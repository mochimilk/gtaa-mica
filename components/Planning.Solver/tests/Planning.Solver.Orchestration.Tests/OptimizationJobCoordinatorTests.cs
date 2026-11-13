using FluentAssertions;
using Planning.Solver.OrTools;
using Planning.Solver.Worker.Local;

namespace Planning.Solver.Orchestration.Tests;

public sealed class OptimizationJobCoordinatorTests
{
    [Fact]
    public async Task ExecuteAsync_AcceptedCpSatPlan_PublishesCompleteLineage()
    {
        var store = new InMemoryOptimizationJobStore();
        var publisher = new InMemoryOptimizationResultPublisher();
        OptimizationJobCoordinator coordinator = Coordinator(store, publisher, new CpSatStrategy());

        OptimizationJobRecord record = await coordinator.ExecuteAsync(OrchestrationFixture.Request());

        record.State.Should().Be(OptimizationJobState.Succeeded);
        record.ExecutionCount.Should().Be(1);
        record.PlanDisposition.Should().Be(PlanDisposition.Accepted);
        record.PublicationState.Should().Be(ResultPublicationState.Published);
        record.Error.Should().BeNull();
        record.Artifacts.Manifest.Should().NotBeNull();
        record.Artifacts.Candidates!.Lineage.RunManifestFingerprint
            .Should().Be(record.Artifacts.Manifest!.Fingerprint);
        record.Artifacts.Optimization!.Lineage.RunManifestFingerprint
            .Should().Be(record.Artifacts.Manifest.Fingerprint);
        record.Artifacts.Validation!.Lineage.RunManifestFingerprint
            .Should().Be(record.Artifacts.Manifest.Fingerprint);
        record.Artifacts.Score!.Lineage.RunManifestFingerprint
            .Should().Be(record.Artifacts.Manifest.Fingerprint);
        publisher.Published.Should().ContainKey(record.Request.JobId);
    }

    [Fact]
    public async Task ExecuteAsync_IdenticalIdempotencyRequest_ExecutesAndPublishesOnce()
    {
        var store = new InMemoryOptimizationJobStore();
        var publisher = new InMemoryOptimizationResultPublisher();
        OptimizationJobCoordinator coordinator = Coordinator(store, publisher, new CpSatStrategy());
        OptimizationJobRequest request = OrchestrationFixture.Request();

        OptimizationJobRecord first = await coordinator.ExecuteAsync(request);
        OptimizationJobRecord second = await coordinator.ExecuteAsync(request);

        second.Should().BeEquivalentTo(first);
        second.ExecutionCount.Should().Be(1);
        publisher.Published.Should().ContainSingle();
    }

    [Fact]
    public async Task ExecuteAsync_ReusedKeyWithChangedRequest_FailsExplicitly()
    {
        var store = new InMemoryOptimizationJobStore();
        var publisher = new InMemoryOptimizationResultPublisher();
        OptimizationJobCoordinator coordinator = Coordinator(store, publisher, new CpSatStrategy());
        OptimizationJobRequest original = OrchestrationFixture.Request();
        OptimizationJobRequest changed = original with { JobId = "different-job" };
        await coordinator.ExecuteAsync(original);

        Func<Task> action = async () => await coordinator.ExecuteAsync(changed);

        await action.Should().ThrowAsync<OptimizationJobConflictException>()
            .WithMessage("*already bound to a different request*");
        publisher.Published.Should().ContainSingle();
    }

    [Fact]
    public async Task ExecuteAsync_UnknownSolverStatus_DoesNotValidateScoreOrPublishPlan()
    {
        var strategy = new TestStrategy("unknown-strategy", "Unknown", selectOverlapping: false);
        var store = new InMemoryOptimizationJobStore();
        var publisher = new InMemoryOptimizationResultPublisher();
        OptimizationJobCoordinator coordinator = Coordinator(store, publisher, strategy);

        OptimizationJobRecord record = await coordinator.ExecuteAsync(
            OrchestrationFixture.Request(strategy.StrategyId));

        record.State.Should().Be(OptimizationJobState.Succeeded);
        record.PlanDisposition.Should().Be(PlanDisposition.NoFeasibleSolution);
        record.PublicationState.Should().Be(ResultPublicationState.NotRequested);
        record.Artifacts.Optimization!.Status.Should().Be("Unknown");
        record.Artifacts.Validation.Should().BeNull();
        record.Artifacts.Score.Should().BeNull();
        publisher.Published.Should().BeEmpty();
    }

    [Fact]
    public async Task ExecuteAsync_IndependentlyRejectedPlan_IsNotPublished()
    {
        var strategy = new TestStrategy("invalid-plan-strategy", "Feasible", selectOverlapping: true);
        var store = new InMemoryOptimizationJobStore();
        var publisher = new InMemoryOptimizationResultPublisher();
        OptimizationJobCoordinator coordinator = Coordinator(store, publisher, strategy);

        OptimizationJobRecord record = await coordinator.ExecuteAsync(
            OrchestrationFixture.Request(strategy.StrategyId));

        record.State.Should().Be(OptimizationJobState.Succeeded);
        record.PlanDisposition.Should().Be(PlanDisposition.Rejected);
        record.PublicationState.Should().Be(ResultPublicationState.NotRequested);
        record.Artifacts.Validation!.Passed.Should().BeFalse();
        record.Artifacts.Score!.Accepted.Should().BeFalse();
        publisher.Published.Should().BeEmpty();
    }

    [Fact]
    public async Task ExecuteAsync_CancelledSolver_PersistsCancellationEvidence()
    {
        var strategy = new CancellingStrategy();
        var store = new InMemoryOptimizationJobStore();
        var publisher = new InMemoryOptimizationResultPublisher();
        OptimizationJobCoordinator coordinator = Coordinator(store, publisher, strategy);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        OptimizationJobRecord record = await coordinator.ExecuteAsync(
            OrchestrationFixture.Request(strategy.StrategyId),
            cancellation.Token);

        record.State.Should().Be(OptimizationJobState.Cancelled);
        record.PlanDisposition.Should().Be(PlanDisposition.NotEvaluated);
        record.Error.Should().NotBeNull();
        record.Error!.Code.Should().Be("JOB_CANCELLED");
        record.Error.Phase.Should().Be("optimization");
        record.Artifacts.Candidates.Should().NotBeNull();
        record.Artifacts.Optimization.Should().BeNull();
        publisher.Published.Should().BeEmpty();
    }

    [Fact]
    public async Task ExecuteAsync_PublicationFailure_PreservesAcceptedPlanAndExplicitError()
    {
        var store = new InMemoryOptimizationJobStore();
        var publisher = new FailingPublisher();
        OptimizationJobCoordinator coordinator = Coordinator(store, publisher, new CpSatStrategy());

        OptimizationJobRecord record = await coordinator.ExecuteAsync(OrchestrationFixture.Request());

        record.State.Should().Be(OptimizationJobState.Failed);
        record.PlanDisposition.Should().Be(PlanDisposition.Accepted);
        record.PublicationState.Should().Be(ResultPublicationState.Failed);
        record.Artifacts.Validation!.Passed.Should().BeTrue();
        record.Artifacts.Score!.Accepted.Should().BeTrue();
        record.Error!.Phase.Should().Be("publication");
        record.Error.Code.Should().Be("PUBLISHER_UNAVAILABLE");
        record.Error.IsRetryable.Should().BeTrue();
        record.Error.Message.Should().Be("Publisher unavailable.");
    }

    [Fact]
    public void RequestFingerprint_FeatureFlagOrder_DoesNotChangeFingerprint()
    {
        OptimizationJobRequest first = OrchestrationFixture.Request() with
        {
            FeatureFlags = new Dictionary<string, bool>(StringComparer.Ordinal)
            {
                ["alpha"] = true,
                ["beta"] = false
            }
        };
        OptimizationJobRequest reordered = first with
        {
            FeatureFlags = new Dictionary<string, bool>(StringComparer.Ordinal)
            {
                ["beta"] = false,
                ["alpha"] = true
            }
        };

        OptimizationJobFingerprints.Request(reordered)
            .Should().Be(OptimizationJobFingerprints.Request(first));
    }

    [Fact]
    public void RequestFingerprint_MetricInputsChange_ChangesFingerprint()
    {
        OptimizationJobRequest first = OrchestrationFixture.Request() with
        {
            MetricInputs = MetricInputSet.Create([new TestMetricInputDataset("source-a")])
        };
        OptimizationJobRequest changed = first with
        {
            MetricInputs = MetricInputSet.Create([new TestMetricInputDataset("source-b")])
        };

        OptimizationJobFingerprints.Request(changed)
            .Should().NotBe(OptimizationJobFingerprints.Request(first));
    }

    private static OptimizationJobCoordinator Coordinator(
        IOptimizationJobStore store,
        IOptimizationResultPublisher publisher,
        params IOptimizationStrategy[] strategies) => new(
        new OptimizationStrategyRegistry(strategies),
        store,
        publisher);

    private sealed class TestStrategy(
        string strategyId,
        string status,
        bool selectOverlapping) : IOptimizationStrategy
    {
        public StrategyCapabilities Capabilities { get; } = CreateCapabilities(strategyId);

        public string StrategyId => Capabilities.StrategyId;

        public string Version => Capabilities.Version;

        public OptimizationResult Solve(
            RunManifest manifest,
            ProblemSnapshot problem,
            RulePackage rules,
            CandidateBatch candidates,
            CompiledProfile profile,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            RunManifestFactory.VerifyOptimizationInputs(
                manifest,
                problem,
                profile,
                rules,
                candidates,
                this);
            IReadOnlyList<SelectedAssignment> assignments = selectOverlapping
                ? candidates.Eligible
                    .GroupBy(candidate => candidate.SubjectId, StringComparer.Ordinal)
                    .Select(group => group.First())
                    .Select(candidate => new SelectedAssignment(
                        candidate.AlternativeId,
                        candidate.SubjectId,
                        candidate.SegmentId,
                        candidate.ResourceId,
                        candidate.Window))
                    .ToList()
                : [];
            HashSet<string> assigned = assignments
                .Select(assignment => assignment.SubjectId)
                .ToHashSet(StringComparer.Ordinal);
            IReadOnlyList<UnassignedSubject> unassigned = problem.Subjects
                .Where(subject => !assigned.Contains(subject.SubjectId))
                .Select(subject => new UnassignedSubject(subject.SubjectId, "NOT_SELECTED"))
                .ToList();
            var result = new OptimizationResult(
                StrategyId,
                Version,
                status,
                assignments,
                unassigned,
                new ArtifactLineage(
                    manifest.Fingerprint,
                    candidates.Lineage.ArtifactFingerprint,
                    string.Empty));
            return result with
            {
                Lineage = result.Lineage with { ArtifactFingerprint = ArtifactFingerprints.Plan(result) }
            };
        }

    }

    private sealed class TestMetricInputDataset(string source) : IMetricInputDataset
    {
        public MetricInputDescriptor Descriptor { get; } = new(
            "test-metric-input",
            "1.0.0",
            MetricValueKind.Predicted,
            new DateTimeOffset(2027, 1, 14, 17, 0, 0, TimeSpan.Zero),
            source,
            "test-content");

        public string CalculateContentFingerprint() => "test-content";
    }

    private sealed class CancellingStrategy : IOptimizationStrategy
    {
        public StrategyCapabilities Capabilities { get; } = CreateCapabilities("cancelling-strategy");

        public string StrategyId => Capabilities.StrategyId;

        public string Version => Capabilities.Version;

        public OptimizationResult Solve(
            RunManifest manifest,
            ProblemSnapshot problem,
            RulePackage rules,
            CandidateBatch candidates,
            CompiledProfile profile,
            CancellationToken cancellationToken)
        {
            RunManifestFactory.VerifyOptimizationInputs(
                manifest,
                problem,
                profile,
                rules,
                candidates,
                this);
            Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).GetAwaiter().GetResult();
            throw new InvalidOperationException("Cancellation was not observed.");
        }
    }

    private sealed class FailingPublisher : IOptimizationResultPublisher
    {
        public ValueTask PublishAsync(
            OptimizationJobRequest request,
            OptimizationJobArtifacts artifacts,
            CancellationToken cancellationToken) =>
            ValueTask.FromException(new TestAdapterException());
    }

    private sealed class TestAdapterException()
        : InvalidOperationException("Publisher unavailable."), IOptimizationFailureMetadata
    {
        public string ErrorCode => "PUBLISHER_UNAVAILABLE";

        public bool IsRetryable => true;
    }

    private static StrategyCapabilities CreateCapabilities(string strategyId) => new(
        strategyId,
        "1.0.0",
        new HashSet<string>(
        [
            BuiltInMetrics.AssignmentCoverage,
            BuiltInMetrics.ResourceCost
        ],
        StringComparer.Ordinal),
        new HashSet<ObjectiveComposition>
        {
            ObjectiveComposition.WeightedSum
        },
        [
            new(
                RequiredCapabilitiesRule.Id,
                RequiredCapabilitiesRule.Version,
                SolverRuleRepresentation.CandidateFilter),
            new(
                ResourceCommitmentRule.Id,
                ResourceCommitmentRule.Version,
                SolverRuleRepresentation.CandidateFilter),
            new(
                ResourceNonOverlapRule.Id,
                ResourceNonOverlapRule.Version,
                SolverRuleRepresentation.PairwiseConflict)
        ],
        SupportsTimeLimit: false);
}
