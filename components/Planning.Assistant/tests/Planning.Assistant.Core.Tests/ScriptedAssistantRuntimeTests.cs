using FluentAssertions;

namespace Planning.Assistant.Tests;

public sealed class ScriptedAssistantRuntimeTests
{
    private static readonly DateTimeOffset Now = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task CompleteAsync_PreservesStructuredContextAndOutput()
    {
        AssistantContextReference context = ActivePlan();
        var notice = new AssistantNoticePart(
            "1.0.0",
            AssistantNoticeSeverity.Warning,
            "Evidence incomplete",
            "One metric is unavailable.");
        var runtime = Runtime([notice], [context]);

        AssistantResponse response = await runtime.CompleteAsync(
            Request([context]),
            CancellationToken.None);

        response.RequestId.Should().Be("request-1");
        response.ConversationToken.Should().Be("conversation-1");
        response.OutputParts.Should().ContainSingle().Which.Should().Be(notice);
        response.EvidenceReferences.Should().Equal(context);
    }

    [Fact]
    public async Task StreamAsync_ProducesOrderedEventsAndOneTerminalOutcome()
    {
        var outputPart = new AssistantResourceReferencePart(
            "1.0.0",
            "plan",
            "plan-42",
            "Open plan",
            true);
        ScriptedAssistantRuntime runtime = Runtime([outputPart], [ActivePlan()]);

        List<AssistantStreamEvent> events = await CollectAsync(
            runtime.StreamAsync(Request([ActivePlan()]), CancellationToken.None));

        events.Select(item => item.Sequence).Should().Equal(0, 1, 2, 3, 4, 5);
        events.Select(item => item.Type).Should().Equal(
            AssistantStreamEventType.ResponseStarted,
            AssistantStreamEventType.ActivityStarted,
            AssistantStreamEventType.ActivityCompleted,
            AssistantStreamEventType.TextDelta,
            AssistantStreamEventType.OutputPartCompleted,
            AssistantStreamEventType.ResponseCompleted);
        events.Count(item => item.Type is
            AssistantStreamEventType.ResponseCompleted
            or AssistantStreamEventType.ResponseFailed).Should().Be(1);
        events.Should().OnlyContain(item =>
            item.ProtocolVersion == ScriptedAssistantRuntime.ProtocolVersion
            && item.RequestId == "request-1"
            && item.Timestamp == Now);
    }

    [Fact]
    public async Task StreamAsync_UnconfiguredMessage_FailsExplicitly()
    {
        ScriptedAssistantRuntime runtime = Runtime([], []);
        AssistantRequest request = Request([]) with { Message = "not configured" };

        List<AssistantStreamEvent> events = await CollectAsync(
            runtime.StreamAsync(request, CancellationToken.None));

        events.Select(item => item.Type).Should().Equal(
            AssistantStreamEventType.ResponseStarted,
            AssistantStreamEventType.ResponseFailed);
        events[^1].Failure.Should().BeEquivalentTo(
            new AssistantFailure(
                "SCRIPT_NOT_FOUND",
                "No deterministic response is configured for this message.",
                false));
    }

    [Fact]
    public async Task CompleteAsync_UnconfiguredMessage_ThrowsInsteadOfReturningSuccess()
    {
        ScriptedAssistantRuntime runtime = Runtime([], []);
        AssistantRequest request = Request([]) with { Message = "not configured" };

        Func<Task> act = () => runtime.CompleteAsync(
            request,
            CancellationToken.None);

        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*No deterministic response*");
    }

    private static ScriptedAssistantRuntime Runtime(
        IReadOnlyList<AssistantOutputPart> outputParts,
        IReadOnlyList<AssistantContextReference> evidence) => new(
            [
                new ScriptedAssistantResponse(
                    "Compare the plans",
                    "conversation-1",
                    "The candidate has higher verified coverage.",
                    [new ScriptedAssistantActivity("activity-1", "compare-revisions")],
                    outputParts,
                    evidence)
            ],
            new FixedTimeProvider(Now));

    private static AssistantRequest Request(
        IReadOnlyList<AssistantContextReference> context) => new(
            "request-1",
            "correlation-1",
            "Compare the plans",
            null,
            context,
            new AssistantClientCapabilities(
                true,
                Set("notice", "resource-reference", "action-proposal")),
            "en-CA",
            "America/Toronto");

    private static AssistantContextReference ActivePlan() => new(
        "plan",
        "plan-42",
        AssistantContextRole.Active,
        "revision-3");

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);

    private static async Task<List<T>> CollectAsync<T>(IAsyncEnumerable<T> source)
    {
        var results = new List<T>();
        await foreach (T item in source)
        {
            results.Add(item);
        }

        return results;
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
