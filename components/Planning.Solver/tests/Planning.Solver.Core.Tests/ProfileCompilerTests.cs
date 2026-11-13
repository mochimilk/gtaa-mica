using FluentAssertions;

namespace Planning.Solver.Tests;

public sealed class ProfileCompilerTests
{
    [Fact]
    public void Compile_UnknownMetric_FailsExplicitly()
    {
        var compiler = Compiler();
        ProfileDefinition profile = SyntheticFixture.Profile() with
        {
            Objectives =
            [
                new ObjectiveTerm("unknown", "1.0.0", ObjectiveDirection.Maximize, 1m)
            ]
        };

        Action action = () => compiler.Compile(profile, SyntheticFixture.Rules());

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*Metric 'unknown' is not registered*");
    }

    [Fact]
    public void Compile_SameDefinition_ProducesStableFingerprint()
    {
        var compiler = Compiler();

        CompiledProfile first = compiler.Compile(SyntheticFixture.Profile(), SyntheticFixture.Rules());
        CompiledProfile second = compiler.Compile(SyntheticFixture.Profile(), SyntheticFixture.Rules());

        second.Fingerprint.Should().Be(first.Fingerprint);
    }

    [Fact]
    public void Compile_ObjectivesReordered_ProducesSameFingerprint()
    {
        var compiler = Compiler();
        ProfileDefinition firstDefinition = SyntheticFixture.Profile();
        ProfileDefinition reordered = firstDefinition with
        {
            Objectives = firstDefinition.Objectives.Reverse().ToList()
        };

        CompiledProfile first = compiler.Compile(firstDefinition, SyntheticFixture.Rules());
        CompiledProfile second = compiler.Compile(reordered, SyntheticFixture.Rules());

        second.Fingerprint.Should().Be(first.Fingerprint);
    }

    [Fact]
    public void Compile_DuplicateMetric_FailsExplicitly()
    {
        var compiler = Compiler();
        ProfileDefinition profile = SyntheticFixture.Profile() with
        {
            Objectives =
            [
                new ObjectiveTerm(BuiltInMetrics.AssignmentCoverage, "1.0.0", ObjectiveDirection.Maximize, 1m),
                new ObjectiveTerm(BuiltInMetrics.AssignmentCoverage, "1.0.0", ObjectiveDirection.Maximize, 2m)
            ]
        };

        Action action = () => compiler.Compile(profile, SyntheticFixture.Rules());

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*declared more than once*");
    }

    [Fact]
    public void Compile_LexicographicObjectiveUnsupportedByStrategy_FailsExplicitly()
    {
        var compiler = Compiler();
        ProfileDefinition profile = SyntheticFixture.Profile() with
        {
            ObjectiveComposition = ObjectiveComposition.Lexicographic
        };

        Action action = () => compiler.Compile(profile, SyntheticFixture.Rules());

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*does not support objective composition 'Lexicographic'*");
    }

    [Fact]
    public void Compile_RegisteredMetricUnsupportedByStrategy_FailsExplicitly()
    {
        const string metricId = "custom-metric";
        var compiler = new ProfileCompiler(
            [.. BuiltInMetrics.Definitions, new MetricDefinition(metricId, "1.0.0", "units", ObjectiveDirection.Maximize)],
            [SyntheticFixture.Strategy().Capabilities]);
        ProfileDefinition profile = SyntheticFixture.Profile() with
        {
            Objectives =
            [
                new ObjectiveTerm(metricId, "1.0.0", ObjectiveDirection.Maximize, 1m)
            ]
        };

        Action action = () => compiler.Compile(profile, SyntheticFixture.Rules());

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*does not support objective metric 'custom-metric'*");
    }

    [Fact]
    public void Compile_ZeroWeightScoringOnlyMetric_DoesNotRequireStrategySupport()
    {
        const string metricId = "scoring-only";
        var compiler = new ProfileCompiler(
            [
                .. BuiltInMetrics.Definitions,
                new MetricDefinition(
                    metricId,
                    "1.0.0",
                    "units",
                    ObjectiveDirection.Maximize,
                    OptimizationKind: MetricOptimizationKind.ScoringOnly)
            ],
            [SyntheticFixture.Strategy().Capabilities]);
        ProfileDefinition profile = SyntheticFixture.Profile() with
        {
            Objectives =
            [
                .. SyntheticFixture.Profile().Objectives,
                new ObjectiveTerm(metricId, "1.0.0", ObjectiveDirection.Maximize, 0m)
            ]
        };

        Action action = () => compiler.Compile(profile, SyntheticFixture.Rules());

        action.Should().NotThrow();
    }

    [Fact]
    public void Compile_WeightedScoringOnlyMetric_FailsExplicitly()
    {
        const string metricId = "scoring-only";
        var compiler = new ProfileCompiler(
            [
                .. BuiltInMetrics.Definitions,
                new MetricDefinition(
                    metricId,
                    "1.0.0",
                    "units",
                    ObjectiveDirection.Maximize,
                    OptimizationKind: MetricOptimizationKind.ScoringOnly)
            ],
            [SyntheticFixture.Strategy().Capabilities]);
        ProfileDefinition profile = SyntheticFixture.Profile() with
        {
            Objectives =
            [
                new ObjectiveTerm(metricId, "1.0.0", ObjectiveDirection.Maximize, 1m)
            ]
        };

        Action action = () => compiler.Compile(profile, SyntheticFixture.Rules());

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*Scoring-only metric 'scoring-only' must have zero objective weight*");
    }

    [Fact]
    public void Compile_GlobalConstraintUnsupportedByStrategy_FailsExplicitly()
    {
        var compiler = Compiler();
        RulePackage rules = RulesWith(new StubCompletePlanRule(SolverRuleRepresentation.GlobalConstraint));

        Action action = () => compiler.Compile(SyntheticFixture.Profile(), rules);

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*cannot enforce rule 'stub-complete-plan'*'GlobalConstraint'*");
    }

    [Fact]
    public void Compile_ValidationOnlyHardRuleWhenSearchEnforcementRequired_FailsExplicitly()
    {
        var compiler = Compiler();
        RulePackage rules = RulesWith(new StubCompletePlanRule(SolverRuleRepresentation.ValidationOnly));

        Action action = () => compiler.Compile(SyntheticFixture.Profile(), rules);

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*cannot enforce rule 'stub-complete-plan'*'ValidationOnly'*");
    }

    [Fact]
    public void Compile_RulePackageNotSelectedByProfile_FailsExplicitly()
    {
        var compiler = Compiler();
        ProfileDefinition profile = SyntheticFixture.Profile() with
        {
            RuleSelection = new RuleSelectionPolicy(
                new HashSet<string>(["different-rules"], StringComparer.Ordinal))
        };

        Action action = () => compiler.Compile(profile, SyntheticFixture.Rules());

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*Rule package 'generic-rules' is not selected*");
    }

    [Fact]
    public void Compile_TimeLimitUnsupportedByStrategy_FailsExplicitly()
    {
        var compiler = Compiler();
        ProfileDefinition profile = SyntheticFixture.Profile() with
        {
            Search = new SearchPolicy(
                DeterministicGreedyStrategy.Id,
                TimeLimit: TimeSpan.FromSeconds(30))
        };

        Action action = () => compiler.Compile(profile, SyntheticFixture.Rules());

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*does not support a time limit*");
    }

    [Fact]
    public void Compile_NonPositiveTimeLimit_FailsExplicitly()
    {
        var capabilities = SyntheticFixture.Strategy().Capabilities with { SupportsTimeLimit = true };
        var compiler = new ProfileCompiler(BuiltInMetrics.Definitions, [capabilities]);
        ProfileDefinition profile = SyntheticFixture.Profile() with
        {
            Search = new SearchPolicy(
                DeterministicGreedyStrategy.Id,
                TimeLimit: TimeSpan.Zero)
        };

        Action action = () => compiler.Compile(profile, SyntheticFixture.Rules());

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*time limit must be greater than zero*");
    }

    [Fact]
    public void Compile_KnownRuleWithUnsupportedVersion_FailsExplicitly()
    {
        var compiler = Compiler();
        RulePackage rules = RulesWith(new StubCompletePlanRule(
            SolverRuleRepresentation.PairwiseConflict,
            ResourceNonOverlapRule.Id,
            "2.0.0"));

        Action action = () => compiler.Compile(SyntheticFixture.Profile(), rules);

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*cannot enforce rule 'resource-non-overlap'*");
    }

    [Fact]
    public void RulePackageFingerprint_AuthorityOrEvidenceChanges_ChangesFingerprint()
    {
        RulePackage original = RulesWith(new ResourceNonOverlapRule("authority-a", "evidence-a"));
        RulePackage changedAuthority = RulesWith(new ResourceNonOverlapRule("authority-b", "evidence-a"));
        RulePackage changedEvidence = RulesWith(new ResourceNonOverlapRule("authority-a", "evidence-b"));

        ArtifactFingerprints.RulePackage(changedAuthority)
            .Should().NotBe(ArtifactFingerprints.RulePackage(original));
        ArtifactFingerprints.RulePackage(changedEvidence)
            .Should().NotBe(ArtifactFingerprints.RulePackage(original));
    }

    private static ProfileCompiler Compiler() =>
        new(BuiltInMetrics.Definitions, [SyntheticFixture.Strategy().Capabilities]);

    private static RulePackage RulesWith(ICompletePlanRule rule) => new(
        "test-rules",
        "1.0.0",
        [],
        [rule]);

    private sealed class StubCompletePlanRule(
        SolverRuleRepresentation representation,
        string ruleId = "stub-complete-plan",
        string version = "1.0.0") : ICompletePlanRule
    {
        public RuleDescriptor Descriptor { get; } = new(
            ruleId,
            version,
            RuleClassification.Hard,
            RuleEvaluationPhase.CompletePlan,
            representation,
            "test-authority",
            "test-evidence");

        public IReadOnlyList<ValidationFinding> Evaluate(CompletePlanRuleContext context)
        {
            ArgumentNullException.ThrowIfNull(context);
            return [];
        }
    }
}
