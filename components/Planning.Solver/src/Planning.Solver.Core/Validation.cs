namespace Planning.Solver;

/// <summary>Outcome of one independent validation check.</summary>
public enum ValidationFindingStatus
{
    /// <summary>A mandatory requirement was violated.</summary>
    Violation,

    /// <summary>A mandatory check could not be evaluated.</summary>
    Unverifiable
}

/// <summary>Evidence from one complete-plan validation check.</summary>
public sealed record ValidationFinding(
    ValidationFindingStatus Status,
    string CheckCode,
    string Detail,
    string? RuleId = null,
    string? SubjectId = null,
    string? OtherSubjectId = null,
    string? ResourceId = null);

/// <summary>Independent validation result for a complete plan.</summary>
public sealed record PlanValidationResult(
    IReadOnlyList<ValidationFinding> Findings,
    ArtifactLineage Lineage)
{
    /// <summary>Number of confirmed violations.</summary>
    public int ViolationCount => Findings.Count(finding => finding.Status == ValidationFindingStatus.Violation);

    /// <summary>Number of required checks that lacked evidence.</summary>
    public int UnverifiableCount => Findings.Count(finding => finding.Status == ValidationFindingStatus.Unverifiable);

    /// <summary>Whether all mandatory checks were evaluated and passed.</summary>
    public bool Passed => ViolationCount == 0 && UnverifiableCount == 0;
}

/// <summary>Validates complete-plan interactions without trusting solver status.</summary>
public static class CompletePlanValidator
{
    /// <summary>Version of validation semantics included in run manifests.</summary>
    public const string Version = "1.0.0";

    /// <summary>Validates identity, candidate provenance, and resource overlap.</summary>
    public static PlanValidationResult Validate(
        RunManifest manifest,
        ProblemSnapshot problem,
        RulePackage rules,
        CandidateBatch candidates,
        OptimizationResult optimization)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(candidates);
        ArgumentNullException.ThrowIfNull(optimization);
        RunManifestFactory.VerifyIntegrity(manifest);
        RunManifestFactory.RequireEqual("problem", manifest.ProblemFingerprint, ArtifactFingerprints.Problem(problem));
        RunManifestFactory.RequireEqual("rule package", manifest.RulePackageFingerprint, ArtifactFingerprints.RulePackage(rules));
        RunManifestFactory.RequireEqual("validator version", manifest.ValidatorVersion, Version);
        if (!string.Equals(optimization.Lineage.RunManifestFingerprint, manifest.Fingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Optimization result belongs to a different run manifest.");
        }

        string planFingerprint = ArtifactFingerprints.Plan(optimization);
        if (!string.Equals(optimization.Lineage.ArtifactFingerprint, planFingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Plan fingerprint does not match its content.");
        }

        if (!string.Equals(candidates.Lineage.RunManifestFingerprint, manifest.Fingerprint, StringComparison.Ordinal)
            || !string.Equals(optimization.Lineage.InputFingerprint, candidates.Lineage.ArtifactFingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Optimization result does not reference the supplied candidate batch.");
        }

        var findings = new List<ValidationFinding>();
        IReadOnlyList<SelectedAssignment> assignments = optimization.Assignments;
        var subjects = problem.Subjects.ToDictionary(subject => subject.SubjectId, StringComparer.Ordinal);
        var eligible = candidates.Eligible.ToDictionary(candidate => candidate.AlternativeId, StringComparer.Ordinal);
        foreach (SelectedAssignment assignment in assignments)
        {
            if (!subjects.ContainsKey(assignment.SubjectId))
            {
                findings.Add(new ValidationFinding(
                    ValidationFindingStatus.Unverifiable,
                    "UNKNOWN_SUBJECT",
                    $"Subject '{assignment.SubjectId}' is not present in the frozen problem.",
                    SubjectId: assignment.SubjectId,
                    ResourceId: assignment.ResourceId));
            }

            if (!eligible.TryGetValue(assignment.AlternativeId, out CandidateAlternative? candidate)
                || !string.Equals(candidate.SubjectId, assignment.SubjectId, StringComparison.Ordinal)
                || !string.Equals(candidate.ResourceId, assignment.ResourceId, StringComparison.Ordinal)
                || candidate.Window != assignment.Window)
            {
                findings.Add(new ValidationFinding(
                    ValidationFindingStatus.Violation,
                    "INELIGIBLE_OR_CHANGED_ALTERNATIVE",
                    $"Assignment '{assignment.AlternativeId}' does not match an eligible frozen alternative.",
                    SubjectId: assignment.SubjectId,
                    ResourceId: assignment.ResourceId));
            }
        }

        foreach (IGrouping<string, SelectedAssignment> group in assignments.GroupBy(
                     assignment => assignment.SubjectId,
                     StringComparer.Ordinal))
        {
            if (group.Count() > 1)
            {
                findings.Add(new ValidationFinding(
                    ValidationFindingStatus.Violation,
                    "SUBJECT_ASSIGNED_MORE_THAN_ONCE",
                    $"Subject '{group.Key}' has {group.Count()} assignments.",
                    SubjectId: group.Key));
            }
        }

        var ruleContext = new CompletePlanRuleContext(problem, assignments);
        foreach (ICompletePlanRule rule in rules.CompletePlanRules)
        {
            findings.AddRange(rule.Evaluate(ruleContext));
        }

        var result = new PlanValidationResult(
            findings,
            new ArtifactLineage(manifest.Fingerprint, planFingerprint, string.Empty));
        return result with
        {
            Lineage = result.Lineage with { ArtifactFingerprint = ArtifactFingerprints.Validation(result) }
        };
    }
}
