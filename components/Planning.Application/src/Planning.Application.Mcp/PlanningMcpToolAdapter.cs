using System.Text.Json;

namespace Planning.Application.Mcp;

/// <summary>Thin schema-versioned tools that delegate to planning HTTP operations.</summary>
public sealed class PlanningMcpToolAdapter : IPlanningMcpToolAdapter
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly PlanningApplicationHttpClient _client;

    /// <summary>Creates an HTTP-backed MCP tool adapter.</summary>
    public PlanningMcpToolAdapter(
        HttpClient httpClient,
        PlanningMcpHttpOptions options)
    {
        _client = new PlanningApplicationHttpClient(httpClient, options);
        Tools =
        [
            Definition(
                "get_plan",
                "Get one immutable plan or draft by ID.",
                McpToolAuthority.Read,
                """{"type":"object","properties":{"planId":{"type":"string"}},"required":["planId"],"additionalProperties":false}"""),
            Definition(
                "create_draft",
                "Create a versioned draft from one immutable source plan.",
                McpToolAuthority.DraftWrite,
                """{"type":"object","properties":{"sourcePlanId":{"type":"string"},"purpose":{"type":"string"},"idempotencyKey":{"type":"string"}},"required":["sourcePlanId","purpose","idempotencyKey"],"additionalProperties":false}""",
                requiresIdempotencyKey: true),
            Definition(
                "preview_changes",
                "Preview typed assignment changes without mutating the draft.",
                McpToolAuthority.DraftWrite,
                ChangeBatchSchema(includeIdempotencyKey: false)),
            Definition(
                "commit_changes",
                "Commit a validated batch against one expected draft version.",
                McpToolAuthority.DraftWrite,
                ChangeBatchSchema(includeIdempotencyKey: true),
                requiresIdempotencyKey: true,
                requiresHumanConfirmation: true),
            Definition(
                "submit_for_review",
                "Submit one exact draft version for authorized human review.",
                McpToolAuthority.ReviewSubmit,
                """{"type":"object","properties":{"draftId":{"type":"string"},"expectedVersion":{"type":"integer","minimum":1},"justification":{"type":"string"},"idempotencyKey":{"type":"string"}},"required":["draftId","expectedVersion","justification","idempotencyKey"],"additionalProperties":false}""",
                requiresIdempotencyKey: true,
                requiresHumanConfirmation: true),
            Definition(
                "get_review_status",
                "Get one review request and its current status.",
                McpToolAuthority.Read,
                """{"type":"object","properties":{"reviewRequestId":{"type":"string"}},"required":["reviewRequestId"],"additionalProperties":false}""")
        ];
    }

    /// <inheritdoc />
    public IReadOnlyList<McpToolDefinition> Tools { get; }

    /// <inheritdoc />
    public async Task<McpToolResult> InvokeAsync(
        string toolId,
        JsonElement input,
        string correlationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(toolId);
        ArgumentException.ThrowIfNullOrWhiteSpace(correlationId);
        try
        {
            return toolId switch
            {
                "get_plan" => await GetPlanAsync(input, correlationId, cancellationToken)
                    .ConfigureAwait(false),
                "create_draft" => await CreateDraftAsync(input, correlationId, cancellationToken)
                    .ConfigureAwait(false),
                "preview_changes" => await PreviewChangesAsync(input, correlationId, cancellationToken)
                    .ConfigureAwait(false),
                "commit_changes" => await CommitChangesAsync(input, correlationId, cancellationToken)
                    .ConfigureAwait(false),
                "submit_for_review" => await SubmitForReviewAsync(input, correlationId, cancellationToken)
                    .ConfigureAwait(false),
                "get_review_status" => await GetReviewStatusAsync(input, correlationId, cancellationToken)
                    .ConfigureAwait(false),
                _ => new McpToolResult(
                    McpToolResultStatus.Rejected,
                    correlationId,
                    ErrorCode: "UNKNOWN_TOOL",
                    Detail: $"Tool '{toolId}' is not registered.")
            };
        }
        catch (JsonException exception)
        {
            return InvalidInput(correlationId, exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return InvalidInput(correlationId, exception.Message);
        }
    }

    private Task<McpToolResult> GetPlanAsync(
        JsonElement input,
        string correlationId,
        CancellationToken cancellationToken)
    {
        GetPlanInput value = Deserialize<GetPlanInput>(input);
        Require(value.PlanId, "planId");
        return _client.SendAsync(
            HttpMethod.Get,
            $"/api/v1/plans/{Uri.EscapeDataString(value.PlanId)}",
            null,
            correlationId,
            cancellationToken);
    }

    private Task<McpToolResult> CreateDraftAsync(
        JsonElement input,
        string correlationId,
        CancellationToken cancellationToken)
    {
        CreateDraftInput value = Deserialize<CreateDraftInput>(input);
        Require(value.SourcePlanId, "sourcePlanId");
        Require(value.Purpose, "purpose");
        Require(value.IdempotencyKey, "idempotencyKey");
        return _client.SendAsync(
            HttpMethod.Post,
            "/api/v1/drafts",
            value,
            correlationId,
            cancellationToken);
    }

    private Task<McpToolResult> PreviewChangesAsync(
        JsonElement input,
        string correlationId,
        CancellationToken cancellationToken)
    {
        ChangeBatchInput value = Deserialize<ChangeBatchInput>(input);
        ValidateChangeBatch(value, requireIdempotencyKey: false);
        return _client.SendAsync(
            HttpMethod.Post,
            $"/api/v1/drafts/{Uri.EscapeDataString(value.DraftId)}/preview",
            new
            {
                value.ExpectedVersion,
                value.Changes
            },
            correlationId,
            cancellationToken);
    }

    private Task<McpToolResult> CommitChangesAsync(
        JsonElement input,
        string correlationId,
        CancellationToken cancellationToken)
    {
        ChangeBatchInput value = Deserialize<ChangeBatchInput>(input);
        ValidateChangeBatch(value, requireIdempotencyKey: true);
        return _client.SendAsync(
            HttpMethod.Post,
            $"/api/v1/drafts/{Uri.EscapeDataString(value.DraftId)}/changes",
            value,
            correlationId,
            cancellationToken);
    }

    private Task<McpToolResult> SubmitForReviewAsync(
        JsonElement input,
        string correlationId,
        CancellationToken cancellationToken)
    {
        SubmitReviewInput value = Deserialize<SubmitReviewInput>(input);
        Require(value.DraftId, "draftId");
        Require(value.Justification, "justification");
        Require(value.IdempotencyKey, "idempotencyKey");
        if (value.ExpectedVersion <= 0)
        {
            throw new InvalidOperationException("expectedVersion must be positive.");
        }

        return _client.SendAsync(
            HttpMethod.Post,
            $"/api/v1/drafts/{Uri.EscapeDataString(value.DraftId)}/reviews",
            new
            {
                value.ExpectedVersion,
                value.Justification,
                value.IdempotencyKey
            },
            correlationId,
            cancellationToken);
    }

    private Task<McpToolResult> GetReviewStatusAsync(
        JsonElement input,
        string correlationId,
        CancellationToken cancellationToken)
    {
        GetReviewInput value = Deserialize<GetReviewInput>(input);
        Require(value.ReviewRequestId, "reviewRequestId");
        return _client.SendAsync(
            HttpMethod.Get,
            $"/api/v1/reviews/{Uri.EscapeDataString(value.ReviewRequestId)}",
            null,
            correlationId,
            cancellationToken);
    }

    private static T Deserialize<T>(JsonElement input)
    {
        if (input.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("Tool input must be a JSON object.");
        }

        return input.Deserialize<T>(JsonOptions)
            ?? throw new InvalidOperationException("Tool input could not be read.");
    }

    private static void ValidateChangeBatch(
        ChangeBatchInput value,
        bool requireIdempotencyKey)
    {
        Require(value.DraftId, "draftId");
        if (value.ExpectedVersion <= 0)
        {
            throw new InvalidOperationException("expectedVersion must be positive.");
        }

        if (value.Changes is null || value.Changes.Count == 0)
        {
            throw new InvalidOperationException("changes must contain at least one item.");
        }

        foreach (ChangeInput change in value.Changes)
        {
            Require(change.ItemId, "changes[].itemId");
            Require(change.NewResourceId, "changes[].newResourceId");
            if (change.NewEndUtc <= change.NewStartUtc)
            {
                throw new InvalidOperationException(
                    "changes[].newEndUtc must be later than changes[].newStartUtc.");
            }
        }

        if (requireIdempotencyKey)
        {
            Require(value.IdempotencyKey, "idempotencyKey");
        }
    }

    private static void Require(string? value, string propertyName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"{propertyName} is required.");
        }
    }

    private static McpToolResult InvalidInput(string correlationId, string detail) => new(
        McpToolResultStatus.Rejected,
        correlationId,
        ErrorCode: "INVALID_TOOL_INPUT",
        Detail: detail);

    private static McpToolDefinition Definition(
        string toolId,
        string description,
        McpToolAuthority authority,
        string inputSchema,
        bool requiresIdempotencyKey = false,
        bool requiresHumanConfirmation = false)
    {
        using JsonDocument document = JsonDocument.Parse(inputSchema);
        return new McpToolDefinition(
            toolId,
            "1.0.0",
            description,
            authority,
            document.RootElement.Clone(),
            requiresIdempotencyKey,
            requiresHumanConfirmation);
    }

    private static string ChangeBatchSchema(bool includeIdempotencyKey) =>
        includeIdempotencyKey
            ? """
              {"type":"object","properties":{"draftId":{"type":"string"},"expectedVersion":{"type":"integer","minimum":1},"changes":{"type":"array","minItems":1,"items":{"type":"object","properties":{"itemId":{"type":"string"},"newResourceId":{"type":"string"},"newStartUtc":{"type":"string","format":"date-time"},"newEndUtc":{"type":"string","format":"date-time"}},"required":["itemId","newResourceId","newStartUtc","newEndUtc"],"additionalProperties":false}},"idempotencyKey":{"type":"string"}},"required":["draftId","expectedVersion","changes","idempotencyKey"],"additionalProperties":false}
              """
            : """
              {"type":"object","properties":{"draftId":{"type":"string"},"expectedVersion":{"type":"integer","minimum":1},"changes":{"type":"array","minItems":1,"items":{"type":"object","properties":{"itemId":{"type":"string"},"newResourceId":{"type":"string"},"newStartUtc":{"type":"string","format":"date-time"},"newEndUtc":{"type":"string","format":"date-time"}},"required":["itemId","newResourceId","newStartUtc","newEndUtc"],"additionalProperties":false}}},"required":["draftId","expectedVersion","changes"],"additionalProperties":false}
              """;

    private sealed record GetPlanInput(string PlanId);

    private sealed record CreateDraftInput(
        string SourcePlanId,
        string Purpose,
        string IdempotencyKey);

    private sealed record ChangeInput(
        string ItemId,
        string NewResourceId,
        DateTimeOffset NewStartUtc,
        DateTimeOffset NewEndUtc);

    private sealed record ChangeBatchInput(
        string DraftId,
        int ExpectedVersion,
        IReadOnlyList<ChangeInput> Changes,
        string? IdempotencyKey = null);

    private sealed record SubmitReviewInput(
        string DraftId,
        int ExpectedVersion,
        string Justification,
        string IdempotencyKey);

    private sealed record GetReviewInput(string ReviewRequestId);
}
