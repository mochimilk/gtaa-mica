using FluentAssertions;

namespace Planning.Solver.Tests;

public sealed class RuleEvaluationOutcomeTests
{
    [Theory]
    [InlineData(RuleClassification.Hard, RuleEvaluationOutcome.Passed, false)]
    [InlineData(RuleClassification.Hard, RuleEvaluationOutcome.Violated, true)]
    [InlineData(RuleClassification.Hard, RuleEvaluationOutcome.Unverifiable, true)]
    [InlineData(RuleClassification.Hard, RuleEvaluationOutcome.NotApplicable, false)]
    [InlineData(RuleClassification.Preference, RuleEvaluationOutcome.Violated, false)]
    [InlineData(RuleClassification.ModelAssumption, RuleEvaluationOutcome.Unverifiable, false)]
    [InlineData(RuleClassification.DataQualityGuard, RuleEvaluationOutcome.Unverifiable, true)]
    public void BlocksSelection_UsesClassificationAndTypedOutcome(
        RuleClassification classification,
        RuleEvaluationOutcome outcome,
        bool expected)
    {
        var evaluation = new RuleEvaluation("test", "1.0.0", classification, outcome, "test");

        evaluation.BlocksSelection.Should().Be(expected);
    }

    [Theory]
    [InlineData(RuleClassification.Hard, RuleEvaluationOutcome.Unverifiable, false)]
    [InlineData(RuleClassification.Hard, RuleEvaluationOutcome.NotApplicable, true)]
    [InlineData(RuleClassification.Preference, RuleEvaluationOutcome.Violated, true)]
    public void Generate_TypedOutcome_DeterminesCandidateEligibility(
        RuleClassification classification,
        RuleEvaluationOutcome outcome,
        bool expectedEligibility)
    {
        ProblemSnapshot problem = SyntheticFixture.Problem();
        var rule = new StubCandidateRule(classification, outcome);
        var rules = new RulePackage("typed-outcome-rules", "1.0.0", [rule], []);
        var strategy = SyntheticFixture.Strategy();
        CompiledProfile profile = new ProfileCompiler(
            BuiltInMetrics.Definitions,
            [strategy.Capabilities]).Compile(SyntheticFixture.Profile(), rules);
        RunManifest manifest = RunManifestFactory.Create(
            "typed-outcome-run",
            problem,
            profile,
            rules,
            strategy);

        CandidateBatch candidates = CandidateGenerator.Generate(
            manifest,
            problem,
            rules,
            "typed-outcome-candidates");

        candidates.Alternatives.Should().OnlyContain(candidate =>
            candidate.IsEligible == expectedEligibility
            && candidate.RuleTrace.Single().Outcome == outcome);
    }

    private sealed class StubCandidateRule(
        RuleClassification classification,
        RuleEvaluationOutcome outcome) : ICandidateRule
    {
        public RuleDescriptor Descriptor { get; } = new(
            "stub-candidate-rule",
            "1.0.0",
            classification,
            RuleEvaluationPhase.Candidate,
            SolverRuleRepresentation.CandidateFilter,
            "test-authority",
            "test-evidence");

        public RuleEvaluation Evaluate(CandidateRuleContext context)
        {
            ArgumentNullException.ThrowIfNull(context);
            return new RuleEvaluation(
                Descriptor.RuleId,
                Descriptor.Version,
                Descriptor.Classification,
                outcome,
                "Stub outcome.");
        }
    }
}
