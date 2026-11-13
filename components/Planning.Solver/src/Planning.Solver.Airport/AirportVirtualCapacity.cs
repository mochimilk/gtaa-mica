using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Planning.Solver.Airport;

/// <summary>Stable IDs for airport-owned metrics.</summary>
public static class AirportMetrics
{
    /// <summary>Configured aircraft-shaped slots in internal stand gaps.</summary>
    public const string VirtualCapacitySlots = "airport-virtual-capacity-slots";
}

/// <summary>Mutually exclusive capacity classification for one stand.</summary>
public sealed record AirportCapacityProfile(
    string StandId,
    string TerminalId,
    string SectorId,
    int SlotDurationMinutes);

/// <summary>Date-specific peak window for one terminal and sector.</summary>
public sealed record AirportCapacityPeakWindow(
    string TerminalId,
    string SectorId,
    TimeWindow Window);

/// <summary>One aircraft-shaped slot found in an internal stand gap.</summary>
public sealed record AirportVirtualCapacitySlot(
    string StandId,
    string TerminalId,
    string SectorId,
    TimeWindow Window,
    int SlotDurationMinutes,
    bool IsPeak);

/// <summary>Slot count for one mutually exclusive terminal, sector, and peak classification.</summary>
public sealed record AirportVirtualCapacitySummary(
    string TerminalId,
    string SectorId,
    bool IsPeak,
    int SlotCount);

/// <summary>Typed virtual-capacity evidence produced by the airport calculator.</summary>
public sealed record AirportVirtualCapacityResult(
    int TotalSlots,
    IReadOnlyList<AirportVirtualCapacitySlot> Slots,
    IReadOnlyList<AirportVirtualCapacitySummary> Summaries);

/// <summary>Frozen airport configuration used to calculate virtual capacity.</summary>
public sealed class AirportVirtualCapacityInput : IMetricInputDataset
{
    /// <summary>Stable dataset ID required by the virtual-capacity calculator.</summary>
    public const string DatasetId = "airport-virtual-capacity-configuration";

    /// <summary>Current configuration contract version.</summary>
    public const string Version = "1.0.0";

    private AirportVirtualCapacityInput(
        MetricInputDescriptor descriptor,
        IReadOnlyList<AirportCapacityProfile> capacityProfiles,
        IReadOnlyList<AirportCapacityPeakWindow> peakWindows)
    {
        Descriptor = descriptor;
        CapacityProfiles = capacityProfiles;
        PeakWindows = peakWindows;
    }

    /// <inheritdoc />
    public MetricInputDescriptor Descriptor { get; }

    /// <summary>One mutually exclusive terminal and sector classification per stand.</summary>
    public IReadOnlyList<AirportCapacityProfile> CapacityProfiles { get; }

    /// <summary>Date-specific peak windows interpreted in the normalized UTC timeline.</summary>
    public IReadOnlyList<AirportCapacityPeakWindow> PeakWindows { get; }

    /// <summary>Creates and fingerprints validated capacity configuration.</summary>
    public static AirportVirtualCapacityInput Create(
        DateTimeOffset knowledgeCutoff,
        string source,
        IEnumerable<AirportCapacityProfile> capacityProfiles,
        IEnumerable<AirportCapacityPeakWindow> peakWindows)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        ArgumentNullException.ThrowIfNull(capacityProfiles);
        ArgumentNullException.ThrowIfNull(peakWindows);
        AirportCapacityProfile[] suppliedProfiles = capacityProfiles.ToArray();
        AirportCapacityPeakWindow[] suppliedWindows = peakWindows.ToArray();
        foreach (AirportCapacityProfile profile in suppliedProfiles)
        {
            ArgumentNullException.ThrowIfNull(profile);
        }

        foreach (AirportCapacityPeakWindow window in suppliedWindows)
        {
            ArgumentNullException.ThrowIfNull(window);
        }

        AirportCapacityProfile[] profiles = suppliedProfiles
            .OrderBy(profile => profile.StandId, StringComparer.Ordinal)
            .ToArray();
        AirportCapacityPeakWindow[] windows = suppliedWindows
            .OrderBy(window => window.TerminalId, StringComparer.Ordinal)
            .ThenBy(window => window.SectorId, StringComparer.Ordinal)
            .ThenBy(window => window.Window.Start)
            .ThenBy(window => window.Window.End)
            .ToArray();
        Validate(profiles, windows);
        string fingerprint = CalculateContentFingerprint(profiles, windows);
        var descriptor = new MetricInputDescriptor(
            DatasetId,
            Version,
            MetricValueKind.Configured,
            knowledgeCutoff,
            source,
            fingerprint);
        return new AirportVirtualCapacityInput(descriptor, profiles, windows);
    }

    /// <inheritdoc />
    public string CalculateContentFingerprint() =>
        CalculateContentFingerprint(CapacityProfiles, PeakWindows);

    private static string CalculateContentFingerprint(
        IReadOnlyList<AirportCapacityProfile> profiles,
        IReadOnlyList<AirportCapacityPeakWindow> windows)
    {
        using IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Append(hash, "airport-virtual-capacity-input-v1");
        Append(hash, "internal-gaps-only");
        Append(hash, "slot-start-determines-peak");
        Append(hash, profiles.Count);
        foreach (AirportCapacityProfile profile in profiles)
        {
            Append(hash, profile.StandId);
            Append(hash, profile.TerminalId);
            Append(hash, profile.SectorId);
            Append(hash, profile.SlotDurationMinutes);
        }

        Append(hash, windows.Count);
        foreach (AirportCapacityPeakWindow window in windows)
        {
            Append(hash, window.TerminalId);
            Append(hash, window.SectorId);
            Append(hash, window.Window.Start);
            Append(hash, window.Window.End);
        }

        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    private static void Validate(
        AirportCapacityProfile[] profiles,
        AirportCapacityPeakWindow[] windows)
    {
        if (profiles.Length == 0)
        {
            throw new InvalidOperationException("Virtual-capacity configuration requires at least one stand profile.");
        }

        var profileKeys = new HashSet<string>(StringComparer.Ordinal);
        var terminalSectors = new HashSet<(string TerminalId, string SectorId)>();
        foreach (AirportCapacityProfile profile in profiles)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(profile.StandId);
            ArgumentException.ThrowIfNullOrWhiteSpace(profile.TerminalId);
            ArgumentException.ThrowIfNullOrWhiteSpace(profile.SectorId);
            if (profile.SlotDurationMinutes <= 0)
            {
                throw new InvalidOperationException(
                    $"Stand '{profile.StandId}' must have a positive virtual-capacity slot duration.");
            }

            if (!profileKeys.Add(profile.StandId))
            {
                throw new InvalidOperationException(
                    $"Stand '{profile.StandId}' has more than one virtual-capacity profile.");
            }

            terminalSectors.Add((profile.TerminalId, profile.SectorId));
        }

        foreach (IGrouping<(string TerminalId, string SectorId), AirportCapacityPeakWindow> group in windows
                     .GroupBy(window => (window.TerminalId, window.SectorId)))
        {
            if (!terminalSectors.Contains(group.Key))
            {
                throw new InvalidOperationException(
                    $"Peak window references unconfigured terminal-sector '{group.Key.TerminalId}/{group.Key.SectorId}'.");
            }

            AirportCapacityPeakWindow[] ordered = group.OrderBy(window => window.Window.Start).ToArray();
            for (int index = 1; index < ordered.Length; index++)
            {
                if (ordered[index - 1].Window.Overlaps(ordered[index].Window))
                {
                    throw new InvalidOperationException(
                        $"Peak windows overlap for terminal-sector '{group.Key.TerminalId}/{group.Key.SectorId}'.");
                }
            }
        }
    }

    private static void Append(IncrementalHash hash, DateTimeOffset value) =>
        Append(hash, value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));

    private static void Append(IncrementalHash hash, int value) =>
        Append(hash, value.ToString(CultureInfo.InvariantCulture));

    private static void Append(IncrementalHash hash, string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        Span<byte> length = stackalloc byte[sizeof(int)];
        BinaryPrimitives.WriteInt32BigEndian(length, bytes.Length);
        hash.AppendData(length);
        hash.AppendData(bytes);
    }
}

/// <summary>Calculates configured virtual-capacity slots and review evidence.</summary>
public sealed class AirportVirtualCapacityCalculator : IMetricCalculator
{
    /// <inheritdoc />
    public MetricDefinition Definition { get; } = new(
        AirportMetrics.VirtualCapacitySlots,
        "1.0.0",
        "slot",
        ObjectiveDirection.Maximize,
        MetricValueKind.Derived,
        MetricOptimizationKind.ScoringOnly,
        [
            new MetricInputRequirement(
                AirportVirtualCapacityInput.DatasetId,
                AirportVirtualCapacityInput.Version,
                MetricValueKind.Configured)
        ]);

    /// <inheritdoc />
    public MetricCalculation Calculate(MetricCalculationContext context)
    {
        AirportVirtualCapacityResult result = CalculateDetailed(context);
        List<MetricBreakdownValue> breakdowns = result.Slots
            .Select(slot => new MetricBreakdownValue(
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["evidence-kind"] = "slot",
                    ["stand"] = slot.StandId,
                    ["terminal"] = slot.TerminalId,
                    ["sector"] = slot.SectorId,
                    ["peak"] = slot.IsPeak ? "true" : "false",
                    ["start-utc"] = slot.Window.Start.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
                    ["end-utc"] = slot.Window.End.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
                    ["slot-duration-minutes"] = slot.SlotDurationMinutes.ToString(CultureInfo.InvariantCulture)
                },
                1m))
            .ToList();
        breakdowns.AddRange(result.Summaries.Select(summary => new MetricBreakdownValue(
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["evidence-kind"] = "summary",
                ["terminal"] = summary.TerminalId,
                ["sector"] = summary.SectorId,
                ["peak"] = summary.IsPeak ? "true" : "false"
            },
            summary.SlotCount)));
        return new MetricCalculation(result.TotalSlots, breakdowns);
    }

    /// <summary>Calculates typed slot placements and mutually exclusive aggregates.</summary>
    public static AirportVirtualCapacityResult CalculateDetailed(MetricCalculationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (!context.Inputs.TryGet(
                AirportVirtualCapacityInput.DatasetId,
                out IMetricInputDataset? untypedInput)
            || untypedInput is not AirportVirtualCapacityInput input)
        {
            throw new InvalidOperationException("Verified airport virtual-capacity input is unavailable.");
        }

        return AirportVirtualCapacityEngine.Calculate(
            context,
            input.CapacityProfiles,
            input.PeakWindows);
    }
}

internal static class AirportVirtualCapacityEngine
{
    public static AirportVirtualCapacityResult Calculate(
        MetricCalculationContext context,
        IReadOnlyList<AirportCapacityProfile> capacityProfiles,
        IReadOnlyList<AirportCapacityPeakWindow> peakWindows)
    {
        VerifyResourceCoverage(context.Problem, capacityProfiles);
        ResourceConflictRule[] conflictRules = context.Rules.CompletePlanRules
            .OfType<ResourceConflictRule>()
            .ToArray();
        Dictionary<string, AirportCapacityProfile> profiles = capacityProfiles
            .ToDictionary(profile => profile.StandId, StringComparer.Ordinal);
        var slots = new List<AirportVirtualCapacitySlot>();
        foreach (IGrouping<string, SelectedAssignment> resourceGroup in context.Optimization.Assignments
                     .GroupBy(assignment => assignment.ResourceId, StringComparer.Ordinal))
        {
            SelectedAssignment[] assignments = resourceGroup
                .OrderBy(assignment => assignment.Window.Start)
                .ThenBy(assignment => assignment.SubjectId, StringComparer.Ordinal)
                .ToArray();
            AirportCapacityProfile profile = profiles[resourceGroup.Key];
            for (int index = 1; index < assignments.Length; index++)
            {
                DateTimeOffset slotStart = assignments[index - 1].Window.End;
                while (slotStart.AddMinutes(profile.SlotDurationMinutes) <= assignments[index].Window.Start)
                {
                    TimeWindow slotWindow = TimeWindow.Create(
                        slotStart,
                        slotStart.AddMinutes(profile.SlotDurationMinutes));
                    if (!IsBlocked(
                            profile.StandId,
                            slotWindow,
                            context,
                            conflictRules))
                    {
                        slots.Add(new AirportVirtualCapacitySlot(
                            profile.StandId,
                            profile.TerminalId,
                            profile.SectorId,
                            slotWindow,
                            profile.SlotDurationMinutes,
                            IsPeak(slotWindow.Start, profile, peakWindows)));
                    }

                    slotStart = slotWindow.End;
                }
            }
        }

        AirportVirtualCapacitySlot[] orderedSlots = slots
            .OrderBy(slot => slot.StandId, StringComparer.Ordinal)
            .ThenBy(slot => slot.Window.Start)
            .ToArray();
        AirportVirtualCapacitySummary[] summaries = orderedSlots
            .GroupBy(slot => (slot.TerminalId, slot.SectorId, slot.IsPeak))
            .Select(group => new AirportVirtualCapacitySummary(
                group.Key.TerminalId,
                group.Key.SectorId,
                group.Key.IsPeak,
                group.Count()))
            .OrderBy(summary => summary.TerminalId, StringComparer.Ordinal)
            .ThenBy(summary => summary.SectorId, StringComparer.Ordinal)
            .ThenByDescending(summary => summary.IsPeak)
            .ToArray();
        return new AirportVirtualCapacityResult(orderedSlots.Length, orderedSlots, summaries);
    }

    private static bool IsBlocked(
        string standId,
        TimeWindow slotWindow,
        MetricCalculationContext context,
        IReadOnlyList<ResourceConflictRule> conflictRules)
    {
        foreach (ResourceCommitment commitment in context.Problem.Commitments)
        {
            if ((string.Equals(commitment.ResourceId, standId, StringComparison.Ordinal)
                    && slotWindow.Overlaps(commitment.Window))
                || conflictRules.Any(rule => rule.ConflictsWith(
                    standId,
                    slotWindow,
                    commitment.ResourceId,
                    commitment.Window)))
            {
                return true;
            }
        }

        return context.Optimization.Assignments.Any(assignment =>
            conflictRules.Any(rule => rule.ConflictsWith(
                standId,
                slotWindow,
                assignment.ResourceId,
                assignment.Window)));
    }

    private static bool IsPeak(
        DateTimeOffset slotStart,
        AirportCapacityProfile profile,
        IReadOnlyList<AirportCapacityPeakWindow> windows) =>
        windows.Any(window =>
            string.Equals(window.TerminalId, profile.TerminalId, StringComparison.Ordinal)
            && string.Equals(window.SectorId, profile.SectorId, StringComparison.Ordinal)
            && slotStart >= window.Window.Start
            && slotStart < window.Window.End);

    private static void VerifyResourceCoverage(
        ProblemSnapshot problem,
        IReadOnlyList<AirportCapacityProfile> capacityProfiles)
    {
        HashSet<string> problemResources = problem.Resources
            .Select(resource => resource.ResourceId)
            .ToHashSet(StringComparer.Ordinal);
        HashSet<string> configuredResources = capacityProfiles
            .Select(profile => profile.StandId)
            .ToHashSet(StringComparer.Ordinal);
        string[] missing = problemResources.Except(configuredResources, StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        string[] unknown = configuredResources.Except(problemResources, StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        if (missing.Length > 0 || unknown.Length > 0)
        {
            throw new InvalidOperationException(
                $"Virtual-capacity stand coverage mismatch. Missing: [{string.Join(", ", missing)}]; "
                + $"unknown: [{string.Join(", ", unknown)}].");
        }
    }
}
