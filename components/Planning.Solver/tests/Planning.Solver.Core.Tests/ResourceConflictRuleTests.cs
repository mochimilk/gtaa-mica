using FluentAssertions;

namespace Planning.Solver.Tests;

public sealed class ResourceConflictRuleTests
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Evaluate_OverlappingConfiguredResources_ReportsViolation()
    {
        var rule = new ResourceConflictRule(
            [new ResourceConflict("adjacent-1", "resource-1", "resource-2")]);
        ProblemSnapshot problem = Problem();
        IReadOnlyList<SelectedAssignment> assignments =
        [
            Assignment("subject-1", "segment-1", "resource-1", 0, 60),
            Assignment("subject-2", "segment-2", "resource-2", 30, 90)
        ];

        IReadOnlyList<ValidationFinding> findings = rule.Evaluate(
            new CompletePlanRuleContext(problem, assignments));

        findings.Should().ContainSingle(finding =>
            finding.Status == ValidationFindingStatus.Violation
            && finding.CheckCode == "RESOURCE_CONFLICT"
            && finding.RuleId == ResourceConflictRule.Id);
    }

    [Fact]
    public void Evaluate_ConflictOutsideEffectiveWindow_DoesNotReportViolation()
    {
        var rule = new ResourceConflictRule(
        [
            new ResourceConflict(
                "peak-only",
                "resource-1",
                "resource-2",
                TimeWindow.Create(Start.AddHours(2), Start.AddHours(3)))
        ]);
        IReadOnlyList<SelectedAssignment> assignments =
        [
            Assignment("subject-1", "segment-1", "resource-1", 0, 60),
            Assignment("subject-2", "segment-2", "resource-2", 30, 90)
        ];

        IReadOnlyList<ValidationFinding> findings = rule.Evaluate(
            new CompletePlanRuleContext(Problem(), assignments));

        findings.Should().BeEmpty();
    }

    [Fact]
    public void Evaluate_UnknownConfiguredResource_ReportsUnverifiable()
    {
        var rule = new ResourceConflictRule(
            [new ResourceConflict("unknown-pair", "resource-1", "missing-resource")]);

        IReadOnlyList<ValidationFinding> findings = rule.Evaluate(
            new CompletePlanRuleContext(Problem(), []));

        findings.Should().ContainSingle(finding =>
            finding.Status == ValidationFindingStatus.Unverifiable
            && finding.CheckCode == "RESOURCE_CONFLICT_UNKNOWN_RESOURCE"
            && finding.ResourceId == "missing-resource");
    }

    [Fact]
    public void RulePackageFingerprint_ReversedResourcePair_IsEquivalentButMaterialChangeIsNot()
    {
        RulePackage first = Rules(new ResourceConflict("pair-1", "resource-1", "resource-2"));
        RulePackage reversed = Rules(new ResourceConflict("pair-1", "resource-2", "resource-1"));
        RulePackage changed = Rules(new ResourceConflict("pair-1", "resource-1", "resource-3"));

        ArtifactFingerprints.RulePackage(reversed)
            .Should().Be(ArtifactFingerprints.RulePackage(first));
        ArtifactFingerprints.RulePackage(changed)
            .Should().NotBe(ArtifactFingerprints.RulePackage(first));
    }

    private static ProblemSnapshot Problem() => new(
        "conflict-problem",
        "synthetic",
        "1.0.0",
        Start.AddDays(-1),
        [
            new PlanningSubject(
                "subject-1",
                "segment-1",
                TimeWindow.Create(Start, Start.AddHours(1)),
                100,
                Set()),
            new PlanningSubject(
                "subject-2",
                "segment-2",
                TimeWindow.Create(Start.AddMinutes(30), Start.AddMinutes(90)),
                50,
                Set())
        ],
        [
            new PlanningResource("resource-1", 0m, Set()),
            new PlanningResource("resource-2", 0m, Set())
        ],
        []);

    private static SelectedAssignment Assignment(
        string subjectId,
        string segmentId,
        string resourceId,
        int startMinutes,
        int endMinutes) => new(
            $"{subjectId}:{resourceId}",
            subjectId,
            segmentId,
            resourceId,
            TimeWindow.Create(Start.AddMinutes(startMinutes), Start.AddMinutes(endMinutes)));

    private static RulePackage Rules(ResourceConflict conflict) => new(
        "conflict-rules",
        "1.0.0",
        [],
        [new ResourceConflictRule([conflict])]);

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);
}
