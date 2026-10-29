using Planning.Solver.OrTools;

namespace Planning.Solver.Orchestration.Tests;

internal static class OrchestrationFixture
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    public static ProblemSnapshot Problem() => new(
        "orchestration-problem",
        "synthetic",
        "1.0.0",
        Start.AddDays(-1),
        [
            Subject("long", "segment-long", 0, 120, 100),
            Subject("early", "segment-early", 0, 60, 50),
            Subject("late", "segment-late", 60, 120, 40)
        ],
        [
            new PlanningResource("resource-1", 0m, Set("basic"))
        ],
        []);

    public static RulePackage Rules() => new(
        "generic-rules",
        "1.0.0",
        [
            new RequiredCapabilitiesRule(),
            new ResourceCommitmentRule()
        ],
        [
            new ResourceNonOverlapRule()
        ]);

    public static ProfileDefinition Profile(string strategyId = CpSatStrategy.Id) => new(
        "coverage-cost",
        "1.0.0",
        [
            new ObjectiveTerm(BuiltInMetrics.AssignmentCoverage, "1.0.0", ObjectiveDirection.Maximize, 100m),
            new ObjectiveTerm(BuiltInMetrics.ResourceCost, "1.0.0", ObjectiveDirection.Minimize, 1m)
        ],
        new AcceptancePolicy(MaximumUnassignedSubjects: 2),
        new SearchPolicy(strategyId));

    public static OptimizationJobRequest Request(
        string strategyId = CpSatStrategy.Id,
        string idempotencyKey = "job-key") => new(
        "job-1",
        idempotencyKey,
        "run-1",
        "candidates-1",
        Problem(),
        Rules(),
        Profile(strategyId));

    private static PlanningSubject Subject(
        string subjectId,
        string segmentId,
        int startMinutes,
        int endMinutes,
        int priority) => new(
            subjectId,
            segmentId,
            TimeWindow.Create(Start.AddMinutes(startMinutes), Start.AddMinutes(endMinutes)),
            priority,
            Set("basic"));

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);
}
