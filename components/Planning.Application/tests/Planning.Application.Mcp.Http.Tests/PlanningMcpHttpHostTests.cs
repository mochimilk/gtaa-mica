using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Planning.Application.Mcp.Http.Tests;

public sealed class PlanningMcpHttpHostTests
{
    [Fact]
    public async Task StreamableHttp_AdvertisesOnlyGovernedPlanningTools()
    {
        await using WebApplicationFactory<Program> factory = CreateFactory();
        using HttpClient httpClient = factory.CreateClient();
        await using McpClient client = await CreateClientAsync(httpClient);

        IList<McpClientTool> tools = await client.ListToolsAsync();

        tools.Select(tool => tool.Name).Should().Equal(
            "get_plan",
            "create_draft",
            "preview_changes",
            "commit_changes",
            "submit_for_review",
            "get_review_status");
        tools.Should().NotContain(tool =>
            tool.Name.Contains("approve", StringComparison.OrdinalIgnoreCase)
            || tool.Name.Contains("reject", StringComparison.OrdinalIgnoreCase)
            || tool.Name.Contains("publish", StringComparison.OrdinalIgnoreCase));
        tools.Single(tool => tool.Name == "get_plan")
            .ProtocolTool.Annotations!.ReadOnlyHint.Should().BeTrue();
        tools.Single(tool => tool.Name == "commit_changes")
            .ProtocolTool.Annotations!.DestructiveHint.Should().BeFalse();
        tools.Single(tool => tool.Name == "commit_changes")
            .Description.Should().Contain("human confirmation");
    }

    [Fact]
    public async Task StreamableHttp_InvokesSdkNeutralAdapter()
    {
        await using WebApplicationFactory<Program> factory = CreateFactory();
        using HttpClient httpClient = factory.CreateClient();
        await using McpClient client = await CreateClientAsync(httpClient);

        CallToolResult result = await client.CallToolAsync(
            "get_plan",
            new Dictionary<string, object?>
            {
                ["planId"] = "plan-local-1"
            });

        result.IsError.Should().BeFalse();
        result.StructuredContent.Should().NotBeNull();
        result.StructuredContent!.Value.GetProperty("status").GetString()
            .Should().Be("Succeeded");
        result.StructuredContent.Value.GetProperty("payload")
            .GetProperty("planId").GetString().Should().Be("plan-local-1");
        result.StructuredContent.Value.GetProperty("correlationId")
            .GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task HealthEndpoint_IsAvailableWithoutStartingPlanningApi()
    {
        await using WebApplicationFactory<Program> factory = CreateFactory();
        using HttpClient client = factory.CreateClient();

        HttpResponseMessage response = await client.GetAsync(
            "/healthz",
            CancellationToken.None);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UnregisteredTool_ReturnsStructuredProtocolError()
    {
        await using WebApplicationFactory<Program> factory = CreateFactory();
        using HttpClient httpClient = factory.CreateClient();
        await using McpClient client = await CreateClientAsync(httpClient);

        CallToolResult result = await client.CallToolAsync("publish_revision");

        result.IsError.Should().BeTrue();
        result.StructuredContent!.Value.GetProperty("errorCode").GetString()
            .Should().Be("UNKNOWN_TOOL");
    }

    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<IPlanningMcpToolAdapter>();
                    services.AddSingleton<IPlanningMcpToolAdapter>(
                        new PlanningMcpToolAdapter(
                            new HttpClient(new PlanningApiStubHandler()),
                            new PlanningMcpHttpOptions(
                                new Uri("https://planning.test"),
                                new McpPlanningActor(
                                    "test-agent",
                                    "Agent",
                                    ["Read", "DraftWrite", "ReviewSubmit"]))));
                });
            });

    private static async Task<McpClient> CreateClientAsync(HttpClient httpClient)
    {
        var transport = new HttpClientTransport(
            new HttpClientTransportOptions
            {
                Endpoint = new Uri(httpClient.BaseAddress!, "mcp"),
                TransportMode = HttpTransportMode.StreamableHttp,
                EnableStandaloneGetStream = false
            },
            httpClient,
            ownsHttpClient: false);
        return await McpClient.CreateAsync(
            transport,
            cancellationToken: CancellationToken.None);
    }

    private sealed class PlanningApiStubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            const string responseBody = """
                {
                  "planId": "plan-local-1",
                  "version": 1,
                  "state": "Published",
                  "assignments": []
                }
                """;
            return Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        responseBody,
                        Encoding.UTF8,
                        "application/json")
                });
        }
    }
}
