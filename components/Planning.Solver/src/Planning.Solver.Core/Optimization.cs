namespace Planning.Solver;

/// <summary>How multiple objective terms are composed by a strategy.</summary>
public enum ObjectiveComposition
{
    /// <summary>All signed objective contributions are added using profile weights.</summary>
    WeightedSum,

    /// <summary>Objectives are optimized in declared priority order.</summary>
    Lexicographic
}

/// <summary>Capabilities a strategy publishes for pre-run compatibility checks.</summary>
public sealed record StrategyRuleCapability(
    string RuleId,
    string RuleVersion,
    SolverRuleRepresentation Representation);

/// <summary>Capabilities a strategy publishes for pre-run compatibility checks.</summary>
public sealed record StrategyCapabilities(
    string StrategyId,
    string Version,
    IReadOnlySet<string> SupportedObjectiveMetricIds,
    IReadOnlySet<ObjectiveComposition> SupportedObjectiveCompositions,
    IReadOnlyList<StrategyRuleCapability> SupportedRules,
    bool SupportsTimeLimit);

/// <summary>Pluggable optimization strategy over an immutable candidate batch.</summary>
public interface IOptimizationStrategy
{
    /// <summary>Metrics, objective modes, rule shapes, and controls supported by the strategy.</summary>
    StrategyCapabilities Capabilities { get; }

    /// <summary>Stable strategy identifier.</summary>
    string StrategyId => Capabilities.StrategyId;

    /// <summary>Version of strategy semantics included in run manifests.</summary>
    string Version => Capabilities.Version;

    /// <summary>Selects a compatible set of candidates.</summary>
    OptimizationResult Solve(
        RunManifest manifest,
        ProblemSnapshot problem,
        RulePackage rules,
        CandidateBatch candidates,
        CompiledProfile profile,
        CancellationToken cancellationToken);
}

/// <summary>
/// Deterministic first-slice strategy that prioritizes high-priority demand,
/// then selects the lowest-cost non-overlapping eligible resource.
/// </summary>
public sealed class DeterministicGreedyStrategy : IOptimizationStrategy
{
    /// <summary>Stable strategy identifier.</summary>
    public const string Id = "deterministic-greedy-v1";

    /// <inheritdoc />
    public StrategyCapabilities Capabilities { get; } = new(
        Id,
        "1.1.0",
        new HashSet<string>(
        [
            BuiltInMetrics.AssignmentCoverage,
            BuiltInMetrics.ResourceCost
        ],
        StringComparer.Ordinal),
        new HashSet<ObjectiveComposition>
        {
            ObjectiveComposition.WeightedSum
        },
        [
            new(
                RequiredCapabilitiesRule.Id,
                RequiredCapabilitiesRule.Version,
                SolverRuleRepresentation.CandidateFilter),
            new(
                ResourceCommitmentRule.Id,
                ResourceCommitmentRule.Version,
                SolverRuleRepresentation.CandidateFilter),
            new(
                ResourceNonOverlapRule.Id,
                ResourceNonOverlapRule.Version,
                SolverRuleRepresentation.PairwiseConflict),
            new(
                ResourceConflictRule.Id,
                ResourceConflictRule.Version,
                SolverRuleRepresentation.PairwiseConflict)
        ],
        SupportsTimeLimit: false);

    /// <inheritdoc />
    public string StrategyId => Capabilities.StrategyId;

    /// <inheritdoc />
    public string Version => Capabilities.Version;

    /// <inheritdoc />
    public OptimizationResult Solve(
        RunManifest manifest,
        ProblemSnapshot problem,
        RulePackage rules,
        CandidateBatch candidates,
        CompiledProfile profile,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(candidates);
        ArgumentNullException.ThrowIfNull(profile);
        RunManifestFactory.VerifyOptimizationInputs(manifest, problem, profile, rules, candidates, this);
        string candidateFingerprint = candidates.Lineage.ArtifactFingerprint;

        var resources = problem.Resources.ToDictionary(resource => resource.ResourceId, StringComparer.Ordinal);
        List<ResourceConflictRule> resourceConflictRules = rules.CompletePlanRules
            .OfType<ResourceConflictRule>()
            .ToList();
        var selected = new List<SelectedAssignment>();
        var unassigned = new List<UnassignedSubject>();
        foreach (PlanningSubject subject in problem.Subjects
                     .OrderByDescending(item => item.Priority)
                     .ThenBy(item => item.Window.Start)
                     .ThenBy(item => item.SubjectId, StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();
            CandidateAlternative? candidate = candidates.Eligible
                .Where(item => string.Equals(item.SubjectId, subject.SubjectId, StringComparison.Ordinal))
                .Where(item => selected.All(assignment =>
                    (!string.Equals(assignment.ResourceId, item.ResourceId, StringComparison.Ordinal)
                        || !assignment.Window.Overlaps(item.Window))
                    && resourceConflictRules.All(rule => !rule.ConflictsWith(
                        assignment.ResourceId,
                        assignment.Window,
                        item.ResourceId,
                        item.Window))))
                .OrderBy(item => resources[item.ResourceId].Cost)
                .ThenBy(item => item.ResourceId, StringComparer.Ordinal)
                .FirstOrDefault();

            if (candidate is null)
            {
                unassigned.Add(new UnassignedSubject(subject.SubjectId, "NO_COMPATIBLE_ALTERNATIVE"));
                continue;
            }

            selected.Add(new SelectedAssignment(
                candidate.AlternativeId,
                candidate.SubjectId,
                candidate.SegmentId,
                candidate.ResourceId,
                candidate.Window));
        }

        var result = new OptimizationResult(
            StrategyId,
            Version,
            "Feasible",
            selected,
            unassigned,
            new ArtifactLineage(manifest.Fingerprint, candidateFingerprint, string.Empty));
        return result with
        {
            Lineage = result.Lineage with { ArtifactFingerprint = ArtifactFingerprints.Plan(result) }
        };
    }
}
