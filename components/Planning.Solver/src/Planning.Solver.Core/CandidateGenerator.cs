namespace Planning.Solver;

/// <summary>Generates and traces every subject-to-resource alternative.</summary>
public static class CandidateGenerator
{
    /// <summary>Version of candidate semantics included in run manifests.</summary>
    public const string Version = "2.0.0";

    /// <summary>Generates a complete candidate batch without hiding rejected alternatives.</summary>
    public static CandidateBatch Generate(
        RunManifest manifest,
        ProblemSnapshot problem,
        RulePackage rules,
        string candidateBatchId)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentException.ThrowIfNullOrWhiteSpace(candidateBatchId);
        RunManifestFactory.VerifyIntegrity(manifest);
        RunManifestFactory.RequireEqual("problem", manifest.ProblemFingerprint, ArtifactFingerprints.Problem(problem));
        RunManifestFactory.RequireEqual("rule package", manifest.RulePackageFingerprint, ArtifactFingerprints.RulePackage(rules));
        RunManifestFactory.RequireEqual("generator version", manifest.CandidateGeneratorVersion, Version);

        EnsureUnique(problem.Subjects.Select(subject => subject.SubjectId), "subject");
        EnsureUnique(problem.Subjects.Select(subject => subject.SegmentId), "segment");
        EnsureUnique(problem.Resources.Select(resource => resource.ResourceId), "resource");

        var alternatives = new List<CandidateAlternative>(problem.Subjects.Count * problem.Resources.Count);
        foreach (PlanningSubject subject in problem.Subjects.OrderBy(item => item.SubjectId, StringComparer.Ordinal))
        {
            foreach (PlanningResource resource in problem.Resources.OrderBy(item => item.ResourceId, StringComparer.Ordinal))
            {
                var context = new CandidateRuleContext(subject, resource, problem.Commitments);
                IReadOnlyList<RuleEvaluation> trace = rules.CandidateRules
                    .Select(rule => rule.Evaluate(context))
                    .ToList();
                alternatives.Add(new CandidateAlternative(
                    AlternativeId: $"{candidateBatchId}:{subject.SegmentId}:{resource.ResourceId}",
                    SubjectId: subject.SubjectId,
                    SegmentId: subject.SegmentId,
                    ResourceId: resource.ResourceId,
                    Window: subject.Window,
                    IsEligible: trace.All(result => !result.BlocksSelection),
                    RuleTrace: trace));
            }
        }

        var batch = new CandidateBatch(
            candidateBatchId,
            problem.SnapshotId,
            rules.RulePackageId,
            rules.Version,
            alternatives,
            new ArtifactLineage(manifest.Fingerprint, manifest.ProblemFingerprint, string.Empty));
        string fingerprint = ArtifactFingerprints.CandidateBatch(batch);
        return batch with
        {
            Lineage = batch.Lineage with { ArtifactFingerprint = fingerprint }
        };
    }

    private static void EnsureUnique(IEnumerable<string> values, string label)
    {
        HashSet<string> seen = new(StringComparer.Ordinal);
        string? duplicate = values.FirstOrDefault(value => !seen.Add(value));
        if (duplicate is not null)
        {
            throw new InvalidOperationException($"Duplicate {label} ID '{duplicate}'.");
        }
    }

}
