namespace Planning.Solver;

/// <summary>An immutable half-open interval where the end instant is excluded.</summary>
public readonly record struct TimeWindow(DateTimeOffset Start, DateTimeOffset End)
{
    /// <summary>Creates and validates a time window.</summary>
    public static TimeWindow Create(DateTimeOffset start, DateTimeOffset end)
    {
        if (end <= start)
        {
            throw new ArgumentException("A time window must end after it starts.", nameof(end));
        }

        return new TimeWindow(start, end);
    }

    /// <summary>Returns whether this window intersects another half-open interval.</summary>
    public bool Overlaps(TimeWindow other) => Start < other.End && End > other.Start;
}

/// <summary>A canonical unit of demand that needs one resource for a fixed window.</summary>
public sealed record PlanningSubject(
    string SubjectId,
    string SegmentId,
    TimeWindow Window,
    int Priority,
    IReadOnlySet<string> RequiredCapabilities);

/// <summary>A canonical resource that can host planning subjects.</summary>
public sealed record PlanningResource(
    string ResourceId,
    decimal Cost,
    IReadOnlySet<string> Capabilities);

/// <summary>Occupancy that constrains a resource but is not available for reassignment.</summary>
public sealed record ResourceCommitment(
    string CommitmentId,
    string ResourceId,
    TimeWindow Window);

/// <summary>The frozen, domain-neutral problem presented to candidate generation.</summary>
public sealed record ProblemSnapshot(
    string SnapshotId,
    string AdapterId,
    string AdapterVersion,
    DateTimeOffset KnowledgeCutoff,
    IReadOnlyList<PlanningSubject> Subjects,
    IReadOnlyList<PlanningResource> Resources,
    IReadOnlyList<ResourceCommitment> Commitments);

/// <summary>One possible subject-to-resource assignment.</summary>
public sealed record CandidateAlternative(
    string AlternativeId,
    string SubjectId,
    string SegmentId,
    string ResourceId,
    TimeWindow Window,
    bool IsEligible,
    IReadOnlyList<RuleEvaluation> RuleTrace);

/// <summary>Immutable output of one candidate-generation pass.</summary>
public sealed record CandidateBatch(
    string CandidateBatchId,
    string ProblemSnapshotId,
    string RulePackageId,
    string RulePackageVersion,
    IReadOnlyList<CandidateAlternative> Alternatives,
    ArtifactLineage Lineage)
{
    /// <summary>Eligible alternatives available to an optimizer.</summary>
    public IReadOnlyList<CandidateAlternative> Eligible =>
        Alternatives.Where(candidate => candidate.IsEligible).ToList();
}

/// <summary>A selected candidate in a proposed plan.</summary>
public sealed record SelectedAssignment(
    string AlternativeId,
    string SubjectId,
    string SegmentId,
    string ResourceId,
    TimeWindow Window);

/// <summary>Reason a demand subject was not selected.</summary>
public sealed record UnassignedSubject(string SubjectId, string ReasonCode);

/// <summary>Result returned by an optimization strategy.</summary>
public sealed record OptimizationResult(
    string StrategyId,
    string StrategyVersion,
    string Status,
    IReadOnlyList<SelectedAssignment> Assignments,
    IReadOnlyList<UnassignedSubject> UnassignedSubjects,
    ArtifactLineage Lineage);
