namespace Planning.Solver;

/// <summary>Direction in which a metric improves.</summary>
public enum ObjectiveDirection
{
    /// <summary>Larger values are preferred.</summary>
    Maximize,

    /// <summary>Smaller values are preferred.</summary>
    Minimize
}

/// <summary>One objective term requested by a profile.</summary>
public sealed record ObjectiveTerm(
    string MetricId,
    string MetricVersion,
    ObjectiveDirection Direction,
    decimal Weight);

/// <summary>Acceptance policy applied after independent validation and scoring.</summary>
public sealed record AcceptancePolicy(
    int MaximumViolations = 0,
    int MaximumUnverifiableChecks = 0,
    int? MaximumUnassignedSubjects = null);

/// <summary>Search controls selected by a profile.</summary>
public sealed record SearchPolicy(
    string StrategyId,
    int RandomSeed = 42,
    TimeSpan? TimeLimit = null);

/// <summary>Rule-package selection and hard-rule enforcement requirements.</summary>
public sealed record RuleSelectionPolicy(
    IReadOnlySet<string> RequiredRulePackageIds,
    bool RequireAllHardRulesEnforcedDuringSearch = true);

/// <summary>Trace and evidence requested from a run.</summary>
public sealed record TracePolicy(
    bool IncludeCandidateRuleTrace = true,
    bool IncludeValidationFindings = true);

/// <summary>Authorable profile definition before compatibility checks and freezing.</summary>
public sealed record ProfileDefinition(
    string ProfileId,
    string Version,
    IReadOnlyList<ObjectiveTerm> Objectives,
    AcceptancePolicy Acceptance,
    SearchPolicy Search,
    ObjectiveComposition ObjectiveComposition = ObjectiveComposition.WeightedSum,
    RuleSelectionPolicy? RuleSelection = null,
    TracePolicy? Trace = null,
    MissingMetricInputPolicy MissingMetricInputs = MissingMetricInputPolicy.FailRun);

/// <summary>Validated immutable profile used by one run.</summary>
public sealed record CompiledProfile(
    string ProfileId,
    string Version,
    string Fingerprint,
    IReadOnlyList<ObjectiveTerm> Objectives,
    AcceptancePolicy Acceptance,
    SearchPolicy Search,
    ObjectiveComposition ObjectiveComposition,
    RuleSelectionPolicy RuleSelection,
    TracePolicy Trace,
    MissingMetricInputPolicy MissingMetricInputs);

/// <summary>Semantic definition of a metric understood by the scorer.</summary>
public sealed record MetricDefinition(
    string MetricId,
    string Version,
    string Unit,
    ObjectiveDirection Direction,
    MetricValueKind ValueKind = MetricValueKind.Derived,
    MetricOptimizationKind OptimizationKind = MetricOptimizationKind.Exact,
    IReadOnlyList<MetricInputRequirement>? RequiredInputs = null);

/// <summary>Validates and freezes profiles against registered metrics and solver strategies.</summary>
public sealed class ProfileCompiler
{
    private readonly Dictionary<string, MetricDefinition> _metrics;
    private readonly Dictionary<string, StrategyCapabilities> _strategies;

    /// <summary>Creates a compiler from explicit capability registries.</summary>
    public ProfileCompiler(IEnumerable<MetricDefinition> metrics, IEnumerable<StrategyCapabilities> strategies)
    {
        ArgumentNullException.ThrowIfNull(metrics);
        ArgumentNullException.ThrowIfNull(strategies);
        _metrics = metrics.ToDictionary(metric => metric.MetricId, StringComparer.Ordinal);
        _strategies = strategies.ToDictionary(strategy => strategy.StrategyId, StringComparer.Ordinal);
    }

    /// <summary>Validates a profile and returns its immutable compiled form.</summary>
    public CompiledProfile Compile(ProfileDefinition definition, RulePackage rules)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentException.ThrowIfNullOrWhiteSpace(definition.ProfileId);
        ArgumentException.ThrowIfNullOrWhiteSpace(definition.Version);

        if (!_strategies.TryGetValue(definition.Search.StrategyId, out StrategyCapabilities? strategy))
        {
            throw new InvalidOperationException($"Strategy '{definition.Search.StrategyId}' is not registered.");
        }

        if (definition.Objectives.Count == 0)
        {
            throw new InvalidOperationException("A profile must declare at least one objective.");
        }

        string? duplicateMetric = definition.Objectives
            .GroupBy(objective => objective.MetricId, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key;
        if (duplicateMetric is not null)
        {
            throw new InvalidOperationException($"Metric '{duplicateMetric}' is declared more than once.");
        }

        foreach (ObjectiveTerm objective in definition.Objectives)
        {
            if (!_metrics.TryGetValue(objective.MetricId, out MetricDefinition? metric))
            {
                throw new InvalidOperationException($"Metric '{objective.MetricId}' is not registered.");
            }

            if (!string.Equals(metric.Version, objective.MetricVersion, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Metric '{objective.MetricId}' requires version '{metric.Version}', not '{objective.MetricVersion}'.");
            }

            if (metric.Direction != objective.Direction)
            {
                throw new InvalidOperationException(
                    $"Metric '{objective.MetricId}' has direction '{metric.Direction}', not '{objective.Direction}'.");
            }

            if (objective.Weight < 0)
            {
                throw new InvalidOperationException($"Metric '{objective.MetricId}' cannot have a negative weight.");
            }

            if (metric.OptimizationKind == MetricOptimizationKind.ScoringOnly)
            {
                if (objective.Weight != 0)
                {
                    throw new InvalidOperationException(
                        $"Scoring-only metric '{objective.MetricId}' must have zero objective weight.");
                }

                continue;
            }

            if (!strategy.SupportedObjectiveMetricIds.Contains(objective.MetricId))
            {
                throw new InvalidOperationException(
                    $"Strategy '{strategy.StrategyId}' does not support objective metric '{objective.MetricId}'.");
            }
        }

        if (!strategy.SupportedObjectiveCompositions.Contains(definition.ObjectiveComposition))
        {
            throw new InvalidOperationException(
                $"Strategy '{strategy.StrategyId}' does not support objective composition '{definition.ObjectiveComposition}'.");
        }

        if (definition.Search.TimeLimit <= TimeSpan.Zero)
        {
            throw new InvalidOperationException("A search time limit must be greater than zero.");
        }

        if (definition.Search.TimeLimit is not null && !strategy.SupportsTimeLimit)
        {
            throw new InvalidOperationException($"Strategy '{strategy.StrategyId}' does not support a time limit.");
        }

        RuleSelectionPolicy ruleSelection = definition.RuleSelection
            ?? new RuleSelectionPolicy(new HashSet<string>([rules.RulePackageId], StringComparer.Ordinal));
        if (!ruleSelection.RequiredRulePackageIds.Contains(rules.RulePackageId))
        {
            throw new InvalidOperationException(
                $"Rule package '{rules.RulePackageId}' is not selected by profile '{definition.ProfileId}'.");
        }

        foreach (INormalizedRule rule in rules.AllRules)
        {
            RuleDescriptor descriptor = rule.Descriptor;
            bool supported = descriptor is
            {
                EvaluationPhase: RuleEvaluationPhase.Candidate,
                SolverRepresentation: SolverRuleRepresentation.CandidateFilter
            }
                || strategy.SupportedRules.Any(capability =>
                    string.Equals(capability.RuleId, descriptor.RuleId, StringComparison.Ordinal)
                    && string.Equals(capability.RuleVersion, descriptor.Version, StringComparison.Ordinal)
                    && capability.Representation == descriptor.SolverRepresentation);
            if (!supported
                && (descriptor.Classification == RuleClassification.Hard
                    || descriptor.Classification == RuleClassification.OperationalPolicy)
                && ruleSelection.RequireAllHardRulesEnforcedDuringSearch)
            {
                throw new InvalidOperationException(
                    $"Strategy '{strategy.StrategyId}' cannot enforce rule '{descriptor.RuleId}' "
                    + $"with representation '{descriptor.SolverRepresentation}'.");
            }
        }

        var compiledDefinition = definition with
        {
            RuleSelection = ruleSelection,
            Trace = definition.Trace ?? new TracePolicy()
        };
        return new CompiledProfile(
            definition.ProfileId,
            definition.Version,
            ArtifactFingerprints.Profile(compiledDefinition),
            definition.Objectives.ToList(),
            definition.Acceptance,
            definition.Search,
            definition.ObjectiveComposition,
            ruleSelection,
            compiledDefinition.Trace,
            definition.MissingMetricInputs);
    }
}
