using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Planning.Solver.Airport;

/// <summary>One simultaneous airport placement selected by the residual matcher.</summary>
public sealed record AirportCapacityMatch(
    string VisitId,
    string StandId,
    TimeWindow Window);

/// <summary>Airport-specific view of global residual matching evidence.</summary>
public sealed record AirportCapacityMatchingResult(
    ResidualMatchingStatus Status,
    int MatchedVisitCount,
    int TotalUnassignedVisitCount,
    IReadOnlyList<AirportCapacityMatch> Matches,
    IReadOnlyList<string> UnmatchedVisitIds,
    int ExploredNodeCount,
    int MaximumSearchNodes)
{
    /// <summary>Whether all unassigned visits were simultaneously placed with complete proof.</summary>
    public bool AllVisitsMatched =>
        Status == ResidualMatchingStatus.Optimal
        && MatchedVisitCount == TotalUnassignedVisitCount;
}

/// <summary>Frozen bounded-search policy for global capacity matching.</summary>
public sealed class AirportCapacityMatchingInput : IMetricInputDataset
{
    /// <summary>Stable dataset ID required by global matching metric v4.</summary>
    public const string DatasetId = "airport-capacity-matching-policy";

    /// <summary>Current policy contract version.</summary>
    public const string Version = "1.0.0";

    private AirportCapacityMatchingInput(MetricInputDescriptor descriptor, int maximumSearchNodes)
    {
        Descriptor = descriptor;
        MaximumSearchNodes = maximumSearchNodes;
    }

    /// <inheritdoc />
    public MetricInputDescriptor Descriptor { get; }

    /// <summary>Maximum deterministic search nodes before proof fails explicitly.</summary>
    public int MaximumSearchNodes { get; }

    /// <summary>Creates a fingerprinted matching policy.</summary>
    public static AirportCapacityMatchingInput Create(
        DateTimeOffset knowledgeCutoff,
        string source,
        int maximumSearchNodes)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        if (maximumSearchNodes <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maximumSearchNodes),
                "Maximum search nodes must be positive.");
        }

        string fingerprint = Fingerprint(maximumSearchNodes);
        return new AirportCapacityMatchingInput(
            new MetricInputDescriptor(
                DatasetId,
                Version,
                MetricValueKind.Configured,
                knowledgeCutoff,
                source,
                fingerprint),
            maximumSearchNodes);
    }

    /// <inheritdoc />
    public string CalculateContentFingerprint() => Fingerprint(MaximumSearchNodes);

    private static string Fingerprint(int maximumSearchNodes)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(
            $"airport-capacity-matching-policy-v1:{maximumSearchNodes.ToString(CultureInfo.InvariantCulture)}");
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
}

/// <summary>Builds airport alternatives and delegates exact search to the core matcher.</summary>
public static class AirportCapacityMatcher
{
    /// <summary>Finds the maximum simultaneous airport placement or reports incomplete proof.</summary>
    public static AirportCapacityMatchingResult Match(
        MetricCalculationContext context,
        AirportCapacityMatchingInput policy)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(policy);
        if (!context.Inputs.TryGet(
                AirportModelCapacityInput.DatasetId,
                out IMetricInputDataset? untypedModelInput)
            || untypedModelInput is not AirportModelCapacityInput modelInput)
        {
            throw new InvalidOperationException("Verified airport model-capacity input is unavailable.");
        }

        Dictionary<string, AirportCapacityProfile> capacityProfiles = modelInput.CapacityProfiles
            .ToDictionary(profile => profile.StandId, StringComparer.Ordinal);
        Dictionary<string, PlanningSubject> subjects = context.Problem.Subjects
            .ToDictionary(subject => subject.SubjectId, StringComparer.Ordinal);
        string[] residualVisitIds = context.Optimization.UnassignedSubjects
            .Select(subject => subject.SubjectId)
            .Order(StringComparer.Ordinal)
            .ToArray();
        ResidualMatchingAlternative[] alternatives = residualVisitIds
            .SelectMany(visitId =>
            {
                PlanningSubject subject = subjects[visitId];
                AirportVisitAircraftModel visit = modelInput.Matrix.VisitModels.Single(item =>
                    string.Equals(item.VisitId, visitId, StringComparison.Ordinal));
                return context.Problem.Resources
                    .Where(resource => string.Equals(
                        capacityProfiles[resource.ResourceId].SectorId,
                        visit.SectorId,
                        StringComparison.Ordinal))
                    .Select(resource => new ResidualMatchingAlternative(
                        $"capacity-match:{visitId}:{resource.ResourceId}",
                        visitId,
                        resource.ResourceId,
                        subject.Window));
            })
            .ToArray();
        ResidualMatchingResult result = ResidualAssignmentMatcher.Match(
            new ResidualMatchingRequest(
                context.Problem,
                context.Rules,
                context.Optimization.Assignments,
                residualVisitIds,
                alternatives,
                policy.MaximumSearchNodes));
        AirportCapacityMatch[] matches = result.Assignments
            .Select(assignment => new AirportCapacityMatch(
                assignment.SubjectId,
                assignment.ResourceId,
                assignment.Window))
            .ToArray();
        return new AirportCapacityMatchingResult(
            result.Status,
            result.MatchedSubjectCount,
            result.TotalResidualSubjectCount,
            matches,
            result.UnmatchedSubjectIds,
            result.ExploredNodeCount,
            result.MaximumSearchNodes);
    }
}

/// <summary>Typed exact-model capacity plus simultaneous global matching evidence.</summary>
public sealed record AirportGlobalModelCapacityResult(
    AirportModelCapacityResult ModelCapacity,
    AirportCapacityMatchingResult Matching);

/// <summary>Calculates virtual capacity v4 with bounded global matching proof.</summary>
public sealed class AirportGlobalModelCapacityCalculator : IMetricCalculator
{
    /// <inheritdoc />
    public MetricDefinition Definition { get; } = new(
        AirportMetrics.VirtualCapacitySlots,
        "4.0.0",
        "physical-slot",
        ObjectiveDirection.Maximize,
        MetricValueKind.Derived,
        MetricOptimizationKind.ScoringOnly,
        [
            new MetricInputRequirement(
                AirportModelCapacityInput.DatasetId,
                AirportModelCapacityInput.Version,
                MetricValueKind.Configured),
            new MetricInputRequirement(
                AirportCapacityMatchingInput.DatasetId,
                AirportCapacityMatchingInput.Version,
                MetricValueKind.Configured)
        ]);

    /// <inheritdoc />
    public MetricCalculation Calculate(MetricCalculationContext context)
    {
        AirportGlobalModelCapacityResult result = CalculateDetailed(context);
        if (result.Matching.Status == ResidualMatchingStatus.SearchLimitReached)
        {
            throw new InvalidOperationException(
                $"Global capacity matching exceeded its {result.Matching.MaximumSearchNodes} node limit.");
        }

        List<MetricBreakdownValue> breakdowns = result.ModelCapacity.Slots
            .Select(slot => new MetricBreakdownValue(
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["evidence-kind"] = "physical-slot",
                    ["stand"] = slot.StandId,
                    ["terminal"] = slot.TerminalId,
                    ["sector"] = slot.SectorId,
                    ["peak"] = slot.IsPeak ? "true" : "false",
                    ["start-utc"] = slot.Window.Start.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
                    ["end-utc"] = slot.Window.End.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)
                },
                1m))
            .ToList();
        breakdowns.Add(
            new MetricBreakdownValue(
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["evidence-kind"] = "global-matching-summary",
                    ["status"] = result.Matching.Status.ToString(),
                    ["all-visits-matched"] = result.Matching.AllVisitsMatched ? "true" : "false",
                    ["total-unassigned-visits"] = result.Matching.TotalUnassignedVisitCount
                        .ToString(CultureInfo.InvariantCulture),
                    ["unmatched-visits"] = string.Join(",", result.Matching.UnmatchedVisitIds),
                    ["explored-nodes"] = result.Matching.ExploredNodeCount.ToString(CultureInfo.InvariantCulture),
                    ["maximum-search-nodes"] = result.Matching.MaximumSearchNodes
                        .ToString(CultureInfo.InvariantCulture)
                },
                result.Matching.MatchedVisitCount));
        breakdowns.AddRange(result.Matching.Matches.Select(match => new MetricBreakdownValue(
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["evidence-kind"] = "global-matching-assignment",
                ["visit"] = match.VisitId,
                ["stand"] = match.StandId,
                ["start-utc"] = match.Window.Start.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
                ["end-utc"] = match.Window.End.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)
            },
            1m)));
        return new MetricCalculation(result.ModelCapacity.TotalPhysicalSlots, breakdowns);
    }

    /// <summary>Calculates typed physical capacity and simultaneous matching evidence.</summary>
    public static AirportGlobalModelCapacityResult CalculateDetailed(MetricCalculationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (!context.Inputs.TryGet(
                AirportCapacityMatchingInput.DatasetId,
                out IMetricInputDataset? untypedPolicy)
            || untypedPolicy is not AirportCapacityMatchingInput policy)
        {
            throw new InvalidOperationException("Verified airport capacity-matching policy is unavailable.");
        }

        return new AirportGlobalModelCapacityResult(
            AirportModelCapacityCalculator.CalculateDetailed(context),
            AirportCapacityMatcher.Match(context, policy));
    }
}
