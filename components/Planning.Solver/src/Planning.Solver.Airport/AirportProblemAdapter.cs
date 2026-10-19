namespace Planning.Solver.Airport;

/// <summary>Maps airport visits, stands, and protected occupancy to canonical solver inputs.</summary>
public static class AirportProblemAdapter
{
    /// <summary>Stable adapter identifier included in canonical problem fingerprints.</summary>
    public const string Id = "airport-planning";

    /// <summary>Semantic adapter version included in canonical problem fingerprints.</summary>
    public const string Version = "1.0.0";

    /// <summary>Converts a frozen airport snapshot without applying solver or persistence behavior.</summary>
    public static ProblemSnapshot Adapt(AirportPlanningSnapshot source)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrWhiteSpace(source.SnapshotId);
        ArgumentException.ThrowIfNullOrWhiteSpace(source.SourceVersion);

        IReadOnlyList<PlanningSubject> subjects = source.Visits.Select(visit =>
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(visit.VisitId);
            ArgumentException.ThrowIfNullOrWhiteSpace(visit.OccupancySegmentId);
            return new PlanningSubject(
                visit.VisitId,
                visit.OccupancySegmentId,
                TimeWindow.Create(visit.OccupancyStart, visit.OccupancyEnd),
                visit.Priority,
                visit.RequiredStandCapabilities.ToHashSet(StringComparer.Ordinal));
        }).ToList();
        IReadOnlyList<PlanningResource> resources = source.Stands.Select(stand =>
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(stand.StandId);
            return new PlanningResource(
                stand.StandId,
                stand.UsageCost,
                stand.Capabilities.ToHashSet(StringComparer.Ordinal));
        }).ToList();
        IReadOnlyList<ResourceCommitment> commitments = source.ProtectedOccupancy.Select(occupancy =>
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(occupancy.OccupancyId);
            ArgumentException.ThrowIfNullOrWhiteSpace(occupancy.StandId);
            return new ResourceCommitment(
                occupancy.OccupancyId,
                occupancy.StandId,
                TimeWindow.Create(occupancy.OccupancyStart, occupancy.OccupancyEnd));
        }).ToList();

        return new ProblemSnapshot(
            source.SnapshotId,
            Id,
            $"{Version}+source.{source.SourceVersion}",
            source.KnowledgeCutoff,
            subjects,
            resources,
            commitments);
    }
}
