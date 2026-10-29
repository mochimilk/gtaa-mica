using FluentAssertions;

namespace Planning.Solver.Tests;

public sealed class CompletePlanValidatorTests
{
    [Fact]
    public void Validate_ConflictingSelectedCandidates_ReportsBothSubjects()
    {
        ProblemSnapshot problem = SyntheticFixture.Problem();
        RulePackage rules = SyntheticFixture.Rules();
        RunManifest manifest = SyntheticFixture.Manifest(problem, rules);
        CandidateBatch candidates = CandidateGenerator.Generate(manifest, problem, rules, "candidate-batch-v1");
        CandidateAlternative first = candidates.Eligible.Single(candidate =>
            candidate.SubjectId == "subject-a" && candidate.ResourceId == "resource-1");
        CandidateAlternative second = candidates.Eligible.Single(candidate =>
            candidate.SubjectId == "subject-d" && candidate.ResourceId == "resource-1");
        SelectedAssignment[] assignments =
        [
            Select(first),
            Select(second)
        ];
        var optimization = new OptimizationResult(
            DeterministicGreedyStrategy.Id,
            "1.0.0",
            "Feasible",
            assignments,
            [],
            new ArtifactLineage(manifest.Fingerprint, candidates.Lineage.ArtifactFingerprint, string.Empty));
        optimization = optimization with
        {
            Lineage = optimization.Lineage with { ArtifactFingerprint = ArtifactFingerprints.Plan(optimization) }
        };

        PlanValidationResult result = CompletePlanValidator.Validate(manifest, problem, rules, candidates, optimization);

        result.Passed.Should().BeFalse();
        result.Findings.Should().ContainSingle(finding =>
            finding.CheckCode == "RESOURCE_OVERLAP"
            && finding.SubjectId == "subject-a"
            && finding.OtherSubjectId == "subject-d"
            && finding.ResourceId == "resource-1");
    }

    private static SelectedAssignment Select(CandidateAlternative candidate) => new(
        candidate.AlternativeId,
        candidate.SubjectId,
        candidate.SegmentId,
        candidate.ResourceId,
        candidate.Window);
}
