using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Planning.Application.Mcp.Tests;

public sealed class PlanningMcpToolAdapterTests
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task Tools_ExposeOnlyReadDraftAndReviewSubmissionCapabilities()
    {
        await using var factory = new WebApplicationFactory<Program>();
        PlanningMcpToolAdapter adapter = Adapter(factory);

        adapter.Tools.Select(tool => tool.ToolId).Should().Equal(
            "get_plan",
            "create_draft",
            "preview_changes",
            "commit_changes",
            "submit_for_review",
            "get_review_status");
        adapter.Tools.Should().OnlyContain(tool => tool.Version == "1.0.0");
        adapter.Tools.Should().NotContain(tool =>
            tool.ToolId.Contains("approve", StringComparison.OrdinalIgnoreCase)
            || tool.ToolId.Contains("publish", StringComparison.OrdinalIgnoreCase));
        adapter.Tools.Single(tool => tool.ToolId == "commit_changes")
            .RequiresHumanConfirmation.Should().BeTrue();
        adapter.Tools.Single(tool => tool.ToolId == "submit_for_review")
            .Authority.Should().Be(McpToolAuthority.ReviewSubmit);
    }

    [Fact]
    public async Task GetPlan_DelegatesToAuthoritativeHttpApi()
    {
        await using var factory = new WebApplicationFactory<Program>();
        PlanningMcpToolAdapter adapter = Adapter(factory);

        McpToolResult result = await adapter.InvokeAsync(
            "get_plan",
            Input(new { planId = "plan-local-1" }),
            "correlation-1",
            CancellationToken.None);

        result.Status.Should().Be(McpToolResultStatus.Succeeded);
        result.CorrelationId.Should().Be("correlation-1");
        result.Payload!.Value.GetProperty("planId").GetString().Should().Be("plan-local-1");
        result.Payload.Value.GetProperty("state").GetString().Should().Be("Published");
    }

    [Fact]
    public async Task CommitInvalidChange_ReturnsRuleRejectionFromHttpApi()
    {
        await using var factory = new WebApplicationFactory<Program>();
        PlanningMcpToolAdapter adapter = Adapter(factory);
        McpToolResult created = await adapter.InvokeAsync(
            "create_draft",
            Input(new
            {
                sourcePlanId = "plan-local-1",
                purpose = "Evaluate option",
                idempotencyKey = "create-mcp-1"
            }),
            "correlation-create",
            CancellationToken.None);
        string draftId = created.Payload!.Value.GetProperty("planId").GetString()!;

        McpToolResult result = await adapter.InvokeAsync(
            "commit_changes",
            Input(new
            {
                draftId,
                expectedVersion = 1,
                idempotencyKey = "commit-mcp-1",
                changes = new[]
                {
                    new
                    {
                        itemId = "item-2",
                        newResourceId = "resource-1",
                        newStartUtc = Start.AddMinutes(30),
                        newEndUtc = Start.AddMinutes(90)
                    }
                }
            }),
            "correlation-commit",
            CancellationToken.None);

        result.Status.Should().Be(McpToolResultStatus.Rejected);
        result.ErrorCode.Should().Be("CHANGE_REJECTED");
        result.Payload!.Value.GetProperty("validation")
            .GetProperty("findings")[0]
            .GetProperty("code").GetString().Should().Be("RESOURCE_OVERLAP");
        result.Retryable.Should().BeFalse();
    }

    [Fact]
    public async Task SubmitForReview_UsesExactDraftVersionAndAgentAuthority()
    {
        await using var factory = new WebApplicationFactory<Program>();
        PlanningMcpToolAdapter adapter = Adapter(factory);
        McpToolResult created = await adapter.InvokeAsync(
            "create_draft",
            Input(new
            {
                sourcePlanId = "plan-local-1",
                purpose = "Evaluate option",
                idempotencyKey = "create-mcp-1"
            }),
            "correlation-create",
            CancellationToken.None);
        string draftId = created.Payload!.Value.GetProperty("planId").GetString()!;

        McpToolResult result = await adapter.InvokeAsync(
            "submit_for_review",
            Input(new
            {
                draftId,
                expectedVersion = 1,
                justification = "Ready for human review",
                idempotencyKey = "review-mcp-1"
            }),
            "correlation-review",
            CancellationToken.None);

        result.Status.Should().Be(McpToolResultStatus.Succeeded);
        result.Payload!.Value.GetProperty("draftId").GetString().Should().Be(draftId);
        result.Payload.Value.GetProperty("draftVersion").GetInt32().Should().Be(1);
        result.Payload.Value.GetProperty("status").GetString().Should().Be("Pending");
    }

    [Fact]
    public async Task ReusedIdempotencyKeyWithDifferentContent_ReturnsConflict()
    {
        await using var factory = new WebApplicationFactory<Program>();
        PlanningMcpToolAdapter adapter = Adapter(factory);
        await adapter.InvokeAsync(
            "create_draft",
            Input(new
            {
                sourcePlanId = "plan-local-1",
                purpose = "First purpose",
                idempotencyKey = "create-mcp-reused"
            }),
            "correlation-first",
            CancellationToken.None);

        McpToolResult result = await adapter.InvokeAsync(
            "create_draft",
            Input(new
            {
                sourcePlanId = "plan-local-1",
                purpose = "Changed purpose",
                idempotencyKey = "create-mcp-reused"
            }),
            "correlation-second",
            CancellationToken.None);

        result.Status.Should().Be(McpToolResultStatus.Conflict);
        result.ErrorCode.Should().Be("IDEMPOTENCY_CONFLICT");
    }

    [Fact]
    public async Task NonJsonUpstreamResponse_ReturnsTypedProtocolFailure()
    {
        using var client = new HttpClient(
            new StubHttpMessageHandler(
                new HttpResponseMessage(System.Net.HttpStatusCode.BadGateway)
                {
                    Content = new StringContent("upstream gateway failed")
                }));
        PlanningMcpToolAdapter adapter = Adapter(client);

        McpToolResult result = await adapter.InvokeAsync(
            "get_plan",
            Input(new { planId = "plan-local-1" }),
            "correlation-invalid-response",
            CancellationToken.None);

        result.Status.Should().Be(McpToolResultStatus.Failed);
        result.ErrorCode.Should().Be("PLANNING_API_INVALID_RESPONSE");
        result.Retryable.Should().BeTrue();
    }

    [Fact]
    public async Task UnauthorizedActor_ReturnsTypedNonRetryableFailure()
    {
        await using var factory = new WebApplicationFactory<Program>();
        HttpClient client = factory.CreateClient();
        var adapter = new PlanningMcpToolAdapter(
            client,
            new PlanningMcpHttpOptions(
                client.BaseAddress!,
                new McpPlanningActor("mcp-agent", "Agent", [])));

        McpToolResult result = await adapter.InvokeAsync(
            "get_plan",
            Input(new { planId = "plan-local-1" }),
            "correlation-unauthorized",
            CancellationToken.None);

        result.Status.Should().Be(McpToolResultStatus.Failed);
        result.ErrorCode.Should().NotBeNullOrWhiteSpace();
        result.Retryable.Should().BeFalse();
    }

    [Fact]
    public async Task Cancellation_IsNotConvertedToToolFailure()
    {
        using var client = new HttpClient(new CancelingHttpMessageHandler());
        PlanningMcpToolAdapter adapter = Adapter(client);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        Func<Task> act = () => adapter.InvokeAsync(
            "get_plan",
            Input(new { planId = "plan-local-1" }),
            "correlation-cancelled",
            cancellation.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task InvalidNestedChange_ReturnsInputRejectionWithoutCallingHttp()
    {
        var handler = new CountingHttpMessageHandler();
        using var client = new HttpClient(handler);
        PlanningMcpToolAdapter adapter = Adapter(client);

        McpToolResult result = await adapter.InvokeAsync(
            "preview_changes",
            Input(new
            {
                draftId = "draft-1",
                expectedVersion = 1,
                changes = new[]
                {
                    new
                    {
                        itemId = "",
                        newResourceId = "resource-1",
                        newStartUtc = Start,
                        newEndUtc = Start
                    }
                }
            }),
            "correlation-invalid-change",
            CancellationToken.None);

        result.Status.Should().Be(McpToolResultStatus.Rejected);
        result.ErrorCode.Should().Be("INVALID_TOOL_INPUT");
        handler.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task UnknownOrMalformedTool_ReturnsExplicitRejection()
    {
        await using var factory = new WebApplicationFactory<Program>();
        PlanningMcpToolAdapter adapter = Adapter(factory);

        McpToolResult unknown = await adapter.InvokeAsync(
            "publish_revision",
            Input(new { reviewRequestId = "review-1" }),
            "correlation-unknown",
            CancellationToken.None);
        McpToolResult malformed = await adapter.InvokeAsync(
            "get_plan",
            Input(new { }),
            "correlation-invalid",
            CancellationToken.None);

        unknown.Status.Should().Be(McpToolResultStatus.Rejected);
        unknown.ErrorCode.Should().Be("UNKNOWN_TOOL");
        malformed.Status.Should().Be(McpToolResultStatus.Rejected);
        malformed.ErrorCode.Should().Be("INVALID_TOOL_INPUT");
    }

    private static PlanningMcpToolAdapter Adapter(
        WebApplicationFactory<Program> factory)
    {
        HttpClient client = factory.CreateClient();
        return Adapter(client);
    }

    private static PlanningMcpToolAdapter Adapter(HttpClient client) =>
        new(
            client,
            new PlanningMcpHttpOptions(
                client.BaseAddress ?? new Uri("https://planning.test"),
                new McpPlanningActor(
                    "mcp-agent",
                    "Agent",
                    ["Read", "DraftWrite", "ReviewSubmit"])));

    private static JsonElement Input<T>(T value) =>
        JsonSerializer.SerializeToElement(value, JsonOptions);

    private sealed class StubHttpMessageHandler(HttpResponseMessage response)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromResult(response);
    }

    private sealed class CountingHttpMessageHandler : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK));
        }
    }

    private sealed class CancelingHttpMessageHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromCanceled<HttpResponseMessage>(cancellationToken);
    }
}
