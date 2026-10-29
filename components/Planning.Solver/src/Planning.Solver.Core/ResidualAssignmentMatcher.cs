namespace Planning.Solver;

/// <summary>Completion status for bounded residual assignment matching.</summary>
public enum ResidualMatchingStatus
{
    /// <summary>The matcher exhaustively proved the maximum simultaneous assignment.</summary>
    Optimal,

    /// <summary>The configured search-node limit was reached before proof completed.</summary>
    SearchLimitReached,

    /// <summary>The fixed selected plan violates or cannot verify a configured rule.</summary>
    ExistingPlanInvalid
}

/// <summary>One adapter-provided alternative for residual demand.</summary>
public sealed record ResidualMatchingAlternative(
    string AlternativeId,
    string SubjectId,
    string ResourceId,
    TimeWindow Window);

/// <summary>Frozen inputs for one domain-neutral residual matching search.</summary>
public sealed record ResidualMatchingRequest(
    ProblemSnapshot Problem,
    RulePackage Rules,
    IReadOnlyList<SelectedAssignment> FixedAssignments,
    IReadOnlyList<string> ResidualSubjectIds,
    IReadOnlyList<ResidualMatchingAlternative> Alternatives,
    int MaximumSearchNodes);

/// <summary>Proof evidence from one bounded residual matching search.</summary>
public sealed record ResidualMatchingResult(
    ResidualMatchingStatus Status,
    IReadOnlyList<SelectedAssignment> Assignments,
    IReadOnlyList<string> UnmatchedSubjectIds,
    int TotalResidualSubjectCount,
    int ExploredNodeCount,
    int MaximumSearchNodes)
{
    /// <summary>Number of residual subjects assigned simultaneously.</summary>
    public int MatchedSubjectCount => Assignments.Count;

    /// <summary>Whether exhaustive proof placed every residual subject.</summary>
    public bool AllSubjectsMatched =>
        Status == ResidualMatchingStatus.Optimal
        && MatchedSubjectCount == TotalResidualSubjectCount;
}

/// <summary>Deterministic exact search for fixed-window residual assignments.</summary>
public static class ResidualAssignmentMatcher
{
    /// <summary>Finds the maximum simultaneous residual assignment or reports incomplete proof.</summary>
    public static ResidualMatchingResult Match(ResidualMatchingRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        Validate(request);
        SelectedAssignment[] fixedAssignments = request.FixedAssignments.ToArray();
        string[] residualSubjectIds = request.ResidualSubjectIds
            .Order(StringComparer.Ordinal)
            .ToArray();
        if (!ExistingPlanPasses(request, fixedAssignments))
        {
            return new ResidualMatchingResult(
                ResidualMatchingStatus.ExistingPlanInvalid,
                [],
                residualSubjectIds,
                residualSubjectIds.Length,
                0,
                request.MaximumSearchNodes);
        }

        Dictionary<string, PlanningSubject> subjects = request.Problem.Subjects
            .ToDictionary(subject => subject.SubjectId, StringComparer.Ordinal);
        Dictionary<string, PlanningResource> resources = request.Problem.Resources
            .ToDictionary(resource => resource.ResourceId, StringComparer.Ordinal);
        DemandAlternatives[] demands = residualSubjectIds
            .Select(subjectId => new DemandAlternatives(
                subjectId,
                request.Alternatives
                    .Where(alternative => string.Equals(
                        alternative.SubjectId,
                        subjectId,
                        StringComparison.Ordinal))
                    .Where(alternative => CandidatePasses(
                        request,
                        subjects[subjectId],
                        resources[alternative.ResourceId]))
                    .Where(alternative => !ConflictsWithAssignments(
                        request.Rules,
                        alternative.Window,
                        alternative.ResourceId,
                        fixedAssignments))
                    .OrderBy(alternative => alternative.ResourceId, StringComparer.Ordinal)
                    .ThenBy(alternative => alternative.AlternativeId, StringComparer.Ordinal)
                    .ToArray()))
            .OrderBy(demand => demand.Alternatives.Count)
            .ThenBy(demand => demand.SubjectId, StringComparer.Ordinal)
            .ToArray();

        var search = new SearchState(request, fixedAssignments, demands);
        search.Run();
        string[] unmatched = residualSubjectIds
            .Except(search.BestAssignments.Select(assignment => assignment.SubjectId), StringComparer.Ordinal)
            .ToArray();
        return new ResidualMatchingResult(
            search.LimitReached
                ? ResidualMatchingStatus.SearchLimitReached
                : ResidualMatchingStatus.Optimal,
            search.BestAssignments
                .OrderBy(assignment => assignment.SubjectId, StringComparer.Ordinal)
                .ToArray(),
            unmatched,
            residualSubjectIds.Length,
            search.ExploredNodes,
            request.MaximumSearchNodes);
    }

    private static void Validate(ResidualMatchingRequest request)
    {
        ArgumentNullException.ThrowIfNull(request.Problem);
        ArgumentNullException.ThrowIfNull(request.Rules);
        ArgumentNullException.ThrowIfNull(request.FixedAssignments);
        ArgumentNullException.ThrowIfNull(request.ResidualSubjectIds);
        ArgumentNullException.ThrowIfNull(request.Alternatives);
        if (request.MaximumSearchNodes <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(request),
                "Maximum search nodes must be positive.");
        }

        Dictionary<string, PlanningSubject> subjects = request.Problem.Subjects
            .ToDictionary(subject => subject.SubjectId, StringComparer.Ordinal);
        HashSet<string> resources = request.Problem.Resources
            .Select(resource => resource.ResourceId)
            .ToHashSet(StringComparer.Ordinal);
        HashSet<string> residual = new(StringComparer.Ordinal);
        foreach (string subjectId in request.ResidualSubjectIds)
        {
            if (!subjects.ContainsKey(subjectId))
            {
                throw new InvalidOperationException(
                    $"Residual subject '{subjectId}' is absent from the frozen problem.");
            }

            if (!residual.Add(subjectId))
            {
                throw new InvalidOperationException(
                    $"Residual subject '{subjectId}' is declared more than once.");
            }
        }

        HashSet<string> alternativeIds = new(StringComparer.Ordinal);
        foreach (ResidualMatchingAlternative alternative in request.Alternatives)
        {
            ArgumentNullException.ThrowIfNull(alternative);
            if (!alternativeIds.Add(alternative.AlternativeId))
            {
                throw new InvalidOperationException(
                    $"Residual alternative '{alternative.AlternativeId}' is declared more than once.");
            }

            if (!residual.Contains(alternative.SubjectId))
            {
                throw new InvalidOperationException(
                    $"Residual alternative '{alternative.AlternativeId}' references non-residual subject "
                    + $"'{alternative.SubjectId}'.");
            }

            if (!resources.Contains(alternative.ResourceId))
            {
                throw new InvalidOperationException(
                    $"Residual alternative '{alternative.AlternativeId}' references unknown resource "
                    + $"'{alternative.ResourceId}'.");
            }

            if (subjects[alternative.SubjectId].Window != alternative.Window)
            {
                throw new InvalidOperationException(
                    $"Residual alternative '{alternative.AlternativeId}' does not preserve the subject window.");
            }
        }
    }

    private static bool CandidatePasses(
        ResidualMatchingRequest request,
        PlanningSubject subject,
        PlanningResource resource)
    {
        var context = new CandidateRuleContext(subject, resource, request.Problem.Commitments);
        return request.Rules.CandidateRules
            .Select(rule => rule.Evaluate(context))
            .All(evaluation => !evaluation.BlocksSelection);
    }

    private static bool ExistingPlanPasses(
        ResidualMatchingRequest request,
        IReadOnlyList<SelectedAssignment> assignments)
    {
        Dictionary<string, PlanningSubject> subjects = request.Problem.Subjects
            .ToDictionary(subject => subject.SubjectId, StringComparer.Ordinal);
        Dictionary<string, PlanningResource> resources = request.Problem.Resources
            .ToDictionary(resource => resource.ResourceId, StringComparer.Ordinal);
        bool assignmentsPass = assignments.All(assignment =>
            subjects.TryGetValue(assignment.SubjectId, out PlanningSubject? subject)
            && resources.TryGetValue(assignment.ResourceId, out PlanningResource? resource)
            && string.Equals(subject.SegmentId, assignment.SegmentId, StringComparison.Ordinal)
            && subject.Window == assignment.Window
            && CandidatePasses(request, subject, resource));
        return assignmentsPass && CompletePlanPasses(request, assignments);
    }

    private static bool ConflictsWithAssignments(
        RulePackage rules,
        TimeWindow window,
        string resourceId,
        IReadOnlyList<SelectedAssignment> assignments)
    {
        ResourceConflictRule[] conflictRules = rules.CompletePlanRules
            .OfType<ResourceConflictRule>()
            .ToArray();
        return assignments.Any(assignment =>
            (string.Equals(assignment.ResourceId, resourceId, StringComparison.Ordinal)
                && assignment.Window.Overlaps(window))
            || conflictRules.Any(rule => rule.ConflictsWith(
                resourceId,
                window,
                assignment.ResourceId,
                assignment.Window)));
    }

    private static bool CompletePlanPasses(
        ResidualMatchingRequest request,
        IReadOnlyList<SelectedAssignment> assignments) =>
        request.Rules.CompletePlanRules.All(rule =>
            rule.Evaluate(new CompletePlanRuleContext(request.Problem, assignments)).Count == 0);

    private sealed record DemandAlternatives(
        string SubjectId,
        IReadOnlyList<ResidualMatchingAlternative> Alternatives);

    private sealed class SearchState(
        ResidualMatchingRequest request,
        IReadOnlyList<SelectedAssignment> fixedAssignments,
        IReadOnlyList<DemandAlternatives> demands)
    {
        private readonly List<SelectedAssignment> _current = [];

        public List<SelectedAssignment> BestAssignments { get; } = [];

        public int ExploredNodes { get; private set; }

        public bool LimitReached { get; private set; }

        public void Run() => Search(0);

        private void Search(int demandIndex)
        {
            if (LimitReached)
            {
                return;
            }

            ExploredNodes++;
            if (ExploredNodes > request.MaximumSearchNodes)
            {
                LimitReached = true;
                return;
            }

            if (_current.Count + demands.Count - demandIndex <= BestAssignments.Count)
            {
                return;
            }

            if (demandIndex == demands.Count)
            {
                SelectedAssignment[] combined = [.. fixedAssignments, .. _current];
                if (CompletePlanPasses(request, combined)
                    && _current.Count > BestAssignments.Count)
                {
                    BestAssignments.Clear();
                    BestAssignments.AddRange(_current);
                }

                return;
            }

            DemandAlternatives demand = demands[demandIndex];
            foreach (ResidualMatchingAlternative alternative in demand.Alternatives)
            {
                SelectedAssignment[] selected = [.. fixedAssignments, .. _current];
                if (ConflictsWithAssignments(
                        request.Rules,
                        alternative.Window,
                        alternative.ResourceId,
                        selected))
                {
                    continue;
                }

                PlanningSubject subject = request.Problem.Subjects.Single(item =>
                    string.Equals(item.SubjectId, alternative.SubjectId, StringComparison.Ordinal));
                _current.Add(new SelectedAssignment(
                    alternative.AlternativeId,
                    alternative.SubjectId,
                    subject.SegmentId,
                    alternative.ResourceId,
                    alternative.Window));
                Search(demandIndex + 1);
                _current.RemoveAt(_current.Count - 1);
            }

            Search(demandIndex + 1);
        }
    }
}
