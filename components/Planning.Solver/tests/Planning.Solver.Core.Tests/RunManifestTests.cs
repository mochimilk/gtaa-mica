using FluentAssertions;

namespace Planning.Solver.Tests;

public sealed class RunManifestTests
{
    [Fact]
    public void Create_EquivalentCollectionOrder_ProducesSameProblemAndManifestFingerprints()
    {
        ProblemSnapshot first = SyntheticFixture.Problem();
        ProblemSnapshot reordered = first with
        {
            Subjects = first.Subjects.Reverse().ToList(),
            Resources = first.Resources.Reverse().ToList()
        };
        RulePackage rules = SyntheticFixture.Rules();

        RunManifest firstManifest = SyntheticFixture.Manifest(first, rules);
        RunManifest reorderedManifest = SyntheticFixture.Manifest(reordered, rules);

        ArtifactFingerprints.Problem(reordered).Should().Be(ArtifactFingerprints.Problem(first));
        reorderedManifest.Fingerprint.Should().Be(firstManifest.Fingerprint);
    }

    [Fact]
    public void Create_MaterialProblemChange_ProducesDifferentFingerprints()
    {
        ProblemSnapshot original = SyntheticFixture.Problem();
        PlanningSubject changedSubject = original.Subjects[0] with { Priority = original.Subjects[0].Priority + 1 };
        ProblemSnapshot changed = original with
        {
            Subjects = [changedSubject, .. original.Subjects.Skip(1)]
        };
        RulePackage rules = SyntheticFixture.Rules();

        RunManifest originalManifest = SyntheticFixture.Manifest(original, rules);
        RunManifest changedManifest = SyntheticFixture.Manifest(changed, rules);

        ArtifactFingerprints.Problem(changed).Should().NotBe(ArtifactFingerprints.Problem(original));
        changedManifest.Fingerprint.Should().NotBe(originalManifest.Fingerprint);
    }

    [Fact]
    public void Generate_ProblemChangedAfterManifest_FailsClosed()
    {
        ProblemSnapshot original = SyntheticFixture.Problem();
        RulePackage rules = SyntheticFixture.Rules();
        RunManifest manifest = SyntheticFixture.Manifest(original, rules);
        ProblemSnapshot changed = original with
        {
            AdapterVersion = "1.0.1"
        };

        Action action = () => CandidateGenerator.Generate(manifest, changed, rules, "candidate-batch-v1");

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*problem mismatch*");
    }

    [Fact]
    public void Generate_ManifestChangedWithoutRefingerprinting_FailsClosed()
    {
        ProblemSnapshot problem = SyntheticFixture.Problem();
        RulePackage rules = SyntheticFixture.Rules();
        RunManifest manifest = SyntheticFixture.Manifest(problem, rules);
        RunManifest changed = manifest with
        {
            FeatureFlags = new Dictionary<string, bool>(StringComparer.Ordinal)
            {
                ["unexpected"] = true
            }
        };

        Action action = () => CandidateGenerator.Generate(changed, problem, rules, "candidate-batch-v1");

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*fingerprint mismatch*");
    }

    [Fact]
    public void Solve_CandidateContentChangedAfterGeneration_FailsClosed()
    {
        ProblemSnapshot problem = SyntheticFixture.Problem();
        RulePackage rules = SyntheticFixture.Rules();
        CompiledProfile profile = SyntheticFixture.CompiledProfile();
        var strategy = new DeterministicGreedyStrategy();
        RunManifest manifest = RunManifestFactory.Create("synthetic-run-v1", problem, profile, rules, strategy);
        CandidateBatch candidates = CandidateGenerator.Generate(manifest, problem, rules, "candidate-batch-v1");
        CandidateBatch changed = candidates with
        {
            Alternatives = candidates.Alternatives.Skip(1).ToList()
        };

        Action action = () => strategy.Solve(
            manifest,
            problem,
            rules,
            changed,
            profile,
            CancellationToken.None);

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*fingerprint does not match*");
    }

    [Fact]
    public void Score_ValidationContentChangedAfterValidation_FailsClosed()
    {
        SolverPipelineResult result = SyntheticFixture.Pipeline().Run(
            SyntheticFixture.Problem(),
            SyntheticFixture.Rules(),
            SyntheticFixture.Profile(),
            "candidate-batch-v1",
            "synthetic-run-v1");
        PlanValidationResult changed = result.Validation with
        {
            Findings =
            [
                new ValidationFinding(
                    ValidationFindingStatus.Violation,
                    "TEST_CHANGE",
                    "Material validation change.",
                    RuleId: "test-rule")
            ]
        };

        Action action = () => PlanScorer.Score(
            result.Manifest,
            SyntheticFixture.Problem(),
            SyntheticFixture.Rules(),
            result.Optimization,
            changed,
            result.Profile,
            MetricInputSet.Empty,
            MetricRegistry.BuiltIn);

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*Validation fingerprint does not match*");
    }
}
