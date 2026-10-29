namespace Planning.Solver;

/// <summary>Names of metrics implemented by the first domain-neutral scorer.</summary>
public static class BuiltInMetrics
{
    /// <summary>Fraction of demand subjects with one selected assignment.</summary>
    public const string AssignmentCoverage = "assignment-coverage";

    /// <summary>Sum of selected resource costs.</summary>
    public const string ResourceCost = "resource-cost";

    /// <summary>Metrics supported by the first-slice scorer.</summary>
    public static IReadOnlyList<MetricDefinition> Definitions { get; } =
    [
        new(
            AssignmentCoverage,
            "1.0.0",
            "ratio",
            ObjectiveDirection.Maximize,
            MetricValueKind.Derived,
            MetricOptimizationKind.Exact),
        new(
            ResourceCost,
            "1.0.0",
            "cost-unit",
            ObjectiveDirection.Minimize,
            MetricValueKind.Derived,
            MetricOptimizationKind.Exact)
    ];
}

/// <summary>One raw and weighted metric result.</summary>
public sealed record MetricResult(
    string MetricId,
    string Version,
    string Unit,
    MetricValueKind ValueKind,
    MetricOptimizationKind OptimizationKind,
    MetricAvailability Availability,
    decimal? RawValue,
    decimal? WeightedContribution,
    IReadOnlyList<MetricInputDescriptor> Inputs,
    IReadOnlyList<MetricBreakdownValue> Breakdowns,
    string? UnavailableReason = null);

/// <summary>Score and acceptance evidence for a validated plan.</summary>
public sealed record PlanScore(
    decimal Total,
    IReadOnlyList<MetricResult> Metrics,
    bool Accepted,
    IReadOnlyList<string> RejectionReasons,
    ArtifactLineage Lineage);

/// <summary>Calculates versioned raw metrics and applies profile acceptance.</summary>
public static class PlanScorer
{
    /// <summary>Version of scoring semantics included in run manifests.</summary>
    public const string Version = "3.0.0";

    /// <summary>Scores a complete proposed plan.</summary>
    public static PlanScore Score(
        RunManifest manifest,
        ProblemSnapshot problem,
        RulePackage rules,
        OptimizationResult optimization,
        PlanValidationResult validation,
        CompiledProfile profile,
        MetricInputSet metricInputs,
        MetricRegistry metricRegistry)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(optimization);
        ArgumentNullException.ThrowIfNull(validation);
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentNullException.ThrowIfNull(metricInputs);
        ArgumentNullException.ThrowIfNull(metricRegistry);
        metricInputs.VerifyIntegrity();
        RunManifestFactory.VerifyIntegrity(manifest);
        RunManifestFactory.RequireEqual("problem", manifest.ProblemFingerprint, ArtifactFingerprints.Problem(problem));
        RunManifestFactory.RequireEqual("rule package", manifest.RulePackageFingerprint, ArtifactFingerprints.RulePackage(rules));
        RunManifestFactory.RequireEqual("profile", manifest.ProfileFingerprint, profile.Fingerprint);
        RunManifestFactory.RequireEqual("metric inputs", manifest.MetricInputFingerprint, metricInputs.Fingerprint);
        RunManifestFactory.RequireEqual("scorer version", manifest.ScorerVersion, Version);
        if (!string.Equals(validation.Lineage.RunManifestFingerprint, manifest.Fingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Validation result belongs to a different run manifest.");
        }

        string validationFingerprint = ArtifactFingerprints.Validation(validation);
        if (!string.Equals(validation.Lineage.ArtifactFingerprint, validationFingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Validation fingerprint does not match its content.");
        }

        string planFingerprint = ArtifactFingerprints.Plan(optimization);
        if (!string.Equals(optimization.Lineage.RunManifestFingerprint, manifest.Fingerprint, StringComparison.Ordinal)
            || !string.Equals(optimization.Lineage.ArtifactFingerprint, planFingerprint, StringComparison.Ordinal)
            || !string.Equals(validation.Lineage.InputFingerprint, planFingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Validation result does not reference the supplied plan.");
        }

        var calculationContext = new MetricCalculationContext(problem, rules, optimization, metricInputs);
        var metrics = new List<MetricResult>();
        foreach (ObjectiveTerm objective in profile.Objectives)
        {
            IMetricCalculator calculator = metricRegistry.Resolve(
                objective.MetricId,
                objective.MetricVersion);
            MetricDefinition definition = calculator.Definition;
            IReadOnlyList<MetricInputRequirement> requirements = definition.RequiredInputs ?? [];
            List<MetricInputDescriptor> usedInputs = [];
            string? unavailableReason = FindUnavailableReason(requirements, metricInputs, usedInputs);
            if (unavailableReason is not null)
            {
                if (profile.MissingMetricInputs == MissingMetricInputPolicy.FailRun)
                {
                    throw new InvalidOperationException(unavailableReason);
                }

                metrics.Add(new MetricResult(
                    objective.MetricId,
                    objective.MetricVersion,
                    definition.Unit,
                    definition.ValueKind,
                    definition.OptimizationKind,
                    MetricAvailability.Unavailable,
                    null,
                    null,
                    usedInputs,
                    [],
                    unavailableReason));
                continue;
            }

            MetricCalculation calculation = calculator.Calculate(calculationContext);
            decimal value = calculation.RawValue;
            decimal signed = objective.Direction == ObjectiveDirection.Maximize ? value : -value;
            metrics.Add(new MetricResult(
                objective.MetricId,
                objective.MetricVersion,
                definition.Unit,
                definition.ValueKind,
                definition.OptimizationKind,
                MetricAvailability.Available,
                value,
                signed * objective.Weight,
                usedInputs,
                calculation.Breakdowns));
        }

        var reasons = new List<string>();
        if (validation.ViolationCount > profile.Acceptance.MaximumViolations)
        {
            reasons.Add("Plan exceeds the maximum hard-rule violation count.");
        }

        if (validation.UnverifiableCount > profile.Acceptance.MaximumUnverifiableChecks)
        {
            reasons.Add("Plan exceeds the maximum required unverifiable-check count.");
        }

        if (profile.Acceptance.MaximumUnassignedSubjects is int maximumUnassigned
            && optimization.UnassignedSubjects.Count > maximumUnassigned)
        {
            reasons.Add("Plan exceeds the maximum unassigned-subject count.");
        }

        if (metrics.Any(metric => metric.Availability == MetricAvailability.Unavailable))
        {
            reasons.Add("One or more required metrics are unavailable.");
        }

        var score = new PlanScore(
            metrics.Sum(metric => metric.WeightedContribution ?? 0),
            metrics,
            reasons.Count == 0,
            reasons,
            new ArtifactLineage(manifest.Fingerprint, validationFingerprint, string.Empty));
        return score with
        {
            Lineage = score.Lineage with { ArtifactFingerprint = ArtifactFingerprints.Score(score) }
        };
    }

    private static string? FindUnavailableReason(
        IReadOnlyList<MetricInputRequirement> requirements,
        MetricInputSet metricInputs,
        List<MetricInputDescriptor> usedInputs)
    {
        foreach (MetricInputRequirement requirement in requirements)
        {
            if (!metricInputs.TryGet(requirement.DatasetId, out IMetricInputDataset? dataset)
                || dataset is null)
            {
                return $"Metric input '{requirement.DatasetId}' is required but was not supplied.";
            }

            MetricInputDescriptor descriptor = dataset.Descriptor;
            usedInputs.Add(descriptor);
            if (!string.Equals(descriptor.Version, requirement.Version, StringComparison.Ordinal))
            {
                return $"Metric input '{requirement.DatasetId}' requires version "
                    + $"'{requirement.Version}', not '{descriptor.Version}'.";
            }

            if (descriptor.ValueKind != requirement.ValueKind)
            {
                return $"Metric input '{requirement.DatasetId}' requires value kind "
                    + $"'{requirement.ValueKind}', not '{descriptor.ValueKind}'.";
            }
        }

        return null;
    }
}
