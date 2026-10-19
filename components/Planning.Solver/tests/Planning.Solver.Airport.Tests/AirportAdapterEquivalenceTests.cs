using FluentAssertions;
using Planning.Solver.OrTools;

namespace Planning.Solver.Airport.Tests;

public sealed class AirportAdapterEquivalenceTests
{
    [Fact]
    public void Adapt_AirportFixture_ProducesExpectedCanonicalProblemAndRules()
    {
        ProblemSnapshot adaptedProblem = AirportProblemAdapter.Adapt(AirportFixture.Source());
        RulePackage adaptedRules = AirportRuleAdapter.Adapt(AirportFixture.RuleConfiguration());

        ArtifactFingerprints.Problem(adaptedProblem)
            .Should().Be(ArtifactFingerprints.Problem(AirportFixture.ExpectedCanonical()));
        ArtifactFingerprints.RulePackage(adaptedRules)
            .Should().Be(ArtifactFingerprints.RulePackage(AirportFixture.ExpectedRules()));
    }

    [Fact]
    public void Adapt_RuleConfiguration_PreservesAuthorityAndEvidence()
    {
        AirportRuleConfiguration configuration = AirportFixture.RuleConfiguration();

        RulePackage rules = AirportRuleAdapter.Adapt(configuration);

        rules.AllRules.Should().OnlyContain(rule =>
            rule.Descriptor.Authority == configuration.Authority
            && rule.Descriptor.EvidenceReference == configuration.EvidenceReference);
    }

    [Fact]
    public void Adapt_StandConflict_ProducesNormalizedRuleEnforcedByCpSat()
    {
        AirportRuleConfiguration configuration = AirportFixture.RuleConfiguration() with
        {
            StandConflicts =
            [
                new AirportStandConflict("adjacent-stands", "gate-1", "remote-1")
            ]
        };
        RulePackage rules = AirportRuleAdapter.Adapt(configuration);
        ResourceConflictRule conflictRule = rules.CompletePlanRules
            .OfType<ResourceConflictRule>()
            .Should().ContainSingle()
            .Which;
        var strategy = new CpSatStrategy();
        var pipeline = new SolverPipeline(
            new ProfileCompiler(BuiltInMetrics.Definitions, [strategy.Capabilities]),
            strategy);

        SolverPipelineResult result = pipeline.Run(
            AirportProblemAdapter.Adapt(AirportFixture.Source()),
            rules,
            AirportFixture.Profile(CpSatStrategy.Id),
            "airport-conflict-candidates",
            "airport-conflict-run");

        conflictRule.Descriptor.Authority.Should().Be(configuration.Authority);
        conflictRule.Descriptor.EvidenceReference.Should().Be(configuration.EvidenceReference);
        conflictRule.Conflicts.Should().ContainSingle().Which.ConflictId.Should().Be("adjacent-stands");
        result.Validation.Passed.Should().BeTrue();
        result.Optimization.Assignments.Should().NotContain(pair =>
            result.Optimization.Assignments.Any(other =>
                !string.Equals(pair.AlternativeId, other.AlternativeId, StringComparison.Ordinal)
                && conflictRule.ConflictsWith(
                    pair.ResourceId,
                    pair.Window,
                    other.ResourceId,
                    other.Window)));
    }

    [Fact]
    public void Run_AdaptedAndCanonicalFixtures_ProduceEquivalentArtifacts()
    {
        SolverPipeline pipeline = AirportFixture.Pipeline();
        SolverPipelineResult adapted = pipeline.Run(
            AirportProblemAdapter.Adapt(AirportFixture.Source()),
            AirportRuleAdapter.Adapt(AirportFixture.RuleConfiguration()),
            AirportFixture.Profile(),
            "airport-candidates-v1",
            "airport-run-v1");
        SolverPipelineResult canonical = pipeline.Run(
            AirportFixture.ExpectedCanonical(),
            AirportFixture.ExpectedRules(),
            AirportFixture.Profile(),
            "airport-candidates-v1",
            "airport-run-v1");

        adapted.Manifest.Fingerprint.Should().Be(canonical.Manifest.Fingerprint);
        adapted.Candidates.Lineage.ArtifactFingerprint.Should().Be(canonical.Candidates.Lineage.ArtifactFingerprint);
        adapted.Optimization.Lineage.ArtifactFingerprint.Should().Be(canonical.Optimization.Lineage.ArtifactFingerprint);
        adapted.Validation.Lineage.ArtifactFingerprint.Should().Be(canonical.Validation.Lineage.ArtifactFingerprint);
        adapted.Score.Lineage.ArtifactFingerprint.Should().Be(canonical.Score.Lineage.ArtifactFingerprint);
        adapted.Validation.Passed.Should().BeTrue();
        adapted.Score.Accepted.Should().BeTrue();
        adapted.Optimization.Assignments.Should().HaveCount(3);
        adapted.Optimization.UnassignedSubjects.Should().ContainSingle()
            .Which.SubjectId.Should().Be("visit-d");
    }

    [Fact]
    public void Run_CpSatWithAdaptedAndCanonicalFixtures_ProducesEquivalentArtifacts()
    {
        var strategy = new CpSatStrategy();
        var pipeline = new SolverPipeline(
            new ProfileCompiler(BuiltInMetrics.Definitions, [strategy.Capabilities]),
            strategy);
        ProfileDefinition profile = AirportFixture.Profile(CpSatStrategy.Id);

        SolverPipelineResult adapted = pipeline.Run(
            AirportProblemAdapter.Adapt(AirportFixture.Source()),
            AirportRuleAdapter.Adapt(AirportFixture.RuleConfiguration()),
            profile,
            "airport-cp-sat-candidates-v1",
            "airport-cp-sat-run-v1");
        SolverPipelineResult canonical = pipeline.Run(
            AirportFixture.ExpectedCanonical(),
            AirportFixture.ExpectedRules(),
            profile,
            "airport-cp-sat-candidates-v1",
            "airport-cp-sat-run-v1");

        adapted.Optimization.Status.Should().Be("Optimal");
        adapted.Optimization.Should().BeEquivalentTo(canonical.Optimization);
        adapted.Validation.Should().BeEquivalentTo(canonical.Validation);
        adapted.Score.Should().BeEquivalentTo(canonical.Score);
        adapted.Validation.Passed.Should().BeTrue();
    }

    [Fact]
    public void Adapt_SourceVersionChanges_ChangesCanonicalAndRunFingerprints()
    {
        AirportPlanningSnapshot source = AirportFixture.Source();
        ProblemSnapshot original = AirportProblemAdapter.Adapt(source);
        ProblemSnapshot changed = AirportProblemAdapter.Adapt(source with { SourceVersion = "fixture-2" });
        RulePackage rules = AirportRuleAdapter.Adapt(AirportFixture.RuleConfiguration());
        var strategy = AirportFixture.Strategy();
        var compiler = new ProfileCompiler(BuiltInMetrics.Definitions, [strategy.Capabilities]);
        CompiledProfile profile = compiler.Compile(AirportFixture.Profile(), rules);

        RunManifest originalManifest = RunManifestFactory.Create(
            "airport-run-v1",
            original,
            profile,
            rules,
            strategy);
        RunManifest changedManifest = RunManifestFactory.Create(
            "airport-run-v1",
            changed,
            profile,
            rules,
            strategy);

        ArtifactFingerprints.Problem(changed).Should().NotBe(ArtifactFingerprints.Problem(original));
        changedManifest.Fingerprint.Should().NotBe(originalManifest.Fingerprint);
    }

    [Fact]
    public void Adapt_ProtectedStandOccupancy_BecomesCandidateConstraint()
    {
        AirportPlanningSnapshot source = AirportFixture.Source();
        AirportPlanningSnapshot protectedSource = source with
        {
            ProtectedOccupancy =
            [
                new AirportProtectedOccupancy(
                    "protected-1",
                    "gate-1",
                    source.Visits[0].OccupancyStart,
                    source.Visits[0].OccupancyEnd)
            ]
        };
        ProblemSnapshot problem = AirportProblemAdapter.Adapt(protectedSource);
        RulePackage rules = AirportRuleAdapter.Adapt(AirportFixture.RuleConfiguration());
        var strategy = AirportFixture.Strategy();
        var compiler = new ProfileCompiler(BuiltInMetrics.Definitions, [strategy.Capabilities]);
        CompiledProfile profile = compiler.Compile(AirportFixture.Profile(), rules);
        RunManifest manifest = RunManifestFactory.Create("airport-run-v1", problem, profile, rules, strategy);

        CandidateBatch candidates = CandidateGenerator.Generate(manifest, problem, rules, "airport-candidates-v1");

        candidates.Alternatives.Should().Contain(candidate =>
            candidate.SubjectId == "visit-a"
            && candidate.ResourceId == "gate-1"
            && !candidate.IsEligible
            && candidate.RuleTrace.Any(trace =>
                trace.RuleId == "resource-commitment"
                && trace.Outcome == RuleEvaluationOutcome.Violated
                && trace.Detail.Contains("protected-1", StringComparison.Ordinal)));
    }
}
