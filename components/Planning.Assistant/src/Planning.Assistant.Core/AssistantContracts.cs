using System.Runtime.CompilerServices;

namespace Planning.Assistant;

/// <summary>Role one immutable resource has in an assistant request.</summary>
public enum AssistantContextRole
{
    /// <summary>Primary resource against which actions or answers are evaluated.</summary>
    Active,

    /// <summary>Read-only resource used as a baseline or comparison.</summary>
    Reference,

    /// <summary>Proposed resource being assessed.</summary>
    Candidate,

    /// <summary>Specific resource the user has selected.</summary>
    Focus
}

/// <summary>Structured reference to an application resource.</summary>
public sealed record AssistantContextReference(
    string ResourceKind,
    string ResourceId,
    AssistantContextRole Role,
    string? ExpectedVersion = null);

/// <summary>Capabilities declared by the chat client.</summary>
public sealed record AssistantClientCapabilities(
    bool SupportsStreaming,
    IReadOnlySet<string> SupportedOutputPartTypes);

/// <summary>Provider-neutral assistant request.</summary>
public sealed record AssistantRequest(
    string RequestId,
    string CorrelationId,
    string Message,
    string? ConversationToken,
    IReadOnlyList<AssistantContextReference> Context,
    AssistantClientCapabilities ClientCapabilities,
    string? Locale = null,
    string? TimeZone = null);

/// <summary>Severity of an assistant notice.</summary>
public enum AssistantNoticeSeverity
{
    /// <summary>Informational evidence or guidance.</summary>
    Information,

    /// <summary>Incomplete evidence or a condition requiring attention.</summary>
    Warning,

    /// <summary>An operation cannot safely proceed.</summary>
    Blocking
}

/// <summary>Versioned structured part returned alongside assistant prose.</summary>
public abstract record AssistantOutputPart(string Type, string SchemaVersion);

/// <summary>Structured informational or blocking notice.</summary>
public sealed record AssistantNoticePart(
    string SchemaVersion,
    AssistantNoticeSeverity Severity,
    string Title,
    string Detail) : AssistantOutputPart("notice", SchemaVersion);

/// <summary>Reference that lets a client open an existing application resource.</summary>
public sealed record AssistantResourceReferencePart(
    string SchemaVersion,
    string ResourceKind,
    string ResourceId,
    string Label,
    bool Primary = false) : AssistantOutputPart("resource-reference", SchemaVersion);

/// <summary>Typed proposal for an application command that has not been executed.</summary>
public sealed record AssistantActionProposalPart(
    string SchemaVersion,
    string CommandType,
    string CommandSchemaVersion,
    string CommandPayloadJson,
    string Label,
    bool RequiresHumanConfirmation = true) : AssistantOutputPart("action-proposal", SchemaVersion);

/// <summary>Completed provider-neutral assistant response.</summary>
public sealed record AssistantResponse(
    string RequestId,
    string ConversationToken,
    string Answer,
    IReadOnlyList<AssistantOutputPart> OutputParts,
    IReadOnlyList<AssistantContextReference> EvidenceReferences);

/// <summary>Normalized streaming event type.</summary>
public enum AssistantStreamEventType
{
    /// <summary>Request processing began.</summary>
    ResponseStarted,

    /// <summary>A tool or specialist activity began.</summary>
    ActivityStarted,

    /// <summary>A tool or specialist activity completed.</summary>
    ActivityCompleted,

    /// <summary>Incremental answer text is available.</summary>
    TextDelta,

    /// <summary>One structured output part is complete.</summary>
    OutputPartCompleted,

    /// <summary>The request completed successfully.</summary>
    ResponseCompleted,

    /// <summary>The request failed with no successful completion.</summary>
    ResponseFailed
}

/// <summary>Provider-neutral failure evidence.</summary>
public sealed record AssistantFailure(
    string ErrorCode,
    string Detail,
    bool Retryable);

/// <summary>One ordered event in the assistant streaming protocol.</summary>
public sealed record AssistantStreamEvent(
    int ProtocolVersion,
    string RequestId,
    long Sequence,
    AssistantStreamEventType Type,
    DateTimeOffset Timestamp,
    string? ActivityId = null,
    string? ActivityName = null,
    string? Text = null,
    AssistantOutputPart? OutputPart = null,
    AssistantResponse? Response = null,
    AssistantFailure? Failure = null);

/// <summary>Provider-neutral assistant execution boundary.</summary>
public interface IAssistantRuntime
{
    /// <summary>Returns one complete response or fails explicitly.</summary>
    Task<AssistantResponse> CompleteAsync(
        AssistantRequest request,
        CancellationToken cancellationToken);

    /// <summary>Streams ordered events ending in exactly one terminal event.</summary>
    IAsyncEnumerable<AssistantStreamEvent> StreamAsync(
        AssistantRequest request,
        CancellationToken cancellationToken);
}

/// <summary>One deterministic tool or specialist activity in a scripted response.</summary>
public sealed record ScriptedAssistantActivity(
    string ActivityId,
    string ActivityName);

/// <summary>One deterministic response used by local tests and development.</summary>
public sealed record ScriptedAssistantResponse(
    string Message,
    string ConversationToken,
    string Answer,
    IReadOnlyList<ScriptedAssistantActivity> Activities,
    IReadOnlyList<AssistantOutputPart> OutputParts,
    IReadOnlyList<AssistantContextReference> EvidenceReferences);

/// <summary>Cloud-free deterministic assistant runtime for contract validation.</summary>
public sealed class ScriptedAssistantRuntime : IAssistantRuntime
{
    /// <summary>Current provider-neutral stream protocol version.</summary>
    public const int ProtocolVersion = 1;

    private readonly Dictionary<string, ScriptedAssistantResponse> _scripts;
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates a runtime keyed by exact request message.</summary>
    public ScriptedAssistantRuntime(
        IEnumerable<ScriptedAssistantResponse> scripts,
        TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(scripts);
        _scripts = scripts.ToDictionary(script => script.Message, StringComparer.Ordinal);
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    /// <inheritdoc />
    public Task<AssistantResponse> CompleteAsync(
        AssistantRequest request,
        CancellationToken cancellationToken)
    {
        ValidateRequest(request);
        cancellationToken.ThrowIfCancellationRequested();
        ScriptedAssistantResponse script = Resolve(request.Message);
        return Task.FromResult(ToResponse(request.RequestId, script));
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<AssistantStreamEvent> StreamAsync(
        AssistantRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        ValidateRequest(request);
        long sequence = 0;
        yield return Event(request.RequestId, sequence++, AssistantStreamEventType.ResponseStarted);

        if (!_scripts.TryGetValue(request.Message, out ScriptedAssistantResponse? script))
        {
            yield return Event(
                request.RequestId,
                sequence,
                AssistantStreamEventType.ResponseFailed,
                failure: new AssistantFailure(
                    "SCRIPT_NOT_FOUND",
                    "No deterministic response is configured for this message.",
                    false));
            yield break;
        }

        foreach (ScriptedAssistantActivity activity in script.Activities)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return Event(
                request.RequestId,
                sequence++,
                AssistantStreamEventType.ActivityStarted,
                activity.ActivityId,
                activity.ActivityName);
            await Task.Yield();
            cancellationToken.ThrowIfCancellationRequested();
            yield return Event(
                request.RequestId,
                sequence++,
                AssistantStreamEventType.ActivityCompleted,
                activity.ActivityId,
                activity.ActivityName);
        }

        if (script.Answer.Length > 0)
        {
            yield return Event(
                request.RequestId,
                sequence++,
                AssistantStreamEventType.TextDelta,
                text: script.Answer);
        }

        foreach (AssistantOutputPart outputPart in script.OutputParts)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return Event(
                request.RequestId,
                sequence++,
                AssistantStreamEventType.OutputPartCompleted,
                outputPart: outputPart);
        }

        yield return Event(
            request.RequestId,
            sequence,
            AssistantStreamEventType.ResponseCompleted,
            response: ToResponse(request.RequestId, script));
    }

    private ScriptedAssistantResponse Resolve(string message)
    {
        if (!_scripts.TryGetValue(message, out ScriptedAssistantResponse? script))
        {
            throw new InvalidOperationException(
                "No deterministic response is configured for this message.");
        }

        return script;
    }

    private AssistantStreamEvent Event(
        string requestId,
        long sequence,
        AssistantStreamEventType type,
        string? activityId = null,
        string? activityName = null,
        string? text = null,
        AssistantOutputPart? outputPart = null,
        AssistantResponse? response = null,
        AssistantFailure? failure = null) => new(
            ProtocolVersion,
            requestId,
            sequence,
            type,
            _timeProvider.GetUtcNow(),
            activityId,
            activityName,
            text,
            outputPart,
            response,
            failure);

    private static AssistantResponse ToResponse(
        string requestId,
        ScriptedAssistantResponse script) => new(
            requestId,
            script.ConversationToken,
            script.Answer,
            script.OutputParts,
            script.EvidenceReferences);

    private static void ValidateRequest(AssistantRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.RequestId);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.CorrelationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.Message);
        ArgumentNullException.ThrowIfNull(request.Context);
        ArgumentNullException.ThrowIfNull(request.ClientCapabilities);
        ArgumentNullException.ThrowIfNull(request.ClientCapabilities.SupportedOutputPartTypes);
        foreach (AssistantContextReference reference in request.Context)
        {
            ArgumentNullException.ThrowIfNull(reference);
            ArgumentException.ThrowIfNullOrWhiteSpace(reference.ResourceKind);
            ArgumentException.ThrowIfNullOrWhiteSpace(reference.ResourceId);
        }
    }
}
