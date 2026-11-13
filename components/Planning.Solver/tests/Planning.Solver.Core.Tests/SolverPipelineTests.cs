using FluentAssertions;

namespace Planning.Solver.Tests;

public sealed class SolverPipelineTests
{
    [Fact]
    public void Run_SyntheticProblem_ProducesValidatedAcceptedPlan()
    {
        SolverPipelineResult result = SyntheticFixture.Pipeline().Run(
            SyntheticFixture.Problem(),
            SyntheticFixture.Rules(),
            SyntheticFixture.Profile(),
            "candidate-batch-v1",
            "synthetic-run-v1");

        result.Profile.Fingerprint.Should().HaveLength(64);
        result.Manifest.Fingerprint.Should().HaveLength(64);
        result.Candidates.Lineage.RunManifestFingerprint.Should().Be(result.Manifest.Fingerprint);
        result.Optimization.Lineage.InputFingerprint.Should().Be(result.Candidates.Lineage.ArtifactFingerprint);
        result.Validation.Lineage.InputFingerprint.Should().Be(result.Optimization.Lineage.ArtifactFingerprint);
        result.Score.Lineage.InputFingerprint.Should().Be(result.Validation.Lineage.ArtifactFingerprint);
        result.Candidates.Alternatives.Should().HaveCount(8);
        result.Candidates.Alternatives.Should().Contain(candidate =>
            candidate.SubjectId == "subject-a"
            && candidate.ResourceId == "resource-2"
            && !candidate.IsEligible
            && candidate.RuleTrace.Any(trace =>
                trace.RuleId == "required-capabilities"
                && trace.Outcome == RuleEvaluationOutcome.Violated));
        result.Optimization.Assignments.Should().BeEquivalentTo(
        [
            new
            {
                SubjectId = "subject-a",
                ResourceId = "resource-1"
            },
            new
            {
                SubjectId = "subject-b",
                ResourceId = "resource-2"
            },
            new
            {
                SubjectId = "subject-c",
                ResourceId = "resource-2"
            }
        ],
        options => options.ExcludingMissingMembers());
        result.Optimization.UnassignedSubjects.Should().ContainSingle()
            .Which.SubjectId.Should().Be("subject-d");
        result.Validation.Passed.Should().BeTrue();
        result.Score.Accepted.Should().BeTrue();
        result.Score.Metrics.Should().Contain(metric =>
            metric.MetricId == BuiltInMetrics.AssignmentCoverage
            && metric.RawValue == 0.75m);
    }

    [Fact]
    public void Run_UnassignedExceedsProfileLimit_RejectsOtherwiseValidPlan()
    {
        SolverPipelineResult result = SyntheticFixture.Pipeline().Run(
            SyntheticFixture.Problem(),
            SyntheticFixture.Rules(),
            SyntheticFixture.Profile(maximumUnassigned: 0),
            "candidate-batch-v1",
            "synthetic-run-v1");

        result.Validation.Passed.Should().BeTrue();
        result.Score.Accepted.Should().BeFalse();
        result.Score.RejectionReasons.Should().ContainSingle()
            .Which.Should().Contain("unassigned-subject");
    }
}
