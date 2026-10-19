using System.Text.Json;

namespace Planning.Application.Mcp;

/// <summary>Authority required by one MCP tool.</summary>
public enum McpToolAuthority
{
    /// <summary>Read-only access to existing application resources.</summary>
    Read,

    /// <summary>Create or modify a planning draft.</summary>
    DraftWrite,

    /// <summary>Submit or withdraw a draft review request.</summary>
    ReviewSubmit
}

/// <summary>Stable schema-versioned MCP tool definition.</summary>
public sealed record McpToolDefinition(
    string ToolId,
    string Version,
    string Description,
    McpToolAuthority Authority,
    JsonElement InputSchema,
    bool RequiresIdempotencyKey,
    bool RequiresHumanConfirmation);

/// <summary>Normalized MCP tool outcome.</summary>
public enum McpToolResultStatus
{
    /// <summary>The backing application operation succeeded.</summary>
    Succeeded,

    /// <summary>Input or application rules rejected the operation.</summary>
    Rejected,

    /// <summary>Required application evidence was unavailable.</summary>
    Unavailable,

    /// <summary>An expected version or idempotency key conflicted.</summary>
    Conflict,

    /// <summary>Transport, authorization, or service execution failed.</summary>
    Failed
}

/// <summary>Stable MCP result envelope returned by every tool.</summary>
public sealed record McpToolResult(
    McpToolResultStatus Status,
    string CorrelationId,
    JsonElement? Payload = null,
    string? ErrorCode = null,
    string? Detail = null,
    bool Retryable = false,
    bool Truncated = false);

/// <summary>Identity propagated by the MCP adapter to the planning HTTP API.</summary>
public sealed record McpPlanningActor(
    string ActorId,
    string ActorKind,
    IReadOnlyList<string> Access);

/// <summary>Options required by the HTTP-backed MCP adapter.</summary>
public sealed record PlanningMcpHttpOptions(
    Uri BaseAddress,
    McpPlanningActor Actor);

/// <summary>Framework-neutral MCP tool catalog and invocation boundary.</summary>
public interface IPlanningMcpToolAdapter
{
    /// <summary>Tools exposed by this adapter in deterministic ID order.</summary>
    IReadOnlyList<McpToolDefinition> Tools { get; }

    /// <summary>Invokes one schema-versioned tool.</summary>
    Task<McpToolResult> InvokeAsync(
        string toolId,
        JsonElement input,
        string correlationId,
        CancellationToken cancellationToken);
}
