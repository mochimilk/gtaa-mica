namespace Planning.Solver.Airport.Tests;

internal static class AirportFixture
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    public static AirportPlanningSnapshot Source() => new(
        SnapshotId: "airport-snapshot-v1",
        SourceVersion: "fixture-1",
        KnowledgeCutoff: Start.AddDays(-1),
        Visits:
        [
            Visit("visit-a", "contact-a", 0, 60, 100, "jet-bridge"),
            Visit("visit-b", "contact-b", 0, 60, 50),
            Visit("visit-c", "contact-c", 60, 120, 40),
            Visit("visit-d", "contact-d", 30, 90, 90, "jet-bridge")
        ],
        Stands:
        [
            new AirportStand("gate-1", 5m, Set("standard", "jet-bridge")),
            new AirportStand("remote-1", 1m, Set("standard"))
        ],
        ProtectedOccupancy: []);

    public static ProblemSnapshot ExpectedCanonical() => new(
        SnapshotId: "airport-snapshot-v1",
        AdapterId: AirportProblemAdapter.Id,
        AdapterVersion: $"{AirportProblemAdapter.Version}+source.fixture-1",
        KnowledgeCutoff: Start.AddDays(-1),
        Subjects:
        [
            Subject("visit-a", "contact-a", 0, 60, 100, "jet-bridge"),
            Subject("visit-b", "contact-b", 0, 60, 50),
            Subject("visit-c", "contact-c", 60, 120, 40),
            Subject("visit-d", "contact-d", 30, 90, 90, "jet-bridge")
        ],
        Resources:
        [
            new PlanningResource("gate-1", 5m, Set("standard", "jet-bridge")),
            new PlanningResource("remote-1", 1m, Set("standard"))
        ],
        Commitments: []);

    public static AirportRuleConfiguration RuleConfiguration() => new(
        RulePackageId: "airport-generic-rules",
        Version: "1.0.0",
        Authority: "fixture-airport-operations",
        EvidenceReference: "fixture-airport-rules-v1");

    public static RulePackage ExpectedRules() => new(
        RulePackageId: "airport-generic-rules",
        Version: "1.0.0",
        CandidateRules:
        [
            new RequiredCapabilitiesRule("fixture-airport-operations", "fixture-airport-rules-v1"),
            new ResourceCommitmentRule("fixture-airport-operations", "fixture-airport-rules-v1")
        ],
        CompletePlanRules:
        [
            new ResourceNonOverlapRule("fixture-airport-operations", "fixture-airport-rules-v1")
        ]);

    public static ProfileDefinition Profile(string strategyId = DeterministicGreedyStrategy.Id) => new(
        ProfileId: "airport-coverage-cost",
        Version: "1.0.0",
        Objectives:
        [
            new ObjectiveTerm(BuiltInMetrics.AssignmentCoverage, "1.0.0", ObjectiveDirection.Maximize, 100m),
            new ObjectiveTerm(BuiltInMetrics.ResourceCost, "1.0.0", ObjectiveDirection.Minimize, 1m)
        ],
        Acceptance: new AcceptancePolicy(MaximumUnassignedSubjects: 1),
        Search: new SearchPolicy(strategyId));

    public static SolverPipeline Pipeline() => new(
        new ProfileCompiler(BuiltInMetrics.Definitions, [Strategy().Capabilities]),
        new DeterministicGreedyStrategy());

    public static DeterministicGreedyStrategy Strategy() => new();

    private static AirportVisitDemand Visit(
        string visitId,
        string segmentId,
        int startMinutes,
        int endMinutes,
        int priority,
        params string[] requiredCapabilities) => new(
            visitId,
            segmentId,
            Start.AddMinutes(startMinutes),
            Start.AddMinutes(endMinutes),
            priority,
            Set(requiredCapabilities));

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
