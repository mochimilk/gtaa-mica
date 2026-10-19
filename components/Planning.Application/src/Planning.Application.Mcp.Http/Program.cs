using ModelContextProtocol;
using Planning.Application.Mcp;
using Planning.Application.Mcp.Http;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

Uri planningApiBaseAddress = new(
    builder.Configuration["PlanningApi:BaseAddress"]
        ?? throw new InvalidOperationException("PlanningApi:BaseAddress is required."),
    UriKind.Absolute);
string actorId = builder.Configuration["McpActor:Id"]
    ?? throw new InvalidOperationException("McpActor:Id is required.");
string actorKind = builder.Configuration["McpActor:Kind"]
    ?? throw new InvalidOperationException("McpActor:Kind is required.");
string[] actorAccess = builder.Configuration
    .GetSection("McpActor:Access")
    .Get<string[]>()
    ?? throw new InvalidOperationException("McpActor:Access is required.");

builder.Services.AddHttpClient("PlanningApplicationMcp");
builder.Services.AddSingleton<IPlanningMcpToolAdapter>(services =>
{
    HttpClient httpClient = services
        .GetRequiredService<IHttpClientFactory>()
        .CreateClient("PlanningApplicationMcp");
    return new PlanningMcpToolAdapter(
        httpClient,
        new PlanningMcpHttpOptions(
            planningApiBaseAddress,
            new McpPlanningActor(actorId, actorKind, actorAccess)));
});
builder.Services.AddSingleton<PlanningMcpSdkBridge>();

builder.Services
    .AddMcpServer()
    .WithHttpTransport()
    .WithListToolsHandler((context, _) =>
    {
        PlanningMcpSdkBridge bridge = context.Services!
            .GetRequiredService<PlanningMcpSdkBridge>();
        return ValueTask.FromResult(bridge.ListTools());
    })
    .WithCallToolHandler(async (context, cancellationToken) =>
    {
        PlanningMcpSdkBridge bridge = context.Services!
            .GetRequiredService<PlanningMcpSdkBridge>();
        string correlationId = Guid.NewGuid().ToString("N");
        return await bridge.CallToolAsync(
                context.Params,
                correlationId,
                cancellationToken)
            .ConfigureAwait(false);
    });

WebApplication app = builder.Build();

app.MapGet("/healthz", () => Results.Ok(new { status = "Healthy" }));
app.MapMcp("/mcp");

app.Run();
