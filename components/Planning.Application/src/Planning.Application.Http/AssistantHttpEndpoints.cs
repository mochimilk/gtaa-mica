using System.Text.Json;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Planning.Assistant;

namespace Planning.Application.Http;

/// <summary>HTTP complete-response and SSE adapters for assistant contracts.</summary>
public static class AssistantHttpEndpoints
{
    /// <summary>Maps the versioned assistant HTTP API.</summary>
    public static IEndpointRouteBuilder MapAssistantHttpEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        RouteGroupBuilder group = app.MapGroup("/api/v1/assistant");
        group.MapPost("/responses", CompleteAsync);
        group.MapPost("/responses/stream", StreamAsync);
        return app;
    }

    private static async Task<IResult> CompleteAsync(
        AssistantHttpRequest request,
        IAssistantRuntime runtime,
        CancellationToken cancellationToken)
    {
        try
        {
            AssistantResponse response = await runtime.CompleteAsync(request.ToCore(), cancellationToken)
                .ConfigureAwait(false);
            return Results.Ok(AssistantHttpResponse.FromCore(response));
        }
        catch (InvalidOperationException exception)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status502BadGateway,
                title: "ASSISTANT_PROVIDER_FAILURE",
                detail: exception.Message,
                extensions: new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["errorCode"] = "ASSISTANT_PROVIDER_FAILURE"
                });
        }
    }

    private static async Task StreamAsync(
        HttpContext context,
        AssistantHttpRequest request,
        IAssistantRuntime runtime,
        IOptions<JsonOptions> jsonOptions,
        CancellationToken cancellationToken)
    {
        context.Response.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-cache";
        context.Response.Headers.Append("X-Accel-Buffering", "no");
        JsonSerializerOptions serializerOptions = jsonOptions.Value.SerializerOptions;
        await foreach (AssistantStreamEvent item in runtime.StreamAsync(request.ToCore(), cancellationToken)
                           .ConfigureAwait(false))
        {
            string json = JsonSerializer.Serialize(
                AssistantHttpStreamEvent.FromCore(item),
                serializerOptions);
            await context.Response.WriteAsync($"data: {json}\n\n", cancellationToken)
                .ConfigureAwait(false);
            await context.Response.Body.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
