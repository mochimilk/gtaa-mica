namespace Planning.Solver.Orchestration;

/// <summary>Coordinates one idempotent optimization job across pure solver stages.</summary>
public sealed class OptimizationJobCoordinator(
    OptimizationStrategyRegistry strategyRegistry,
    IOptimizationJobStore jobStore,
    IOptimizationResultPublisher resultPublisher,
    MetricRegistry? metricRegistry = null)
{
    private readonly MetricRegistry _metricRegistry = metricRegistry ?? MetricRegistry.BuiltIn;

    /// <summary>Executes a new request or returns the record for an identical prior request.</summary>
    public async ValueTask<OptimizationJobRecord> ExecuteAsync(
        OptimizationJobRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        string requestFingerprint = OptimizationJobFingerprints.Request(request);
        JobRegistrationResult registration = await jobStore.RegisterAsync(
            request,
            requestFingerprint,
            cancellationToken).ConfigureAwait(false);
        if (registration.Status == JobRegistrationStatus.Conflict)
        {
            throw new OptimizationJobConflictException(request.IdempotencyKey);
        }

        if (registration.Status == JobRegistrationStatus.Existing)
        {
            return registration.Record;
        }

        OptimizationJobRecord running = await jobStore.StartAsync(
            request.IdempotencyKey,
            requestFingerprint,
            CancellationToken.None).ConfigureAwait(false);
        OptimizationJobRecord terminal = await ExecuteStagesAsync(
            running,
            cancellationToken).ConfigureAwait(false);
        return await jobStore.CompleteAsync(terminal, CancellationToken.None).ConfigureAwait(false);
    }

    private async ValueTask<OptimizationJobRecord> ExecuteStagesAsync(
        OptimizationJobRecord running,
        CancellationToken cancellationToken)
    {
        OptimizationJobRequest request = running.Request;
        MetricInputSet metricInputs = request.MetricInputs ?? MetricInputSet.Empty;
        var artifacts = new OptimizationJobArtifacts();
        string phase = "strategy-resolution";
        PlanDisposition disposition = PlanDisposition.NotEvaluated;
        ResultPublicationState publicationState = ResultPublicationState.NotRequested;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            IOptimizationStrategy strategy = strategyRegistry.Resolve(request.Profile.Search.StrategyId);

            phase = "profile-compilation";
            var compiler = new ProfileCompiler(
                _metricRegistry.Definitions,
                strategyRegistry.All.Select(item => item.Capabilities));
            CompiledProfile profile = compiler.Compile(request.Profile, request.Rules);
            artifacts = artifacts with { Profile = profile };

            phase = "manifest";
            RunManifest manifest = RunManifestFactory.Create(
                request.RunId,
                request.Problem,
                profile,
                request.Rules,
                strategy,
                request.FeatureFlags,
                request.ParentPlanFingerprint,
                metricInputs);
            RunManifestFactory.VerifyInputs(
                manifest,
                request.Problem,
                profile,
                request.Rules,
                strategy,
                metricInputs);
            artifacts = artifacts with { Manifest = manifest };

            phase = "candidate-generation";
            CandidateBatch candidates = CandidateGenerator.Generate(
                manifest,
                request.Problem,
                request.Rules,
                request.CandidateBatchId);
            artifacts = artifacts with { Candidates = candidates };

            phase = "optimization";
            OptimizationResult optimization = strategy.Solve(
                manifest,
                request.Problem,
                request.Rules,
                candidates,
                profile,
                cancellationToken);
            artifacts = artifacts with { Optimization = optimization };
            if (!HasFeasiblePlan(optimization.Status))
            {
                return running with
                {
                    State = OptimizationJobState.Succeeded,
                    PlanDisposition = PlanDisposition.NoFeasibleSolution,
                    Artifacts = artifacts
                };
            }

            phase = "validation";
            PlanValidationResult validation = CompletePlanValidator.Validate(
                manifest,
                request.Problem,
                request.Rules,
                candidates,
                optimization);
            artifacts = artifacts with { Validation = validation };

            phase = "scoring";
            PlanScore score = PlanScorer.Score(
                manifest,
                request.Problem,
                request.Rules,
                optimization,
                validation,
                profile,
                metricInputs,
                _metricRegistry);
            artifacts = artifacts with { Score = score };
            disposition = validation.Passed && score.Accepted
                ? PlanDisposition.Accepted
                : PlanDisposition.Rejected;
            if (disposition == PlanDisposition.Accepted)
            {
                phase = "publication";
                await resultPublisher.PublishAsync(request, artifacts, cancellationToken).ConfigureAwait(false);
                publicationState = ResultPublicationState.Published;
            }

            return running with
            {
                State = OptimizationJobState.Succeeded,
                PlanDisposition = disposition,
                PublicationState = publicationState,
                Artifacts = artifacts
            };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return running with
            {
                State = OptimizationJobState.Cancelled,
                PlanDisposition = disposition,
                PublicationState = publicationState,
                Artifacts = artifacts,
                Error = new OptimizationJobError(
                    "JOB_CANCELLED",
                    phase,
                    typeof(OperationCanceledException).FullName!,
                    "Optimization job execution was cancelled.",
                    IsRetryable: false)
            };
        }
        catch (Exception exception)
        {
            IOptimizationFailureMetadata? metadata = exception as IOptimizationFailureMetadata;
            return running with
            {
                State = OptimizationJobState.Failed,
                PlanDisposition = disposition,
                PublicationState = phase == "publication"
                    ? ResultPublicationState.Failed
                    : publicationState,
                Artifacts = artifacts,
                Error = new OptimizationJobError(
                    metadata?.ErrorCode ?? "JOB_EXECUTION_FAILED",
                    phase,
                    exception.GetType().FullName ?? exception.GetType().Name,
                    exception.Message,
                    metadata?.IsRetryable ?? false)
            };
        }
    }

    private static bool HasFeasiblePlan(string solverStatus) =>
        string.Equals(solverStatus, "Optimal", StringComparison.Ordinal)
        || string.Equals(solverStatus, "Feasible", StringComparison.Ordinal);
}
