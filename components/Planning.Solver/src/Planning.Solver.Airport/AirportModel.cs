namespace Planning.Solver.Airport;

/// <summary>An airport visit segment that requires one stand for a fixed occupancy window.</summary>
public sealed record AirportVisitDemand(
    string VisitId,
    string OccupancySegmentId,
    DateTimeOffset OccupancyStart,
    DateTimeOffset OccupancyEnd,
    int Priority,
    IReadOnlySet<string> RequiredStandCapabilities);

/// <summary>A stand offered to the planning engine.</summary>
public sealed record AirportStand(
    string StandId,
    decimal UsageCost,
    IReadOnlySet<string> Capabilities);

/// <summary>Protected stand occupancy that constrains planning but cannot be reassigned.</summary>
public sealed record AirportProtectedOccupancy(
    string OccupancyId,
    string StandId,
    DateTimeOffset OccupancyStart,
    DateTimeOffset OccupancyEnd);

/// <summary>Airport stand pair that cannot host overlapping occupancy.</summary>
public sealed record AirportStandConflict(
    string ConflictId,
    string FirstStandId,
    string SecondStandId,
    DateTimeOffset? EffectiveStart = null,
    DateTimeOffset? EffectiveEnd = null);

/// <summary>Frozen airport source data supplied to the adapter.</summary>
public sealed record AirportPlanningSnapshot(
    string SnapshotId,
    string SourceVersion,
    DateTimeOffset KnowledgeCutoff,
    IReadOnlyList<AirportVisitDemand> Visits,
    IReadOnlyList<AirportStand> Stands,
    IReadOnlyList<AirportProtectedOccupancy> ProtectedOccupancy);

/// <summary>Airport selection of normalized generic rule families.</summary>
public sealed record AirportRuleConfiguration(
    string RulePackageId,
    string Version,
    bool EnforceRequiredStandCapabilities = true,
    bool EnforceProtectedOccupancy = true,
    bool EnforceStandNonOverlap = true,
    string Authority = "airport-operations",
    string EvidenceReference = "airport-rule-configuration",
    IReadOnlyList<AirportStandConflict>? StandConflicts = null,
    AirportAircraftModelMatrix? AircraftModelMatrix = null);
