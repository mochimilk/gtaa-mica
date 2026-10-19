using System.Globalization;
using System.Numerics;
using Google.OrTools.Sat;

namespace Planning.Solver.OrTools;

/// <summary>Optimizes canonical candidate selections with Google OR-Tools CP-SAT.</summary>
public sealed class CpSatStrategy : IOptimizationStrategy
{
    /// <summary>Stable strategy identifier.</summary>
    public const string Id = "or-tools-cp-sat-v1";

    /// <inheritdoc />
    public StrategyCapabilities Capabilities { get; } = new(
        Id,
        "1.1.0",
        new HashSet<string>(
        [
            BuiltInMetrics.AssignmentCoverage,
            BuiltInMetrics.ResourceCost
        ],
        StringComparer.Ordinal),
        new HashSet<ObjectiveComposition>
        {
            ObjectiveComposition.WeightedSum
        },
        [
            new(
                RequiredCapabilitiesRule.Id,
                RequiredCapabilitiesRule.Version,
                SolverRuleRepresentation.CandidateFilter),
            new(
                ResourceCommitmentRule.Id,
                ResourceCommitmentRule.Version,
                SolverRuleRepresentation.CandidateFilter),
            new(
                ResourceNonOverlapRule.Id,
                ResourceNonOverlapRule.Version,
                SolverRuleRepresentation.PairwiseConflict),
            new(
                ResourceConflictRule.Id,
                ResourceConflictRule.Version,
                SolverRuleRepresentation.PairwiseConflict)
        ],
        SupportsTimeLimit: true);

    /// <inheritdoc />
    public string StrategyId => Capabilities.StrategyId;

    /// <inheritdoc />
    public string Version => Capabilities.Version;

    /// <inheritdoc />
    public OptimizationResult Solve(
        RunManifest manifest,
        ProblemSnapshot problem,
        RulePackage rules,
        CandidateBatch candidates,
        CompiledProfile profile,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(candidates);
        ArgumentNullException.ThrowIfNull(profile);
        cancellationToken.ThrowIfCancellationRequested();
        RunManifestFactory.VerifyOptimizationInputs(manifest, problem, profile, rules, candidates, this);

        Dictionary<string, PlanningSubject> subjects = problem.Subjects.ToDictionary(
            subject => subject.SubjectId,
            StringComparer.Ordinal);
        Dictionary<string, PlanningResource> resources = problem.Resources.ToDictionary(
            resource => resource.ResourceId,
            StringComparer.Ordinal);
        List<CandidateAlternative> eligible = candidates.Eligible
            .OrderBy(candidate => candidate.SubjectId, StringComparer.Ordinal)
            .ThenBy(candidate => candidate.ResourceId, StringComparer.Ordinal)
            .ThenBy(candidate => candidate.AlternativeId, StringComparer.Ordinal)
            .ToList();
        ValidateCandidates(eligible, subjects, resources);

        var model = new CpModel();
        var variables = new Dictionary<string, BoolVar>(StringComparer.Ordinal);
        for (int index = 0; index < eligible.Count; index++)
        {
            variables.Add(eligible[index].AlternativeId, model.NewBoolVar($"candidate_{index:D8}"));
        }

        foreach (IGrouping<string, CandidateAlternative> group in eligible.GroupBy(
                     candidate => candidate.SubjectId,
                     StringComparer.Ordinal))
        {
            model.AddAtMostOne(group.Select(candidate => variables[candidate.AlternativeId]));
        }

        AddResourceNonOverlapConstraints(model, eligible, variables);
        AddResourceConflictConstraints(model, eligible, variables, rules);
        Dictionary<string, long> coefficients = CreateObjectiveCoefficients(
            eligible,
            resources,
            profile,
            problem.Subjects.Count);
        LinearExpr[] objectiveTerms = eligible
            .Where(candidate => coefficients[candidate.AlternativeId] != 0)
            .Select(candidate => LinearExpr.Term(
                variables[candidate.AlternativeId],
                coefficients[candidate.AlternativeId]))
            .ToArray();
        if (objectiveTerms.Length > 0)
        {
            model.Maximize(LinearExpr.Sum(objectiveTerms));
        }

        var solver = new CpSolver
        {
            StringParameters = CreateSolverParameters(manifest)
        };
        using CancellationTokenRegistration registration = cancellationToken.Register(solver.StopSearch);
        CpSolverStatus solverStatus = solver.Solve(model);
        cancellationToken.ThrowIfCancellationRequested();

        string status = MapStatus(solverStatus);
        bool hasSolution = solverStatus is CpSolverStatus.Optimal or CpSolverStatus.Feasible;
        List<SelectedAssignment> assignments = hasSolution
            ? eligible
                .Where(candidate => solver.BooleanValue(variables[candidate.AlternativeId]))
                .Select(candidate => new SelectedAssignment(
                    candidate.AlternativeId,
                    candidate.SubjectId,
                    candidate.SegmentId,
                    candidate.ResourceId,
                    candidate.Window))
                .OrderBy(assignment => assignment.SubjectId, StringComparer.Ordinal)
                .ToList()
            : [];
        HashSet<string> assignedSubjectIds = assignments
            .Select(assignment => assignment.SubjectId)
            .ToHashSet(StringComparer.Ordinal);
        string reasonCode = hasSolution ? "NO_SELECTED_ALTERNATIVE" : $"SOLVER_{status.ToUpperInvariant()}";
        List<UnassignedSubject> unassigned = problem.Subjects
            .Where(subject => !assignedSubjectIds.Contains(subject.SubjectId))
            .OrderBy(subject => subject.SubjectId, StringComparer.Ordinal)
            .Select(subject => new UnassignedSubject(subject.SubjectId, reasonCode))
            .ToList();

        string candidateFingerprint = ArtifactFingerprints.CandidateBatch(candidates);
        var result = new OptimizationResult(
            StrategyId,
            Version,
            status,
            assignments,
            unassigned,
            new ArtifactLineage(manifest.Fingerprint, candidateFingerprint, string.Empty));
        return result with
        {
            Lineage = result.Lineage with { ArtifactFingerprint = ArtifactFingerprints.Plan(result) }
        };
    }

    private static void ValidateCandidates(
        IReadOnlyList<CandidateAlternative> candidates,
        Dictionary<string, PlanningSubject> subjects,
        Dictionary<string, PlanningResource> resources)
    {
        string? duplicateId = candidates
            .GroupBy(candidate => candidate.AlternativeId, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key;
        if (duplicateId is not null)
        {
            throw new InvalidOperationException($"Eligible candidate ID '{duplicateId}' is duplicated.");
        }

        foreach (CandidateAlternative candidate in candidates)
        {
            if (!subjects.TryGetValue(candidate.SubjectId, out PlanningSubject? subject)
                || !string.Equals(candidate.SegmentId, subject.SegmentId, StringComparison.Ordinal)
                || candidate.Window != subject.Window)
            {
                throw new InvalidOperationException(
                    $"Eligible candidate '{candidate.AlternativeId}' does not match its canonical subject.");
            }

            if (!resources.ContainsKey(candidate.ResourceId))
            {
                throw new InvalidOperationException(
                    $"Eligible candidate '{candidate.AlternativeId}' references an unknown resource.");
            }
        }
    }

    private static void AddResourceNonOverlapConstraints(
        CpModel model,
        List<CandidateAlternative> candidates,
        Dictionary<string, BoolVar> variables)
    {
        foreach (IGrouping<string, CandidateAlternative> group in candidates.GroupBy(
                     candidate => candidate.ResourceId,
                     StringComparer.Ordinal))
        {
            CandidateAlternative[] ordered = group
                .OrderBy(candidate => candidate.Window.Start)
                .ThenBy(candidate => candidate.Window.End)
                .ThenBy(candidate => candidate.AlternativeId, StringComparer.Ordinal)
                .ToArray();
            for (int left = 0; left < ordered.Length; left++)
            {
                for (int right = left + 1; right < ordered.Length; right++)
                {
                    if (!ordered[left].Window.Overlaps(ordered[right].Window))
                    {
                        break;
                    }

                    model.Add(
                        variables[ordered[left].AlternativeId]
                        + variables[ordered[right].AlternativeId]
                        <= 1);
                }
            }
        }
    }

    private static void AddResourceConflictConstraints(
        CpModel model,
        List<CandidateAlternative> candidates,
        Dictionary<string, BoolVar> variables,
        RulePackage rules)
    {
        foreach (ResourceConflictRule rule in rules.CompletePlanRules.OfType<ResourceConflictRule>())
        {
            for (int left = 0; left < candidates.Count; left++)
            {
                for (int right = left + 1; right < candidates.Count; right++)
                {
                    CandidateAlternative first = candidates[left];
                    CandidateAlternative second = candidates[right];
                    if (string.Equals(first.SubjectId, second.SubjectId, StringComparison.Ordinal)
                        || !rule.ConflictsWith(
                            first.ResourceId,
                            first.Window,
                            second.ResourceId,
                            second.Window))
                    {
                        continue;
                    }

                    model.Add(
                        variables[first.AlternativeId]
                        + variables[second.AlternativeId]
                        <= 1);
                }
            }
        }
    }

    private static Dictionary<string, long> CreateObjectiveCoefficients(
        IReadOnlyList<CandidateAlternative> candidates,
        Dictionary<string, PlanningResource> resources,
        CompiledProfile profile,
        int subjectCount)
    {
        var raw = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (CandidateAlternative candidate in candidates)
        {
            decimal coefficient = 0;
            foreach (ObjectiveTerm objective in profile.Objectives)
            {
                decimal direction = objective.Direction == ObjectiveDirection.Maximize ? 1 : -1;
                coefficient += objective.MetricId switch
                {
                    BuiltInMetrics.AssignmentCoverage => direction * objective.Weight,
                    BuiltInMetrics.ResourceCost =>
                        direction * objective.Weight * subjectCount * resources[candidate.ResourceId].Cost,
                    _ => throw new InvalidOperationException(
                        $"CP-SAT does not implement objective metric '{objective.MetricId}'.")
                };
            }

            raw.Add(candidate.AlternativeId, coefficient);
        }

        return ScaleToIntegerCoefficients(raw);
    }

    private static Dictionary<string, long> ScaleToIntegerCoefficients(
        IReadOnlyDictionary<string, decimal> coefficients)
    {
        int commonScale = coefficients.Count == 0
            ? 0
            : coefficients.Values.Max(GetScale);
        var scaled = coefficients.ToDictionary(
            pair => pair.Key,
            pair => ToScaledInteger(pair.Value, commonScale),
            StringComparer.Ordinal);
        BigInteger divisor = scaled.Values
            .Where(value => value != BigInteger.Zero)
            .Select(BigInteger.Abs)
            .Aggregate(BigInteger.Zero, BigInteger.GreatestCommonDivisor);
        if (divisor == BigInteger.Zero)
        {
            divisor = BigInteger.One;
        }

        var result = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach ((string candidateId, BigInteger value) in scaled)
        {
            BigInteger reduced = value / divisor;
            if (reduced < long.MinValue || reduced > long.MaxValue)
            {
                throw new InvalidOperationException(
                    "The exact CP-SAT objective coefficients exceed the supported 64-bit integer range.");
            }

            result.Add(candidateId, (long)reduced);
        }

        return result;
    }

    private static int GetScale(decimal value) => (decimal.GetBits(value)[3] >> 16) & 0x7F;

    private static BigInteger ToScaledInteger(decimal value, int targetScale)
    {
        int[] bits = decimal.GetBits(value);
        var mantissa = new BigInteger((uint)bits[0])
            | (new BigInteger((uint)bits[1]) << 32)
            | (new BigInteger((uint)bits[2]) << 64);
        bool negative = (bits[3] & int.MinValue) != 0;
        if (negative)
        {
            mantissa = -mantissa;
        }

        int scale = (bits[3] >> 16) & 0x7F;
        return mantissa * BigInteger.Pow(10, targetScale - scale);
    }

    private static string CreateSolverParameters(RunManifest manifest)
    {
        var parameters = new List<string>
        {
            $"random_seed:{manifest.RandomSeed.ToString(CultureInfo.InvariantCulture)}",
            "search_branching:FIXED_SEARCH",
            "num_search_workers:1"
        };
        if (manifest.TimeLimit is TimeSpan timeLimit)
        {
            parameters.Add(
                $"max_time_in_seconds:{timeLimit.TotalSeconds.ToString("R", CultureInfo.InvariantCulture)}");
        }

        return string.Join(',', parameters);
    }

    private static string MapStatus(CpSolverStatus status) => status switch
    {
        CpSolverStatus.Optimal => "Optimal",
        CpSolverStatus.Feasible => "Feasible",
        CpSolverStatus.Infeasible => "Infeasible",
        CpSolverStatus.Unknown => "Unknown",
        CpSolverStatus.ModelInvalid => throw new InvalidOperationException("CP-SAT rejected the generated model."),
        _ => throw new InvalidOperationException($"CP-SAT returned unsupported status '{status}'.")
    };
}
