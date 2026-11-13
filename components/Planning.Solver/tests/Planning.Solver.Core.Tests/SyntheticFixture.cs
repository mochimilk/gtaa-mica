namespace Planning.Solver.Tests;

internal static class SyntheticFixture
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    public static ProblemSnapshot Problem() => new(
        SnapshotId: "synthetic-problem-v1",
        AdapterId: "synthetic",
        AdapterVersion: "1.0.0",
        KnowledgeCutoff: Start.AddDays(-1),
        Subjects:
        [
            Subject("subject-a", "segment-a", 0, 60, 100, "high-power"),
            Subject("subject-b", "segment-b", 0, 60, 50),
            Subject("subject-c", "segment-c", 60, 120, 40),
            Subject("subject-d", "segment-d", 30, 90, 90, "high-power")
        ],
        Resources:
        [
            new PlanningResource("resource-1", 5m, Set("basic", "high-power")),
            new PlanningResource("resource-2", 1m, Set("basic"))
        ],
        Commitments: []);

    public static RulePackage Rules() => new(
        RulePackageId: "generic-rules",
        Version: "1.0.0",
        CandidateRules:
        [
            new RequiredCapabilitiesRule(),
            new ResourceCommitmentRule()
        ],
        CompletePlanRules:
        [
            new ResourceNonOverlapRule()
        ]);

    public static ProfileDefinition Profile(int? maximumUnassigned = 1) => new(
        ProfileId: "coverage-cost",
        Version: "1.0.0",
        Objectives:
        [
            new ObjectiveTerm(BuiltInMetrics.AssignmentCoverage, "1.0.0", ObjectiveDirection.Maximize, 100m),
            new ObjectiveTerm(BuiltInMetrics.ResourceCost, "1.0.0", ObjectiveDirection.Minimize, 1m)
        ],
        Acceptance: new AcceptancePolicy(MaximumUnassignedSubjects: maximumUnassigned),
        Search: new SearchPolicy(DeterministicGreedyStrategy.Id));

    public static SolverPipeline Pipeline() => new(
        new ProfileCompiler(BuiltInMetrics.Definitions, [Strategy().Capabilities]),
        new DeterministicGreedyStrategy());

    public static CompiledProfile CompiledProfile() =>
        new ProfileCompiler(BuiltInMetrics.Definitions, [Strategy().Capabilities]).Compile(Profile(), Rules());

    public static DeterministicGreedyStrategy Strategy() => new();

    public static RunManifest Manifest(ProblemSnapshot problem, RulePackage rules) =>
        RunManifestFactory.Create(
            "synthetic-run-v1",
            problem,
            CompiledProfile(),
            rules,
            Strategy());

    private static PlanningSubject Subject(
        string subjectId,
        string segmentId,
        int startMinutes,
        int endMinutes,
        int priority,
        params string[] requiredCapabilities) => new(
            subjectId,
            segmentId,
            TimeWindow.Create(Start.AddMinutes(startMinutes), Start.AddMinutes(endMinutes)),
            priority,
            Set(requiredCapabilities));

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);
}
