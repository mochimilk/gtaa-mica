namespace Planning.Solver.Orchestration;

/// <summary>Transport-neutral request for one frozen optimization run.</summary>
public sealed record OptimizationJobRequest(
    string JobId,
    string IdempotencyKey,
    string RunId,
    string CandidateBatchId,
    ProblemSnapshot Problem,
    RulePackage Rules,
    ProfileDefinition Profile,
    IReadOnlyDictionary<string, bool>? FeatureFlags = null,
    string? ParentPlanFingerprint = null,
    MetricInputSet? MetricInputs = null);

/// <summary>Lifecycle of the worker execution, independent of solver and plan outcomes.</summary>
public enum OptimizationJobState
{
    /// <summary>The request is registered but has not started.</summary>
    Queued,

    /// <summary>A worker is executing the request.</summary>
    Running,

    /// <summary>The worker completed all applicable orchestration stages.</summary>
    Succeeded,

    /// <summary>The worker encountered an explicit execution failure.</summary>
    Failed,

    /// <summary>The worker observed cancellation.</summary>
    Cancelled
}

/// <summary>Disposition of the proposed plan, independent of worker execution.</summary>
public enum PlanDisposition
{
    /// <summary>No complete plan was available for evaluation.</summary>
    NotEvaluated,

    /// <summary>The independently validated and scored plan met acceptance policy.</summary>
    Accepted,

    /// <summary>The plan was evaluated but failed validation or acceptance policy.</summary>
    Rejected,

    /// <summary>The solver did not return a feasible incumbent.</summary>
    NoFeasibleSolution
}

/// <summary>Status of publishing an accepted plan to a downstream adapter.</summary>
public enum ResultPublicationState
{
    /// <summary>No accepted result required publication.</summary>
    NotRequested,

    /// <summary>The accepted result was published.</summary>
    Published,

    /// <summary>Publication was attempted and failed.</summary>
    Failed
}

/// <summary>Explicit terminal execution failure captured by the worker boundary.</summary>
public sealed record OptimizationJobError(
    string Code,
    string Phase,
    string ExceptionType,
    string Message,
    bool IsRetryable);

/// <summary>Optional failure metadata supplied by transport, persistence, or publication adapters.</summary>
public interface IOptimizationFailureMetadata
{
    /// <summary>Stable adapter-specific error code.</summary>
    string ErrorCode { get; }

    /// <summary>Whether the adapter considers the operation safe to retry.</summary>
    bool IsRetryable { get; }
}

/// <summary>Artifacts created during orchestration, including partial failed runs.</summary>
public sealed record OptimizationJobArtifacts(
    CompiledProfile? Profile = null,
    RunManifest? Manifest = null,
    CandidateBatch? Candidates = null,
    OptimizationResult? Optimization = null,
    PlanValidationResult? Validation = null,
    PlanScore? Score = null);

/// <summary>Persistable job state and evidence.</summary>
public sealed record OptimizationJobRecord(
    OptimizationJobRequest Request,
    string RequestFingerprint,
    OptimizationJobState State,
    int ExecutionCount,
    PlanDisposition PlanDisposition,
    ResultPublicationState PublicationState,
    OptimizationJobArtifacts Artifacts,
    OptimizationJobError? Error)
{
    /// <summary>Creates the initial queued record.</summary>
    public static OptimizationJobRecord Queued(OptimizationJobRequest request, string requestFingerprint) => new(
        request,
        requestFingerprint,
        OptimizationJobState.Queued,
        0,
        PlanDisposition.NotEvaluated,
        ResultPublicationState.NotRequested,
        new OptimizationJobArtifacts(),
        null);
}

/// <summary>Result of atomically registering an idempotent request.</summary>
public enum JobRegistrationStatus
{
    /// <summary>The request created a new queued job.</summary>
    Created,

    /// <summary>An identical request already exists.</summary>
    Existing,

    /// <summary>The idempotency key already belongs to different request content.</summary>
    Conflict
}

/// <summary>Atomic idempotency registration response.</summary>
public sealed record JobRegistrationResult(
    JobRegistrationStatus Status,
    OptimizationJobRecord Record);

/// <summary>Atomic persistence contract required by the orchestration coordinator.</summary>
public interface IOptimizationJobStore
{
    /// <summary>Registers a request or returns the record already bound to its idempotency key.</summary>
    ValueTask<JobRegistrationResult> RegisterAsync(
        OptimizationJobRequest request,
        string requestFingerprint,
        CancellationToken cancellationToken);

    /// <summary>Transitions a newly queued job to running exactly once.</summary>
    ValueTask<OptimizationJobRecord> StartAsync(
        string idempotencyKey,
        string requestFingerprint,
        CancellationToken cancellationToken);

    /// <summary>Persists one terminal record over its running predecessor.</summary>
    ValueTask<OptimizationJobRecord> CompleteAsync(
        OptimizationJobRecord terminalRecord,
        CancellationToken cancellationToken);

    /// <summary>Reads a job by idempotency key.</summary>
    ValueTask<OptimizationJobRecord?> GetAsync(
        string idempotencyKey,
        CancellationToken cancellationToken);
}

/// <summary>Publishes only independently accepted results.</summary>
public interface IOptimizationResultPublisher
{
    /// <summary>Publishes an accepted result to a replaceable downstream adapter.</summary>
    ValueTask PublishAsync(
        OptimizationJobRequest request,
        OptimizationJobArtifacts artifacts,
        CancellationToken cancellationToken);
}

/// <summary>Raised when an idempotency key is reused for different request content.</summary>
public sealed class OptimizationJobConflictException(string idempotencyKey)
    : InvalidOperationException($"Idempotency key '{idempotencyKey}' is already bound to a different request.");
