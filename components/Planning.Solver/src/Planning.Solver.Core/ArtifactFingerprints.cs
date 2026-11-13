using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Planning.Solver;

/// <summary>Deterministic SHA-256 fingerprints for frozen solver artifacts.</summary>
public static class ArtifactFingerprints
{
    /// <summary>Fingerprints an authorable profile independent of objective insertion order.</summary>
    public static string Profile(ProfileDefinition profile)
    {
        ArgumentNullException.ThrowIfNull(profile);
        var value = new CanonicalValueBuilder()
            .Append("profile-v1")
            .Append(profile.ProfileId)
            .Append(profile.Version)
            .Append(profile.Search.StrategyId)
            .Append(profile.Search.RandomSeed)
            .Append(profile.Search.TimeLimit?.Ticks.ToString(CultureInfo.InvariantCulture))
            .Append(profile.Acceptance.MaximumViolations)
            .Append(profile.Acceptance.MaximumUnverifiableChecks)
            .Append(profile.Acceptance.MaximumUnassignedSubjects?.ToString(CultureInfo.InvariantCulture))
            .Append(profile.ObjectiveComposition.ToString())
            .Append(profile.MissingMetricInputs.ToString())
            .Append(profile.RuleSelection?.RequireAllHardRulesEnforcedDuringSearch ?? true)
            .Append(profile.Trace?.IncludeCandidateRuleTrace ?? true)
            .Append(profile.Trace?.IncludeValidationFindings ?? true);
        string[] requiredRulePackages = profile.RuleSelection?.RequiredRulePackageIds
            .Order(StringComparer.Ordinal)
            .ToArray() ?? [];
        value.Append(requiredRulePackages.Length);
        foreach (string rulePackageId in requiredRulePackages)
        {
            value.Append(rulePackageId);
        }

        ObjectiveTerm[] objectives = profile.Objectives
            .OrderBy(objective => objective.MetricId, StringComparer.Ordinal)
            .ToArray();
        value.Append(objectives.Length);
        foreach (ObjectiveTerm objective in objectives)
        {
            value.Append(objective.MetricId)
                .Append(objective.MetricVersion)
                .Append(objective.Direction.ToString())
                .Append(objective.Weight);
        }

        return value.Fingerprint();
    }

    /// <summary>Fingerprints the immutable inputs and component versions selected for a run.</summary>
    public static string RunManifest(RunManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        var value = new CanonicalValueBuilder()
            .Append("run-manifest-v1")
            .Append(manifest.RunId)
            .Append(manifest.ProblemFingerprint)
            .Append(manifest.ProfileFingerprint)
            .Append(manifest.RulePackageFingerprint)
            .Append(manifest.MetricInputFingerprint)
            .Append(manifest.CandidateGeneratorVersion)
            .Append(manifest.SolverStrategyId)
            .Append(manifest.SolverStrategyVersion)
            .Append(manifest.ValidatorVersion)
            .Append(manifest.ScorerVersion)
            .Append(manifest.KnowledgeCutoff)
            .Append(manifest.PlanningHorizon.Start)
            .Append(manifest.PlanningHorizon.End)
            .Append(manifest.RandomSeed)
            .Append(manifest.TimeLimit?.Ticks.ToString(CultureInfo.InvariantCulture))
            .Append(manifest.ParentPlanFingerprint);
        KeyValuePair<string, bool>[] flags = manifest.FeatureFlags
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .ToArray();
        value.Append(flags.Length);
        foreach ((string key, bool enabled) in flags)
        {
            value.Append(key).Append(enabled);
        }

        return value.Fingerprint();
    }

    /// <summary>Fingerprints a canonical problem independent of collection insertion order.</summary>
    public static string Problem(ProblemSnapshot problem)
    {
        ArgumentNullException.ThrowIfNull(problem);
        var value = new CanonicalValueBuilder()
            .Append("problem-v1")
            .Append(problem.SnapshotId)
            .Append(problem.AdapterId)
            .Append(problem.AdapterVersion)
            .Append(problem.KnowledgeCutoff);

        PlanningSubject[] subjects = problem.Subjects
            .OrderBy(subject => subject.SubjectId, StringComparer.Ordinal)
            .ToArray();
        value.Append(subjects.Length);
        foreach (PlanningSubject subject in subjects)
        {
            value.Append(subject.SubjectId)
                .Append(subject.SegmentId)
                .Append(subject.Window.Start)
                .Append(subject.Window.End)
                .Append(subject.Priority);
            string[] capabilities = subject.RequiredCapabilities.Order(StringComparer.Ordinal).ToArray();
            value.Append(capabilities.Length);
            foreach (string capability in capabilities)
            {
                value.Append(capability);
            }
        }

        PlanningResource[] resources = problem.Resources
            .OrderBy(resource => resource.ResourceId, StringComparer.Ordinal)
            .ToArray();
        value.Append(resources.Length);
        foreach (PlanningResource resource in resources)
        {
            value.Append(resource.ResourceId).Append(resource.Cost);
            string[] capabilities = resource.Capabilities.Order(StringComparer.Ordinal).ToArray();
            value.Append(capabilities.Length);
            foreach (string capability in capabilities)
            {
                value.Append(capability);
            }
        }

        ResourceCommitment[] commitments = problem.Commitments
            .OrderBy(commitment => commitment.CommitmentId, StringComparer.Ordinal)
            .ToArray();
        value.Append(commitments.Length);
        foreach (ResourceCommitment commitment in commitments)
        {
            value.Append(commitment.CommitmentId)
                .Append(commitment.ResourceId)
                .Append(commitment.Window.Start)
                .Append(commitment.Window.End);
        }

        return value.Fingerprint();
    }

    /// <summary>Fingerprints rule identity, version, and declared evaluation order.</summary>
    public static string RulePackage(RulePackage rules)
    {
        ArgumentNullException.ThrowIfNull(rules);
        var value = new CanonicalValueBuilder()
            .Append("rule-package-v2")
            .Append(rules.RulePackageId)
            .Append(rules.Version)
            .Append(rules.CandidateRules.Count);
        foreach (ICandidateRule rule in rules.CandidateRules)
        {
            AppendRuleDescriptor(value, rule.Descriptor);
            value.Append(rule.ConfigurationFingerprint);
        }

        value.Append(rules.CompletePlanRules.Count);
        foreach (ICompletePlanRule rule in rules.CompletePlanRules)
        {
            AppendRuleDescriptor(value, rule.Descriptor);
            value.Append(rule.ConfigurationFingerprint);
        }

        return value.Fingerprint();
    }

    /// <summary>Fingerprints a candidate batch without its lineage envelope.</summary>
    public static string CandidateBatch(CandidateBatch batch)
    {
        ArgumentNullException.ThrowIfNull(batch);
        var value = new CanonicalValueBuilder()
            .Append("candidate-batch-v2")
            .Append(batch.CandidateBatchId)
            .Append(batch.ProblemSnapshotId)
            .Append(batch.RulePackageId)
            .Append(batch.RulePackageVersion);
        CandidateAlternative[] alternatives = batch.Alternatives
            .OrderBy(candidate => candidate.AlternativeId, StringComparer.Ordinal)
            .ToArray();
        value.Append(alternatives.Length);
        foreach (CandidateAlternative candidate in alternatives)
        {
            value.Append(candidate.AlternativeId)
                .Append(candidate.SubjectId)
                .Append(candidate.SegmentId)
                .Append(candidate.ResourceId)
                .Append(candidate.Window.Start)
                .Append(candidate.Window.End)
                .Append(candidate.IsEligible)
                .Append(candidate.RuleTrace.Count);
            foreach (RuleEvaluation trace in candidate.RuleTrace)
            {
                value.Append(trace.RuleId)
                    .Append(trace.RuleVersion)
                    .Append(trace.Classification.ToString())
                    .Append(trace.Outcome.ToString())
                    .Append(trace.Detail);
            }
        }

        return value.Fingerprint();
    }

    /// <summary>Fingerprints resource-conflict configuration independent of insertion order.</summary>
    public static string ResourceConflicts(IReadOnlyList<ResourceConflict> conflicts)
    {
        ArgumentNullException.ThrowIfNull(conflicts);
        var value = new CanonicalValueBuilder()
            .Append("resource-conflicts-v1");
        ResourceConflict[] ordered = conflicts
            .OrderBy(conflict => conflict.ConflictId, StringComparer.Ordinal)
            .ToArray();
        value.Append(ordered.Length);
        foreach (ResourceConflict conflict in ordered)
        {
            string firstResourceId;
            string secondResourceId;
            if (string.CompareOrdinal(conflict.FirstResourceId, conflict.SecondResourceId) <= 0)
            {
                firstResourceId = conflict.FirstResourceId;
                secondResourceId = conflict.SecondResourceId;
            }
            else
            {
                firstResourceId = conflict.SecondResourceId;
                secondResourceId = conflict.FirstResourceId;
            }

            value.Append(conflict.ConflictId)
                .Append(firstResourceId)
                .Append(secondResourceId)
            .Append(conflict.EffectiveWindow?.Start.ToUniversalTime().ToString(
                "O",
                CultureInfo.InvariantCulture))
            .Append(conflict.EffectiveWindow?.End.ToUniversalTime().ToString(
                "O",
                CultureInfo.InvariantCulture));
        }

        return value.Fingerprint();
    }

    /// <summary>Fingerprints frozen metric input descriptors and verified content identities.</summary>
    public static string MetricInputs(IReadOnlyList<IMetricInputDataset> datasets)
    {
        ArgumentNullException.ThrowIfNull(datasets);
        var value = new CanonicalValueBuilder()
            .Append("metric-inputs-v1");
        IMetricInputDataset[] ordered = datasets
            .OrderBy(dataset => dataset.Descriptor.DatasetId, StringComparer.Ordinal)
            .ToArray();
        value.Append(ordered.Length);
        foreach (IMetricInputDataset dataset in ordered)
        {
            MetricInputDescriptor descriptor = dataset.Descriptor;
            value.Append(descriptor.DatasetId)
                .Append(descriptor.Version)
                .Append(descriptor.ValueKind.ToString())
                .Append(descriptor.KnowledgeCutoff)
                .Append(descriptor.Source)
                .Append(descriptor.ContentFingerprint);
        }

        return value.Fingerprint();
    }

    /// <summary>Fingerprints selected and unassigned optimization outcomes.</summary>
    public static string Plan(OptimizationResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        var value = new CanonicalValueBuilder()
            .Append("plan-v1")
            .Append(result.StrategyId)
            .Append(result.StrategyVersion)
            .Append(result.Status);
        SelectedAssignment[] assignments = result.Assignments
            .OrderBy(assignment => assignment.SubjectId, StringComparer.Ordinal)
            .ThenBy(assignment => assignment.SegmentId, StringComparer.Ordinal)
            .ToArray();
        value.Append(assignments.Length);
        foreach (SelectedAssignment assignment in assignments)
        {
            value.Append(assignment.AlternativeId)
                .Append(assignment.SubjectId)
                .Append(assignment.SegmentId)
                .Append(assignment.ResourceId)
                .Append(assignment.Window.Start)
                .Append(assignment.Window.End);
        }

        UnassignedSubject[] unassigned = result.UnassignedSubjects
            .OrderBy(subject => subject.SubjectId, StringComparer.Ordinal)
            .ToArray();
        value.Append(unassigned.Length);
        foreach (UnassignedSubject subject in unassigned)
        {
            value.Append(subject.SubjectId).Append(subject.ReasonCode);
        }

        return value.Fingerprint();
    }

    /// <summary>Fingerprints complete-plan validation findings.</summary>
    public static string Validation(PlanValidationResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        var value = new CanonicalValueBuilder().Append("validation-v1");
        ValidationFinding[] findings = result.Findings
            .OrderBy(finding => finding.Status)
            .ThenBy(finding => finding.CheckCode, StringComparer.Ordinal)
            .ThenBy(finding => finding.SubjectId, StringComparer.Ordinal)
            .ThenBy(finding => finding.OtherSubjectId, StringComparer.Ordinal)
            .ThenBy(finding => finding.ResourceId, StringComparer.Ordinal)
            .ThenBy(finding => finding.Detail, StringComparer.Ordinal)
            .ToArray();
        value.Append(findings.Length);
        foreach (ValidationFinding finding in findings)
        {
            value.Append(finding.Status.ToString())
                .Append(finding.CheckCode)
                .Append(finding.Detail)
                .Append(finding.RuleId)
                .Append(finding.SubjectId)
                .Append(finding.OtherSubjectId)
                .Append(finding.ResourceId);
        }

        return value.Fingerprint();
    }

    /// <summary>Fingerprints raw metrics, objective contributions, and acceptance.</summary>
    public static string Score(PlanScore score)
    {
        ArgumentNullException.ThrowIfNull(score);
        var value = new CanonicalValueBuilder()
            .Append("score-v3")
            .Append(score.Total)
            .Append(score.Accepted);
        MetricResult[] metrics = score.Metrics.OrderBy(metric => metric.MetricId, StringComparer.Ordinal).ToArray();
        value.Append(metrics.Length);
        foreach (MetricResult metric in metrics)
        {
            value.Append(metric.MetricId)
                .Append(metric.Version)
                .Append(metric.Unit)
            .Append(metric.ValueKind.ToString())
            .Append(metric.OptimizationKind.ToString())
            .Append(metric.Availability.ToString())
            .Append(metric.RawValue?.ToString("G29", CultureInfo.InvariantCulture))
            .Append(metric.WeightedContribution?.ToString("G29", CultureInfo.InvariantCulture))
            .Append(metric.UnavailableReason);
            MetricInputDescriptor[] inputs = metric.Inputs
            .OrderBy(input => input.DatasetId, StringComparer.Ordinal)
            .ToArray();
            value.Append(inputs.Length);
            foreach (MetricInputDescriptor input in inputs)
            {
                value.Append(input.DatasetId)
                    .Append(input.Version)
                    .Append(input.ValueKind.ToString())
                    .Append(input.KnowledgeCutoff)
                    .Append(input.Source)
                    .Append(input.ContentFingerprint);
            }

            MetricBreakdownValue[] breakdowns = metric.Breakdowns
                .OrderBy(BreakdownSortKey, StringComparer.Ordinal)
                .ToArray();
            value.Append(breakdowns.Length);
            foreach (MetricBreakdownValue breakdown in breakdowns)
            {
                KeyValuePair<string, string>[] dimensions = breakdown.Dimensions
                    .OrderBy(dimension => dimension.Key, StringComparer.Ordinal)
                    .ToArray();
                value.Append(dimensions.Length);
                foreach ((string key, string dimensionValue) in dimensions)
                {
                    value.Append(key).Append(dimensionValue);
                }

                value.Append(breakdown.Value);
            }
        }

        string[] reasons = score.RejectionReasons.Order(StringComparer.Ordinal).ToArray();
        value.Append(reasons.Length);
        foreach (string reason in reasons)
        {
            value.Append(reason);
        }

        return value.Fingerprint();
    }

    private static string BreakdownSortKey(MetricBreakdownValue breakdown) =>
        string.Join(
            "\u001f",
            breakdown.Dimensions
                .OrderBy(dimension => dimension.Key, StringComparer.Ordinal)
                .Select(dimension => $"{dimension.Key}\u001e{dimension.Value}"));

    private sealed class CanonicalValueBuilder
    {
        private readonly StringBuilder _value = new();

        public CanonicalValueBuilder Append(string? value)
        {
            if (value is null)
            {
                _value.Append("-1:");
                return this;
            }

            _value.Append(value.Length.ToString(CultureInfo.InvariantCulture))
                .Append(':')
                .Append(value);
            return this;
        }

        public CanonicalValueBuilder Append(int value) =>
            Append(value.ToString(CultureInfo.InvariantCulture));

        public CanonicalValueBuilder Append(bool value) =>
            Append(value ? "true" : "false");

        public CanonicalValueBuilder Append(decimal value) =>
            Append(value.ToString("G29", CultureInfo.InvariantCulture));

        public CanonicalValueBuilder Append(DateTimeOffset value) =>
            Append(value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));

        public string Fingerprint() =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(_value.ToString())));
    }

    private static void AppendRuleDescriptor(CanonicalValueBuilder value, RuleDescriptor descriptor)
    {
        value.Append(descriptor.RuleId)
            .Append(descriptor.Version)
            .Append(descriptor.Classification.ToString())
            .Append(descriptor.EvaluationPhase.ToString())
            .Append(descriptor.SolverRepresentation.ToString())
            .Append(descriptor.Authority)
            .Append(descriptor.EvidenceReference);
    }
}
