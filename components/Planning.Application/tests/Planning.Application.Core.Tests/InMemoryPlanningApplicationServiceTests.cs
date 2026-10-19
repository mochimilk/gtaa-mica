using FluentAssertions;

namespace Planning.Application.Tests;

public sealed class InMemoryPlanningApplicationServiceTests
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task CreateDraftAsync_ReplayedCommand_ReturnsSameDraft()
    {
        InMemoryPlanningApplicationService service = Service();
        var command = new CreateDraftCommand(
            "plan-1",
            "Evaluate an alternative",
            "create-1",
            Agent());

        ApplicationResult<PlanSnapshot> first = await service.CreateDraftAsync(
            command,
            CancellationToken.None);
        ApplicationResult<PlanSnapshot> replay = await service.CreateDraftAsync(
            command,
            CancellationToken.None);

        first.Succeeded.Should().BeTrue();
        replay.Should().BeEquivalentTo(first);
        first.Value!.PlanId.Should().Be("draft-generated-1");
    }

    [Fact]
    public async Task CreateDraftAsync_ReusedKeyWithChangedContent_ReturnsConflict()
    {
        InMemoryPlanningApplicationService service = Service();
        await service.CreateDraftAsync(
            new CreateDraftCommand("plan-1", "First purpose", "create-1", Agent()),
            CancellationToken.None);

        ApplicationResult<PlanSnapshot> result = await service.CreateDraftAsync(
            new CreateDraftCommand("plan-1", "Changed purpose", "create-1", Agent()),
            CancellationToken.None);

        result.Status.Should().Be(ApplicationResultStatus.Conflict);
        result.Error!.Code.Should().Be("IDEMPOTENCY_CONFLICT");
    }

    [Fact]
    public async Task PreviewAndCommit_PreviewDoesNotMutateAndCommitCreatesNewVersion()
    {
        InMemoryPlanningApplicationService service = Service();
        PlanSnapshot draft = await CreateDraftAsync(service);
        ReassignItemChange change = Change("item-1", "resource-3", 0, 60);

        ApplicationResult<ChangePreview> preview = await service.PreviewChangesAsync(
            new PreviewChangesQuery(draft.PlanId, draft.Version, [change], Agent()),
            CancellationToken.None);
        ApplicationResult<PlanSnapshot> unchanged = await service.GetPlanAsync(
            draft.PlanId,
            Reader(),
            CancellationToken.None);
        ApplicationResult<PlanSnapshot> committed = await service.CommitChangesAsync(
            new CommitChangesCommand(
                draft.PlanId,
                draft.Version,
                [change],
                "commit-1",
                Agent()),
            CancellationToken.None);

        preview.Succeeded.Should().BeTrue();
        preview.Value!.Proposed.Version.Should().Be(2);
        unchanged.Value!.Version.Should().Be(1);
        unchanged.Value.Assignments.Single(item => item.ItemId == "item-1")
            .ResourceId.Should().Be("resource-1");
        committed.Value!.Version.Should().Be(2);
        committed.Value.Assignments.Single(item => item.ItemId == "item-1")
            .ResourceId.Should().Be("resource-3");
    }

    [Fact]
    public async Task CommitChangesAsync_OverlappingAssignments_IsRejectedWithoutMutation()
    {
        InMemoryPlanningApplicationService service = Service();
        PlanSnapshot draft = await CreateDraftAsync(service);

        ApplicationResult<PlanSnapshot> result = await service.CommitChangesAsync(
            new CommitChangesCommand(
                draft.PlanId,
                draft.Version,
                [Change("item-2", "resource-1", 30, 90)],
                "commit-overlap",
                Agent()),
            CancellationToken.None);
        ApplicationResult<PlanSnapshot> unchanged = await service.GetPlanAsync(
            draft.PlanId,
            Reader(),
            CancellationToken.None);

        result.Status.Should().Be(ApplicationResultStatus.Rejected);
        result.Error!.Code.Should().Be("CHANGE_REJECTED");
        result.Error.Validation!.Findings.Should().ContainSingle(finding =>
            finding.Code == "RESOURCE_OVERLAP");
        unchanged.Value!.Version.Should().Be(1);
    }

    [Fact]
    public async Task CommitChangesAsync_StaleExpectedVersion_ReturnsConflict()
    {
        InMemoryPlanningApplicationService service = Service();
        PlanSnapshot draft = await CreateDraftAsync(service);
        await service.CommitChangesAsync(
            new CommitChangesCommand(
                draft.PlanId,
                1,
                [Change("item-1", "resource-3", 0, 60)],
                "commit-1",
                Agent()),
            CancellationToken.None);

        ApplicationResult<PlanSnapshot> result = await service.CommitChangesAsync(
            new CommitChangesCommand(
                draft.PlanId,
                1,
                [Change("item-1", "resource-1", 0, 60)],
                "commit-stale",
                Agent()),
            CancellationToken.None);

        result.Status.Should().Be(ApplicationResultStatus.Conflict);
        result.Error!.Code.Should().Be("DRAFT_VERSION_CONFLICT");
    }

    [Fact]
    public async Task AgentCanSubmitButCannotApproveOrPublish()
    {
        InMemoryPlanningApplicationService service = Service();
        PlanSnapshot draft = await CreateDraftAsync(service);
        ApplicationResult<ReviewRequest> submitted = await service.SubmitForReviewAsync(
            new SubmitForReviewCommand(
                draft.PlanId,
                draft.Version,
                "Ready for review",
                "submit-1",
                Agent()),
            CancellationToken.None);

        ApplicationResult<ReviewRequest> decision = await service.DecideReviewAsync(
            new DecideReviewCommand(
                submitted.Value!.ReviewRequestId,
                ReviewStatus.Approved,
                "Agent approval attempt",
                "decision-agent",
                AgentWithAllPermissions()),
            CancellationToken.None);
        ApplicationResult<PlanSnapshot> publication = await service.PublishApprovedRevisionAsync(
            new PublishApprovedRevisionCommand(
                submitted.Value.ReviewRequestId,
                "publish-agent",
                AgentWithAllPermissions()),
            CancellationToken.None);

        submitted.Succeeded.Should().BeTrue();
        decision.Status.Should().Be(ApplicationResultStatus.Unauthorized);
        decision.Error!.Code.Should().Be("HUMAN_AUTHORITY_REQUIRED");
        publication.Status.Should().Be(ApplicationResultStatus.Unauthorized);
        publication.Error!.Code.Should().Be("HUMAN_AUTHORITY_REQUIRED");
    }

    [Fact]
    public async Task HumanApprovalAndPublication_PreserveExactReviewedRevision()
    {
        InMemoryPlanningApplicationService service = Service();
        PlanSnapshot draft = await CreateDraftAsync(service);
        ApplicationResult<ReviewRequest> submitted = await service.SubmitForReviewAsync(
            new SubmitForReviewCommand(
                draft.PlanId,
                draft.Version,
                "Ready for review",
                "submit-1",
                Agent()),
            CancellationToken.None);
        ApplicationResult<ReviewRequest> approved = await service.DecideReviewAsync(
            new DecideReviewCommand(
                submitted.Value!.ReviewRequestId,
                ReviewStatus.Approved,
                "Approved",
                "decision-1",
                Reviewer()),
            CancellationToken.None);
        ApplicationResult<PlanSnapshot> published = await service.PublishApprovedRevisionAsync(
            new PublishApprovedRevisionCommand(
                approved.Value!.ReviewRequestId,
                "publish-1",
                Publisher()),
            CancellationToken.None);

        approved.Value.Status.Should().Be(ReviewStatus.Approved);
        published.Succeeded.Should().BeTrue();
        published.Value!.State.Should().Be(PlanSnapshotState.Published);
        published.Value.SourcePlanId.Should().Be(draft.PlanId);
        ApplicationResult<ReviewRequest> finalReview = await service.GetReviewAsync(
            approved.Value.ReviewRequestId,
            Reader(),
            CancellationToken.None);
        finalReview.Value!.Status.Should().Be(ReviewStatus.Published);
        finalReview.Value.PublishedPlanId.Should().Be(published.Value.PlanId);
    }

    [Fact]
    public async Task Publication_IdGeneratorCollidesWithExistingPlan_SkipsCollision()
    {
        PlanSnapshot source = InMemoryPlanningApplicationService.CreateSnapshot(
            "plan-generated-1",
            1,
            PlanSnapshotState.Published,
            null,
            [
                Assignment("item-1", "resource-1", 0, 60),
                Assignment("item-2", "resource-2", 30, 90)
            ]);
        var service = new InMemoryPlanningApplicationService(
            [source],
            new ResourceOverlapValidator(),
            new SequentialIdGenerator());
        ApplicationResult<PlanSnapshot> draft = await service.CreateDraftAsync(
            new CreateDraftCommand(
                source.PlanId,
                "Fixture draft",
                "create-collision",
                Agent()),
            CancellationToken.None);
        ApplicationResult<ReviewRequest> submitted = await service.SubmitForReviewAsync(
            new SubmitForReviewCommand(
                draft.Value!.PlanId,
                draft.Value.Version,
                "Ready for review",
                "submit-collision",
                Agent()),
            CancellationToken.None);
        ApplicationResult<ReviewRequest> approved = await service.DecideReviewAsync(
            new DecideReviewCommand(
                submitted.Value!.ReviewRequestId,
                ReviewStatus.Approved,
                "Approved",
                "decision-collision",
                Reviewer()),
            CancellationToken.None);

        ApplicationResult<PlanSnapshot> published = await service.PublishApprovedRevisionAsync(
            new PublishApprovedRevisionCommand(
                approved.Value!.ReviewRequestId,
                "publish-collision",
                Publisher()),
            CancellationToken.None);

        published.Succeeded.Should().BeTrue();
        published.Value!.PlanId.Should().Be("plan-generated-2");
    }

    [Fact]
    public async Task PublishApprovedRevisionAsync_DraftChangedAfterApproval_ReturnsConflict()
    {
        InMemoryPlanningApplicationService service = Service();
        PlanSnapshot draft = await CreateDraftAsync(service);
        ApplicationResult<ReviewRequest> submitted = await service.SubmitForReviewAsync(
            new SubmitForReviewCommand(
                draft.PlanId,
                draft.Version,
                "Ready for review",
                "submit-1",
                Agent()),
            CancellationToken.None);
        ApplicationResult<ReviewRequest> approved = await service.DecideReviewAsync(
            new DecideReviewCommand(
                submitted.Value!.ReviewRequestId,
                ReviewStatus.Approved,
                "Approved",
                "decision-1",
                Reviewer()),
            CancellationToken.None);
        await service.CommitChangesAsync(
            new CommitChangesCommand(
                draft.PlanId,
                draft.Version,
                [Change("item-1", "resource-3", 0, 60)],
                "commit-after-review",
                Agent()),
            CancellationToken.None);

        ApplicationResult<PlanSnapshot> result = await service.PublishApprovedRevisionAsync(
            new PublishApprovedRevisionCommand(
                approved.Value!.ReviewRequestId,
                "publish-1",
                Publisher()),
            CancellationToken.None);

        result.Status.Should().Be(ApplicationResultStatus.Conflict);
        result.Error!.Code.Should().Be("APPROVED_DRAFT_CHANGED");
    }

    private static InMemoryPlanningApplicationService Service() => new(
        [PublishedPlan()],
        new ResourceOverlapValidator(),
        new SequentialIdGenerator());

    private static async Task<PlanSnapshot> CreateDraftAsync(
        InMemoryPlanningApplicationService service)
    {
        ApplicationResult<PlanSnapshot> result = await service.CreateDraftAsync(
            new CreateDraftCommand(
                "plan-1",
                "Fixture draft",
                "create-1",
                Agent()),
            CancellationToken.None);
        return result.Value!;
    }

    private static PlanSnapshot PublishedPlan() =>
        InMemoryPlanningApplicationService.CreateSnapshot(
            "plan-1",
            1,
            PlanSnapshotState.Published,
            null,
            [
                Assignment("item-1", "resource-1", 0, 60),
                Assignment("item-2", "resource-2", 30, 90)
            ]);

    private static PlanningAssignment Assignment(
        string itemId,
        string resourceId,
        int startMinutes,
        int endMinutes) => new(
            itemId,
            resourceId,
            Start.AddMinutes(startMinutes),
            Start.AddMinutes(endMinutes));

    private static ReassignItemChange Change(
        string itemId,
        string resourceId,
        int startMinutes,
        int endMinutes) => new(
            itemId,
            resourceId,
            Start.AddMinutes(startMinutes),
            Start.AddMinutes(endMinutes));

    private static PlanningActor Agent() => new(
        "agent-1",
        PlanningActorKind.Agent,
        Set(PlanningAccess.Read, PlanningAccess.DraftWrite, PlanningAccess.ReviewSubmit));

    private static PlanningActor AgentWithAllPermissions() => new(
        "agent-1",
        PlanningActorKind.Agent,
        Enum.GetValues<PlanningAccess>().ToHashSet());

    private static PlanningActor Reader() => new(
        "reader-1",
        PlanningActorKind.Human,
        Set(PlanningAccess.Read));

    private static PlanningActor Reviewer() => new(
        "reviewer-1",
        PlanningActorKind.Human,
        Set(PlanningAccess.Read, PlanningAccess.ReviewDecide));

    private static PlanningActor Publisher() => new(
        "publisher-1",
        PlanningActorKind.Human,
        Set(PlanningAccess.Read, PlanningAccess.Publish));

    private static HashSet<PlanningAccess> Set(params PlanningAccess[] values) =>
        values.ToHashSet();

    private sealed class SequentialIdGenerator : IPlanningApplicationIdGenerator
    {
        private readonly Dictionary<string, int> _counts = new(StringComparer.Ordinal);

        public string NextId(string resourceKind)
        {
            int next = _counts.GetValueOrDefault(resourceKind) + 1;
            _counts[resourceKind] = next;
            return $"{resourceKind}-generated-{next}";
        }
    }

    private sealed class ResourceOverlapValidator : IPlanningRevisionValidator
    {
        public PlanningValidationResult Validate(PlanSnapshot proposed)
        {
            PlanningAssignment[] assignments = proposed.Assignments
                .OrderBy(assignment => assignment.StartUtc)
                .ToArray();
            var findings = new List<PlanningValidationFinding>();
            for (int left = 0; left < assignments.Length; left++)
            {
                for (int right = left + 1; right < assignments.Length; right++)
                {
                    PlanningAssignment first = assignments[left];
                    PlanningAssignment second = assignments[right];
                    if (string.Equals(first.ResourceId, second.ResourceId, StringComparison.Ordinal)
                        && first.StartUtc < second.EndUtc
                        && first.EndUtc > second.StartUtc)
                    {
                        findings.Add(new PlanningValidationFinding(
                            "RESOURCE_OVERLAP",
                            $"Items '{first.ItemId}' and '{second.ItemId}' overlap.",
                            first.ItemId,
                            second.ItemId,
                            first.ResourceId));
                    }
                }
            }

            return new PlanningValidationResult(findings);
        }
    }
}
