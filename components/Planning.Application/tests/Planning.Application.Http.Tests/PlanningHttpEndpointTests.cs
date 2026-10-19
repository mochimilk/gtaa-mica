using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Planning.Assistant;

namespace Planning.Application.Http.Tests;

public sealed class PlanningHttpEndpointTests
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task GetPlan_MissingActorHeaders_ReturnsStableForbiddenProblem()
    {
        await using var factory = new WebApplicationFactory<Program>();
        HttpClient client = factory.CreateClient();

        HttpResponseMessage response = await client.GetAsync(
            "/api/v1/plans/plan-local-1",
            CancellationToken.None);
        JsonElement problem = await ReadJsonAsync(response);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        problem.GetProperty("errorCode").GetString().Should().Be("ACTOR_REQUIRED");
    }

    [Fact]
    public async Task CreateDraft_ReplayedIdempotencyKey_ReturnsSameDraft()
    {
        await using var factory = new WebApplicationFactory<Program>();
        HttpClient client = PlanningClient(factory, "Agent", "Read,DraftWrite,ReviewSubmit");
        var request = new
        {
            sourcePlanId = "plan-local-1",
            purpose = "Evaluate option",
            idempotencyKey = "create-http-1"
        };

        HttpResponseMessage first = await client.PostAsJsonAsync(
            "/api/v1/drafts",
            request,
            CancellationToken.None);
        HttpResponseMessage replay = await client.PostAsJsonAsync(
            "/api/v1/drafts",
            request,
            CancellationToken.None);
        JsonElement firstBody = await ReadJsonAsync(first);
        JsonElement replayBody = await ReadJsonAsync(replay);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        replayBody.GetProperty("planId").GetString()
            .Should().Be(firstBody.GetProperty("planId").GetString());
        replayBody.GetProperty("fingerprint").GetString()
            .Should().Be(firstBody.GetProperty("fingerprint").GetString());
    }

    [Fact]
    public async Task CommitInvalidChange_ReturnsValidationProblemWithoutSuccessShape()
    {
        await using var factory = new WebApplicationFactory<Program>();
        HttpClient client = PlanningClient(factory, "Agent", "Read,DraftWrite,ReviewSubmit");
        HttpResponseMessage created = await client.PostAsJsonAsync(
            "/api/v1/drafts",
            new
            {
                sourcePlanId = "plan-local-1",
                purpose = "Evaluate option",
                idempotencyKey = "create-http-1"
            },
            CancellationToken.None);
        string draftId = (await ReadJsonAsync(created)).GetProperty("planId").GetString()!;

        HttpResponseMessage response = await client.PostAsJsonAsync(
            $"/api/v1/drafts/{draftId}/changes",
            new
            {
                expectedVersion = 1,
                idempotencyKey = "commit-http-1",
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
            },
            CancellationToken.None);
        JsonElement problem = await ReadJsonAsync(response);

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        problem.GetProperty("errorCode").GetString().Should().Be("CHANGE_REJECTED");
        problem.GetProperty("validation")
            .GetProperty("findings")[0]
            .GetProperty("code").GetString().Should().Be("RESOURCE_OVERLAP");
    }

    private static HttpClient PlanningClient(
        WebApplicationFactory<Program> factory,
        string actorKind,
        string access)
    {
        HttpClient client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Planning-Actor-Id", "test-actor");
        client.DefaultRequestHeaders.Add("X-Planning-Actor-Kind", actorKind);
        client.DefaultRequestHeaders.Add("X-Planning-Actor-Access", access);
        return client;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using JsonDocument document = JsonDocument.Parse(
            await response.Content.ReadAsStringAsync(CancellationToken.None));
        return document.RootElement.Clone();
    }
}

public sealed class AssistantHttpEndpointTests
{
    [Fact]
    public async Task CompleteResponse_PreservesStructuredContextAndTypedOutput()
    {
        await using var factory = new WebApplicationFactory<Program>();
        HttpClient client = factory.CreateClient();
        AssistantRequest request = Request();

        HttpResponseMessage response = await client.PostAsJsonAsync(
            "/api/v1/assistant/responses",
            request,
            CancellationToken.None);
        JsonElement body = await ReadJsonAsync(response);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        body.GetProperty("requestId").GetString().Should().Be(request.RequestId);
        body.GetProperty("conversationToken").GetString().Should().Be("conversation-local-1");
        body.GetProperty("outputParts")[0].GetProperty("type").GetString()
            .Should().Be("resource-reference");
        body.GetProperty("outputParts")[0].GetProperty("resourceId").GetString()
            .Should().Be("plan-local-1");
        body.GetProperty("evidenceReferences")[0].GetProperty("role").GetString()
            .Should().Be("Active");
    }

    [Fact]
    public async Task StreamResponse_ProducesOrderedSseWithOneTerminalEvent()
    {
        await using var factory = new WebApplicationFactory<Program>();
        HttpClient client = factory.CreateClient();

        HttpResponseMessage response = await client.PostAsJsonAsync(
            "/api/v1/assistant/responses/stream",
            Request(),
            CancellationToken.None);
        string content = await response.Content.ReadAsStringAsync(CancellationToken.None);
        JsonElement[] events = content
            .Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Select(block => block["data: ".Length..])
            .Select(json =>
            {
                using JsonDocument document = JsonDocument.Parse(json);
                return document.RootElement.Clone();
            })
            .ToArray();

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should().Be("text/event-stream");
        events.Select(item => item.GetProperty("sequence").GetInt64())
            .Should().Equal(0, 1, 2, 3, 4, 5);
        events.Count(item =>
            item.GetProperty("type").GetString() is "ResponseCompleted" or "ResponseFailed")
            .Should().Be(1);
        events[^1].GetProperty("type").GetString().Should().Be("ResponseCompleted");
    }

    [Fact]
    public async Task CompleteResponse_UnconfiguredMessage_ReturnsProviderFailure()
    {
        await using var factory = new WebApplicationFactory<Program>();
        HttpClient client = factory.CreateClient();
        AssistantRequest request = Request() with { Message = "Unknown request" };

        HttpResponseMessage response = await client.PostAsJsonAsync(
            "/api/v1/assistant/responses",
            request,
            CancellationToken.None);
        JsonElement problem = await ReadJsonAsync(response);

        response.StatusCode.Should().Be(HttpStatusCode.BadGateway);
        problem.GetProperty("errorCode").GetString()
            .Should().Be("ASSISTANT_PROVIDER_FAILURE");
    }

    private static AssistantRequest Request() => new(
        "assistant-request-1",
        "correlation-1",
        "Summarize the active plan",
        null,
        [
            new AssistantContextReference(
                "plan",
                "plan-local-1",
                AssistantContextRole.Active,
                "1")
        ],
        new AssistantClientCapabilities(
            true,
            new HashSet<string>(StringComparer.Ordinal)
            {
                "notice",
                "resource-reference",
                "action-proposal"
            }),
        "en-CA",
        "America/Toronto");

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using JsonDocument document = JsonDocument.Parse(
            await response.Content.ReadAsStringAsync(CancellationToken.None));
        return document.RootElement.Clone();
    }
}
