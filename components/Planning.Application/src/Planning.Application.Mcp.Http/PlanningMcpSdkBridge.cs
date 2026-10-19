using System.Text.Json;
using System.Text.Json.Serialization;
using ModelContextProtocol.Protocol;

namespace Planning.Application.Mcp.Http;

/// <summary>Maps the SDK-neutral planning tool boundary to MCP protocol types.</summary>
public sealed class PlanningMcpSdkBridge(IPlanningMcpToolAdapter adapter)
{
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    /// <summary>Returns the planning tools represented as MCP protocol tools.</summary>
    public ListToolsResult ListTools() => new()
    {
        Tools = adapter.Tools.Select(ToProtocolTool).ToList()
    };

    /// <summary>Invokes one MCP tool through the SDK-neutral planning adapter.</summary>
    public async Task<CallToolResult> CallToolAsync(
        CallToolRequestParams request,
        string correlationId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentException.ThrowIfNullOrWhiteSpace(correlationId);
        JsonElement input = JsonSerializer.SerializeToElement(
            request.Arguments ?? new Dictionary<string, JsonElement>(StringComparer.Ordinal),
            JsonOptions);
        McpToolResult result = await adapter.InvokeAsync(
                request.Name,
                input,
                correlationId,
                cancellationToken)
            .ConfigureAwait(false);
        JsonElement structuredContent = JsonSerializer.SerializeToElement(result, JsonOptions);

        return new CallToolResult
        {
            IsError = result.Status != McpToolResultStatus.Succeeded,
            StructuredContent = structuredContent,
            Content =
            [
                new TextContentBlock
                {
                    Text = ResultSummary(result)
                }
            ]
        };
    }

    private static Tool ToProtocolTool(McpToolDefinition definition) => new()
    {
        Name = definition.ToolId,
        Title = definition.ToolId.Replace('_', ' '),
        Description = definition.RequiresHumanConfirmation
            ? $"{definition.Description} Requires host-side human confirmation before invocation."
            : definition.Description,
        InputSchema = definition.InputSchema,
        Annotations = new ToolAnnotations
        {
            ReadOnlyHint = definition.Authority == McpToolAuthority.Read,
            DestructiveHint = false,
            IdempotentHint = true,
            OpenWorldHint = false
        }
    };

    private static string ResultSummary(McpToolResult result) =>
        result.Status == McpToolResultStatus.Succeeded
            ? $"Planning tool completed. Correlation ID: {result.CorrelationId}."
            : $"Planning tool returned {result.Status}: {result.ErrorCode}. "
                + $"Correlation ID: {result.CorrelationId}.";

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}
