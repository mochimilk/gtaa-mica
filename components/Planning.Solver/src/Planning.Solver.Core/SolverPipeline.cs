namespace Planning.Solver;

/// <summary>Artifacts produced by the first domain-neutral solver vertical slice.</summary>
public sealed record SolverPipelineResult(
    RunManifest Manifest,
    CompiledProfile Profile,
    CandidateBatch Candidates,
    OptimizationResult Optimization,
    PlanValidationResult Validation,
    PlanScore Score);

/// <summary>Coordinates pure solver stages without persistence, messaging, or cloud dependencies.</summary>
public sealed class SolverPipeline(
    ProfileCompiler profileCompiler,
    IOptimizationStrategy strategy,
    MetricRegistry? metricRegistry = null)
{
    private readonly MetricRegistry _metricRegistry = metricRegistry ?? MetricRegistry.BuiltIn;

    /// <summary>Runs the canonical vertical slice against immutable inputs.</summary>
    public SolverPipelineResult Run(
        ProblemSnapshot problem,
        RulePackage rules,
        ProfileDefinition profileDefinition,
        string candidateBatchId,
        string runId,
        MetricInputSet? metricInputs = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(profileDefinition);
        MetricInputSet inputs = metricInputs ?? MetricInputSet.Empty;

        CompiledProfile profile = profileCompiler.Compile(profileDefinition, rules);
        RunManifest manifest = RunManifestFactory.Create(
            runId,
            problem,
            profile,
            rules,
            strategy,
            metricInputs: inputs);
        RunManifestFactory.VerifyInputs(manifest, problem, profile, rules, strategy, inputs);
        CandidateBatch candidates = CandidateGenerator.Generate(manifest, problem, rules, candidateBatchId);
        OptimizationResult optimization = strategy.Solve(
            manifest,
            problem,
            rules,
            candidates,
            profile,
            cancellationToken);
        PlanValidationResult validation = CompletePlanValidator.Validate(manifest, problem, rules, candidates, optimization);
        PlanScore score = PlanScorer.Score(
            manifest,
            problem,
            rules,
            optimization,
            validation,
            profile,
            inputs,
            _metricRegistry);
        return new SolverPipelineResult(manifest, profile, candidates, optimization, validation, score);
    }
}
