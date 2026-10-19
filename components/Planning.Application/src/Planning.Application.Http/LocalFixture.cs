using Planning.Assistant;

namespace Planning.Application.Http;

internal sealed class LocalPlanningValidator : IPlanningRevisionValidator
{
    public PlanningValidationResult Validate(PlanSnapshot proposed)
    {
        var findings = new List<PlanningValidationFinding>();
        PlanningAssignment[] assignments = proposed.Assignments
            .OrderBy(assignment => assignment.StartUtc)
            .ToArray();
        for (int left = 0; left < assignments.Length; left++)
        {
            for (int right = left + 1; right < assignments.Length; right++)
            {
                PlanningAssignment first = assignments[left];
                PlanningAssignment second = assignments[right];
                if (string.Equals(first.ResourceId, second.ResourceId, StringComparison.Ordinal)
                    && first.StartUtc < second.EndUtc
                    && first.EndUtc > second.StartUtc)
                {
                    findings.Add(new PlanningValidationFinding(
                        "RESOURCE_OVERLAP",
                        $"Items '{first.ItemId}' and '{second.ItemId}' overlap.",
                        first.ItemId,
                        second.ItemId,
                        first.ResourceId));
                }
            }
        }

        return new PlanningValidationResult(findings);
    }
}

internal sealed class LocalPlanningIdGenerator : IPlanningApplicationIdGenerator
{
    private readonly Dictionary<string, int> _counts = new(StringComparer.Ordinal);

    public string NextId(string resourceKind)
    {
        int next = _counts.GetValueOrDefault(resourceKind) + 1;
        _counts[resourceKind] = next;
        return $"{resourceKind}-local-{next}";
    }
}

internal static class LocalFixture
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    public static IPlanningApplicationService CreateApplication() =>
        new InMemoryPlanningApplicationService(
            [
                InMemoryPlanningApplicationService.CreateSnapshot(
                    "plan-local-1",
                    1,
                    PlanSnapshotState.Published,
                    null,
                    [
                        new PlanningAssignment(
                            "item-1",
                            "resource-1",
                            Start,
                            Start.AddHours(1)),
                        new PlanningAssignment(
                            "item-2",
                            "resource-2",
                            Start.AddMinutes(30),
                            Start.AddMinutes(90))
                    ])
            ],
            new LocalPlanningValidator(),
            new LocalPlanningIdGenerator());

    public static IAssistantRuntime CreateAssistant()
    {
        var plan = new AssistantContextReference(
            "plan",
            "plan-local-1",
            AssistantContextRole.Active,
            "1");
        return new ScriptedAssistantRuntime(
        [
            new ScriptedAssistantResponse(
                "Summarize the active plan",
                "conversation-local-1",
                "The active plan contains two assigned items.",
                [new ScriptedAssistantActivity("activity-1", "get-plan")],
                [
                    new AssistantResourceReferencePart(
                        "1.0.0",
                        "plan",
                        "plan-local-1",
                        "Open plan",
                        true)
                ],
                [plan])
        ]);
    }
}
