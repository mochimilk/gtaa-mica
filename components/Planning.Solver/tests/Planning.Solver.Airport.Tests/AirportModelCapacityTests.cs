using FluentAssertions;

namespace Planning.Solver.Airport.Tests;

public sealed class AirportModelCapacityTests
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Rule_SameAircraftClass_UsesExactModelOutcome()
    {
        AirportAircraftModelMatrix matrix = Matrix();
        var rule = new AirportAircraftModelCompatibilityRule(
            matrix,
            "fixture-authority",
            "fixture-matrix");
        PlanningResource gate1 = Problem().Resources.Single(resource => resource.ResourceId == "gate-1");
        PlanningSubject allowed = Problem().Subjects.Single(subject => subject.SubjectId == "unassigned-a320");
        PlanningSubject denied = Problem().Subjects.Single(subject => subject.SubjectId == "unassigned-b737");

        RuleEvaluation allowedResult = rule.Evaluate(new CandidateRuleContext(allowed, gate1, []));
        RuleEvaluation deniedResult = rule.Evaluate(new CandidateRuleContext(denied, gate1, []));

        allowedResult.Outcome.Should().Be(RuleEvaluationOutcome.Passed);
        deniedResult.Outcome.Should().Be(RuleEvaluationOutcome.Violated);
        matrix.VisitModels.Single(visit => visit.VisitId == allowed.SubjectId)
            .AircraftClassId.Should().Be("Narrow");
        matrix.VisitModels.Single(visit => visit.VisitId == denied.SubjectId)
            .AircraftClassId.Should().Be("Narrow");
    }

    [Fact]
    public void Rule_MissingVisitModel_IsUnverifiable()
    {
        AirportAircraftModelMatrix matrix = AirportAircraftModelMatrix.Create(
            [new AirportStandAircraftModelFit("gate-1", "A320", AirportAircraftModelFitOutcome.Allowed, "matrix")],
            []);
        var rule = new AirportAircraftModelCompatibilityRule(matrix, "authority", "matrix");
        PlanningSubject subject = Problem().Subjects[0];
        PlanningResource resource = Problem().Resources[0];

        RuleEvaluation result = rule.Evaluate(new CandidateRuleContext(subject, resource, []));

        result.Outcome.Should().Be(RuleEvaluationOutcome.Unverifiable);
        result.BlocksSelection.Should().BeTrue();
    }

    [Fact]
    public void Matrix_AircraftClassChanges_ChangesFingerprintButNotExactFit()
    {
        AirportAircraftModelMatrix original = Matrix();
        AirportVisitAircraftModel[] visits = original.VisitModels
            .Select(visit => visit.VisitId == "unassigned-a320"
                ? visit with { AircraftClassId = "Changed rollup" }
                : visit)
            .ToArray();
        AirportAircraftModelMatrix changed = AirportAircraftModelMatrix.Create(
            original.StandFits,
            visits);

        changed.Fingerprint.Should().NotBe(original.Fingerprint);
        changed.EligibilityFingerprint.Should().Be(original.EligibilityFingerprint);
        changed.TryGetFit("gate-1", "a320", out AirportStandAircraftModelFit? fit)
            .Should().BeTrue();
        fit!.Outcome.Should().Be(AirportAircraftModelFitOutcome.Allowed);
    }

    [Fact]
    public void CalculateDetailed_UnassignedVisits_UsesModelTimingAndEvidence()
    {
        ProblemSnapshot problem = Problem();
        AirportAircraftModelMatrix matrix = Matrix();
        RulePackage rules = Rules(matrix);
        var optimization = new OptimizationResult(
            DeterministicGreedyStrategy.Id,
            "test",
            "Optimal",
            [
                Assignment("assigned-early", "gate-1"),
                Assignment("assigned-late", "gate-1"),
                Assignment("assigned-blocker", "gate-2")
            ],
            [
                new UnassignedSubject("unassigned-a320", "NO_SELECTION"),
                new UnassignedSubject("unassigned-b737", "NO_SELECTION"),
                new UnassignedSubject("unassigned-77w", "NO_SELECTION")
            ],
            new ArtifactLineage("manifest", "input", "artifact"));
        AirportModelCapacityInput input = Input(matrix);
        var context = new MetricCalculationContext(
            problem,
            rules,
            optimization,
            MetricInputSet.Create([input]));

        AirportModelCapacityResult result = AirportModelCapacityCalculator.CalculateDetailed(context);

        result.TotalPhysicalSlots.Should().Be(2);
        result.UnassignedVisitFits.Should().ContainSingle(fit =>
            fit.VisitId == "unassigned-a320"
            && fit.Status == AirportVisitCapacityFitStatus.CompatibleResourceAvailable
            && fit.AvailableStandIds.Count == 1
            && fit.AvailableStandIds[0] == "gate-1");
        result.UnassignedVisitFits.Should().ContainSingle(fit =>
            fit.VisitId == "unassigned-b737"
            && fit.Status == AirportVisitCapacityFitStatus.NoCompatibleResource
            && fit.AvailableStandIds.Count == 0);
        result.UnassignedVisitFits.Should().ContainSingle(fit =>
            fit.VisitId == "unassigned-77w"
            && fit.Status == AirportVisitCapacityFitStatus.Unverifiable
            && fit.AvailableStandIds.Count == 0);
    }

    [Fact]
    public void CalculateDetailed_MetricMatrixDiffersFromRuleMatrix_FailsExplicitly()
    {
        AirportAircraftModelMatrix matrix = Matrix();
        AirportAircraftModelMatrix changed = AirportAircraftModelMatrix.Create(
            matrix.StandFits.Select(fit =>
                fit.StandId == "gate-1" && fit.AircraftModelCode == "A320"
                    ? fit with { Outcome = AirportAircraftModelFitOutcome.Denied }
                    : fit),
            matrix.VisitModels);
        var optimization = new OptimizationResult(
            DeterministicGreedyStrategy.Id,
            "test",
            "Optimal",
            [],
            Problem().Subjects.Select(subject => new UnassignedSubject(subject.SubjectId, "NO_SELECTION")).ToArray(),
            new ArtifactLineage("manifest", "input", "artifact"));
        var context = new MetricCalculationContext(
            Problem(),
            Rules(matrix),
            optimization,
            MetricInputSet.Create([Input(changed)]));

        Action act = () => AirportModelCapacityCalculator.CalculateDetailed(context);

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*does not match the normalized aircraft model rule*");
    }

    [Fact]
    public void Run_ModelCapacityV3_UsesSameMatrixForCandidatesAndScoring()
    {
        AirportAircraftModelMatrix matrix = PipelineMatrix();
        AirportPlanningSnapshot source = PipelineSource();
        ProblemSnapshot problem = AirportProblemAdapter.Adapt(source);
        RulePackage rules = AirportRuleAdapter.Adapt(new AirportRuleConfiguration(
            "airport-model-rules",
            "1.0.0",
            AircraftModelMatrix: matrix));
        MetricRegistry registry = MetricRegistry.CreateWithBuiltIns(
            [new AirportModelCapacityCalculator()]);
        DeterministicGreedyStrategy strategy = AirportFixture.Strategy();
        var pipeline = new SolverPipeline(
            new ProfileCompiler(registry.Definitions, [strategy.Capabilities]),
            strategy,
            registry);
        AirportModelCapacityInput input = AirportModelCapacityInput.Create(
            Start.AddDays(-1),
            "fixture-model-matrix",
            PipelineProfiles(),
            [],
            matrix);

        SolverPipelineResult result = pipeline.Run(
            problem,
            rules,
            PipelineProfile(),
            "model-candidates",
            "model-run",
            MetricInputSet.Create([input]));

        result.Optimization.Assignments.Should().Contain(assignment =>
            assignment.SubjectId == "visit-a320" && assignment.ResourceId == "gate-1");
        result.Optimization.Assignments.Should().Contain(assignment =>
            assignment.SubjectId == "visit-b737" && assignment.ResourceId == "gate-2");
        result.Candidates.Alternatives.Should().Contain(candidate =>
            candidate.SubjectId == "visit-a320"
            && candidate.ResourceId == "gate-2"
            && !candidate.IsEligible
            && candidate.RuleTrace.Any(trace =>
                trace.RuleId == AirportAircraftModelCompatibilityRule.Id
                && trace.Outcome == RuleEvaluationOutcome.Violated));
        MetricResult metric = result.Score.Metrics.Should().ContainSingle(item =>
            item.MetricId == AirportMetrics.VirtualCapacitySlots).Subject;
        metric.Version.Should().Be("3.0.0");
        metric.RawValue.Should().Be(0m);
        metric.Inputs.Should().ContainSingle()
            .Which.ContentFingerprint.Should().Be(input.Descriptor.ContentFingerprint);
    }

    private static ProblemSnapshot Problem() => new(
        "model-capacity-problem",
        AirportProblemAdapter.Id,
        AirportProblemAdapter.Version,
        Start.AddDays(-1),
        [
            Subject("assigned-early", 0, 60),
            Subject("assigned-late", 180, 240),
            Subject("assigned-blocker", 60, 120),
            Subject("unassigned-a320", 60, 120),
            Subject("unassigned-b737", 60, 120),
            Subject("unassigned-77w", 60, 120)
        ],
        [
            new PlanningResource("gate-1", 1m, Set("basic")),
            new PlanningResource("gate-2", 1m, Set("basic"))
        ],
        []);

    private static PlanningSubject Subject(string id, int startMinutes, int endMinutes) => new(
        id,
        $"segment-{id}",
        TimeWindow.Create(Start.AddMinutes(startMinutes), Start.AddMinutes(endMinutes)),
        1,
        Set("basic"));

    private static SelectedAssignment Assignment(string subjectId, string standId)
    {
        PlanningSubject subject = Problem().Subjects.Single(item => item.SubjectId == subjectId);
        return new SelectedAssignment(
            $"assignment-{subjectId}",
            subject.SubjectId,
            subject.SegmentId,
            standId,
            subject.Window);
    }

    private static AirportAircraftModelMatrix Matrix() => AirportAircraftModelMatrix.Create(
        [
            Fit("gate-1", "A320", AirportAircraftModelFitOutcome.Allowed),
            Fit("gate-1", "B737", AirportAircraftModelFitOutcome.Denied),
            Fit("gate-1", "77W", AirportAircraftModelFitOutcome.Unverifiable),
            Fit("gate-2", "A320", AirportAircraftModelFitOutcome.Denied),
            Fit("gate-2", "B737", AirportAircraftModelFitOutcome.Allowed),
            Fit("gate-2", "77W", AirportAircraftModelFitOutcome.Denied)
        ],
        [
            VisitModel("assigned-early", "A320", "Domestic", "Narrow"),
            VisitModel("assigned-late", "A320", "Domestic", "Narrow"),
            VisitModel("assigned-blocker", "B737", "Domestic", "Narrow"),
            VisitModel("unassigned-a320", "A320", "Domestic", "Narrow"),
            VisitModel("unassigned-b737", "B737", "Domestic", "Narrow"),
            VisitModel("unassigned-77w", "77W", "Domestic", "Wide")
        ]);

    private static AirportStandAircraftModelFit Fit(
        string standId,
        string model,
        AirportAircraftModelFitOutcome outcome) =>
        new(standId, model, outcome, "fixture-matrix");

    private static AirportVisitAircraftModel VisitModel(
        string visitId,
        string model,
        string sector,
        string? aircraftClass) =>
        new(visitId, model, sector, aircraftClass);

    private static AirportModelCapacityInput Input(AirportAircraftModelMatrix matrix) =>
        AirportModelCapacityInput.Create(
            Start.AddDays(-1),
            "fixture-model-matrix",
            [
                new AirportCapacityProfile("gate-1", "T1", "Domestic", 60),
                new AirportCapacityProfile("gate-2", "T1", "Domestic", 60)
            ],
            [],
            matrix);

    private static RulePackage Rules(AirportAircraftModelMatrix matrix) =>
        AirportRuleAdapter.Adapt(new AirportRuleConfiguration(
            "airport-model-rules",
            "1.0.0",
            AircraftModelMatrix: matrix));

    private static AirportPlanningSnapshot PipelineSource() => new(
        "pipeline-model-capacity",
        "fixture-1",
        Start.AddDays(-1),
        [
            new AirportVisitDemand(
                "visit-a320",
                "segment-a320",
                Start,
                Start.AddHours(1),
                2,
                Set("basic")),
            new AirportVisitDemand(
                "visit-b737",
                "segment-b737",
                Start,
                Start.AddHours(1),
                1,
                Set("basic"))
        ],
        [
            new AirportStand("gate-1", 1m, Set("basic")),
            new AirportStand("gate-2", 1m, Set("basic"))
        ],
        []);

    private static AirportAircraftModelMatrix PipelineMatrix() => AirportAircraftModelMatrix.Create(
        [
            Fit("gate-1", "A320", AirportAircraftModelFitOutcome.Allowed),
            Fit("gate-1", "B737", AirportAircraftModelFitOutcome.Denied),
            Fit("gate-2", "A320", AirportAircraftModelFitOutcome.Denied),
            Fit("gate-2", "B737", AirportAircraftModelFitOutcome.Allowed)
        ],
        [
            VisitModel("visit-a320", "A320", "Domestic", "Narrow"),
            VisitModel("visit-b737", "B737", "Domestic", "Narrow")
        ]);

    private static AirportCapacityProfile[] PipelineProfiles() =>
    [
        new("gate-1", "T1", "Domestic", 60),
        new("gate-2", "T1", "Domestic", 60)
    ];

    private static ProfileDefinition PipelineProfile() => new(
        "airport-model-capacity",
        "1.0.0",
        [
            new ObjectiveTerm(
                BuiltInMetrics.AssignmentCoverage,
                "1.0.0",
                ObjectiveDirection.Maximize,
                100m),
            new ObjectiveTerm(
                AirportMetrics.VirtualCapacitySlots,
                "3.0.0",
                ObjectiveDirection.Maximize,
                0m)
        ],
        new AcceptancePolicy(MaximumUnassignedSubjects: 0),
        new SearchPolicy(DeterministicGreedyStrategy.Id));

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);
}
