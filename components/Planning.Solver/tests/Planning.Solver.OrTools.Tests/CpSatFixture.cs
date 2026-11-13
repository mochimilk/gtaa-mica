namespace Planning.Solver.OrTools.Tests;

internal static class CpSatFixture
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    public static ProblemSnapshot CoverageProblem() => new(
        "cp-sat-coverage-problem",
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

    public static ProblemSnapshot CostProblem() => new(
        "cp-sat-cost-problem",
        "synthetic",
        "1.0.0",
        Start.AddDays(-1),
        [
            Subject("subject-1", "segment-1", 0, 60, 100)
        ],
        [
            new PlanningResource("expensive", 0.2m, Set("basic")),
            new PlanningResource("cheap", 0.1m, Set("basic"))
        ],
        []);

    public static ProblemSnapshot ResourceConflictProblem() => new(
        "cp-sat-resource-conflict-problem",
        "synthetic",
        "1.0.0",
        Start.AddDays(-1),
        [
            Subject("subject-a", "segment-a", 0, 60, 100, "resource-a"),
            Subject("subject-b", "segment-b", 0, 60, 50, "resource-b")
        ],
        [
            new PlanningResource("resource-1", 0m, Set("basic", "resource-a")),
            new PlanningResource("resource-2", 0m, Set("basic", "resource-b"))
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

    public static RulePackage ResourceConflictRules() => new(
        "resource-conflict-rules",
        "1.0.0",
        [
            new RequiredCapabilitiesRule(),
            new ResourceCommitmentRule()
        ],
        [
            new ResourceNonOverlapRule(),
            new ResourceConflictRule(
                [new ResourceConflict("adjacent-resources", "resource-1", "resource-2")])
        ]);

    public static ProfileDefinition Profile(
        string strategyId = CpSatStrategy.Id,
        TimeSpan? timeLimit = null) => new(
        "coverage-cost",
        "1.0.0",
        [
            new ObjectiveTerm(BuiltInMetrics.AssignmentCoverage, "1.0.0", ObjectiveDirection.Maximize, 100m),
            new ObjectiveTerm(BuiltInMetrics.ResourceCost, "1.0.0", ObjectiveDirection.Minimize, 1m)
        ],
        new AcceptancePolicy(MaximumUnassignedSubjects: 2),
        new SearchPolicy(strategyId, RandomSeed: 42, TimeLimit: timeLimit));

    public static ProfileCompiler Compiler(params IOptimizationStrategy[] strategies) => new(
        BuiltInMetrics.Definitions,
        strategies.Select(strategy => strategy.Capabilities));

    public static SolverPipeline Pipeline(IOptimizationStrategy strategy) =>
        new(Compiler(strategy), strategy);

    private static PlanningSubject Subject(
        string subjectId,
        string segmentId,
        int startMinutes,
        int endMinutes,
        int priority,
        params string[] additionalCapabilities) => new(
            subjectId,
            segmentId,
            TimeWindow.Create(Start.AddMinutes(startMinutes), Start.AddMinutes(endMinutes)),
            priority,
            Set(["basic", .. additionalCapabilities]));

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);
}
