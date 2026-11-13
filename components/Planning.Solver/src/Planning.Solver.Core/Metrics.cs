namespace Planning.Solver;

/// <summary>How a metric value relates to source evidence.</summary>
public enum MetricValueKind
{
    /// <summary>Directly measured from an observed event or system.</summary>
    Observed,

    /// <summary>Produced by a versioned predictive model.</summary>
    Predicted,

    /// <summary>Calculated deterministically from frozen planning inputs.</summary>
    Derived,

    /// <summary>Frozen operational or reference configuration selected for the run.</summary>
    Configured
}

/// <summary>Relationship between solver optimization and final metric calculation.</summary>
public enum MetricOptimizationKind
{
    /// <summary>The solver optimizes the same formula used for final scoring.</summary>
    Exact,

    /// <summary>The solver uses a documented proxy and final scoring recalculates the true metric.</summary>
    Proxy,

    /// <summary>The metric is calculated for evidence but is not optimized by the strategy.</summary>
    ScoringOnly
}

/// <summary>Behavior when a selected metric lacks a required frozen input.</summary>
public enum MissingMetricInputPolicy
{
    /// <summary>Stop scoring and fail the run explicitly.</summary>
    FailRun,

    /// <summary>Record the metric as unavailable and reject plan acceptance.</summary>
    MarkUnavailableAndReject
}

/// <summary>Availability of one calculated metric.</summary>
public enum MetricAvailability
{
    /// <summary>The metric was calculated from all required evidence.</summary>
    Available,

    /// <summary>The metric could not be calculated from the frozen inputs.</summary>
    Unavailable
}

/// <summary>Exact frozen dataset required by a metric calculator.</summary>
public sealed record MetricInputRequirement(
    string DatasetId,
    string Version,
    MetricValueKind ValueKind);

/// <summary>Identity, provenance, and content fingerprint of one frozen metric dataset.</summary>
public sealed record MetricInputDescriptor(
    string DatasetId,
    string Version,
    MetricValueKind ValueKind,
    DateTimeOffset KnowledgeCutoff,
    string Source,
    string ContentFingerprint);

/// <summary>One dimensioned contribution to a calculated metric.</summary>
public sealed record MetricBreakdownValue(
    IReadOnlyDictionary<string, string> Dimensions,
    decimal Value);

/// <summary>Raw metric value and optional dimensioned evidence.</summary>
public sealed record MetricCalculation(
    decimal RawValue,
    IReadOnlyList<MetricBreakdownValue> Breakdowns);

/// <summary>Immutable typed metric input supplied by a domain or model adapter.</summary>
public interface IMetricInputDataset
{
    /// <summary>Frozen identity and provenance.</summary>
    MetricInputDescriptor Descriptor { get; }

    /// <summary>Recalculates the deterministic fingerprint from dataset content.</summary>
    string CalculateContentFingerprint();
}

/// <summary>Verified frozen metric datasets selected for one run.</summary>
public sealed class MetricInputSet
{
    private readonly Dictionary<string, IMetricInputDataset> _datasets;

    private MetricInputSet(
        IReadOnlyList<IMetricInputDataset> datasets,
        Dictionary<string, IMetricInputDataset> byId,
        string fingerprint)
    {
        Datasets = datasets;
        _datasets = byId;
        Fingerprint = fingerprint;
    }

    /// <summary>Verified empty input set for metrics that need only canonical planning artifacts.</summary>
    public static MetricInputSet Empty { get; } = Create([]);

    /// <summary>Datasets in deterministic dataset-ID order.</summary>
    public IReadOnlyList<IMetricInputDataset> Datasets { get; }

    /// <summary>Fingerprint of every descriptor and dataset content fingerprint.</summary>
    public string Fingerprint { get; }

    /// <summary>Creates and verifies a frozen input set.</summary>
    public static MetricInputSet Create(IEnumerable<IMetricInputDataset> datasets)
    {
        ArgumentNullException.ThrowIfNull(datasets);
        List<IMetricInputDataset> supplied = datasets.ToList();
        foreach (IMetricInputDataset dataset in supplied)
        {
            ArgumentNullException.ThrowIfNull(dataset);
            ArgumentNullException.ThrowIfNull(dataset.Descriptor);
        }

        List<IMetricInputDataset> ordered = supplied
            .OrderBy(dataset => dataset.Descriptor.DatasetId, StringComparer.Ordinal)
            .ToList();
        var byId = new Dictionary<string, IMetricInputDataset>(StringComparer.Ordinal);
        foreach (IMetricInputDataset dataset in ordered)
        {
            ValidateDescriptor(dataset.Descriptor);
            string actual = dataset.CalculateContentFingerprint();
            if (!string.Equals(
                    dataset.Descriptor.ContentFingerprint,
                    actual,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Metric input '{dataset.Descriptor.DatasetId}' content fingerprint does not match its descriptor.");
            }

            if (!byId.TryAdd(dataset.Descriptor.DatasetId, dataset))
            {
                throw new InvalidOperationException(
                    $"Metric input dataset '{dataset.Descriptor.DatasetId}' is declared more than once.");
            }
        }

        return new MetricInputSet(
            ordered,
            byId,
            ArtifactFingerprints.MetricInputs(ordered));
    }

    /// <summary>Fails if dataset content changed after the set was frozen.</summary>
    public void VerifyIntegrity()
    {
        foreach (IMetricInputDataset dataset in Datasets)
        {
            string actual = dataset.CalculateContentFingerprint();
            if (!string.Equals(
                    dataset.Descriptor.ContentFingerprint,
                    actual,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Metric input '{dataset.Descriptor.DatasetId}' changed after it was frozen.");
            }
        }

        string actualSetFingerprint = ArtifactFingerprints.MetricInputs(Datasets);
        if (!string.Equals(Fingerprint, actualSetFingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Metric input-set fingerprint does not match its content.");
        }
    }

    /// <summary>Finds a dataset by stable ID.</summary>
    public bool TryGet(string datasetId, out IMetricInputDataset? dataset) =>
        _datasets.TryGetValue(datasetId, out dataset);

    private static void ValidateDescriptor(MetricInputDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentException.ThrowIfNullOrWhiteSpace(descriptor.DatasetId);
        ArgumentException.ThrowIfNullOrWhiteSpace(descriptor.Version);
        ArgumentException.ThrowIfNullOrWhiteSpace(descriptor.Source);
        ArgumentException.ThrowIfNullOrWhiteSpace(descriptor.ContentFingerprint);
    }
}

/// <summary>Inputs supplied to one metric calculator.</summary>
public sealed record MetricCalculationContext(
    ProblemSnapshot Problem,
    RulePackage Rules,
    OptimizationResult Optimization,
    MetricInputSet Inputs);

/// <summary>Calculates one versioned raw metric from frozen artifacts and datasets.</summary>
public interface IMetricCalculator
{
    /// <summary>Metric semantics and required input contract.</summary>
    MetricDefinition Definition { get; }

    /// <summary>Calculates the raw value after required inputs are verified.</summary>
    MetricCalculation Calculate(MetricCalculationContext context);
}

/// <summary>Registry of exact metric calculator versions.</summary>
public sealed class MetricRegistry
{
    private readonly Dictionary<string, IMetricCalculator> _calculators;

    /// <summary>Creates a registry from explicit calculators.</summary>
    public MetricRegistry(IEnumerable<IMetricCalculator> calculators)
    {
        ArgumentNullException.ThrowIfNull(calculators);
        _calculators = calculators.ToDictionary(
            calculator => calculator.Definition.MetricId,
            StringComparer.Ordinal);
        if (_calculators.Count == 0)
        {
            throw new ArgumentException("At least one metric calculator must be registered.", nameof(calculators));
        }
    }

    /// <summary>Default registry containing the domain-neutral built-in metrics.</summary>
    public static MetricRegistry BuiltIn { get; } = new(
    [
        new AssignmentCoverageCalculator(),
        new ResourceCostCalculator()
    ]);

    /// <summary>Creates a registry containing built-ins and additional calculators.</summary>
    public static MetricRegistry CreateWithBuiltIns(IEnumerable<IMetricCalculator> calculators)
    {
        ArgumentNullException.ThrowIfNull(calculators);
        return new MetricRegistry(
        [
            new AssignmentCoverageCalculator(),
            new ResourceCostCalculator(),
            .. calculators
        ]);
    }

    /// <summary>Definitions available for profile compilation.</summary>
    public IReadOnlyList<MetricDefinition> Definitions => _calculators.Values
        .Select(calculator => calculator.Definition)
        .OrderBy(definition => definition.MetricId, StringComparer.Ordinal)
        .ToList();

    /// <summary>Resolves an exact metric calculator and version.</summary>
    public IMetricCalculator Resolve(string metricId, string version)
    {
        if (!_calculators.TryGetValue(metricId, out IMetricCalculator? calculator))
        {
            throw new InvalidOperationException($"Metric calculator '{metricId}' is not registered.");
        }

        if (!string.Equals(calculator.Definition.Version, version, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Metric calculator '{metricId}' requires version '{calculator.Definition.Version}', not '{version}'.");
        }

        return calculator;
    }

    private sealed class AssignmentCoverageCalculator : IMetricCalculator
    {
        public MetricDefinition Definition { get; } = BuiltInMetrics.Definitions.Single(
            definition => definition.MetricId == BuiltInMetrics.AssignmentCoverage);

        public MetricCalculation Calculate(MetricCalculationContext context)
        {
            ArgumentNullException.ThrowIfNull(context);
            decimal value = context.Problem.Subjects.Count == 0
                ? 0
                : Math.Round(
                    (decimal)context.Optimization.Assignments.Count / context.Problem.Subjects.Count,
                    6);
            return new MetricCalculation(value, []);
        }
    }

    private sealed class ResourceCostCalculator : IMetricCalculator
    {
        public MetricDefinition Definition { get; } = BuiltInMetrics.Definitions.Single(
            definition => definition.MetricId == BuiltInMetrics.ResourceCost);

        public MetricCalculation Calculate(MetricCalculationContext context)
        {
            ArgumentNullException.ThrowIfNull(context);
            var resources = context.Problem.Resources.ToDictionary(
                resource => resource.ResourceId,
                StringComparer.Ordinal);
            decimal value = context.Optimization.Assignments.Sum(
                assignment => resources[assignment.ResourceId].Cost);
            return new MetricCalculation(value, []);
        }
    }
}
