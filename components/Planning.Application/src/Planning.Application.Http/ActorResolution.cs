namespace Planning.Application.Http;

/// <summary>Maps authenticated transport identity into application authority.</summary>
public interface IPlanningActorResolver
{
    /// <summary>Resolves one actor or returns explicit authorization failure.</summary>
    ApplicationResult<PlanningActor> Resolve(HttpContext context);
}

/// <summary>Local-only actor resolver using explicit development headers.</summary>
public sealed class DevelopmentHeaderActorResolver : IPlanningActorResolver
{
    /// <summary>Actor identifier header.</summary>
    public const string ActorIdHeader = "X-Planning-Actor-Id";

    /// <summary>Actor kind header.</summary>
    public const string ActorKindHeader = "X-Planning-Actor-Kind";

    /// <summary>Comma-separated access grants header.</summary>
    public const string ActorAccessHeader = "X-Planning-Actor-Access";

    /// <inheritdoc />
    public ApplicationResult<PlanningActor> Resolve(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        string actorId = context.Request.Headers[ActorIdHeader].ToString().Trim();
        string actorKind = context.Request.Headers[ActorKindHeader].ToString().Trim();
        string access = context.Request.Headers[ActorAccessHeader].ToString().Trim();
        if (string.IsNullOrWhiteSpace(actorId)
            || !Enum.TryParse(actorKind, true, out PlanningActorKind kind))
        {
            return ApplicationResults.Failure<PlanningActor>(
                ApplicationResultStatus.Unauthorized,
                "ACTOR_REQUIRED",
                "Valid planning actor identity headers are required.");
        }

        var grants = new HashSet<PlanningAccess>();
        foreach (string value in access.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (!Enum.TryParse(value, true, out PlanningAccess grant))
            {
                return ApplicationResults.Failure<PlanningActor>(
                    ApplicationResultStatus.Unauthorized,
                    "ACTOR_ACCESS_INVALID",
                    $"Planning access value '{value}' is not recognized.");
            }

            grants.Add(grant);
        }

        return ApplicationResults.Success(new PlanningActor(actorId, kind, grants));
    }
}
