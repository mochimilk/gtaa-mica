using Planning.Assistant;

namespace Planning.Application.Http;

/// <summary>Transport representation of assistant client capabilities.</summary>
public sealed record AssistantClientCapabilitiesHttpRequest(
    bool SupportsStreaming,
    IReadOnlyList<string> SupportedOutputPartTypes);

/// <summary>Structured assistant request received through HTTP.</summary>
public sealed record AssistantHttpRequest(
    string RequestId,
    string CorrelationId,
    string Message,
    string? ConversationToken,
    IReadOnlyList<AssistantContextReference> Context,
    AssistantClientCapabilitiesHttpRequest ClientCapabilities,
    string? Locale = null,
    string? TimeZone = null)
{
    /// <summary>Maps the transport shape into provider-neutral assistant contracts.</summary>
    public AssistantRequest ToCore() => new(
        RequestId,
        CorrelationId,
        Message,
        ConversationToken,
        Context,
        new AssistantClientCapabilities(
            ClientCapabilities.SupportsStreaming,
            ClientCapabilities.SupportedOutputPartTypes.ToHashSet(StringComparer.Ordinal)),
        Locale,
        TimeZone);
}

/// <summary>Creates a draft from one immutable source plan.</summary>
public sealed record CreateDraftHttpRequest(
    string SourcePlanId,
    string Purpose,
    string IdempotencyKey);

/// <summary>One assignment replacement received through HTTP.</summary>
public sealed record ReassignItemHttpRequest(
    string ItemId,
    string NewResourceId,
    DateTimeOffset NewStartUtc,
    DateTimeOffset NewEndUtc)
{
    /// <summary>Maps the transport shape into the application contract.</summary>
    public ReassignItemChange ToApplicationChange() =>
        new(ItemId, NewResourceId, NewStartUtc, NewEndUtc);
}

/// <summary>Previews a batch against one expected draft version.</summary>
public sealed record PreviewChangesHttpRequest(
    int ExpectedVersion,
    IReadOnlyList<ReassignItemHttpRequest> Changes);

/// <summary>Commits a batch against one expected draft version.</summary>
public sealed record CommitChangesHttpRequest(
    int ExpectedVersion,
    IReadOnlyList<ReassignItemHttpRequest> Changes,
    string IdempotencyKey);

/// <summary>Submits one exact draft version for review.</summary>
public sealed record SubmitReviewHttpRequest(
    int ExpectedVersion,
    string Justification,
    string IdempotencyKey);

/// <summary>Records an authorized human review decision.</summary>
public sealed record DecideReviewHttpRequest(
    ReviewStatus Decision,
    string Note,
    string IdempotencyKey);

/// <summary>Publishes one exact approved revision.</summary>
public sealed record PublishReviewHttpRequest(string IdempotencyKey);

/// <summary>Structured assistant response suitable for polymorphic JSON output.</summary>
public sealed record AssistantHttpResponse(
    string RequestId,
    string ConversationToken,
    string Answer,
    IReadOnlyList<object> OutputParts,
    IReadOnlyList<AssistantContextReference> EvidenceReferences)
{
    /// <summary>Maps a core response without parsing prose.</summary>
    public static AssistantHttpResponse FromCore(AssistantResponse response) => new(
        response.RequestId,
        response.ConversationToken,
        response.Answer,
        response.OutputParts.Cast<object>().ToArray(),
        response.EvidenceReferences);
}

/// <summary>HTTP serialization shape for one normalized stream event.</summary>
public sealed record AssistantHttpStreamEvent(
    int ProtocolVersion,
    string RequestId,
    long Sequence,
    AssistantStreamEventType Type,
    DateTimeOffset Timestamp,
    string? ActivityId,
    string? ActivityName,
    string? Text,
    object? OutputPart,
    AssistantHttpResponse? Response,
    AssistantFailure? Failure)
{
    /// <summary>Maps a core event without provider-specific fields.</summary>
    public static AssistantHttpStreamEvent FromCore(AssistantStreamEvent item) => new(
        item.ProtocolVersion,
        item.RequestId,
        item.Sequence,
        item.Type,
        item.Timestamp,
        item.ActivityId,
        item.ActivityName,
        item.Text,
        item.OutputPart,
        item.Response is null ? null : AssistantHttpResponse.FromCore(item.Response),
        item.Failure);
}
