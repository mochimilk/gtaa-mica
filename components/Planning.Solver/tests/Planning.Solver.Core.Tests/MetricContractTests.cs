using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using FluentAssertions;

namespace Planning.Solver.Tests;

public sealed class MetricContractTests
{
    [Fact]
    public void Create_DatasetOrderChanges_ProducesSameFingerprint()
    {
        MutableMetricDataset first = new("first", 1m);
        MutableMetricDataset second = new("second", 2m);

        MetricInputSet.Create([first, second]).Fingerprint.Should()
            .Be(MetricInputSet.Create([second, first]).Fingerprint);
    }

    [Fact]
    public void Create_DatasetContentChanges_ProducesDifferentFingerprint()
    {
        MetricInputSet.Create([new MutableMetricDataset("predicted-delay", 1m)])
            .Fingerprint.Should().NotBe(
                MetricInputSet.Create([new MutableMetricDataset("predicted-delay", 2m)]).Fingerprint);
    }

    [Fact]
    public void Create_EmptyInput_ProducesStableFingerprint()
    {
        MetricInputSet.Create([]).Fingerprint.Should().Be(MetricInputSet.Empty.Fingerprint);
    }

    [Fact]
    public void Create_DescriptorFingerprintDoesNotMatchContent_FailsClosed()
    {
        MutableMetricDataset dataset = new("predicted-delay", 12m, new string('0', 64));

        Action act = () => MetricInputSet.Create([dataset]);

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*content fingerprint*");
    }

    [Fact]
    public void Create_DuplicateDatasetIds_FailsExplicitly()
    {
        Action act = () => MetricInputSet.Create(
        [
            new MutableMetricDataset("predicted-delay", 12m),
            new MutableMetricDataset("predicted-delay", 13m)
        ]);

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*declared more than once*");
    }

    [Fact]
    public void VerifyIntegrity_DatasetMutatedAfterFreeze_FailsClosed()
    {
        MutableMetricDataset dataset = new("predicted-delay", 12m);
        MetricInputSet inputs = MetricInputSet.Create([dataset]);

        dataset.Value = 13m;
        Action act = inputs.VerifyIntegrity;

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*changed after it was frozen*");
    }

    [Fact]
    public void Score_RequiredPredictedInputAvailable_RecordsInputLineage()
    {
        MutableMetricDataset dataset = new(PredictedDatasetId, 12m);
        MetricInputSet inputs = MetricInputSet.Create([dataset]);
        SolverPipelineResult result = RunPredictedPipeline(
            SyntheticFixture.Profile(),
            inputs);

        MetricResult metric = result.Score.Metrics.Should().ContainSingle(item =>
            item.MetricId == BuiltInMetrics.AssignmentCoverage).Subject;
        metric.Availability.Should().Be(MetricAvailability.Available);
        metric.ValueKind.Should().Be(MetricValueKind.Predicted);
        metric.OptimizationKind.Should().Be(MetricOptimizationKind.Proxy);
        metric.RawValue.Should().Be(12m);
        metric.Inputs.Should().ContainSingle()
            .Which.Should().Be(dataset.Descriptor);
    }

    [Fact]
    public void Score_RequiredInputMissingWithFailPolicy_Throws()
    {
        Action act = () => RunPredictedPipeline(
            SyntheticFixture.Profile(),
            MetricInputSet.Empty);

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*required but was not supplied*");
    }

    [Fact]
    public void Score_RequiredInputMissingWithRejectPolicy_MarksUnavailableAndRejects()
    {
        ProfileDefinition definition = SyntheticFixture.Profile() with
        {
            MissingMetricInputs = MissingMetricInputPolicy.MarkUnavailableAndReject
        };
        SolverPipelineResult result = RunPredictedPipeline(
            definition,
            MetricInputSet.Empty);

        result.Score.Accepted.Should().BeFalse();
        result.Score.Metrics.Should().ContainSingle(item =>
            item.MetricId == BuiltInMetrics.AssignmentCoverage
            && item.Availability == MetricAvailability.Unavailable);
        result.Score.RejectionReasons.Should().Contain(reason =>
            reason.Contains("unavailable", StringComparison.Ordinal));
    }

    [Fact]
    public void Score_WrongDatasetVersionWithRejectPolicy_MarksUnavailable()
    {
        MutableMetricDataset dataset = new(PredictedDatasetId, 12m, version: "2.0.0");
        MetricInputSet inputs = MetricInputSet.Create([dataset]);
        ProfileDefinition definition = SyntheticFixture.Profile() with
        {
            MissingMetricInputs = MissingMetricInputPolicy.MarkUnavailableAndReject
        };
        SolverPipelineResult result = RunPredictedPipeline(definition, inputs);

        result.Score.Metrics.Should().ContainSingle(item =>
            item.MetricId == BuiltInMetrics.AssignmentCoverage
            && item.Availability == MetricAvailability.Unavailable
            && item.UnavailableReason!.Contains("version", StringComparison.Ordinal));
    }

    [Fact]
    public void Score_WrongDatasetKindWithRejectPolicy_MarksUnavailable()
    {
        MutableMetricDataset dataset = new(
            PredictedDatasetId,
            12m,
            valueKind: MetricValueKind.Observed);
        MetricInputSet inputs = MetricInputSet.Create([dataset]);
        ProfileDefinition definition = SyntheticFixture.Profile() with
        {
            MissingMetricInputs = MissingMetricInputPolicy.MarkUnavailableAndReject
        };

        SolverPipelineResult result = RunPredictedPipeline(definition, inputs);

        result.Score.Metrics.Should().ContainSingle(item =>
            item.MetricId == BuiltInMetrics.AssignmentCoverage
            && item.Availability == MetricAvailability.Unavailable
            && item.UnavailableReason!.Contains("value kind", StringComparison.Ordinal));
    }

    [Fact]
    public void CreateManifest_MetricInputsChange_ProducesDifferentFingerprint()
    {
        ProblemSnapshot problem = SyntheticFixture.Problem();
        RulePackage rules = SyntheticFixture.Rules();
        CompiledProfile profile = SyntheticFixture.CompiledProfile();
        DeterministicGreedyStrategy strategy = SyntheticFixture.Strategy();
        MetricInputSet firstInputs = MetricInputSet.Create(
            [new MutableMetricDataset(PredictedDatasetId, 1m)]);
        MetricInputSet secondInputs = MetricInputSet.Create(
            [new MutableMetricDataset(PredictedDatasetId, 2m)]);

        RunManifest first = RunManifestFactory.Create(
            "metric-run",
            problem,
            profile,
            rules,
            strategy,
            metricInputs: firstInputs);
        RunManifest second = RunManifestFactory.Create(
            "metric-run",
            problem,
            profile,
            rules,
            strategy,
            metricInputs: secondInputs);

        second.MetricInputFingerprint.Should().NotBe(first.MetricInputFingerprint);
        second.Fingerprint.Should().NotBe(first.Fingerprint);
    }

    private const string PredictedDatasetId = "predicted-delay";

    private static SolverPipelineResult RunPredictedPipeline(
        ProfileDefinition profile,
        MetricInputSet inputs)
    {
        MetricRegistry registry = PredictedRegistry();
        var pipeline = new SolverPipeline(
            new ProfileCompiler(registry.Definitions, [SyntheticFixture.Strategy().Capabilities]),
            SyntheticFixture.Strategy(),
            registry);
        return pipeline.Run(
            SyntheticFixture.Problem(),
            SyntheticFixture.Rules(),
            profile,
            "candidate-batch-v1",
            "synthetic-run-v1",
            inputs);
    }

    private static MetricRegistry PredictedRegistry() => new(
    [
        new PredictedMetricCalculator(),
        new ResourceCostMetricCalculator()
    ]);

    private sealed class PredictedMetricCalculator : IMetricCalculator
    {
        public MetricDefinition Definition { get; } = new(
            BuiltInMetrics.AssignmentCoverage,
            "1.0.0",
            "predicted-minutes",
            ObjectiveDirection.Maximize,
            MetricValueKind.Predicted,
            MetricOptimizationKind.Proxy,
            [new MetricInputRequirement(PredictedDatasetId, "1.0.0", MetricValueKind.Predicted)]);

        public MetricCalculation Calculate(MetricCalculationContext context) =>
            context.Inputs.TryGet(PredictedDatasetId, out IMetricInputDataset? dataset)
                ? new MetricCalculation(((MutableMetricDataset)dataset!).Value, [])
                : throw new InvalidOperationException("Required input was not verified.");
    }

    private sealed class ResourceCostMetricCalculator : IMetricCalculator
    {
        public MetricDefinition Definition { get; } = BuiltInMetrics.Definitions.Single(
            definition => definition.MetricId == BuiltInMetrics.ResourceCost);

        public MetricCalculation Calculate(MetricCalculationContext context)
        {
            var resources = context.Problem.Resources.ToDictionary(
                resource => resource.ResourceId,
                StringComparer.Ordinal);
            decimal value = context.Optimization.Assignments.Sum(
                assignment => resources[assignment.ResourceId].Cost);
            return new MetricCalculation(value, []);
        }
    }

    private sealed class MutableMetricDataset : IMetricInputDataset
    {
        public MutableMetricDataset(
            string datasetId,
            decimal value,
            string? contentFingerprint = null,
            string version = "1.0.0",
            MetricValueKind valueKind = MetricValueKind.Predicted)
        {
            Value = value;
            Descriptor = new MetricInputDescriptor(
                datasetId,
                version,
                valueKind,
                new DateTimeOffset(2027, 1, 14, 17, 0, 0, TimeSpan.Zero),
                "synthetic-test",
                contentFingerprint ?? Fingerprint(value));
        }

        public MetricInputDescriptor Descriptor { get; }

        public decimal Value { get; set; }

        public string CalculateContentFingerprint() => Fingerprint(Value);

        private static string Fingerprint(decimal value)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(value.ToString(CultureInfo.InvariantCulture));
            return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        }
    }
}
