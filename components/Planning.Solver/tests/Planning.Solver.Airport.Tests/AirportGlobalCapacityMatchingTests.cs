using FluentAssertions;

namespace Planning.Solver.Airport.Tests;

public sealed class AirportGlobalCapacityMatchingTests
{
    private static readonly DateTimeOffset Start = new(2027, 2, 1, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Match_OverlappingVisitsCompetingForOneStand_MatchesOne()
    {
        MetricCalculationContext context = Context(
            [Subject("visit-1", 0, 60), Subject("visit-2", 0, 60)],
            ["gate-1"]);

        AirportCapacityMatchingResult result = Match(context);

        result.Status.Should().Be(ResidualMatchingStatus.Optimal);
        result.MatchedVisitCount.Should().Be(1);
        result.Matches.Should().ContainSingle()
            .Which.VisitId.Should().Be("visit-1");
        result.UnmatchedVisitIds.Should().Equal("visit-2");
    }

    [Fact]
    public void Match_NonOverlappingVisits_CanShareStand()
    {
        MetricCalculationContext context = Context(
            [Subject("visit-1", 0, 60), Subject("visit-2", 60, 120)],
            ["gate-1"]);

        AirportCapacityMatchingResult result = Match(context);

        result.Status.Should().Be(ResidualMatchingStatus.Optimal);
        result.MatchedVisitCount.Should().Be(2);
        result.Matches.Select(match => match.StandId).Should().OnlyContain(stand => stand == "gate-1");
        result.AllVisitsMatched.Should().BeTrue();
    }

    [Fact]
    public void Match_CrossResourceConflict_PreventsSimultaneousPlacement()
    {
        var conflictRule = new ResourceConflictRule(
            [new ResourceConflict("adjacent-gates", "gate-1", "gate-2")]);
        MetricCalculationContext context = Context(
            [Subject("visit-1", 0, 60), Subject("visit-2", 0, 60)],
            ["gate-1", "gate-2"],
            completeRules: [conflictRule]);

        AirportCapacityMatchingResult result = Match(context);

        result.Status.Should().Be(ResidualMatchingStatus.Optimal);
        result.MatchedVisitCount.Should().Be(1);
    }

    [Fact]
    public void Match_EvaluatesEveryCandidateRule()
    {
        MetricCalculationContext context = Context(
            [Subject("visit-1", 0, 60), Subject("visit-2", 0, 60)],
            ["gate-1", "gate-2"],
            candidateRules: [new DenyResourceRule("gate-2")]);

        AirportCapacityMatchingResult result = Match(context);

        result.MatchedVisitCount.Should().Be(1);
        result.Matches.Should().ContainSingle()
            .Which.StandId.Should().Be("gate-1");
    }

    [Fact]
    public void Match_CompletePlanRuleRejectsInvalidLeaf()
    {
        MetricCalculationContext context = Context(
            [Subject("visit-1", 0, 60), Subject("visit-2", 0, 60)],
            ["gate-1", "gate-2"],
            completeRules: [new RejectSubjectPairRule("visit-1", "visit-2")]);

        AirportCapacityMatchingResult result = Match(context);

        result.Status.Should().Be(ResidualMatchingStatus.Optimal);
        result.MatchedVisitCount.Should().Be(1);
    }

    [Fact]
    public void Match_RepeatedSearch_IsDeterministic()
    {
        MetricCalculationContext context = Context(
            [Subject("visit-1", 0, 60), Subject("visit-2", 0, 60)],
            ["gate-1", "gate-2"]);

        AirportCapacityMatchingResult first = Match(context);
        AirportCapacityMatchingResult second = Match(context);

        second.Should().BeEquivalentTo(first, options => options.WithStrictOrdering());
    }

    [Fact]
    public void Match_SearchLimitReached_IsNotReportedAsProof()
    {
        MetricCalculationContext context = Context(
            [Subject("visit-1", 0, 60), Subject("visit-2", 0, 60)],
            ["gate-1", "gate-2"],
            matchingSearchNodes: 1);
        AirportCapacityMatchingInput policy = Policy(1);

        AirportCapacityMatchingResult result = AirportCapacityMatcher.Match(context, policy);
        Action calculate = () => new AirportGlobalModelCapacityCalculator().Calculate(context);

        result.Status.Should().Be(ResidualMatchingStatus.SearchLimitReached);
        result.AllVisitsMatched.Should().BeFalse();
        calculate.Should().Throw<InvalidOperationException>()
            .WithMessage("*exceeded its 1 node limit*");
    }

    [Fact]
    public void Match_InvalidExistingPlan_ReturnsExplicitStatus()
    {
        PlanningSubject fixedOne = Subject("fixed-1", 0, 60);
        PlanningSubject fixedTwo = Subject("fixed-2", 0, 60);
        MetricCalculationContext context = Context(
            [fixedOne, fixedTwo, Subject("visit-1", 60, 120)],
            ["gate-1"],
            [
                Assignment(fixedOne, "gate-1"),
                Assignment(fixedTwo, "gate-1")
            ],
            ["visit-1"]);

        AirportCapacityMatchingResult result = Match(context);

        result.Status.Should().Be(ResidualMatchingStatus.ExistingPlanInvalid);
        result.MatchedVisitCount.Should().Be(0);
        result.UnmatchedVisitIds.Should().Equal("visit-1");
    }

    [Fact]
    public void Calculate_PhysicalSlotValueRemainsSeparateFromMatchingCount()
    {
        PlanningSubject early = Subject("fixed-early", 0, 60);
        PlanningSubject late = Subject("fixed-late", 180, 240);
        MetricCalculationContext context = Context(
            [early, late, Subject("visit-1", 60, 120)],
            ["gate-1"],
            [Assignment(early, "gate-1"), Assignment(late, "gate-1")],
            ["visit-1"]);

        MetricCalculation calculation = new AirportGlobalModelCapacityCalculator().Calculate(context);

        calculation.RawValue.Should().Be(2m);
        calculation.Breakdowns.Should().ContainSingle(item =>
            item.Dimensions["evidence-kind"] == "global-matching-summary"
            && item.Value == 1m
            && item.Dimensions["status"] == ResidualMatchingStatus.Optimal.ToString());
        calculation.Breakdowns.Count(item =>
            item.Dimensions["evidence-kind"] == "physical-slot").Should().Be(2);
    }

    private static AirportCapacityMatchingResult Match(MetricCalculationContext context) =>
        AirportCapacityMatcher.Match(context, Policy());

    private static MetricCalculationContext Context(
        IReadOnlyList<PlanningSubject> subjects,
        IReadOnlyList<string> standIds,
        IReadOnlyList<SelectedAssignment>? fixedAssignments = null,
        IReadOnlyList<string>? unassignedVisitIds = null,
        IReadOnlyList<ICandidateRule>? candidateRules = null,
        IReadOnlyList<ICompletePlanRule>? completeRules = null,
        int matchingSearchNodes = 10_000)
    {
        PlanningResource[] resources = standIds
            .Select(standId => new PlanningResource(standId, 1m, Set("basic")))
            .ToArray();
        var problem = new ProblemSnapshot(
            "matching-problem",
            AirportProblemAdapter.Id,
            AirportProblemAdapter.Version,
            Start.AddDays(-1),
            subjects,
            resources,
            []);
        AirportAircraftModelMatrix matrix = AirportAircraftModelMatrix.Create(
            standIds.Select(standId => new AirportStandAircraftModelFit(
                standId,
                "A320",
                AirportAircraftModelFitOutcome.Allowed,
                "fixture-matrix")),
            subjects.Select(subject => new AirportVisitAircraftModel(
                subject.SubjectId,
                "A320",
                "Domestic",
                "Narrow")));
        var modelRule = new AirportAircraftModelCompatibilityRule(
            matrix,
            "fixture-authority",
            "fixture-matrix");
        var rules = new RulePackage(
            "matching-rules",
            "1.0.0",
            [
                new RequiredCapabilitiesRule(),
                new ResourceCommitmentRule(),
                modelRule,
                .. (candidateRules ?? [])
            ],
            [
                new ResourceNonOverlapRule(),
                .. (completeRules ?? [])
            ]);
        SelectedAssignment[] selected = fixedAssignments?.ToArray() ?? [];
        string[] unassigned = unassignedVisitIds?.ToArray()
            ?? subjects
                .Select(subject => subject.SubjectId)
                .Except(selected.Select(assignment => assignment.SubjectId), StringComparer.Ordinal)
                .ToArray();
        var optimization = new OptimizationResult(
            "fixture",
            "1.0.0",
            "Feasible",
            selected,
            unassigned.Select(visitId => new UnassignedSubject(visitId, "NO_SELECTION")).ToArray(),
            new ArtifactLineage("manifest", "input", "artifact"));
        AirportModelCapacityInput modelInput = AirportModelCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            standIds.Select(standId => new AirportCapacityProfile(
                standId,
                "T1",
                "Domestic",
                60)),
            [],
            matrix);
        return new MetricCalculationContext(
            problem,
            rules,
            optimization,
            MetricInputSet.Create([modelInput, Policy(matchingSearchNodes)]));
    }

    private static AirportCapacityMatchingInput Policy(int maximumSearchNodes = 10_000) =>
        AirportCapacityMatchingInput.Create(
            Start.AddDays(-1),
            "fixture",
            maximumSearchNodes);

    private static PlanningSubject Subject(string id, int startMinutes, int endMinutes) => new(
        id,
        $"segment-{id}",
        TimeWindow.Create(Start.AddMinutes(startMinutes), Start.AddMinutes(endMinutes)),
        1,
        Set("basic"));

    private static SelectedAssignment Assignment(PlanningSubject subject, string standId) => new(
        $"assignment-{subject.SubjectId}",
        subject.SubjectId,
        subject.SegmentId,
        standId,
        subject.Window);

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);

    private sealed class DenyResourceRule(string deniedResourceId) : ICandidateRule
    {
        public RuleDescriptor Descriptor { get; } = new(
            "fixture-deny-resource",
            "1.0.0",
            RuleClassification.Hard,
            RuleEvaluationPhase.Candidate,
            SolverRuleRepresentation.CandidateFilter,
            "fixture",
            "fixture");

        public RuleEvaluation Evaluate(CandidateRuleContext context)
        {
            RuleEvaluationOutcome outcome = string.Equals(
                context.Resource.ResourceId,
                deniedResourceId,
                StringComparison.Ordinal)
                ? RuleEvaluationOutcome.Violated
                : RuleEvaluationOutcome.Passed;
            return new RuleEvaluation(
                Descriptor.RuleId,
                Descriptor.Version,
                Descriptor.Classification,
                outcome,
                "Fixture candidate rule.");
        }
    }

    private sealed class RejectSubjectPairRule(
        string firstSubjectId,
        string secondSubjectId) : ICompletePlanRule
    {
        public RuleDescriptor Descriptor { get; } = new(
            "fixture-reject-pair",
            "1.0.0",
            RuleClassification.Hard,
            RuleEvaluationPhase.CompletePlan,
            SolverRuleRepresentation.GlobalConstraint,
            "fixture",
            "fixture");

        public IReadOnlyList<ValidationFinding> Evaluate(CompletePlanRuleContext context)
        {
            bool containsFirst = context.Assignments.Any(assignment =>
                string.Equals(assignment.SubjectId, firstSubjectId, StringComparison.Ordinal));
            bool containsSecond = context.Assignments.Any(assignment =>
                string.Equals(assignment.SubjectId, secondSubjectId, StringComparison.Ordinal));
            return containsFirst && containsSecond
                ?
                [
                    new ValidationFinding(
                        ValidationFindingStatus.Violation,
                        "FIXTURE_PAIR",
                        "Fixture pair rejected.",
                        Descriptor.RuleId)
                ]
                : [];
        }
    }
}
