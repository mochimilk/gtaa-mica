namespace Planning.Application;

/// <summary>Kind of actor invoking an application capability.</summary>
public enum PlanningActorKind
{
    /// <summary>An authenticated human user.</summary>
    Human,

    /// <summary>An AI assistant or other delegated agent.</summary>
    Agent,

    /// <summary>A non-agent service integration.</summary>
    Service
}

/// <summary>Application permissions evaluated independently for each command.</summary>
public enum PlanningAccess
{
    /// <summary>Read plans, drafts, validation, and review evidence.</summary>
    Read,

    /// <summary>Create drafts and preview or commit draft changes.</summary>
    DraftWrite,

    /// <summary>Submit or withdraw an exact draft version for review.</summary>
    ReviewSubmit,

    /// <summary>Approve or reject a pending review.</summary>
    ReviewDecide,

    /// <summary>Publish an approved exact revision.</summary>
    Publish
}

/// <summary>Authenticated application actor and granted permissions.</summary>
public sealed record PlanningActor(
    string ActorId,
    PlanningActorKind Kind,
    IReadOnlySet<PlanningAccess> Permissions);

/// <summary>One assignment in a versioned plan or draft.</summary>
public sealed record PlanningAssignment(
    string ItemId,
    string ResourceId,
    DateTimeOffset StartUtc,
    DateTimeOffset EndUtc);

/// <summary>Lifecycle state of a plan snapshot.</summary>
public enum PlanSnapshotState
{
    /// <summary>Immutable plan available as a source for drafts.</summary>
    Published,

    /// <summary>Mutable-by-command draft represented by immutable versions.</summary>
    Draft
}

/// <summary>Immutable application view of one plan or draft version.</summary>
public sealed record PlanSnapshot(
    string PlanId,
    int Version,
    PlanSnapshotState State,
    string? SourcePlanId,
    IReadOnlyList<PlanningAssignment> Assignments,
    string Fingerprint);

/// <summary>One typed assignment replacement proposed against a draft.</summary>
public sealed record ReassignItemChange(
    string ItemId,
    string NewResourceId,
    DateTimeOffset NewStartUtc,
    DateTimeOffset NewEndUtc);

/// <summary>Finding returned by authoritative application validation.</summary>
public sealed record PlanningValidationFinding(
    string Code,
    string Detail,
    string? ItemId = null,
    string? OtherItemId = null,
    string? ResourceId = null);

/// <summary>Complete validation evidence for one proposed revision.</summary>
public sealed record PlanningValidationResult(
    IReadOnlyList<PlanningValidationFinding> Findings)
{
    /// <summary>Whether no hard-rule or evidence finding blocks the proposal.</summary>
    public bool Passed => Findings.Count == 0;
}

/// <summary>Preview evidence without persisted draft mutation.</summary>
public sealed record ChangePreview(
    PlanSnapshot Proposed,
    PlanningValidationResult Validation,
    IReadOnlyList<ReassignItemChange> Changes);

/// <summary>Review workflow status.</summary>
public enum ReviewStatus
{
    /// <summary>Awaiting an authorized human decision.</summary>
    Pending,

    /// <summary>Approved by an authorized human.</summary>
    Approved,

    /// <summary>Rejected by an authorized human.</summary>
    Rejected,

    /// <summary>Withdrawn before decision.</summary>
    Withdrawn,

    /// <summary>The approved exact revision was published.</summary>
    Published
}

/// <summary>Immutable view of one review request.</summary>
public sealed record ReviewRequest(
    string ReviewRequestId,
    string DraftId,
    int DraftVersion,
    string DraftFingerprint,
    ReviewStatus Status,
    string Justification,
    string SubmittedBy,
    string? DecidedBy = null,
    string? DecisionNote = null,
    string? PublishedPlanId = null);

/// <summary>Stable application result classification shared by HTTP and MCP adapters.</summary>
public enum ApplicationResultStatus
{
    /// <summary>The operation completed successfully.</summary>
    Succeeded,

    /// <summary>Input or domain validation rejected the operation.</summary>
    Rejected,

    /// <summary>The target resource does not exist.</summary>
    NotFound,

    /// <summary>The expected version or idempotent request content conflicts.</summary>
    Conflict,

    /// <summary>The actor lacks required authority.</summary>
    Unauthorized
}

/// <summary>Stable structured application error.</summary>
public sealed record ApplicationError(
    string Code,
    string Detail,
    PlanningValidationResult? Validation = null);

/// <summary>Typed success or explicit failure returned by an application operation.</summary>
public sealed record ApplicationResult<T>(
    ApplicationResultStatus Status,
    T? Value = default,
    ApplicationError? Error = null)
{
    /// <summary>Whether the operation completed successfully.</summary>
    public bool Succeeded => Status == ApplicationResultStatus.Succeeded;
}

/// <summary>Factory methods for typed application results.</summary>
public static class ApplicationResults
{
    /// <summary>Creates a successful result.</summary>
    public static ApplicationResult<T> Success<T>(T value) =>
        new(ApplicationResultStatus.Succeeded, value);

    /// <summary>Creates an explicit failed result.</summary>
    public static ApplicationResult<T> Failure<T>(
        ApplicationResultStatus status,
        string code,
        string detail,
        PlanningValidationResult? validation = null) =>
        new(status, Error: new ApplicationError(code, detail, validation));
}

/// <summary>Creates a versioned draft from an immutable source plan.</summary>
public sealed record CreateDraftCommand(
    string SourcePlanId,
    string Purpose,
    string IdempotencyKey,
    PlanningActor Actor);

/// <summary>Previews changes against one expected draft version.</summary>
public sealed record PreviewChangesQuery(
    string DraftId,
    int ExpectedVersion,
    IReadOnlyList<ReassignItemChange> Changes,
    PlanningActor Actor);

/// <summary>Commits validated changes to one expected draft version.</summary>
public sealed record CommitChangesCommand(
    string DraftId,
    int ExpectedVersion,
    IReadOnlyList<ReassignItemChange> Changes,
    string IdempotencyKey,
    PlanningActor Actor);

/// <summary>Submits one exact draft version for human review.</summary>
public sealed record SubmitForReviewCommand(
    string DraftId,
    int ExpectedVersion,
    string Justification,
    string IdempotencyKey,
    PlanningActor Actor);

/// <summary>Records an authorized human decision on a pending review.</summary>
public sealed record DecideReviewCommand(
    string ReviewRequestId,
    ReviewStatus Decision,
    string Note,
    string IdempotencyKey,
    PlanningActor Actor);

/// <summary>Publishes the exact approved draft revision.</summary>
public sealed record PublishApprovedRevisionCommand(
    string ReviewRequestId,
    string IdempotencyKey,
    PlanningActor Actor);

/// <summary>Authoritative validator for one complete proposed snapshot.</summary>
public interface IPlanningRevisionValidator
{
    /// <summary>Validates all interactions in the proposed complete revision.</summary>
    PlanningValidationResult Validate(PlanSnapshot proposed);
}

/// <summary>Generates destination-controlled immutable application IDs.</summary>
public interface IPlanningApplicationIdGenerator
{
    /// <summary>Returns the next ID for the requested resource kind.</summary>
    string NextId(string resourceKind);
}

/// <summary>Transport-neutral authoritative planning application boundary.</summary>
public interface IPlanningApplicationService
{
    /// <summary>Gets one immutable plan or draft version.</summary>
    Task<ApplicationResult<PlanSnapshot>> GetPlanAsync(
        string planId,
        PlanningActor actor,
        CancellationToken cancellationToken);

    /// <summary>Creates a draft from an immutable plan.</summary>
    Task<ApplicationResult<PlanSnapshot>> CreateDraftAsync(
        CreateDraftCommand command,
        CancellationToken cancellationToken);

    /// <summary>Previews changes without mutation.</summary>
    Task<ApplicationResult<ChangePreview>> PreviewChangesAsync(
        PreviewChangesQuery query,
        CancellationToken cancellationToken);

    /// <summary>Commits validated changes and returns a new draft version.</summary>
    Task<ApplicationResult<PlanSnapshot>> CommitChangesAsync(
        CommitChangesCommand command,
        CancellationToken cancellationToken);

    /// <summary>Submits an exact draft version for human review.</summary>
    Task<ApplicationResult<ReviewRequest>> SubmitForReviewAsync(
        SubmitForReviewCommand command,
        CancellationToken cancellationToken);

    /// <summary>Gets one review request.</summary>
    Task<ApplicationResult<ReviewRequest>> GetReviewAsync(
        string reviewRequestId,
        PlanningActor actor,
        CancellationToken cancellationToken);

    /// <summary>Approves or rejects a pending review as an authorized human.</summary>
    Task<ApplicationResult<ReviewRequest>> DecideReviewAsync(
        DecideReviewCommand command,
        CancellationToken cancellationToken);

    /// <summary>Publishes the exact approved revision as an authorized human.</summary>
    Task<ApplicationResult<PlanSnapshot>> PublishApprovedRevisionAsync(
        PublishApprovedRevisionCommand command,
        CancellationToken cancellationToken);
}
