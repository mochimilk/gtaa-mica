using FluentAssertions;

namespace Planning.Solver.Airport.Tests;

public sealed class AirportVirtualCapacityTests
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 16, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Create_EquivalentInputOrder_ProducesSameFingerprint()
    {
        AirportCapacityProfile[] profiles = CapacityProfiles();
        AirportCapacityPeakWindow[] windows = PeakWindows();

        AirportVirtualCapacityInput first = AirportVirtualCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            profiles,
            windows);
        AirportVirtualCapacityInput reordered = AirportVirtualCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            profiles.Reverse(),
            windows.Reverse());

        reordered.Descriptor.ContentFingerprint.Should()
            .Be(first.Descriptor.ContentFingerprint);
    }

    [Fact]
    public void Create_SlotDurationChanges_ChangesFingerprint()
    {
        AirportCapacityProfile[] profiles = CapacityProfiles();
        AirportVirtualCapacityInput original = CapacityInput();
        AirportVirtualCapacityInput changed = AirportVirtualCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            [profiles[0] with { SlotDurationMinutes = 90 }, .. profiles.Skip(1)],
            PeakWindows());

        changed.Descriptor.ContentFingerprint.Should()
            .NotBe(original.Descriptor.ContentFingerprint);
    }

    [Fact]
    public void CalculateDetailed_InternalGaps_AggregatesByTerminalSectorAndPeak()
    {
        MetricCalculationContext context = Context(
            Rules(),
            [
                Assignment("a1", "visit-a", "gate-1", 60, 90),
                Assignment("a2", "visit-b", "gate-1", 210, 240),
                Assignment("a3", "visit-c", "gate-2", 0, 30),
                Assignment("a4", "visit-d", "gate-2", 180, 210)
            ]);

        AirportVirtualCapacityResult result =
            AirportVirtualCapacityCalculator.CalculateDetailed(context);

        result.TotalSlots.Should().Be(4);
        result.Slots.Should().OnlyContain(slot =>
            slot.Window.Start >= Start.AddMinutes(30)
            && slot.Window.End <= Start.AddMinutes(210));
        result.Summaries.Should().BeEquivalentTo(
        [
            new AirportVirtualCapacitySummary("T1", "International", true, 2),
            new AirportVirtualCapacitySummary("T3", "Domestic", true, 1),
            new AirportVirtualCapacitySummary("T3", "Domestic", false, 1)
        ]);
    }

    [Fact]
    public void CalculateDetailed_ConflictingStandOccupied_SuppressesBlockedSlot()
    {
        RulePackage rules = new(
            "airport-capacity-rules",
            "1.0.0",
            [],
            [
                new ResourceConflictRule(
                    [new ResourceConflict("gate-conflict", "gate-1", "gate-2")])
            ]);
        MetricCalculationContext context = Context(
            rules,
            [
                Assignment("a1", "visit-a", "gate-1", 60, 90),
                Assignment("a2", "visit-b", "gate-1", 210, 240),
                Assignment("a3", "visit-c", "gate-2", 105, 135)
            ]);

        AirportVirtualCapacityResult result =
            AirportVirtualCapacityCalculator.CalculateDetailed(context);

        result.TotalSlots.Should().Be(1);
        result.Slots.Should().ContainSingle()
            .Which.Window.Should().Be(
                TimeWindow.Create(Start.AddMinutes(150), Start.AddMinutes(210)));
    }

    [Fact]
    public void CalculateDetailed_MissingStandConfiguration_FailsExplicitly()
    {
        AirportVirtualCapacityInput incomplete = AirportVirtualCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            CapacityProfiles().Take(1),
            PeakWindows().Where(window => window.TerminalId == "T1"));
        MetricCalculationContext context = Context(
            Rules(),
            [
                Assignment("a1", "visit-a", "gate-1", 60, 90),
                Assignment("a2", "visit-b", "gate-2", 180, 210)
            ],
            incomplete);

        Action act = () => AirportVirtualCapacityCalculator.CalculateDetailed(context);

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*stand coverage mismatch*Missing: [gate-2]*");
    }

    [Fact]
    public void Run_AirportCapacityMetric_ProducesTypedLineageAndBreakdowns()
    {
        AirportPlanningSnapshot source = Source();
        ProblemSnapshot problem = AirportProblemAdapter.Adapt(source);
        RulePackage rules = AirportRuleAdapter.Adapt(RuleConfiguration());
        MetricRegistry registry = MetricRegistry.CreateWithBuiltIns(
            [new AirportVirtualCapacityCalculator()]);
        DeterministicGreedyStrategy strategy = AirportFixture.Strategy();
        ProfileDefinition profile = CapacityProfile();
        var pipeline = new SolverPipeline(
            new ProfileCompiler(registry.Definitions, [strategy.Capabilities]),
            strategy,
            registry);
        MetricInputSet inputs = MetricInputSet.Create([CapacityInput()]);

        SolverPipelineResult result = pipeline.Run(
            problem,
            rules,
            profile,
            "capacity-candidates",
            "capacity-run",
            inputs);

        MetricResult metric = result.Score.Metrics.Should().ContainSingle(item =>
            item.MetricId == AirportMetrics.VirtualCapacitySlots).Subject;
        metric.RawValue.Should().Be(4m);
        metric.OptimizationKind.Should().Be(MetricOptimizationKind.ScoringOnly);
        metric.WeightedContribution.Should().Be(0m);
        metric.Inputs.Should().ContainSingle()
            .Which.DatasetId.Should().Be(AirportVirtualCapacityInput.DatasetId);
        metric.Breakdowns.Count(item => item.Dimensions["evidence-kind"] == "slot")
            .Should().Be(4);
        metric.Breakdowns.Should().Contain(item =>
            item.Dimensions["evidence-kind"] == "summary"
            && item.Dimensions["terminal"] == "T1"
            && item.Dimensions["sector"] == "International"
            && item.Dimensions["peak"] == "true"
            && item.Value == 2m);
        result.Manifest.MetricInputFingerprint.Should().Be(inputs.Fingerprint);
    }

    private static MetricCalculationContext Context(
        RulePackage rules,
        IReadOnlyList<SelectedAssignment> assignments,
        AirportVirtualCapacityInput? input = null)
    {
        ProblemSnapshot problem = AirportProblemAdapter.Adapt(Source());
        var optimization = new OptimizationResult(
            DeterministicGreedyStrategy.Id,
            "test",
            "Optimal",
            assignments,
            [],
            new ArtifactLineage("manifest", "input", "artifact"));
        return new MetricCalculationContext(
            problem,
            rules,
            optimization,
            MetricInputSet.Create([input ?? CapacityInput()]));
    }

    private static AirportPlanningSnapshot Source() => new(
        "capacity-airport",
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

    private static AirportVirtualCapacityInput CapacityInput() =>
        AirportVirtualCapacityInput.Create(
            Start.AddDays(-1),
            "fixture",
            CapacityProfiles(),
            PeakWindows());

    private static AirportCapacityProfile[] CapacityProfiles() =>
    [
        new("gate-1", "T1", "International", 60),
        new("gate-2", "T3", "Domestic", 60)
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

    private static ProfileDefinition CapacityProfile() => new(
        "airport-capacity",
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
                "1.0.0",
                ObjectiveDirection.Maximize,
                0m)
        ],
        new AcceptancePolicy(MaximumUnassignedSubjects: 0),
        new SearchPolicy(DeterministicGreedyStrategy.Id));

    private static AirportRuleConfiguration RuleConfiguration() => new(
        "airport-capacity-rules",
        "1.0.0");

    private static RulePackage Rules() => AirportRuleAdapter.Adapt(RuleConfiguration());

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);
}
