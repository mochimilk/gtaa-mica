using System.Security.Cryptography;
using System.Text;

namespace Planning.Application;

/// <summary>Cloud-free authoritative application fixture with version and authority enforcement.</summary>
public sealed class InMemoryPlanningApplicationService : IPlanningApplicationService
{
    private readonly IPlanningRevisionValidator _validator;
    private readonly IPlanningApplicationIdGenerator _ids;
    private readonly Dictionary<string, PlanSnapshot> _plans;
    private readonly Dictionary<string, ReviewRequest> _reviews = new(StringComparer.Ordinal);
    private readonly Dictionary<string, IdempotentResult<PlanSnapshot>> _createResults =
        new(StringComparer.Ordinal);
    private readonly Dictionary<string, IdempotentResult<PlanSnapshot>> _commitResults =
        new(StringComparer.Ordinal);
    private readonly Dictionary<string, IdempotentResult<ReviewRequest>> _submitResults =
        new(StringComparer.Ordinal);
    private readonly Dictionary<string, IdempotentResult<ReviewRequest>> _decisionResults =
        new(StringComparer.Ordinal);
    private readonly Dictionary<string, IdempotentResult<PlanSnapshot>> _publishResults =
        new(StringComparer.Ordinal);

    /// <summary>Creates an in-memory application over frozen initial plans.</summary>
    public InMemoryPlanningApplicationService(
        IEnumerable<PlanSnapshot> initialPlans,
        IPlanningRevisionValidator validator,
        IPlanningApplicationIdGenerator ids)
    {
        ArgumentNullException.ThrowIfNull(initialPlans);
        ArgumentNullException.ThrowIfNull(validator);
        ArgumentNullException.ThrowIfNull(ids);
        _validator = validator;
        _ids = ids;
        _plans = initialPlans.ToDictionary(plan => plan.PlanId, StringComparer.Ordinal);
        foreach (PlanSnapshot plan in _plans.Values)
        {
            ValidateSnapshot(plan);
            RequireFingerprint(plan);
        }
    }

    /// <inheritdoc />
    public Task<ApplicationResult<PlanSnapshot>> GetPlanAsync(
        string planId,
        PlanningActor actor,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ApplicationResult<PlanSnapshot> unauthorized = RequirePermission<PlanSnapshot>(
            actor,
            PlanningAccess.Read);
        if (!unauthorized.Succeeded)
        {
            return Task.FromResult(unauthorized);
        }

        return Task.FromResult(_plans.TryGetValue(planId, out PlanSnapshot? plan)
            ? ApplicationResults.Success(plan)
            : NotFound<PlanSnapshot>("PLAN_NOT_FOUND", $"Plan '{planId}' was not found."));
    }

    /// <inheritdoc />
    public Task<ApplicationResult<PlanSnapshot>> CreateDraftAsync(
        CreateDraftCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        ApplicationResult<PlanSnapshot> unauthorized = RequirePermission<PlanSnapshot>(
            command.Actor,
            PlanningAccess.DraftWrite);
        if (!unauthorized.Succeeded)
        {
            return Task.FromResult(unauthorized);
        }

        string requestFingerprint = Fingerprint(
            "create-draft",
            command.SourcePlanId,
            command.Purpose,
            command.Actor.ActorId);
        if (TryReplay(_createResults, command.IdempotencyKey, requestFingerprint, out ApplicationResult<PlanSnapshot>? replay))
        {
            return Task.FromResult(replay);
        }

        if (!_plans.TryGetValue(command.SourcePlanId, out PlanSnapshot? source))
        {
            ApplicationResult<PlanSnapshot> missing = NotFound<PlanSnapshot>(
                "SOURCE_PLAN_NOT_FOUND",
                $"Source plan '{command.SourcePlanId}' was not found.");
            Store(_createResults, command.IdempotencyKey, requestFingerprint, missing);
            return Task.FromResult(missing);
        }

        string draftId = NextAvailableId("draft", _plans.ContainsKey);
        PlanSnapshot draft = CreateSnapshot(
            draftId,
            1,
            PlanSnapshotState.Draft,
            source.PlanId,
            source.Assignments);
        _plans.Add(draftId, draft);
        ApplicationResult<PlanSnapshot> result = ApplicationResults.Success(draft);
        Store(_createResults, command.IdempotencyKey, requestFingerprint, result);
        return Task.FromResult(result);
    }

    /// <inheritdoc />
    public Task<ApplicationResult<ChangePreview>> PreviewChangesAsync(
        PreviewChangesQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        cancellationToken.ThrowIfCancellationRequested();
        ApplicationResult<ChangePreview> unauthorized = RequirePermission<ChangePreview>(
            query.Actor,
            PlanningAccess.DraftWrite);
        if (!unauthorized.Succeeded)
        {
            return Task.FromResult(unauthorized);
        }

        return Task.FromResult(Preview(query.DraftId, query.ExpectedVersion, query.Changes));
    }

    /// <inheritdoc />
    public Task<ApplicationResult<PlanSnapshot>> CommitChangesAsync(
        CommitChangesCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        ApplicationResult<PlanSnapshot> unauthorized = RequirePermission<PlanSnapshot>(
            command.Actor,
            PlanningAccess.DraftWrite);
        if (!unauthorized.Succeeded)
        {
            return Task.FromResult(unauthorized);
        }

        string requestFingerprint = Fingerprint(
            "commit",
            command.DraftId,
            command.ExpectedVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ChangesFingerprint(command.Changes),
            command.Actor.ActorId);
        if (TryReplay(_commitResults, command.IdempotencyKey, requestFingerprint, out ApplicationResult<PlanSnapshot>? replay))
        {
            return Task.FromResult(replay);
        }

        ApplicationResult<ChangePreview> preview = Preview(
            command.DraftId,
            command.ExpectedVersion,
            command.Changes);
        ApplicationResult<PlanSnapshot> result;
        if (!preview.Succeeded)
        {
            result = ApplicationResults.Failure<PlanSnapshot>(
                preview.Status,
                preview.Error!.Code,
                preview.Error.Detail,
                preview.Error.Validation);
        }
        else if (!preview.Value!.Validation.Passed)
        {
            result = ApplicationResults.Failure<PlanSnapshot>(
                ApplicationResultStatus.Rejected,
                "CHANGE_REJECTED",
                "The proposed complete revision violates required planning rules.",
                preview.Value.Validation);
        }
        else
        {
            PlanSnapshot committed = preview.Value.Proposed;
            _plans[committed.PlanId] = committed;
            result = ApplicationResults.Success(committed);
        }

        Store(_commitResults, command.IdempotencyKey, requestFingerprint, result);
        return Task.FromResult(result);
    }

    /// <inheritdoc />
    public Task<ApplicationResult<ReviewRequest>> SubmitForReviewAsync(
        SubmitForReviewCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        ApplicationResult<ReviewRequest> unauthorized = RequirePermission<ReviewRequest>(
            command.Actor,
            PlanningAccess.ReviewSubmit);
        if (!unauthorized.Succeeded)
        {
            return Task.FromResult(unauthorized);
        }

        string requestFingerprint = Fingerprint(
            "submit-review",
            command.DraftId,
            command.ExpectedVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
            command.Justification,
            command.Actor.ActorId);
        if (TryReplay(_submitResults, command.IdempotencyKey, requestFingerprint, out ApplicationResult<ReviewRequest>? replay))
        {
            return Task.FromResult(replay);
        }

        ApplicationResult<ReviewRequest> result;
        if (!_plans.TryGetValue(command.DraftId, out PlanSnapshot? draft)
            || draft.State != PlanSnapshotState.Draft)
        {
            result = NotFound<ReviewRequest>(
                "DRAFT_NOT_FOUND",
                $"Draft '{command.DraftId}' was not found.");
        }
        else if (draft.Version != command.ExpectedVersion)
        {
            result = Conflict<ReviewRequest>(
                "DRAFT_VERSION_CONFLICT",
                $"Expected draft version {command.ExpectedVersion}, but current version is {draft.Version}.");
        }
        else
        {
            PlanningValidationResult validation = _validator.Validate(draft);
            if (!validation.Passed)
            {
                result = ApplicationResults.Failure<ReviewRequest>(
                    ApplicationResultStatus.Rejected,
                    "DRAFT_INVALID",
                    "The complete draft failed validation.",
                    validation);
            }
            else if (_reviews.Values.Any(review =>
                         string.Equals(review.DraftId, draft.PlanId, StringComparison.Ordinal)
                         && review.Status == ReviewStatus.Pending))
            {
                result = Conflict<ReviewRequest>(
                    "PENDING_REVIEW_EXISTS",
                    $"Draft '{draft.PlanId}' already has a pending review.");
            }
            else
            {
                var review = new ReviewRequest(
                    NextAvailableId("review", _reviews.ContainsKey),
                    draft.PlanId,
                    draft.Version,
                    draft.Fingerprint,
                    ReviewStatus.Pending,
                    command.Justification,
                    command.Actor.ActorId);
                _reviews.Add(review.ReviewRequestId, review);
                result = ApplicationResults.Success(review);
            }
        }

        Store(_submitResults, command.IdempotencyKey, requestFingerprint, result);
        return Task.FromResult(result);
    }

    /// <inheritdoc />
    public Task<ApplicationResult<ReviewRequest>> GetReviewAsync(
        string reviewRequestId,
        PlanningActor actor,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ApplicationResult<ReviewRequest> unauthorized = RequirePermission<ReviewRequest>(
            actor,
            PlanningAccess.Read);
        if (!unauthorized.Succeeded)
        {
            return Task.FromResult(unauthorized);
        }

        return Task.FromResult(_reviews.TryGetValue(reviewRequestId, out ReviewRequest? review)
            ? ApplicationResults.Success(review)
            : NotFound<ReviewRequest>(
                "REVIEW_NOT_FOUND",
                $"Review request '{reviewRequestId}' was not found."));
    }

    /// <inheritdoc />
    public Task<ApplicationResult<ReviewRequest>> DecideReviewAsync(
        DecideReviewCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        ApplicationResult<ReviewRequest> unauthorized = RequireHumanPermission<ReviewRequest>(
            command.Actor,
            PlanningAccess.ReviewDecide);
        if (!unauthorized.Succeeded)
        {
            return Task.FromResult(unauthorized);
        }

        string requestFingerprint = Fingerprint(
            "decide-review",
            command.ReviewRequestId,
            command.Decision.ToString(),
            command.Note,
            command.Actor.ActorId);
        if (TryReplay(_decisionResults, command.IdempotencyKey, requestFingerprint, out ApplicationResult<ReviewRequest>? replay))
        {
            return Task.FromResult(replay);
        }

        ApplicationResult<ReviewRequest> result;
        if (command.Decision is not ReviewStatus.Approved and not ReviewStatus.Rejected)
        {
            result = ApplicationResults.Failure<ReviewRequest>(
                ApplicationResultStatus.Rejected,
                "INVALID_REVIEW_DECISION",
                "A review decision must be Approved or Rejected.");
        }
        else if (!_reviews.TryGetValue(command.ReviewRequestId, out ReviewRequest? review))
        {
            result = NotFound<ReviewRequest>(
                "REVIEW_NOT_FOUND",
                $"Review request '{command.ReviewRequestId}' was not found.");
        }
        else if (review.Status != ReviewStatus.Pending)
        {
            result = Conflict<ReviewRequest>(
                "REVIEW_STATUS_CONFLICT",
                $"Review request '{review.ReviewRequestId}' is {review.Status}, not Pending.");
        }
        else if (!_plans.TryGetValue(review.DraftId, out PlanSnapshot? draft)
                 || draft.Version != review.DraftVersion
                 || !string.Equals(draft.Fingerprint, review.DraftFingerprint, StringComparison.Ordinal))
        {
            result = Conflict<ReviewRequest>(
                "REVIEW_DRAFT_CHANGED",
                "The exact draft revision submitted for review is no longer current.");
        }
        else
        {
            ReviewRequest decided = review with
            {
                Status = command.Decision,
                DecidedBy = command.Actor.ActorId,
                DecisionNote = command.Note
            };
            _reviews[decided.ReviewRequestId] = decided;
            result = ApplicationResults.Success(decided);
        }

        Store(_decisionResults, command.IdempotencyKey, requestFingerprint, result);
        return Task.FromResult(result);
    }

    /// <inheritdoc />
    public Task<ApplicationResult<PlanSnapshot>> PublishApprovedRevisionAsync(
        PublishApprovedRevisionCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        ApplicationResult<PlanSnapshot> unauthorized = RequireHumanPermission<PlanSnapshot>(
            command.Actor,
            PlanningAccess.Publish);
        if (!unauthorized.Succeeded)
        {
            return Task.FromResult(unauthorized);
        }

        string requestFingerprint = Fingerprint(
            "publish",
            command.ReviewRequestId,
            command.Actor.ActorId);
        if (TryReplay(_publishResults, command.IdempotencyKey, requestFingerprint, out ApplicationResult<PlanSnapshot>? replay))
        {
            return Task.FromResult(replay);
        }

        ApplicationResult<PlanSnapshot> result;
        if (!_reviews.TryGetValue(command.ReviewRequestId, out ReviewRequest? review))
        {
            result = NotFound<PlanSnapshot>(
                "REVIEW_NOT_FOUND",
                $"Review request '{command.ReviewRequestId}' was not found.");
        }
        else if (review.Status != ReviewStatus.Approved)
        {
            result = Conflict<PlanSnapshot>(
                "REVIEW_NOT_APPROVED",
                $"Review request '{review.ReviewRequestId}' is {review.Status}, not Approved.");
        }
        else if (!_plans.TryGetValue(review.DraftId, out PlanSnapshot? draft)
                 || draft.Version != review.DraftVersion
                 || !string.Equals(draft.Fingerprint, review.DraftFingerprint, StringComparison.Ordinal))
        {
            result = Conflict<PlanSnapshot>(
                "APPROVED_DRAFT_CHANGED",
                "The exact approved draft revision is no longer current.");
        }
        else
        {
            string publishedId = NextAvailableId("plan", _plans.ContainsKey);
            PlanSnapshot published = CreateSnapshot(
                publishedId,
                1,
                PlanSnapshotState.Published,
                draft.PlanId,
                draft.Assignments);
            _plans.Add(published.PlanId, published);
            _reviews[review.ReviewRequestId] = review with
            {
                Status = ReviewStatus.Published,
                PublishedPlanId = published.PlanId
            };
            result = ApplicationResults.Success(published);
        }

        Store(_publishResults, command.IdempotencyKey, requestFingerprint, result);
        return Task.FromResult(result);
    }

    /// <summary>Creates a verified immutable snapshot for fixtures or adapters.</summary>
    public static PlanSnapshot CreateSnapshot(
        string planId,
        int version,
        PlanSnapshotState state,
        string? sourcePlanId,
        IEnumerable<PlanningAssignment> assignments)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(planId);
        ArgumentNullException.ThrowIfNull(assignments);
        if (version <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(version), "Plan version must be positive.");
        }

        PlanningAssignment[] ordered = assignments
            .OrderBy(assignment => assignment.ItemId, StringComparer.Ordinal)
            .ToArray();
        var snapshot = new PlanSnapshot(
            planId,
            version,
            state,
            sourcePlanId,
            ordered,
            CalculateFingerprint(planId, version, state, sourcePlanId, ordered));
        ValidateSnapshot(snapshot);
        return snapshot;
    }

    private string NextAvailableId(
        string resourceKind,
        Func<string, bool> exists)
    {
        const int maximumAttempts = 1024;
        for (int attempt = 0; attempt < maximumAttempts; attempt++)
        {
            string candidate = _ids.NextId(resourceKind);
            if (string.IsNullOrWhiteSpace(candidate))
            {
                throw new InvalidOperationException(
                    $"The ID generator returned an empty {resourceKind} ID.");
            }

            if (!exists(candidate))
            {
                return candidate;
            }
        }

        throw new InvalidOperationException(
            $"The ID generator did not produce an available {resourceKind} ID "
            + $"within {maximumAttempts} attempts.");
    }

    private ApplicationResult<ChangePreview> Preview(
        string draftId,
        int expectedVersion,
        IReadOnlyList<ReassignItemChange> changes)
    {
        if (!_plans.TryGetValue(draftId, out PlanSnapshot? draft)
            || draft.State != PlanSnapshotState.Draft)
        {
            return NotFound<ChangePreview>(
                "DRAFT_NOT_FOUND",
                $"Draft '{draftId}' was not found.");
        }

        if (draft.Version != expectedVersion)
        {
            return Conflict<ChangePreview>(
                "DRAFT_VERSION_CONFLICT",
                $"Expected draft version {expectedVersion}, but current version is {draft.Version}.");
        }

        string[] duplicateItems = changes
            .GroupBy(change => change.ItemId, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToArray();
        if (duplicateItems.Length > 0)
        {
            return ApplicationResults.Failure<ChangePreview>(
                ApplicationResultStatus.Rejected,
                "DUPLICATE_CHANGE",
                $"A batch may change each item once. Duplicates: {string.Join(", ", duplicateItems)}.");
        }

        Dictionary<string, PlanningAssignment> assignments = draft.Assignments
            .ToDictionary(assignment => assignment.ItemId, StringComparer.Ordinal);
        foreach (ReassignItemChange change in changes)
        {
            if (!assignments.TryGetValue(change.ItemId, out PlanningAssignment? current))
            {
                return NotFound<ChangePreview>(
                    "ITEM_NOT_FOUND",
                    $"Item '{change.ItemId}' is absent from draft '{draftId}'.");
            }

            if (change.NewEndUtc <= change.NewStartUtc)
            {
                return ApplicationResults.Failure<ChangePreview>(
                    ApplicationResultStatus.Rejected,
                    "INVALID_WINDOW",
                    $"Item '{change.ItemId}' must end after it starts.");
            }

            assignments[change.ItemId] = current with
            {
                ResourceId = change.NewResourceId,
                StartUtc = change.NewStartUtc,
                EndUtc = change.NewEndUtc
            };
        }

        PlanSnapshot proposed = CreateSnapshot(
            draft.PlanId,
            draft.Version + 1,
            PlanSnapshotState.Draft,
            draft.SourcePlanId,
            assignments.Values);
        PlanningValidationResult validation = _validator.Validate(proposed);
        return ApplicationResults.Success(
            new ChangePreview(proposed, validation, changes));
    }

    private static ApplicationResult<T> RequirePermission<T>(
        PlanningActor actor,
        PlanningAccess permission)
    {
        ArgumentNullException.ThrowIfNull(actor);
        return actor.Permissions.Contains(permission)
            ? ApplicationResults.Success(default(T)!)
            : ApplicationResults.Failure<T>(
                ApplicationResultStatus.Unauthorized,
                "PERMISSION_DENIED",
                $"Actor '{actor.ActorId}' lacks permission '{permission}'.");
    }

    private static ApplicationResult<T> RequireHumanPermission<T>(
        PlanningActor actor,
        PlanningAccess permission) =>
        actor.Kind == PlanningActorKind.Human
        ? RequirePermission<T>(actor, permission)
        : ApplicationResults.Failure<T>(
            ApplicationResultStatus.Unauthorized,
            "HUMAN_AUTHORITY_REQUIRED",
            $"Permission '{permission}' requires an authenticated human actor.");

    private static bool TryReplay<T>(
        Dictionary<string, IdempotentResult<T>> store,
        string key,
        string fingerprint,
        out ApplicationResult<T> result)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        if (!store.TryGetValue(key, out IdempotentResult<T>? existing))
        {
            result = default!;
            return false;
        }

        result = string.Equals(existing.RequestFingerprint, fingerprint, StringComparison.Ordinal)
            ? existing.Result
            : Conflict<T>(
                "IDEMPOTENCY_CONFLICT",
                $"Idempotency key '{key}' was already used with different request content.");
        return true;
    }

    private static void Store<T>(
        Dictionary<string, IdempotentResult<T>> store,
        string key,
        string fingerprint,
        ApplicationResult<T> result)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        store.Add(key, new IdempotentResult<T>(fingerprint, result));
    }

    private static ApplicationResult<T> NotFound<T>(string code, string detail) =>
        ApplicationResults.Failure<T>(ApplicationResultStatus.NotFound, code, detail);

    private static ApplicationResult<T> Conflict<T>(string code, string detail) =>
        ApplicationResults.Failure<T>(ApplicationResultStatus.Conflict, code, detail);

    private static string ChangesFingerprint(IEnumerable<ReassignItemChange> changes) =>
        Fingerprint(
        [
            "changes",
            .. changes
                .OrderBy(change => change.ItemId, StringComparer.Ordinal)
                .Select(change =>
                    $"{change.ItemId}:{change.NewResourceId}:"
                    + $"{change.NewStartUtc.ToUniversalTime():O}:{change.NewEndUtc.ToUniversalTime():O}")
                .ToArray()
        ]);

    private static string CalculateFingerprint(
        string planId,
        int version,
        PlanSnapshotState state,
        string? sourcePlanId,
        IEnumerable<PlanningAssignment> assignments) =>
        Fingerprint(
        [
            "planning-snapshot-v1",
            planId,
            version.ToString(System.Globalization.CultureInfo.InvariantCulture),
            state.ToString(),
            sourcePlanId ?? string.Empty,
            .. assignments.Select(assignment =>
                $"{assignment.ItemId}:{assignment.ResourceId}:"
                + $"{assignment.StartUtc.ToUniversalTime():O}:{assignment.EndUtc.ToUniversalTime():O}")
                .ToArray()
        ]);

    private static string Fingerprint(params string[] values)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(string.Join("\n", values));
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    private static void RequireFingerprint(PlanSnapshot snapshot)
    {
        string actual = CalculateFingerprint(
            snapshot.PlanId,
            snapshot.Version,
            snapshot.State,
            snapshot.SourcePlanId,
            snapshot.Assignments);
        if (!string.Equals(snapshot.Fingerprint, actual, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Plan '{snapshot.PlanId}' fingerprint does not match its content.");
        }
    }

    private static void ValidateSnapshot(PlanSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentException.ThrowIfNullOrWhiteSpace(snapshot.PlanId);
        if (snapshot.Version <= 0)
        {
            throw new InvalidOperationException(
                $"Plan '{snapshot.PlanId}' has a non-positive version.");
        }

        HashSet<string> itemIds = new(StringComparer.Ordinal);
        foreach (PlanningAssignment assignment in snapshot.Assignments)
        {
            ArgumentNullException.ThrowIfNull(assignment);
            ArgumentException.ThrowIfNullOrWhiteSpace(assignment.ItemId);
            ArgumentException.ThrowIfNullOrWhiteSpace(assignment.ResourceId);
            if (assignment.EndUtc <= assignment.StartUtc)
            {
                throw new InvalidOperationException(
                    $"Assignment '{assignment.ItemId}' must end after it starts.");
            }

            if (!itemIds.Add(assignment.ItemId))
            {
                throw new InvalidOperationException(
                    $"Plan '{snapshot.PlanId}' contains duplicate item '{assignment.ItemId}'.");
            }
        }
    }

    private sealed record IdempotentResult<T>(
        string RequestFingerprint,
        ApplicationResult<T> Result);
}
