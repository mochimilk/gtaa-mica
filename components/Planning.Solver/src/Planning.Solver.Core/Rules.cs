namespace Planning.Solver;

/// <summary>Semantic role a normalized rule has in planning.</summary>
public enum RuleClassification
{
    /// <summary>Mandatory feasibility requirement.</summary>
    Hard,

    /// <summary>Required operating policy that constrains authorized changes.</summary>
    OperationalPolicy,

    /// <summary>Non-mandatory preference that may influence ranking.</summary>
    Preference,

    /// <summary>Versioned predictive or planning assumption.</summary>
    ModelAssumption,

    /// <summary>Guard that prevents unsupported or misleading feasibility claims.</summary>
    DataQualityGuard
}

/// <summary>Stage at which a normalized rule must be evaluated.</summary>
public enum RuleEvaluationPhase
{
    /// <summary>Evaluated independently for each subject-resource alternative.</summary>
    Candidate,

    /// <summary>Evaluated across the selected complete plan.</summary>
    CompletePlan
}

/// <summary>Constraint shape a strategy must support to enforce a rule during search.</summary>
public enum SolverRuleRepresentation
{
    /// <summary>Removes an alternative before global optimization.</summary>
    CandidateFilter,

    /// <summary>Prevents selection of conflicting pairs of alternatives.</summary>
    PairwiseConflict,

    /// <summary>Requires a solver-wide constraint beyond candidate or pair filtering.</summary>
    GlobalConstraint,

    /// <summary>Can only be evaluated by validation and is not enforced during search.</summary>
    ValidationOnly
}

/// <summary>Normalized identity, semantics, and provenance for one rule.</summary>
public sealed record RuleDescriptor(
    string RuleId,
    string Version,
    RuleClassification Classification,
    RuleEvaluationPhase EvaluationPhase,
    SolverRuleRepresentation SolverRepresentation,
    string Authority,
    string EvidenceReference);

/// <summary>Outcome of evaluating one rule against one candidate.</summary>
public enum RuleEvaluationOutcome
{
    /// <summary>The rule was applicable and satisfied.</summary>
    Passed,

    /// <summary>The rule was applicable and violated.</summary>
    Violated,

    /// <summary>The rule required evidence that was not available.</summary>
    Unverifiable,

    /// <summary>The rule did not apply to this candidate.</summary>
    NotApplicable
}

/// <summary>Outcome of evaluating one rule against one candidate.</summary>
public sealed record RuleEvaluation(
    string RuleId,
    string RuleVersion,
    RuleClassification Classification,
    RuleEvaluationOutcome Outcome,
    string Detail)
{
    /// <summary>Whether this outcome prevents the candidate from being selected.</summary>
    public bool BlocksSelection =>
        Classification is RuleClassification.Hard
            or RuleClassification.OperationalPolicy
            or RuleClassification.DataQualityGuard
        && Outcome is RuleEvaluationOutcome.Violated or RuleEvaluationOutcome.Unverifiable;
}

/// <summary>Context supplied to candidate-level rules.</summary>
public sealed record CandidateRuleContext(
    PlanningSubject Subject,
    PlanningResource Resource,
    IReadOnlyList<ResourceCommitment> Commitments);

/// <summary>A typed, independently testable candidate rule.</summary>
public interface INormalizedRule
{
    /// <summary>Identity, semantics, and provenance used for compatibility and audit.</summary>
    RuleDescriptor Descriptor { get; }

    /// <summary>Fingerprint of rule-specific configuration beyond its descriptor.</summary>
    string ConfigurationFingerprint => string.Empty;
}

/// <summary>A typed, independently testable candidate rule.</summary>
public interface ICandidateRule : INormalizedRule
{

    /// <summary>Evaluates the rule without mutating the problem.</summary>
    RuleEvaluation Evaluate(CandidateRuleContext context);
}

/// <summary>Context supplied to complete-plan rules.</summary>
public sealed record CompletePlanRuleContext(
    ProblemSnapshot Problem,
    IReadOnlyList<SelectedAssignment> Assignments);

/// <summary>A typed rule that independently evaluates interactions in a complete plan.</summary>
public interface ICompletePlanRule : INormalizedRule
{
    /// <summary>Returns every finding produced by this rule.</summary>
    IReadOnlyList<ValidationFinding> Evaluate(CompletePlanRuleContext context);
}

/// <summary>Immutable set of normalized rules selected for a run.</summary>
public sealed record RulePackage(
    string RulePackageId,
    string Version,
    IReadOnlyList<ICandidateRule> CandidateRules,
    IReadOnlyList<ICompletePlanRule> CompletePlanRules)
{
    /// <summary>All rules in deterministic declared phase order.</summary>
    public IReadOnlyList<INormalizedRule> AllRules =>
        [.. CandidateRules, .. CompletePlanRules];
}

/// <summary>Requires a resource to provide every capability requested by a subject.</summary>
public sealed class RequiredCapabilitiesRule(
    string authority = "solver-core",
    string evidenceReference = "built-in") : ICandidateRule
{
    /// <summary>Stable normalized rule identifier.</summary>
    public const string Id = "required-capabilities";

    /// <summary>Version of normalized rule semantics.</summary>
    public const string Version = "1.0.0";

    /// <inheritdoc />
    public RuleDescriptor Descriptor { get; } = new(
        Id,
        Version,
        RuleClassification.Hard,
        RuleEvaluationPhase.Candidate,
        SolverRuleRepresentation.CandidateFilter,
        authority,
        evidenceReference);

    /// <inheritdoc />
    public RuleEvaluation Evaluate(CandidateRuleContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        List<string> missing = context.Subject.RequiredCapabilities
            .Where(capability => !context.Resource.Capabilities.Contains(capability))
            .Order(StringComparer.Ordinal)
            .ToList();
        RuleEvaluationOutcome outcome = missing.Count == 0
            ? RuleEvaluationOutcome.Passed
            : RuleEvaluationOutcome.Violated;
        string detail = outcome == RuleEvaluationOutcome.Passed
            ? "Resource provides all required capabilities."
            : $"Resource is missing capabilities: {string.Join(", ", missing)}.";
        return new RuleEvaluation(
            Descriptor.RuleId,
            Descriptor.Version,
            Descriptor.Classification,
            outcome,
            detail);
    }
}

/// <summary>Rejects alternatives that overlap immutable resource commitments.</summary>
public sealed class ResourceCommitmentRule(
    string authority = "solver-core",
    string evidenceReference = "built-in") : ICandidateRule
{
    /// <summary>Stable normalized rule identifier.</summary>
    public const string Id = "resource-commitment";

    /// <summary>Version of normalized rule semantics.</summary>
    public const string Version = "1.0.0";

    /// <inheritdoc />
    public RuleDescriptor Descriptor { get; } = new(
        Id,
        Version,
        RuleClassification.Hard,
        RuleEvaluationPhase.Candidate,
        SolverRuleRepresentation.CandidateFilter,
        authority,
        evidenceReference);

    /// <inheritdoc />
    public RuleEvaluation Evaluate(CandidateRuleContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        ResourceCommitment? blocker = context.Commitments.FirstOrDefault(commitment =>
            string.Equals(commitment.ResourceId, context.Resource.ResourceId, StringComparison.Ordinal)
            && commitment.Window.Overlaps(context.Subject.Window));
        RuleEvaluationOutcome outcome = blocker is null
            ? RuleEvaluationOutcome.Passed
            : RuleEvaluationOutcome.Violated;
        string detail = outcome == RuleEvaluationOutcome.Passed
            ? "No immutable resource commitment overlaps the requested window."
            : $"Commitment '{blocker!.CommitmentId}' overlaps the requested window.";
        return new RuleEvaluation(
            Descriptor.RuleId,
            Descriptor.Version,
            Descriptor.Classification,
            outcome,
            detail);
    }
}

/// <summary>Prevents overlapping selected assignments on the same resource.</summary>
public sealed class ResourceNonOverlapRule(
    string authority = "solver-core",
    string evidenceReference = "built-in") : ICompletePlanRule
{
    /// <summary>Stable normalized rule identifier.</summary>
    public const string Id = "resource-non-overlap";

    /// <summary>Version of normalized rule semantics.</summary>
    public const string Version = "1.0.0";

    /// <inheritdoc />
    public RuleDescriptor Descriptor { get; } = new(
        Id,
        Version,
        RuleClassification.Hard,
        RuleEvaluationPhase.CompletePlan,
        SolverRuleRepresentation.PairwiseConflict,
        authority,
        evidenceReference);

    /// <inheritdoc />
    public IReadOnlyList<ValidationFinding> Evaluate(CompletePlanRuleContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var findings = new List<ValidationFinding>();
        foreach (IGrouping<string, SelectedAssignment> group in context.Assignments.GroupBy(
                     assignment => assignment.ResourceId,
                     StringComparer.Ordinal))
        {
            SelectedAssignment[] ordered = group.OrderBy(assignment => assignment.Window.Start).ToArray();
            for (int left = 0; left < ordered.Length; left++)
            {
                for (int right = left + 1; right < ordered.Length; right++)
                {
                    if (!ordered[left].Window.Overlaps(ordered[right].Window))
                    {
                        break;
                    }

                    findings.Add(new ValidationFinding(
                        ValidationFindingStatus.Violation,
                        "RESOURCE_OVERLAP",
                        $"Subjects '{ordered[left].SubjectId}' and '{ordered[right].SubjectId}' overlap on resource '{group.Key}'.",
                        Descriptor.RuleId,
                        ordered[left].SubjectId,
                        ordered[right].SubjectId,
                        group.Key));
                }
            }
        }

        return findings;
    }
}

/// <summary>A configured pair of resources that cannot host overlapping assignments.</summary>
public sealed record ResourceConflict(
    string ConflictId,
    string FirstResourceId,
    string SecondResourceId,
    TimeWindow? EffectiveWindow = null);

/// <summary>Prevents overlapping assignments across configured resource pairs.</summary>
public sealed class ResourceConflictRule : ICompletePlanRule
{
    /// <summary>Stable normalized rule identifier.</summary>
    public const string Id = "resource-conflict";

    /// <summary>Version of normalized rule semantics.</summary>
    public const string Version = "1.0.0";

    /// <summary>Creates a conflict rule from frozen pair definitions and provenance.</summary>
    public ResourceConflictRule(
        IReadOnlyList<ResourceConflict> conflicts,
        string authority = "solver-core",
        string evidenceReference = "built-in")
    {
        ArgumentNullException.ThrowIfNull(conflicts);
        EnsureValid(conflicts);
        Conflicts = conflicts
            .OrderBy(conflict => conflict.ConflictId, StringComparer.Ordinal)
            .ToList();
        Descriptor = new RuleDescriptor(
            Id,
            Version,
            RuleClassification.Hard,
            RuleEvaluationPhase.CompletePlan,
            SolverRuleRepresentation.PairwiseConflict,
            authority,
            evidenceReference);
        ConfigurationFingerprint = ArtifactFingerprints.ResourceConflicts(Conflicts);
    }

    /// <inheritdoc />
    public RuleDescriptor Descriptor { get; }

    /// <inheritdoc />
    public string ConfigurationFingerprint { get; }

    /// <summary>Frozen conflict definitions enforced by this rule.</summary>
    public IReadOnlyList<ResourceConflict> Conflicts { get; }

    /// <summary>Returns whether two resource windows violate a configured conflict.</summary>
    public bool ConflictsWith(
        string firstResourceId,
        TimeWindow firstWindow,
        string secondResourceId,
        TimeWindow secondWindow)
    {
        if (!firstWindow.Overlaps(secondWindow))
        {
            return false;
        }

        return Conflicts.Any(conflict =>
            IsResourcePair(conflict, firstResourceId, secondResourceId)
            && (conflict.EffectiveWindow is not TimeWindow effectiveWindow
                || firstWindow.Overlaps(effectiveWindow) && secondWindow.Overlaps(effectiveWindow)));
    }

    /// <inheritdoc />
    public IReadOnlyList<ValidationFinding> Evaluate(CompletePlanRuleContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var findings = new List<ValidationFinding>();
        HashSet<string> resourceIds = context.Problem.Resources
            .Select(resource => resource.ResourceId)
            .ToHashSet(StringComparer.Ordinal);
        foreach (ResourceConflict conflict in Conflicts)
        {
            if (!resourceIds.Contains(conflict.FirstResourceId)
                || !resourceIds.Contains(conflict.SecondResourceId))
            {
                findings.Add(new ValidationFinding(
                    ValidationFindingStatus.Unverifiable,
                    "RESOURCE_CONFLICT_UNKNOWN_RESOURCE",
                    $"Conflict '{conflict.ConflictId}' references a resource absent from the frozen problem.",
                    Descriptor.RuleId,
                    ResourceId: !resourceIds.Contains(conflict.FirstResourceId)
                        ? conflict.FirstResourceId
                        : conflict.SecondResourceId));
                continue;
            }

            SelectedAssignment[] firstAssignments = context.Assignments
                .Where(assignment => string.Equals(
                    assignment.ResourceId,
                    conflict.FirstResourceId,
                    StringComparison.Ordinal))
                .ToArray();
            SelectedAssignment[] secondAssignments = context.Assignments
                .Where(assignment => string.Equals(
                    assignment.ResourceId,
                    conflict.SecondResourceId,
                    StringComparison.Ordinal))
                .ToArray();
            foreach (SelectedAssignment first in firstAssignments)
            {
                foreach (SelectedAssignment second in secondAssignments)
                {
                    if (!ConflictsWith(
                            first.ResourceId,
                            first.Window,
                            second.ResourceId,
                            second.Window))
                    {
                        continue;
                    }

                    findings.Add(new ValidationFinding(
                        ValidationFindingStatus.Violation,
                        "RESOURCE_CONFLICT",
                        $"Conflict '{conflict.ConflictId}' prohibits overlapping subjects "
                        + $"'{first.SubjectId}' and '{second.SubjectId}' on resources "
                        + $"'{first.ResourceId}' and '{second.ResourceId}'.",
                        Descriptor.RuleId,
                        first.SubjectId,
                        second.SubjectId,
                        first.ResourceId));
                }
            }
        }

        return findings;
    }

    private static bool IsResourcePair(
        ResourceConflict conflict,
        string firstResourceId,
        string secondResourceId) =>
        string.Equals(conflict.FirstResourceId, firstResourceId, StringComparison.Ordinal)
        && string.Equals(conflict.SecondResourceId, secondResourceId, StringComparison.Ordinal)
        || string.Equals(conflict.FirstResourceId, secondResourceId, StringComparison.Ordinal)
        && string.Equals(conflict.SecondResourceId, firstResourceId, StringComparison.Ordinal);

    private static void EnsureValid(IReadOnlyList<ResourceConflict> conflicts)
    {
        var conflictIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (ResourceConflict conflict in conflicts)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(conflict.ConflictId);
            ArgumentException.ThrowIfNullOrWhiteSpace(conflict.FirstResourceId);
            ArgumentException.ThrowIfNullOrWhiteSpace(conflict.SecondResourceId);
            if (!conflictIds.Add(conflict.ConflictId))
            {
                throw new InvalidOperationException($"Duplicate resource conflict ID '{conflict.ConflictId}'.");
            }

            if (string.Equals(
                    conflict.FirstResourceId,
                    conflict.SecondResourceId,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Resource conflict '{conflict.ConflictId}' must reference two different resources.");
            }
        }
    }
}
