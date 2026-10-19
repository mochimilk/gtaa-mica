using System.Net;
using System.Text;
using System.Text.Json;

namespace Planning.Application.Mcp;

internal sealed class PlanningApplicationHttpClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _httpClient;
    private readonly McpPlanningActor _actor;

    public PlanningApplicationHttpClient(
        HttpClient httpClient,
        PlanningMcpHttpOptions options)
    {
        ArgumentNullException.ThrowIfNull(httpClient);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(options.BaseAddress);
        ArgumentNullException.ThrowIfNull(options.Actor);
        _httpClient = httpClient;
        _httpClient.BaseAddress = options.BaseAddress;
        _actor = options.Actor;
    }

    public async Task<McpToolResult> SendAsync(
        HttpMethod method,
        string relativePath,
        object? body,
        string correlationId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(method);
        ArgumentException.ThrowIfNullOrWhiteSpace(relativePath);
        ArgumentException.ThrowIfNullOrWhiteSpace(correlationId);
        using var request = new HttpRequestMessage(method, relativePath);
        request.Headers.Add("X-Planning-Actor-Id", _actor.ActorId);
        request.Headers.Add("X-Planning-Actor-Kind", _actor.ActorKind);
        request.Headers.Add("X-Planning-Actor-Access", string.Join(",", _actor.Access));
        request.Headers.Add("X-Correlation-Id", correlationId);
        if (body is not null)
        {
            request.Content = new StringContent(
                JsonSerializer.Serialize(body, JsonOptions),
                Encoding.UTF8,
                "application/json");
        }

        try
        {
            using HttpResponseMessage response = await _httpClient.SendAsync(
                    request,
                    HttpCompletionOption.ResponseContentRead,
                    cancellationToken)
                .ConfigureAwait(false);
            string content = await response.Content.ReadAsStringAsync(cancellationToken)
                .ConfigureAwait(false);
            if (!TryParsePayload(content, out JsonElement? payload))
            {
                return new McpToolResult(
                    McpToolResultStatus.Failed,
                    correlationId,
                    ErrorCode: "PLANNING_API_INVALID_RESPONSE",
                    Detail: "Planning API returned a non-JSON response.",
                    Retryable: (int)response.StatusCode >= 500);
            }

            if (response.IsSuccessStatusCode)
            {
                return new McpToolResult(
                    McpToolResultStatus.Succeeded,
                    correlationId,
                    payload);
            }

            string? errorCode = ReadString(payload, "errorCode");
            string? detail = ReadString(payload, "detail");
            McpToolResultStatus status = response.StatusCode switch
            {
                HttpStatusCode.Conflict => McpToolResultStatus.Conflict,
                HttpStatusCode.BadRequest or HttpStatusCode.NotFound
                    or HttpStatusCode.UnprocessableEntity => McpToolResultStatus.Rejected,
                HttpStatusCode.FailedDependency => McpToolResultStatus.Unavailable,
                _ => McpToolResultStatus.Failed
            };
            return new McpToolResult(
                status,
                correlationId,
                payload,
                errorCode ?? $"HTTP_{(int)response.StatusCode}",
                detail ?? $"Planning API returned HTTP {(int)response.StatusCode}.",
                Retryable: (int)response.StatusCode >= 500);
        }
        catch (HttpRequestException exception)
        {
            return new McpToolResult(
                McpToolResultStatus.Failed,
                correlationId,
                ErrorCode: "PLANNING_API_UNAVAILABLE",
                Detail: exception.Message,
                Retryable: true);
        }
    }

    private static bool TryParsePayload(string content, out JsonElement? payload)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            payload = null;
            return true;
        }

        try
        {
            using JsonDocument document = JsonDocument.Parse(content);
            payload = document.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            payload = null;
            return false;
        }
    }

    private static string? ReadString(JsonElement? payload, string propertyName) =>
        payload is JsonElement element
        && element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(propertyName, out JsonElement property)
        && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
}
