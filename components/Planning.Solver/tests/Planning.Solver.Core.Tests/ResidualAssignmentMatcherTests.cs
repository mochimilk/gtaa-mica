using FluentAssertions;

namespace Planning.Solver.Tests;

public sealed class ResidualAssignmentMatcherTests
{
    private static readonly DateTimeOffset Start = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Match_CompetingJobs_ProvesMaximumWithoutDomainAdapter()
    {
        ProblemSnapshot problem = Problem(
            [Subject("job-1", 0, 60), Subject("job-2", 0, 60)],
            [Resource("machine-1")]);
        ResidualMatchingRequest request = Request(problem, ["job-1", "job-2"]);

        ResidualMatchingResult result = ResidualAssignmentMatcher.Match(request);

        result.Status.Should().Be(ResidualMatchingStatus.Optimal);
        result.MatchedSubjectCount.Should().Be(1);
        result.Assignments.Should().ContainSingle()
            .Which.SubjectId.Should().Be("job-1");
        result.UnmatchedSubjectIds.Should().Equal("job-2");
    }

    [Fact]
    public void Match_ConfiguredCandidateRules_FilterAdapterAlternatives()
    {
        ProblemSnapshot problem = Problem(
            [Subject("high-power-job", 0, 60, "high-power")],
            [Resource("basic-machine"), Resource("powered-machine", "high-power")]);
        ResidualMatchingRequest request = Request(problem, ["high-power-job"]);

        ResidualMatchingResult result = ResidualAssignmentMatcher.Match(request);

        result.AllSubjectsMatched.Should().BeTrue();
        result.Assignments.Should().ContainSingle()
            .Which.ResourceId.Should().Be("powered-machine");
    }

    [Fact]
    public void Match_SearchLimitReached_DoesNotClaimOptimality()
    {
        ProblemSnapshot problem = Problem(
            [Subject("job-1", 0, 60), Subject("job-2", 0, 60)],
            [Resource("machine-1"), Resource("machine-2")]);
        ResidualMatchingRequest request = Request(
            problem,
            ["job-1", "job-2"],
            maximumSearchNodes: 1);

        ResidualMatchingResult result = ResidualAssignmentMatcher.Match(request);

        result.Status.Should().Be(ResidualMatchingStatus.SearchLimitReached);
        result.AllSubjectsMatched.Should().BeFalse();
        result.MaximumSearchNodes.Should().Be(1);
    }

    private static ResidualMatchingRequest Request(
        ProblemSnapshot problem,
        IReadOnlyList<string> residualSubjectIds,
        int maximumSearchNodes = 1_000)
    {
        ResidualMatchingAlternative[] alternatives = residualSubjectIds
            .SelectMany(subjectId =>
            {
                PlanningSubject subject = problem.Subjects.Single(item =>
                    string.Equals(item.SubjectId, subjectId, StringComparison.Ordinal));
                return problem.Resources.Select(resource => new ResidualMatchingAlternative(
                    $"{subjectId}:{resource.ResourceId}",
                    subjectId,
                    resource.ResourceId,
                    subject.Window));
            })
            .ToArray();
        return new ResidualMatchingRequest(
            problem,
            new RulePackage(
                "machine-rules",
                "1.0.0",
                [new RequiredCapabilitiesRule(), new ResourceCommitmentRule()],
                [new ResourceNonOverlapRule()]),
            [],
            residualSubjectIds,
            alternatives,
            maximumSearchNodes);
    }

    private static ProblemSnapshot Problem(
        IReadOnlyList<PlanningSubject> subjects,
        IReadOnlyList<PlanningResource> resources) => new(
            "machine-scheduling",
            "manufacturing-fixture",
            "1.0.0",
            Start.AddDays(-1),
            subjects,
            resources,
            []);

    private static PlanningSubject Subject(
        string subjectId,
        int startMinutes,
        int endMinutes,
        params string[] capabilities) => new(
            subjectId,
            $"operation-{subjectId}",
            TimeWindow.Create(Start.AddMinutes(startMinutes), Start.AddMinutes(endMinutes)),
            1,
            Set(capabilities));

    private static PlanningResource Resource(
        string resourceId,
        params string[] capabilities) => new(
            resourceId,
            1m,
            Set(capabilities));

    private static HashSet<string> Set(params string[] values) =>
        values.ToHashSet(StringComparer.Ordinal);
}
