using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Planning.Solver.Airport;

/// <summary>Capacity configuration for one stand and its authoritative aircraft classes.</summary>
public sealed record AirportCompatibilityCapacityProfile(
    string StandId,
    string TerminalId,
    string SectorId,
    int SlotDurationMinutes,
    IReadOnlySet<string> CompatibleAircraftClassIds);

/// <summary>One physical slot and every aircraft class the configured stand can accept.</summary>
public sealed record AirportCompatibilityCapacitySlot(
    string StandId,
    string TerminalId,
    string SectorId,
    TimeWindow Window,
    int SlotDurationMinutes,
    bool IsPeak,
    IReadOnlyList<string> CompatibleAircraftClassIds);

/// <summary>Non-additive compatibility view for one terminal, sector, peak state, and class.</summary>
public sealed record AirportCompatibilityCapacitySummary(
    string TerminalId,
    string SectorId,
    bool IsPeak,
    string AircraftClassId,
    int CompatibleSlotCount,
    int ExclusiveSlotCount,
    int SharedSlotCount);

/// <summary>Typed compatibility-aware capacity evidence.</summary>
public sealed record AirportCompatibilityCapacityResult(
    int TotalPhysicalSlots,
    IReadOnlyList<AirportCompatibilityCapacitySlot> Slots,
    IReadOnlyList<AirportVirtualCapacitySummary> PhysicalSummaries,
    IReadOnlyList<AirportCompatibilityCapacitySummary> CompatibilitySummaries)
{
    /// <summary>Returns physical slots compatible with one authoritative aircraft class.</summary>
    public IReadOnlyList<AirportCompatibilityCapacitySlot> SlotsFor(string aircraftClassId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(aircraftClassId);
        return Slots
            .Where(slot => slot.CompatibleAircraftClassIds.Contains(
                aircraftClassId,
                StringComparer.Ordinal))
            .ToList();
    }
}

/// <summary>Frozen compatibility-aware airport capacity configuration.</summary>
public sealed class AirportCompatibilityCapacityInput : IMetricInputDataset
{
    /// <summary>Stable dataset ID required by compatibility-aware capacity v2.</summary>
    public const string DatasetId = "airport-compatibility-capacity-configuration";

    /// <summary>Current configuration contract version.</summary>
    public const string Version = "1.0.0";

    private AirportCompatibilityCapacityInput(
        MetricInputDescriptor descriptor,
        IReadOnlyList<AirportCompatibilityCapacityProfile> capacityProfiles,
        IReadOnlyList<AirportCapacityPeakWindow> peakWindows)
    {
        Descriptor = descriptor;
        CapacityProfiles = capacityProfiles;
        PeakWindows = peakWindows;
    }

    /// <inheritdoc />
    public MetricInputDescriptor Descriptor { get; }

    /// <summary>One mutually exclusive terminal and sector classification per stand.</summary>
    public IReadOnlyList<AirportCompatibilityCapacityProfile> CapacityProfiles { get; }

    /// <summary>Date-specific peak windows interpreted in the normalized UTC timeline.</summary>
    public IReadOnlyList<AirportCapacityPeakWindow> PeakWindows { get; }

    /// <summary>Creates and fingerprints validated compatibility-aware configuration.</summary>
    public static AirportCompatibilityCapacityInput Create(
        DateTimeOffset knowledgeCutoff,
        string source,
        IEnumerable<AirportCompatibilityCapacityProfile> capacityProfiles,
        IEnumerable<AirportCapacityPeakWindow> peakWindows)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        ArgumentNullException.ThrowIfNull(capacityProfiles);
        ArgumentNullException.ThrowIfNull(peakWindows);
        AirportCompatibilityCapacityProfile[] suppliedProfiles = capacityProfiles.ToArray();
        AirportCapacityPeakWindow[] suppliedWindows = peakWindows.ToArray();
        foreach (AirportCompatibilityCapacityProfile profile in suppliedProfiles)
        {
            ArgumentNullException.ThrowIfNull(profile);
            ArgumentNullException.ThrowIfNull(profile.CompatibleAircraftClassIds);
        }

        foreach (AirportCapacityPeakWindow window in suppliedWindows)
        {
            ArgumentNullException.ThrowIfNull(window);
        }

        AirportCompatibilityCapacityProfile[] profiles = suppliedProfiles
            .Select(profile => profile with
            {
                CompatibleAircraftClassIds = profile.CompatibleAircraftClassIds
                    .ToHashSet(StringComparer.Ordinal)
            })
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
        return new AirportCompatibilityCapacityInput(
            new MetricInputDescriptor(
                DatasetId,
                Version,
                MetricValueKind.Configured,
                knowledgeCutoff,
                source,
                fingerprint),
            profiles,
            windows);
    }

    /// <inheritdoc />
    public string CalculateContentFingerprint() =>
        CalculateContentFingerprint(CapacityProfiles, PeakWindows);

    private static string CalculateContentFingerprint(
        IReadOnlyList<AirportCompatibilityCapacityProfile> profiles,
        IReadOnlyList<AirportCapacityPeakWindow> windows)
    {
        using IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Append(hash, "airport-compatibility-capacity-input-v1");
        Append(hash, "physical-slots-count-once");
        Append(hash, "class-summaries-are-non-additive");
        Append(hash, profiles.Count);
        foreach (AirportCompatibilityCapacityProfile profile in profiles)
        {
            Append(hash, profile.StandId);
            Append(hash, profile.TerminalId);
            Append(hash, profile.SectorId);
            Append(hash, profile.SlotDurationMinutes);
            string[] classes = profile.CompatibleAircraftClassIds
                .Order(StringComparer.Ordinal)
                .ToArray();
            Append(hash, classes.Length);
            foreach (string classId in classes)
            {
                Append(hash, classId);
            }
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
        AirportCompatibilityCapacityProfile[] profiles,
        AirportCapacityPeakWindow[] windows)
    {
        if (profiles.Length == 0)
        {
            throw new InvalidOperationException(
                "Compatibility-aware capacity configuration requires at least one stand profile.");
        }

        var standIds = new HashSet<string>(StringComparer.Ordinal);
        var terminalSectors = new HashSet<(string TerminalId, string SectorId)>();
        foreach (AirportCompatibilityCapacityProfile profile in profiles)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(profile.StandId);
            ArgumentException.ThrowIfNullOrWhiteSpace(profile.TerminalId);
            ArgumentException.ThrowIfNullOrWhiteSpace(profile.SectorId);
            ArgumentNullException.ThrowIfNull(profile.CompatibleAircraftClassIds);
            if (profile.SlotDurationMinutes <= 0)
            {
                throw new InvalidOperationException(
                    $"Stand '{profile.StandId}' must have a positive compatibility-capacity slot duration.");
            }

            if (!standIds.Add(profile.StandId))
            {
                throw new InvalidOperationException(
                    $"Stand '{profile.StandId}' has more than one compatibility-capacity profile.");
            }

            if (profile.CompatibleAircraftClassIds.Count == 0)
            {
                throw new InvalidOperationException(
                    $"Stand '{profile.StandId}' requires at least one compatible aircraft class.");
            }

            foreach (string classId in profile.CompatibleAircraftClassIds)
            {
                ArgumentException.ThrowIfNullOrWhiteSpace(classId);
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

/// <summary>Calculates compatibility-aware virtual capacity without double-counting physical slots.</summary>
public sealed class AirportCompatibilityCapacityCalculator : IMetricCalculator
{
    /// <inheritdoc />
    public MetricDefinition Definition { get; } = new(
        AirportMetrics.VirtualCapacitySlots,
        "2.0.0",
        "physical-slot",
        ObjectiveDirection.Maximize,
        MetricValueKind.Derived,
        MetricOptimizationKind.ScoringOnly,
        [
            new MetricInputRequirement(
                AirportCompatibilityCapacityInput.DatasetId,
                AirportCompatibilityCapacityInput.Version,
                MetricValueKind.Configured)
        ]);

    /// <inheritdoc />
    public MetricCalculation Calculate(MetricCalculationContext context)
    {
        AirportCompatibilityCapacityResult result = CalculateDetailed(context);
        var breakdowns = new List<MetricBreakdownValue>();
        breakdowns.AddRange(result.Slots.Select(slot => new MetricBreakdownValue(
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["evidence-kind"] = "physical-slot",
                ["stand"] = slot.StandId,
                ["terminal"] = slot.TerminalId,
                ["sector"] = slot.SectorId,
                ["peak"] = slot.IsPeak ? "true" : "false",
                ["start-utc"] = slot.Window.Start.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
                ["end-utc"] = slot.Window.End.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
                ["slot-duration-minutes"] = slot.SlotDurationMinutes.ToString(CultureInfo.InvariantCulture),
                ["compatible-aircraft-classes"] = string.Join(",", slot.CompatibleAircraftClassIds)
            },
            1m)));
        breakdowns.AddRange(result.PhysicalSummaries.Select(summary => new MetricBreakdownValue(
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["evidence-kind"] = "physical-summary",
                ["aggregation"] = "additive",
                ["terminal"] = summary.TerminalId,
                ["sector"] = summary.SectorId,
                ["peak"] = summary.IsPeak ? "true" : "false"
            },
            summary.SlotCount)));
        foreach (AirportCompatibilityCapacitySummary summary in result.CompatibilitySummaries)
        {
            breakdowns.Add(Breakdown(summary, "compatible-slot-count", "non-additive", summary.CompatibleSlotCount));
            breakdowns.Add(Breakdown(summary, "exclusive-slot-count", "additive", summary.ExclusiveSlotCount));
            breakdowns.Add(Breakdown(summary, "shared-slot-count", "non-additive", summary.SharedSlotCount));
        }

        return new MetricCalculation(result.TotalPhysicalSlots, breakdowns);
    }

    /// <summary>Calculates typed physical slots and non-additive aircraft-class views.</summary>
    public static AirportCompatibilityCapacityResult CalculateDetailed(MetricCalculationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (!context.Inputs.TryGet(
                AirportCompatibilityCapacityInput.DatasetId,
                out IMetricInputDataset? untypedInput)
            || untypedInput is not AirportCompatibilityCapacityInput input)
        {
            throw new InvalidOperationException(
                "Verified airport compatibility-capacity input is unavailable.");
        }

        AirportCapacityProfile[] physicalProfiles = input.CapacityProfiles
            .Select(profile => new AirportCapacityProfile(
                profile.StandId,
                profile.TerminalId,
                profile.SectorId,
                profile.SlotDurationMinutes))
            .ToArray();
        AirportVirtualCapacityResult physical = AirportVirtualCapacityEngine.Calculate(
            context,
            physicalProfiles,
            input.PeakWindows);
        Dictionary<string, AirportCompatibilityCapacityProfile> profiles = input.CapacityProfiles
            .ToDictionary(profile => profile.StandId, StringComparer.Ordinal);
        AirportCompatibilityCapacitySlot[] slots = physical.Slots
            .Select(slot => new AirportCompatibilityCapacitySlot(
                slot.StandId,
                slot.TerminalId,
                slot.SectorId,
                slot.Window,
                slot.SlotDurationMinutes,
                slot.IsPeak,
                profiles[slot.StandId].CompatibleAircraftClassIds
                    .Order(StringComparer.Ordinal)
                    .ToArray()))
            .ToArray();
        AirportCompatibilityCapacitySummary[] summaries = slots
            .SelectMany(slot => slot.CompatibleAircraftClassIds.Select(classId => (Slot: slot, ClassId: classId)))
            .GroupBy(item => (
                item.Slot.TerminalId,
                item.Slot.SectorId,
                item.Slot.IsPeak,
                item.ClassId))
            .Select(group => new AirportCompatibilityCapacitySummary(
                group.Key.TerminalId,
                group.Key.SectorId,
                group.Key.IsPeak,
                group.Key.ClassId,
                group.Count(),
                group.Count(item => item.Slot.CompatibleAircraftClassIds.Count == 1),
                group.Count(item => item.Slot.CompatibleAircraftClassIds.Count > 1)))
            .OrderBy(summary => summary.TerminalId, StringComparer.Ordinal)
            .ThenBy(summary => summary.SectorId, StringComparer.Ordinal)
            .ThenByDescending(summary => summary.IsPeak)
            .ThenBy(summary => summary.AircraftClassId, StringComparer.Ordinal)
            .ToArray();
        return new AirportCompatibilityCapacityResult(
            physical.TotalSlots,
            slots,
            physical.Summaries,
            summaries);
    }

    private static MetricBreakdownValue Breakdown(
        AirportCompatibilityCapacitySummary summary,
        string measure,
        string aggregation,
        decimal value) => new(
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["evidence-kind"] = "compatibility-summary",
                ["measure"] = measure,
                ["aggregation"] = aggregation,
                ["terminal"] = summary.TerminalId,
                ["sector"] = summary.SectorId,
                ["peak"] = summary.IsPeak ? "true" : "false",
                ["aircraft-class"] = summary.AircraftClassId
            },
            value);
}
