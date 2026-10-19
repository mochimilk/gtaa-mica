using FluentAssertions;

namespace Planning.Solver.OrTools.Tests;

public sealed class CpSatStrategyTests
{
    [Fact]
    public void Capabilities_DeclareExactNormalizedRulesAndTimeLimits()
    {
        var strategy = new CpSatStrategy();

        strategy.Capabilities.SupportsTimeLimit.Should().BeTrue();
        strategy.Capabilities.SupportedRules.Should().BeEquivalentTo(
        [
            new StrategyRuleCapability(
                RequiredCapabilitiesRule.Id,
                RequiredCapabilitiesRule.Version,
                SolverRuleRepresentation.CandidateFilter),
            new StrategyRuleCapability(
                ResourceCommitmentRule.Id,
                ResourceCommitmentRule.Version,
                SolverRuleRepresentation.CandidateFilter),
            new StrategyRuleCapability(
                ResourceNonOverlapRule.Id,
                ResourceNonOverlapRule.Version,
                SolverRuleRepresentation.PairwiseConflict),
            new StrategyRuleCapability(
                ResourceConflictRule.Id,
                ResourceConflictRule.Version,
                SolverRuleRepresentation.PairwiseConflict)
        ]);
    }

    [Fact]
    public void Run_CompetingIntervals_FindsHigherCoverageThanGreedy()
    {
        ProblemSnapshot problem = CpSatFixture.CoverageProblem();
        RulePackage rules = CpSatFixture.Rules();
        var cpSat = new CpSatStrategy();
        var greedy = new DeterministicGreedyStrategy();

        SolverPipelineResult cpSatResult = CpSatFixture.Pipeline(cpSat).Run(
            problem,
            rules,
            CpSatFixture.Profile(),
            "coverage-candidates",
            "cp-sat-coverage-run");
        SolverPipelineResult greedyResult = CpSatFixture.Pipeline(greedy).Run(
            problem,
            rules,
            CpSatFixture.Profile(DeterministicGreedyStrategy.Id),
            "coverage-candidates",
            "greedy-coverage-run");

        cpSatResult.Optimization.Status.Should().Be("Optimal");
        cpSatResult.Optimization.Assignments.Select(assignment => assignment.SubjectId)
            .Should().BeEquivalentTo(["early", "late"]);
        cpSatResult.Optimization.Assignments.Should().HaveCount(2);
        cpSatResult.Optimization.Assignments.Should().HaveCountGreaterThan(
            greedyResult.Optimization.Assignments.Count);
        cpSatResult.Validation.Passed.Should().BeTrue();
        cpSatResult.Score.Accepted.Should().BeTrue();
    }

    [Fact]
    public void Run_DecimalResourceCosts_SelectsLowestCostAlternative()
    {
        var strategy = new CpSatStrategy();

        SolverPipelineResult result = CpSatFixture.Pipeline(strategy).Run(
            CpSatFixture.CostProblem(),
            CpSatFixture.Rules(),
            CpSatFixture.Profile(),
            "cost-candidates",
            "cp-sat-cost-run");

        result.Optimization.Status.Should().Be("Optimal");
        result.Optimization.Assignments.Should().ContainSingle()
            .Which.ResourceId.Should().Be("cheap");
        result.Score.Metrics.Single(metric => metric.MetricId == BuiltInMetrics.ResourceCost)
            .RawValue.Should().Be(0.1m);
    }

    [Fact]
    public void Run_ResourceConflict_IsEnforcedByCpSatAndGreedyThenIndependentlyValidated()
    {
        ProblemSnapshot problem = CpSatFixture.ResourceConflictProblem();
        RulePackage rules = CpSatFixture.ResourceConflictRules();
        var cpSat = new CpSatStrategy();
        var greedy = new DeterministicGreedyStrategy();

        SolverPipelineResult cpSatResult = CpSatFixture.Pipeline(cpSat).Run(
            problem,
            rules,
            CpSatFixture.Profile(),
            "cp-sat-conflict-candidates",
            "cp-sat-conflict-run");
        SolverPipelineResult greedyResult = CpSatFixture.Pipeline(greedy).Run(
            problem,
            rules,
            CpSatFixture.Profile(DeterministicGreedyStrategy.Id),
            "greedy-conflict-candidates",
            "greedy-conflict-run");

        cpSatResult.Optimization.Assignments.Should().ContainSingle();
        greedyResult.Optimization.Assignments.Should().ContainSingle();
        cpSatResult.Validation.Passed.Should().BeTrue();
        greedyResult.Validation.Passed.Should().BeTrue();
        cpSatResult.Optimization.UnassignedSubjects.Should().ContainSingle();
        greedyResult.Optimization.UnassignedSubjects.Should().ContainSingle();
    }

    [Fact]
    public void Run_SameFrozenInputs_ProducesDeterministicArtifacts()
    {
        var strategy = new CpSatStrategy();
        SolverPipeline pipeline = CpSatFixture.Pipeline(strategy);

        SolverPipelineResult first = pipeline.Run(
            CpSatFixture.CoverageProblem(),
            CpSatFixture.Rules(),
            CpSatFixture.Profile(),
            "deterministic-candidates",
            "deterministic-run");
        SolverPipelineResult second = pipeline.Run(
            CpSatFixture.CoverageProblem(),
            CpSatFixture.Rules(),
            CpSatFixture.Profile(),
            "deterministic-candidates",
            "deterministic-run");

        second.Optimization.Should().BeEquivalentTo(first.Optimization);
        second.Validation.Should().BeEquivalentTo(first.Validation);
        second.Score.Should().BeEquivalentTo(first.Score);
    }

    [Fact]
    public void Run_PositiveTimeLimit_CompletesThroughStandardPipeline()
    {
        var strategy = new CpSatStrategy();

        SolverPipelineResult result = CpSatFixture.Pipeline(strategy).Run(
            CpSatFixture.CoverageProblem(),
            CpSatFixture.Rules(),
            CpSatFixture.Profile(timeLimit: TimeSpan.FromSeconds(5)),
            "timed-candidates",
            "timed-run");

        result.Manifest.TimeLimit.Should().Be(TimeSpan.FromSeconds(5));
        result.Optimization.Status.Should().Be("Optimal");
    }

    [Fact]
    public void Solve_AlreadyCancelledToken_Throws()
    {
        var strategy = new CpSatStrategy();
        ProblemSnapshot problem = CpSatFixture.CoverageProblem();
        RulePackage rules = CpSatFixture.Rules();
        CompiledProfile profile = CpSatFixture.Compiler(strategy).Compile(CpSatFixture.Profile(), rules);
        RunManifest manifest = RunManifestFactory.Create("cancelled-run", problem, profile, rules, strategy);
        CandidateBatch candidates = CandidateGenerator.Generate(manifest, problem, rules, "cancelled-candidates");
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        Action action = () => strategy.Solve(
            manifest,
            problem,
            rules,
            candidates,
            profile,
            cancellation.Token);

        action.Should().Throw<OperationCanceledException>();
    }

    [Fact]
    public void Solve_ModifiedCandidateBatch_FailsClosed()
    {
        var strategy = new CpSatStrategy();
        ProblemSnapshot problem = CpSatFixture.CoverageProblem();
        RulePackage rules = CpSatFixture.Rules();
        CompiledProfile profile = CpSatFixture.Compiler(strategy).Compile(CpSatFixture.Profile(), rules);
        RunManifest manifest = RunManifestFactory.Create("lineage-run", problem, profile, rules, strategy);
        CandidateBatch candidates = CandidateGenerator.Generate(manifest, problem, rules, "lineage-candidates");
        CandidateBatch modified = candidates with
        {
            Alternatives = candidates.Alternatives.Skip(1).ToList()
        };

        Action action = () => strategy.Solve(
            manifest,
            problem,
            rules,
            modified,
            profile,
            CancellationToken.None);

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*fingerprint does not match*");
    }
}
