namespace Planning.Solver;

/// <summary>Immutable identity and component versions for one reproducible solver run.</summary>
public sealed record RunManifest(
    string RunId,
    string ProblemFingerprint,
    string ProfileFingerprint,
    string RulePackageFingerprint,
    string MetricInputFingerprint,
    string CandidateGeneratorVersion,
    string SolverStrategyId,
    string SolverStrategyVersion,
    string ValidatorVersion,
    string ScorerVersion,
    DateTimeOffset KnowledgeCutoff,
    TimeWindow PlanningHorizon,
    int RandomSeed,
    TimeSpan? TimeLimit,
    string? ParentPlanFingerprint,
    IReadOnlyDictionary<string, bool> FeatureFlags,
    string Fingerprint);

/// <summary>Input and output fingerprints that bind an artifact to one frozen run.</summary>
public sealed record ArtifactLineage(
    string RunManifestFingerprint,
    string InputFingerprint,
    string ArtifactFingerprint);

/// <summary>Creates and verifies frozen run manifests.</summary>
public static class RunManifestFactory
{
    /// <summary>Creates a manifest from the immutable inputs selected before candidate generation.</summary>
    public static RunManifest Create(
        string runId,
        ProblemSnapshot problem,
        CompiledProfile profile,
        RulePackage rules,
        IOptimizationStrategy strategy,
        IReadOnlyDictionary<string, bool>? featureFlags = null,
        string? parentPlanFingerprint = null,
        MetricInputSet? metricInputs = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(runId);
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(strategy);
        MetricInputSet inputs = metricInputs ?? MetricInputSet.Empty;
        inputs.VerifyIntegrity();

        if (!string.Equals(profile.Search.StrategyId, strategy.StrategyId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Profile requests strategy '{profile.Search.StrategyId}', not '{strategy.StrategyId}'.");
        }

        if (problem.Subjects.Count == 0)
        {
            throw new InvalidOperationException("A run manifest requires at least one demand subject.");
        }

        var flags = (featureFlags ?? new Dictionary<string, bool>(StringComparer.Ordinal))
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        var horizon = TimeWindow.Create(
            problem.Subjects.Min(subject => subject.Window.Start),
            problem.Subjects.Max(subject => subject.Window.End));
        string problemFingerprint = ArtifactFingerprints.Problem(problem);
        string rulePackageFingerprint = ArtifactFingerprints.RulePackage(rules);
        var manifest = new RunManifest(
            runId,
            problemFingerprint,
            profile.Fingerprint,
            rulePackageFingerprint,
            inputs.Fingerprint,
            CandidateGenerator.Version,
            strategy.StrategyId,
            strategy.Version,
            CompletePlanValidator.Version,
            PlanScorer.Version,
            problem.KnowledgeCutoff,
            horizon,
            profile.Search.RandomSeed,
            profile.Search.TimeLimit,
            parentPlanFingerprint,
            flags,
            string.Empty);
        return manifest with { Fingerprint = ArtifactFingerprints.RunManifest(manifest) };
    }

    /// <summary>Fails when execution inputs no longer match a frozen manifest.</summary>
    public static void VerifyInputs(
        RunManifest manifest,
        ProblemSnapshot problem,
        CompiledProfile profile,
        RulePackage rules,
        IOptimizationStrategy strategy,
        MetricInputSet? metricInputs = null)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(strategy);
        MetricInputSet inputs = metricInputs ?? MetricInputSet.Empty;
        inputs.VerifyIntegrity();
        VerifyIntegrity(manifest);
        RequireEqual("problem", manifest.ProblemFingerprint, ArtifactFingerprints.Problem(problem));
        RequireEqual("profile", manifest.ProfileFingerprint, profile.Fingerprint);
        RequireEqual("rule package", manifest.RulePackageFingerprint, ArtifactFingerprints.RulePackage(rules));
        RequireEqual("metric inputs", manifest.MetricInputFingerprint, inputs.Fingerprint);
        RequireEqual("candidate generator version", manifest.CandidateGeneratorVersion, CandidateGenerator.Version);
        RequireEqual("strategy ID", manifest.SolverStrategyId, strategy.StrategyId);
        RequireEqual("strategy version", manifest.SolverStrategyVersion, strategy.Version);
        RequireEqual("validator version", manifest.ValidatorVersion, CompletePlanValidator.Version);
        RequireEqual("scorer version", manifest.ScorerVersion, PlanScorer.Version);
    }

    /// <summary>Verifies the frozen inputs consumed directly by an optimization strategy.</summary>
    public static void VerifyOptimizationInputs(
        RunManifest manifest,
        ProblemSnapshot problem,
        CompiledProfile profile,
        RulePackage rules,
        CandidateBatch candidates,
        IOptimizationStrategy strategy)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(candidates);
        ArgumentNullException.ThrowIfNull(strategy);
        VerifyIntegrity(manifest);
        RequireEqual("problem", manifest.ProblemFingerprint, ArtifactFingerprints.Problem(problem));
        RequireEqual("profile", manifest.ProfileFingerprint, profile.Fingerprint);
        RequireEqual("rule package", manifest.RulePackageFingerprint, ArtifactFingerprints.RulePackage(rules));
        RequireEqual("strategy ID", manifest.SolverStrategyId, strategy.StrategyId);
        RequireEqual("strategy version", manifest.SolverStrategyVersion, strategy.Version);

        if (!string.Equals(profile.Search.StrategyId, strategy.StrategyId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Profile requests strategy '{profile.Search.StrategyId}', not '{strategy.StrategyId}'.");
        }

        if (!string.Equals(candidates.Lineage.RunManifestFingerprint, manifest.Fingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Candidate batch belongs to a different run manifest.");
        }

        string candidateFingerprint = ArtifactFingerprints.CandidateBatch(candidates);
        if (!string.Equals(candidates.Lineage.ArtifactFingerprint, candidateFingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Candidate batch fingerprint does not match its content.");
        }
    }

    /// <summary>Fails when a manifest fingerprint no longer matches its content.</summary>
    public static void VerifyIntegrity(RunManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        RequireEqual("fingerprint", manifest.Fingerprint, ArtifactFingerprints.RunManifest(manifest));
    }

    internal static void RequireEqual(string label, string expected, string actual)
    {
        if (!string.Equals(expected, actual, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Frozen run manifest {label} mismatch. Expected '{expected}', received '{actual}'.");
        }
    }
}
