using FluentAssertions;
using Planning.Solver.Airport;
using Planning.Solver.OrTools;

namespace Planning.Solver.Worker.Local.Tests;

public sealed class LocalOptimizationWorkerTests
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task RunAsync_AirportFixtureThroughCpSat_PublishesAcceptedCanonicalArtifacts()
    {
        var cpSat = new CpSatStrategy();
        var store = new InMemoryOptimizationJobStore();
        var publisher = new InMemoryOptimizationResultPublisher();
        var channel = new InMemoryOptimizationJobChannel();
        var coordinator = new OptimizationJobCoordinator(
            new OptimizationStrategyRegistry([cpSat]),
            store,
            publisher);
        var worker = new LocalOptimizationWorker(channel, coordinator);
        Task workerTask = worker.RunAsync();

        OptimizationJobRecord record = await channel.EnqueueAsync(Request(cpSat.StrategyId, "cp-sat"));
        channel.Complete();
        await workerTask;

        record.State.Should().Be(OptimizationJobState.Succeeded);
        record.PlanDisposition.Should().Be(PlanDisposition.Accepted);
        record.PublicationState.Should().Be(ResultPublicationState.Published);
        record.Artifacts.Manifest.Should().NotBeNull();
        record.Artifacts.Optimization!.Status.Should().Be("Optimal");
        record.Artifacts.Validation!.Passed.Should().BeTrue();
        record.Artifacts.Score!.Accepted.Should().BeTrue();
        record.Request.Problem.AdapterId.Should().Be(AirportProblemAdapter.Id);
        publisher.Published.Should().ContainKey(record.Request.JobId);
    }

    [Fact]
    public async Task RunAsync_StrategySelectionChangesByProfileWithoutWorkerChanges()
    {
        var greedy = new DeterministicGreedyStrategy();
        var cpSat = new CpSatStrategy();
        var store = new InMemoryOptimizationJobStore();
        var publisher = new InMemoryOptimizationResultPublisher();
        var channel = new InMemoryOptimizationJobChannel();
        var coordinator = new OptimizationJobCoordinator(
            new OptimizationStrategyRegistry([greedy, cpSat]),
            store,
            publisher);
        var worker = new LocalOptimizationWorker(channel, coordinator);
        Task workerTask = worker.RunAsync();

        OptimizationJobRecord greedyRecord = await channel.EnqueueAsync(Request(greedy.StrategyId, "greedy"));
        OptimizationJobRecord cpSatRecord = await channel.EnqueueAsync(Request(cpSat.StrategyId, "cp-sat"));
        channel.Complete();
        await workerTask;

        greedyRecord.Artifacts.Optimization!.StrategyId.Should().Be(greedy.StrategyId);
        cpSatRecord.Artifacts.Optimization!.StrategyId.Should().Be(cpSat.StrategyId);
        greedyRecord.PlanDisposition.Should().Be(PlanDisposition.Accepted);
        cpSatRecord.PlanDisposition.Should().Be(PlanDisposition.Accepted);
        publisher.Published.Should().HaveCount(2);
    }

    [Fact]
    public async Task RunAsync_AirportStandConflict_FlowsThroughOrchestrationAndLimitsSelection()
    {
        var cpSat = new CpSatStrategy();
        var store = new InMemoryOptimizationJobStore();
        var publisher = new InMemoryOptimizationResultPublisher();
        var channel = new InMemoryOptimizationJobChannel();
        var coordinator = new OptimizationJobCoordinator(
            new OptimizationStrategyRegistry([cpSat]),
            store,
            publisher);
        var worker = new LocalOptimizationWorker(channel, coordinator);
        Task workerTask = worker.RunAsync();

        OptimizationJobRecord record = await channel.EnqueueAsync(
            Request(cpSat.StrategyId, "stand-conflict", includeStandConflict: true));
        channel.Complete();
        await workerTask;

        record.State.Should().Be(OptimizationJobState.Succeeded);
        record.PlanDisposition.Should().Be(PlanDisposition.Accepted);
        record.Artifacts.Optimization!.Assignments.Should().ContainSingle();
        record.Artifacts.Validation!.Passed.Should().BeTrue();
        record.Request.Rules.CompletePlanRules.Should().ContainSingle(
            rule => rule is ResourceConflictRule);
        publisher.Published.Should().ContainKey(record.Request.JobId);
    }

    private static OptimizationJobRequest Request(
        string strategyId,
        string suffix,
        bool includeStandConflict = false)
    {
        AirportPlanningSnapshot source = new(
            $"airport-{suffix}",
            "fixture-1",
            Start.AddDays(-1),
            [
                new AirportVisitDemand(
                    "visit-a",
                    "segment-a",
                    Start,
                    Start.AddHours(1),
                    100,
                    Set("jet-bridge")),
                new AirportVisitDemand(
                    "visit-b",
                    "segment-b",
                    Start,
                    Start.AddHours(1),
                    50,
                    Set())
            ],
            [
                new AirportStand("gate-1", 2m, Set("standard", "jet-bridge")),
                new AirportStand("remote-1", 1m, Set("standard"))
            ],
            []);
        IReadOnlyList<AirportStandConflict>? standConflicts = includeStandConflict
            ?
            [
                new AirportStandConflict("adjacent-stands", "gate-1", "remote-1")
            ]
            : null;
        var rules = AirportRuleAdapter.Adapt(new AirportRuleConfiguration(
            "airport-rules",
            "1.0.0",
            Authority: "fixture-airport-operations",
            EvidenceReference: "fixture-evidence-v1",
            StandConflicts: standConflicts));
        var profile = new ProfileDefinition(
            "airport-coverage-cost",
            "1.0.0",
            [
                new ObjectiveTerm(
                    BuiltInMetrics.AssignmentCoverage,
                    "1.0.0",
                    ObjectiveDirection.Maximize,
                    100m),
                new ObjectiveTerm(
                    BuiltInMetrics.ResourceCost,
                    "1.0.0",
                    ObjectiveDirection.Minimize,
                    1m)
            ],
            new AcceptancePolicy(MaximumUnassignedSubjects: includeStandConflict ? 1 : 0),
            new SearchPolicy(strategyId));
        return new OptimizationJobRequest(
            $"job-{suffix}",
            $"key-{suffix}",
            $"run-{suffix}",
            $"candidates-{suffix}",
            AirportProblemAdapter.Adapt(source),
            rules,
            profile);
    }

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);
}
