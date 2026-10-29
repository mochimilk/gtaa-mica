namespace Planning.Solver.Airport;

/// <summary>Maps airport rule-family selection to normalized solver rules.</summary>
public static class AirportRuleAdapter
{
    /// <summary>Builds an immutable generic rule package from airport configuration.</summary>
    public static RulePackage Adapt(AirportRuleConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentException.ThrowIfNullOrWhiteSpace(configuration.RulePackageId);
        ArgumentException.ThrowIfNullOrWhiteSpace(configuration.Version);

        var rules = new List<ICandidateRule>();
        if (configuration.EnforceRequiredStandCapabilities)
        {
            rules.Add(new RequiredCapabilitiesRule(configuration.Authority, configuration.EvidenceReference));
        }

        if (configuration.EnforceProtectedOccupancy)
        {
            rules.Add(new ResourceCommitmentRule(configuration.Authority, configuration.EvidenceReference));
        }

        if (configuration.AircraftModelMatrix is not null)
        {
            rules.Add(new AirportAircraftModelCompatibilityRule(
                configuration.AircraftModelMatrix,
                configuration.Authority,
                configuration.EvidenceReference));
        }

        var completePlanRules = new List<ICompletePlanRule>();
        if (configuration.EnforceStandNonOverlap)
        {
            completePlanRules.Add(new ResourceNonOverlapRule(
                configuration.Authority,
                configuration.EvidenceReference));
        }

        if (configuration.StandConflicts is { Count: > 0 } standConflicts)
        {
            IReadOnlyList<ResourceConflict> conflicts = standConflicts
                .Select(MapConflict)
                .ToList();
            completePlanRules.Add(new ResourceConflictRule(
                conflicts,
                configuration.Authority,
                configuration.EvidenceReference));
        }

        return new RulePackage(configuration.RulePackageId, configuration.Version, rules, completePlanRules);
    }

    private static ResourceConflict MapConflict(AirportStandConflict conflict)
    {
        bool hasStart = conflict.EffectiveStart is not null;
        bool hasEnd = conflict.EffectiveEnd is not null;
        if (hasStart != hasEnd)
        {
            throw new InvalidOperationException(
                $"Stand conflict '{conflict.ConflictId}' must provide both effective timestamps or neither.");
        }

        TimeWindow? effectiveWindow = hasStart
            ? TimeWindow.Create(conflict.EffectiveStart!.Value, conflict.EffectiveEnd!.Value)
            : null;
        return new ResourceConflict(
            conflict.ConflictId,
            conflict.FirstStandId,
            conflict.SecondStandId,
            effectiveWindow);
    }
}
