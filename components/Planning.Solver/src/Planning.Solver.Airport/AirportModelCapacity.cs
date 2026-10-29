using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Planning.Solver.Airport;

/// <summary>Effective authoritative outcome for one stand and aircraft model pair.</summary>
public enum AirportAircraftModelFitOutcome
{
    /// <summary>The authoritative matrix allows the model at the stand.</summary>
    Allowed,

    /// <summary>The authoritative matrix denies the model at the stand.</summary>
    Denied,

    /// <summary>The available evidence does not support a fit decision.</summary>
    Unverifiable
}

/// <summary>One effective row in the authoritative stand-aircraft model matrix.</summary>
public sealed record AirportStandAircraftModelFit(
    string StandId,
    string AircraftModelCode,
    AirportAircraftModelFitOutcome Outcome,
    string EvidenceReference);

/// <summary>Authoritative aircraft model for one planning visit.</summary>
public sealed record AirportVisitAircraftModel(
    string VisitId,
    string AircraftModelCode,
    string SectorId,
    string? AircraftClassId = null);

/// <summary>Frozen exact-model matrix shared by rules and capacity evidence.</summary>
public sealed class AirportAircraftModelMatrix
{
    private readonly Dictionary<(string StandId, string AircraftModelCode), AirportStandAircraftModelFit> _fits;
    private readonly Dictionary<string, AirportVisitAircraftModel> _visits;

    private AirportAircraftModelMatrix(
        IReadOnlyList<AirportStandAircraftModelFit> standFits,
        IReadOnlyList<AirportVisitAircraftModel> visitModels,
        string fingerprint,
        string eligibilityFingerprint)
    {
        StandFits = standFits;
        VisitModels = visitModels;
        Fingerprint = fingerprint;
        EligibilityFingerprint = eligibilityFingerprint;
        _fits = standFits.ToDictionary(
            fit => (fit.StandId, fit.AircraftModelCode),
            fit => fit);
        _visits = visitModels.ToDictionary(visit => visit.VisitId, StringComparer.Ordinal);
    }

    /// <summary>Effective exact-model rows in canonical order.</summary>
    public IReadOnlyList<AirportStandAircraftModelFit> StandFits { get; }

    /// <summary>Visit aircraft models in canonical visit-ID order.</summary>
    public IReadOnlyList<AirportVisitAircraftModel> VisitModels { get; }

    /// <summary>Deterministic fingerprint shared by rule and metric configuration.</summary>
    public string Fingerprint { get; }

    /// <summary>Fingerprint of exact-model eligibility fields, excluding reporting rollups.</summary>
    public string EligibilityFingerprint { get; }

    /// <summary>Creates a normalized, fail-closed exact-model matrix.</summary>
    public static AirportAircraftModelMatrix Create(
        IEnumerable<AirportStandAircraftModelFit> standFits,
        IEnumerable<AirportVisitAircraftModel> visitModels)
    {
        ArgumentNullException.ThrowIfNull(standFits);
        ArgumentNullException.ThrowIfNull(visitModels);
        AirportStandAircraftModelFit[] fits = standFits
            .Select(Normalize)
            .OrderBy(fit => fit.StandId, StringComparer.Ordinal)
            .ThenBy(fit => fit.AircraftModelCode, StringComparer.Ordinal)
            .ToArray();
        AirportVisitAircraftModel[] visits = visitModels
            .Select(Normalize)
            .OrderBy(visit => visit.VisitId, StringComparer.Ordinal)
            .ToArray();
        Validate(fits, visits);
        return new AirportAircraftModelMatrix(
            fits,
            visits,
            FingerprintContent(fits, visits),
            FingerprintEligibility(fits, visits));
    }

    /// <summary>Finds the effective exact-model row for a stand.</summary>
    public bool TryGetFit(
        string standId,
        string aircraftModelCode,
        out AirportStandAircraftModelFit? fit) =>
        _fits.TryGetValue((standId, NormalizeCode(aircraftModelCode)), out fit);

    /// <summary>Finds authoritative model data for a visit.</summary>
    public bool TryGetVisit(string visitId, out AirportVisitAircraftModel? visit) =>
        _visits.TryGetValue(visitId, out visit);

    /// <summary>Returns whether the matrix contains any evidence for a stand.</summary>
    public bool HasStandEvidence(string standId) =>
        StandFits.Any(fit => string.Equals(fit.StandId, standId, StringComparison.Ordinal));

    private static AirportStandAircraftModelFit Normalize(AirportStandAircraftModelFit fit)
    {
        ArgumentNullException.ThrowIfNull(fit);
        return fit with
        {
            StandId = fit.StandId.Trim(),
            AircraftModelCode = NormalizeCode(fit.AircraftModelCode),
            EvidenceReference = fit.EvidenceReference.Trim()
        };
    }

    private static AirportVisitAircraftModel Normalize(AirportVisitAircraftModel visit)
    {
        ArgumentNullException.ThrowIfNull(visit);
        return visit with
        {
            VisitId = visit.VisitId.Trim(),
            AircraftModelCode = NormalizeCode(visit.AircraftModelCode),
            SectorId = visit.SectorId.Trim(),
            AircraftClassId = string.IsNullOrWhiteSpace(visit.AircraftClassId)
                ? null
                : visit.AircraftClassId.Trim()
        };
    }

    private static string NormalizeCode(string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        return value.Trim().ToUpperInvariant();
    }

    private static void Validate(
        AirportStandAircraftModelFit[] fits,
        AirportVisitAircraftModel[] visits)
    {
        if (fits.Length == 0)
        {
            throw new InvalidOperationException("Aircraft model matrix requires at least one stand-model row.");
        }

        foreach (AirportStandAircraftModelFit fit in fits)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(fit.StandId);
            ArgumentException.ThrowIfNullOrWhiteSpace(fit.AircraftModelCode);
            ArgumentException.ThrowIfNullOrWhiteSpace(fit.EvidenceReference);
        }

        string? duplicateFit = fits
            .GroupBy(fit => (fit.StandId, fit.AircraftModelCode))
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key
            .ToString();
        if (duplicateFit is not null)
        {
            throw new InvalidOperationException(
                $"Aircraft model matrix contains duplicate stand-model pair '{duplicateFit}'.");
        }

        foreach (AirportVisitAircraftModel visit in visits)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(visit.VisitId);
            ArgumentException.ThrowIfNullOrWhiteSpace(visit.AircraftModelCode);
            ArgumentException.ThrowIfNullOrWhiteSpace(visit.SectorId);
        }

        string? duplicateVisit = visits
            .GroupBy(visit => visit.VisitId, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key;
        if (duplicateVisit is not null)
        {
            throw new InvalidOperationException(
                $"Aircraft model matrix contains duplicate visit '{duplicateVisit}'.");
        }
    }

    private static string FingerprintContent(
        AirportStandAircraftModelFit[] fits,
        AirportVisitAircraftModel[] visits)
    {
        using IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Append(hash, "airport-aircraft-model-matrix-v1");
        Append(hash, fits.Length);
        foreach (AirportStandAircraftModelFit fit in fits)
        {
            Append(hash, fit.StandId);
            Append(hash, fit.AircraftModelCode);
            Append(hash, fit.Outcome.ToString());
            Append(hash, fit.EvidenceReference);
        }

        Append(hash, visits.Length);
        foreach (AirportVisitAircraftModel visit in visits)
        {
            Append(hash, visit.VisitId);
            Append(hash, visit.AircraftModelCode);
            Append(hash, visit.SectorId);
            Append(hash, visit.AircraftClassId ?? string.Empty);
        }

        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    private static string FingerprintEligibility(
        AirportStandAircraftModelFit[] fits,
        AirportVisitAircraftModel[] visits)
    {
        using IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Append(hash, "airport-aircraft-model-eligibility-v1");
        Append(hash, fits.Length);
        foreach (AirportStandAircraftModelFit fit in fits)
        {
            Append(hash, fit.StandId);
            Append(hash, fit.AircraftModelCode);
            Append(hash, fit.Outcome.ToString());
            Append(hash, fit.EvidenceReference);
        }

        Append(hash, visits.Length);
        foreach (AirportVisitAircraftModel visit in visits)
        {
            Append(hash, visit.VisitId);
            Append(hash, visit.AircraftModelCode);
        }

        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

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

/// <summary>Candidate rule backed by the exact stand-aircraft model matrix.</summary>
public sealed class AirportAircraftModelCompatibilityRule : ICandidateRule
{
    /// <summary>Stable rule identifier.</summary>
    public const string Id = "airport-aircraft-model-compatibility";

    /// <summary>Current exact-model rule semantics.</summary>
    public const string Version = "1.0.0";

    private readonly AirportAircraftModelMatrix _matrix;

    /// <summary>Creates an exact-model candidate rule from frozen authoritative evidence.</summary>
    public AirportAircraftModelCompatibilityRule(
        AirportAircraftModelMatrix matrix,
        string authority,
        string evidenceReference)
    {
        ArgumentNullException.ThrowIfNull(matrix);
        ArgumentException.ThrowIfNullOrWhiteSpace(authority);
        ArgumentException.ThrowIfNullOrWhiteSpace(evidenceReference);
        _matrix = matrix;
        Descriptor = new RuleDescriptor(
            Id,
            Version,
            RuleClassification.Hard,
            RuleEvaluationPhase.Candidate,
            SolverRuleRepresentation.CandidateFilter,
            authority,
            evidenceReference);
    }

    /// <inheritdoc />
    public RuleDescriptor Descriptor { get; }

    /// <inheritdoc />
    public string ConfigurationFingerprint => _matrix.EligibilityFingerprint;

    /// <inheritdoc />
    public RuleEvaluation Evaluate(CandidateRuleContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (!_matrix.TryGetVisit(context.Subject.SubjectId, out AirportVisitAircraftModel? visit)
            || visit is null)
        {
            return Result(
                RuleEvaluationOutcome.Unverifiable,
                $"Visit '{context.Subject.SubjectId}' has no authoritative aircraft model.");
        }

        if (!_matrix.HasStandEvidence(context.Resource.ResourceId))
        {
            return Result(
                RuleEvaluationOutcome.Unverifiable,
                $"Stand '{context.Resource.ResourceId}' has no authoritative aircraft model evidence.");
        }

        if (!_matrix.TryGetFit(
                context.Resource.ResourceId,
                visit.AircraftModelCode,
                out AirportStandAircraftModelFit? fit)
            || fit is null)
        {
            return Result(
                RuleEvaluationOutcome.Violated,
                $"Aircraft model '{visit.AircraftModelCode}' is not in the authoritative allowlist "
                + $"for stand '{context.Resource.ResourceId}'.");
        }

        return fit.Outcome switch
        {
            AirportAircraftModelFitOutcome.Allowed => Result(
                RuleEvaluationOutcome.Passed,
                $"Aircraft model '{visit.AircraftModelCode}' is allowed at stand "
                + $"'{context.Resource.ResourceId}' by '{fit.EvidenceReference}'."),
            AirportAircraftModelFitOutcome.Denied => Result(
                RuleEvaluationOutcome.Violated,
                $"Aircraft model '{visit.AircraftModelCode}' is denied at stand "
                + $"'{context.Resource.ResourceId}' by '{fit.EvidenceReference}'."),
            _ => Result(
                RuleEvaluationOutcome.Unverifiable,
                $"Aircraft model '{visit.AircraftModelCode}' fit at stand "
                + $"'{context.Resource.ResourceId}' is unverifiable from '{fit.EvidenceReference}'.")
        };
    }

    private RuleEvaluation Result(RuleEvaluationOutcome outcome, string detail) => new(
        Descriptor.RuleId,
        Descriptor.Version,
        Descriptor.Classification,
        outcome,
        detail);
}

/// <summary>Availability outcome for one unassigned visit at its required window.</summary>
public enum AirportVisitCapacityFitStatus
{
    /// <summary>At least one exact-model-compatible resource is available.</summary>
    CompatibleResourceAvailable,

    /// <summary>No exact-model-compatible resource is available.</summary>
    NoCompatibleResource,

    /// <summary>Potential resources have unresolved exact-model evidence.</summary>
    Unverifiable
}

/// <summary>Demand-specific exact-model capacity evidence for one unassigned visit.</summary>
public sealed record AirportVisitCapacityFit(
    string VisitId,
    string AircraftModelCode,
    string SectorId,
    string? AircraftClassId,
    AirportVisitCapacityFitStatus Status,
    IReadOnlyList<string> AvailableStandIds);

/// <summary>Typed exact-model capacity result.</summary>
public sealed record AirportModelCapacityResult(
    int TotalPhysicalSlots,
    IReadOnlyList<AirportVirtualCapacitySlot> Slots,
    IReadOnlyList<AirportVirtualCapacitySummary> PhysicalSummaries,
    IReadOnlyList<AirportVisitCapacityFit> UnassignedVisitFits);

/// <summary>Frozen exact-model capacity configuration.</summary>
public sealed class AirportModelCapacityInput : IMetricInputDataset
{
    /// <summary>Stable dataset ID required by exact-model capacity v3.</summary>
    public const string DatasetId = "airport-model-capacity-configuration";

    /// <summary>Current configuration contract version.</summary>
    public const string Version = "1.0.0";

    private AirportModelCapacityInput(
        MetricInputDescriptor descriptor,
        IReadOnlyList<AirportCapacityProfile> capacityProfiles,
        IReadOnlyList<AirportCapacityPeakWindow> peakWindows,
        AirportAircraftModelMatrix matrix)
    {
        Descriptor = descriptor;
        CapacityProfiles = capacityProfiles;
        PeakWindows = peakWindows;
        Matrix = matrix;
    }

    /// <inheritdoc />
    public MetricInputDescriptor Descriptor { get; }

    /// <summary>Mutually exclusive terminal, sector, and duration profiles.</summary>
    public IReadOnlyList<AirportCapacityProfile> CapacityProfiles { get; }

    /// <summary>Date-specific terminal-sector peak windows.</summary>
    public IReadOnlyList<AirportCapacityPeakWindow> PeakWindows { get; }

    /// <summary>Exact model matrix shared with the candidate rule.</summary>
    public AirportAircraftModelMatrix Matrix { get; }

    /// <summary>Creates and fingerprints exact-model capacity configuration.</summary>
    public static AirportModelCapacityInput Create(
        DateTimeOffset knowledgeCutoff,
        string source,
        IEnumerable<AirportCapacityProfile> capacityProfiles,
        IEnumerable<AirportCapacityPeakWindow> peakWindows,
        AirportAircraftModelMatrix matrix)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        ArgumentNullException.ThrowIfNull(capacityProfiles);
        ArgumentNullException.ThrowIfNull(peakWindows);
        ArgumentNullException.ThrowIfNull(matrix);
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
            .ToArray();
        AirportVirtualCapacityInput physical = AirportVirtualCapacityInput.Create(
            knowledgeCutoff,
            source,
            profiles,
            windows);
        string contentFingerprint = FingerprintContent(
            physical.Descriptor.ContentFingerprint,
            matrix.Fingerprint);
        return new AirportModelCapacityInput(
            new MetricInputDescriptor(
                DatasetId,
                Version,
                MetricValueKind.Configured,
                knowledgeCutoff,
                source,
                contentFingerprint),
            profiles,
            windows,
            matrix);
    }

    /// <inheritdoc />
    public string CalculateContentFingerprint()
    {
        AirportVirtualCapacityInput physical = AirportVirtualCapacityInput.Create(
            Descriptor.KnowledgeCutoff,
            Descriptor.Source,
            CapacityProfiles,
            PeakWindows);
        return FingerprintContent(physical.Descriptor.ContentFingerprint, Matrix.Fingerprint);
    }

    private static string FingerprintContent(string physicalFingerprint, string matrixFingerprint)
    {
        using IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        byte[] bytes = Encoding.UTF8.GetBytes(
            $"airport-model-capacity-input-v1:{physicalFingerprint}:{matrixFingerprint}");
        hash.AppendData(bytes);
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
}

/// <summary>Calculates physical capacity and exact-model availability for unassigned visits.</summary>
public sealed class AirportModelCapacityCalculator : IMetricCalculator
{
    /// <inheritdoc />
    public MetricDefinition Definition { get; } = new(
        AirportMetrics.VirtualCapacitySlots,
        "3.0.0",
        "physical-slot",
        ObjectiveDirection.Maximize,
        MetricValueKind.Derived,
        MetricOptimizationKind.ScoringOnly,
        [
            new MetricInputRequirement(
                AirportModelCapacityInput.DatasetId,
                AirportModelCapacityInput.Version,
                MetricValueKind.Configured)
        ]);

    /// <inheritdoc />
    public MetricCalculation Calculate(MetricCalculationContext context)
    {
        AirportModelCapacityResult result = CalculateDetailed(context);
        var breakdowns = result.Slots.Select(slot => new MetricBreakdownValue(
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
            1m)).ToList();
        breakdowns.AddRange(result.UnassignedVisitFits.Select(fit => new MetricBreakdownValue(
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["evidence-kind"] = "unassigned-visit-model-fit",
                ["visit"] = fit.VisitId,
                ["aircraft-model"] = fit.AircraftModelCode,
                ["aircraft-class"] = fit.AircraftClassId ?? string.Empty,
                ["sector"] = fit.SectorId,
                ["status"] = fit.Status.ToString(),
                ["available-stands"] = string.Join(",", fit.AvailableStandIds),
                ["aggregation"] = "non-additive"
            },
            fit.AvailableStandIds.Count)));
        return new MetricCalculation(result.TotalPhysicalSlots, breakdowns);
    }

    /// <summary>Calculates typed physical capacity and exact-model demand fit.</summary>
    public static AirportModelCapacityResult CalculateDetailed(MetricCalculationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (!context.Inputs.TryGet(
                AirportModelCapacityInput.DatasetId,
                out IMetricInputDataset? untypedInput)
            || untypedInput is not AirportModelCapacityInput input)
        {
            throw new InvalidOperationException("Verified airport model-capacity input is unavailable.");
        }

        AirportAircraftModelCompatibilityRule? modelRule = context.Rules.CandidateRules
            .OfType<AirportAircraftModelCompatibilityRule>()
            .SingleOrDefault();
        if (modelRule is null
            || !string.Equals(
                modelRule.ConfigurationFingerprint,
                input.Matrix.EligibilityFingerprint,
                StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Airport model-capacity input does not match the normalized aircraft model rule.");
        }

        VerifyMatrixCoverage(context.Problem, input.Matrix);
        AirportVirtualCapacityResult physical = AirportVirtualCapacityEngine.Calculate(
            context,
            input.CapacityProfiles,
            input.PeakWindows);
        AirportVisitCapacityFit[] fits = context.Optimization.UnassignedSubjects
            .OrderBy(subject => subject.SubjectId, StringComparer.Ordinal)
            .Select(subject => EvaluateUnassignedVisit(subject.SubjectId, context, input))
            .ToArray();
        return new AirportModelCapacityResult(
            physical.TotalSlots,
            physical.Slots,
            physical.Summaries,
            fits);
    }

    private static AirportVisitCapacityFit EvaluateUnassignedVisit(
        string visitId,
        MetricCalculationContext context,
        AirportModelCapacityInput input)
    {
        PlanningSubject subject = context.Problem.Subjects.Single(item =>
            string.Equals(item.SubjectId, visitId, StringComparison.Ordinal));
        AirportVisitAircraftModel visit = input.Matrix.VisitModels.Single(item =>
            string.Equals(item.VisitId, visitId, StringComparison.Ordinal));
        Dictionary<string, AirportCapacityProfile> profiles = input.CapacityProfiles
            .ToDictionary(profile => profile.StandId, StringComparer.Ordinal);
        ResourceConflictRule[] conflicts = context.Rules.CompletePlanRules
            .OfType<ResourceConflictRule>()
            .ToArray();
        var available = new List<string>();
        bool hasUnverifiableFit = false;
        foreach (PlanningResource resource in context.Problem.Resources)
        {
            AirportCapacityProfile profile = profiles[resource.ResourceId];
            if (!string.Equals(profile.SectorId, visit.SectorId, StringComparison.Ordinal)
                || subject.RequiredCapabilities.Any(capability => !resource.Capabilities.Contains(capability)))
            {
                continue;
            }

            if (!input.Matrix.TryGetFit(
                    resource.ResourceId,
                    visit.AircraftModelCode,
                    out AirportStandAircraftModelFit? fit)
                || fit is null
                || fit.Outcome == AirportAircraftModelFitOutcome.Denied)
            {
                continue;
            }

            if (fit.Outcome == AirportAircraftModelFitOutcome.Unverifiable)
            {
                hasUnverifiableFit = true;
                continue;
            }

            if (!IsWindowBlocked(resource.ResourceId, subject.Window, context, conflicts))
            {
                available.Add(resource.ResourceId);
            }
        }

        AirportVisitCapacityFitStatus status = available.Count > 0
            ? AirportVisitCapacityFitStatus.CompatibleResourceAvailable
            : hasUnverifiableFit
                ? AirportVisitCapacityFitStatus.Unverifiable
                : AirportVisitCapacityFitStatus.NoCompatibleResource;
        return new AirportVisitCapacityFit(
            visit.VisitId,
            visit.AircraftModelCode,
            visit.SectorId,
            visit.AircraftClassId,
            status,
            available.Order(StringComparer.Ordinal).ToArray());
    }

    private static bool IsWindowBlocked(
        string standId,
        TimeWindow window,
        MetricCalculationContext context,
        IReadOnlyList<ResourceConflictRule> conflictRules)
    {
        if (context.Optimization.Assignments.Any(assignment =>
                (string.Equals(assignment.ResourceId, standId, StringComparison.Ordinal)
                    && assignment.Window.Overlaps(window))
                || conflictRules.Any(rule => rule.ConflictsWith(
                    standId,
                    window,
                    assignment.ResourceId,
                    assignment.Window))))
        {
            return true;
        }

        return context.Problem.Commitments.Any(commitment =>
            (string.Equals(commitment.ResourceId, standId, StringComparison.Ordinal)
                && commitment.Window.Overlaps(window))
            || conflictRules.Any(rule => rule.ConflictsWith(
                standId,
                window,
                commitment.ResourceId,
                commitment.Window)));
    }

    private static void VerifyMatrixCoverage(
        ProblemSnapshot problem,
        AirportAircraftModelMatrix matrix)
    {
        string[] missingVisits = problem.Subjects
            .Where(subject => !matrix.TryGetVisit(subject.SubjectId, out _))
            .Select(subject => subject.SubjectId)
            .Order(StringComparer.Ordinal)
            .ToArray();
        string[] unknownVisits = matrix.VisitModels
            .Select(visit => visit.VisitId)
            .Except(problem.Subjects.Select(subject => subject.SubjectId), StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        string[] missingStands = problem.Resources
            .Where(resource => !matrix.HasStandEvidence(resource.ResourceId))
            .Select(resource => resource.ResourceId)
            .Order(StringComparer.Ordinal)
            .ToArray();
        if (missingVisits.Length > 0 || unknownVisits.Length > 0 || missingStands.Length > 0)
        {
            throw new InvalidOperationException(
                $"Aircraft model matrix coverage mismatch. Missing visits: [{string.Join(", ", missingVisits)}]; "
                + $"unknown visits: [{string.Join(", ", unknownVisits)}]; "
                + $"stands without evidence: [{string.Join(", ", missingStands)}].");
        }
    }
}
