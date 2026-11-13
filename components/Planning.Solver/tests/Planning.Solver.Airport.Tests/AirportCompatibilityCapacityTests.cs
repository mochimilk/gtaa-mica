using FluentAssertions;

namespace Planning.Solver.Airport.Tests;

public sealed class AirportCompatibilityCapacityTests
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 16, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Create_ProfileAndClassOrderChanges_ProducesSameFingerprint()
    {
        AirportCompatibilityCapacityProfile[] profiles = Profiles();
        AirportCompatibilityCapacityInput first = Input();
        AirportCompatibilityCapacityInput reordered = AirportCompatibilityCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            profiles
                .Reverse()
                .Select(profile => profile with
                {
                    CompatibleAircraftClassIds = profile.CompatibleAircraftClassIds
                        .Reverse()
                        .ToHashSet(StringComparer.Ordinal)
                }),
            PeakWindows().Reverse());

        reordered.Descriptor.ContentFingerprint.Should()
            .Be(first.Descriptor.ContentFingerprint);
    }

    [Fact]
    public void Create_CompatibilityMappingChanges_ChangesFingerprint()
    {
        AirportCompatibilityCapacityProfile[] profiles = Profiles();
        AirportCompatibilityCapacityInput changed = AirportCompatibilityCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            [
                profiles[0] with
                {
                    CompatibleAircraftClassIds = Set("class-narrow")
                },
                .. profiles.Skip(1)
            ],
            PeakWindows());

        changed.Descriptor.ContentFingerprint.Should()
            .NotBe(Input().Descriptor.ContentFingerprint);
    }

    [Fact]
    public void CalculateDetailed_FlexibleSlots_CountsPhysicalCapacityOnce()
    {
        AirportCompatibilityCapacityResult result =
            AirportCompatibilityCapacityCalculator.CalculateDetailed(Context());

        result.TotalPhysicalSlots.Should().Be(4);
        result.SlotsFor("class-narrow").Should().HaveCount(4);
        result.SlotsFor("class-wide").Should().HaveCount(2);
        result.CompatibilitySummaries.Sum(summary => summary.CompatibleSlotCount)
            .Should().Be(6, "class views overlap and are explicitly non-additive");
        result.CompatibilitySummaries.Should().Contain(summary =>
            summary.TerminalId == "T1"
            && summary.AircraftClassId == "class-wide"
            && summary.CompatibleSlotCount == 2
            && summary.ExclusiveSlotCount == 0
            && summary.SharedSlotCount == 2);
        result.CompatibilitySummaries
            .Where(summary =>
                summary.TerminalId == "T3"
                && summary.AircraftClassId == "class-narrow")
            .Sum(summary => summary.CompatibleSlotCount)
            .Should().Be(2);
        result.CompatibilitySummaries
            .Where(summary =>
                summary.TerminalId == "T3"
                && summary.AircraftClassId == "class-narrow")
            .Sum(summary => summary.ExclusiveSlotCount)
            .Should().Be(2);
    }

    [Fact]
    public void Create_StandWithoutCompatibilityClass_FailsExplicitly()
    {
        AirportCompatibilityCapacityProfile[] profiles = Profiles();

        Action act = () => AirportCompatibilityCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            [
                profiles[0] with
                {
                    CompatibleAircraftClassIds = Set()
                },
                .. profiles.Skip(1)
            ],
            PeakWindows());

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*requires at least one compatible aircraft class*");
    }

    [Fact]
    public void Run_CompatibilityCapacityV2_PreservesPhysicalAndNonAdditiveEvidence()
    {
        ProblemSnapshot problem = AirportProblemAdapter.Adapt(Source());
        RulePackage rules = Rules();
        MetricRegistry registry = MetricRegistry.CreateWithBuiltIns(
            [new AirportCompatibilityCapacityCalculator()]);
        DeterministicGreedyStrategy strategy = AirportFixture.Strategy();
        var pipeline = new SolverPipeline(
            new ProfileCompiler(registry.Definitions, [strategy.Capabilities]),
            strategy,
            registry);
        MetricInputSet inputs = MetricInputSet.Create([Input()]);

        SolverPipelineResult result = pipeline.Run(
            problem,
            rules,
            Profile(),
            "compatibility-candidates",
            "compatibility-run",
            inputs);

        MetricResult metric = result.Score.Metrics.Should().ContainSingle(item =>
            item.MetricId == AirportMetrics.VirtualCapacitySlots).Subject;
        metric.Version.Should().Be("2.0.0");
        metric.RawValue.Should().Be(4m);
        metric.WeightedContribution.Should().Be(0m);
        metric.Breakdowns.Count(item =>
                item.Dimensions["evidence-kind"] == "physical-slot")
            .Should().Be(4);
        metric.Breakdowns.Should().Contain(item =>
            item.Dimensions["evidence-kind"] == "compatibility-summary"
            && item.Dimensions["measure"] == "compatible-slot-count"
            && item.Dimensions["aggregation"] == "non-additive"
            && item.Dimensions["aircraft-class"] == "class-wide"
            && item.Value == 2m);
        metric.Breakdowns
            .Where(item =>
                item.Dimensions["evidence-kind"] == "compatibility-summary"
                && item.Dimensions["measure"] == "compatible-slot-count")
            .Sum(item => item.Value)
            .Should().Be(6m);
    }

    private static MetricCalculationContext Context()
    {
        var optimization = new OptimizationResult(
            DeterministicGreedyStrategy.Id,
            "test",
            "Optimal",
            Assignments(),
            [],
            new ArtifactLineage("manifest", "input", "artifact"));
        return new MetricCalculationContext(
            AirportProblemAdapter.Adapt(Source()),
            Rules(),
            optimization,
            MetricInputSet.Create([Input()]));
    }

    private static IReadOnlyList<SelectedAssignment> Assignments() =>
    [
        Assignment("a1", "visit-a", "gate-1", 60, 90),
        Assignment("a2", "visit-b", "gate-1", 210, 240),
        Assignment("a3", "visit-c", "gate-2", 0, 30),
        Assignment("a4", "visit-d", "gate-2", 180, 210)
    ];

    private static AirportPlanningSnapshot Source() => new(
        "compatibility-airport",
        "fixture-1",
        Start.AddDays(-1),
        [
            Visit("visit-a", "segment-a", 60, 90, "gate-1-only"),
            Visit("visit-b", "segment-b", 210, 240, "gate-1-only"),
            Visit("visit-c", "segment-c", 0, 30, "gate-2-only"),
            Visit("visit-d", "segment-d", 180, 210, "gate-2-only")
        ],
        [
            new AirportStand("gate-1", 1m, Set("gate-1-only")),
            new AirportStand("gate-2", 1m, Set("gate-2-only"))
        ],
        []);

    private static AirportVisitDemand Visit(
        string visitId,
        string segmentId,
        int startMinutes,
        int endMinutes,
        string capability) => new(
            visitId,
            segmentId,
            Start.AddMinutes(startMinutes),
            Start.AddMinutes(endMinutes),
            1,
            Set(capability));

    private static SelectedAssignment Assignment(
        string assignmentId,
        string subjectId,
        string standId,
        int startMinutes,
        int endMinutes) => new(
            assignmentId,
            subjectId,
            $"segment-{subjectId}",
            standId,
            TimeWindow.Create(Start.AddMinutes(startMinutes), Start.AddMinutes(endMinutes)));

    private static AirportCompatibilityCapacityInput Input() =>
        AirportCompatibilityCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            Profiles(),
            PeakWindows());

    private static AirportCompatibilityCapacityProfile[] Profiles() =>
    [
        new(
            "gate-1",
            "T1",
            "International",
            60,
            Set("class-narrow", "class-wide")),
        new(
            "gate-2",
            "T3",
            "Domestic",
            60,
            Set("class-narrow"))
    ];

    private static AirportCapacityPeakWindow[] PeakWindows() =>
    [
        new(
            "T1",
            "International",
            TimeWindow.Create(Start.AddHours(1), Start.AddHours(5))),
        new(
            "T3",
            "Domestic",
            TimeWindow.Create(Start.AddHours(1), Start.AddHours(5)))
    ];

    private static ProfileDefinition Profile() => new(
        "airport-compatibility-capacity",
        "1.0.0",
        [
            new ObjectiveTerm(
                BuiltInMetrics.AssignmentCoverage,
                "1.0.0",
                ObjectiveDirection.Maximize,
                100m),
            new ObjectiveTerm(
                BuiltInMetrics.ResourceCost,
                "1.0.0",
                ObjectiveDirection.Minimize,
                1m),
            new ObjectiveTerm(
                AirportMetrics.VirtualCapacitySlots,
                "2.0.0",
                ObjectiveDirection.Maximize,
                0m)
        ],
        new AcceptancePolicy(MaximumUnassignedSubjects: 0),
        new SearchPolicy(DeterministicGreedyStrategy.Id));

    private static RulePackage Rules() => AirportRuleAdapter.Adapt(
        new AirportRuleConfiguration(
            "airport-compatibility-rules",
            "1.0.0"));

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);
}
