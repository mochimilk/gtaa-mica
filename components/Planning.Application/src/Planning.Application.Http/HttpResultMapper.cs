namespace Planning.Application.Http;

internal static class HttpResultMapper
{
    public static IResult ToHttpResult<T>(this ApplicationResult<T> result)
    {
        ArgumentNullException.ThrowIfNull(result);
        if (result.Succeeded)
        {
            return Results.Ok(result.Value);
        }

        int status = result.Status switch
        {
            ApplicationResultStatus.Rejected => StatusCodes.Status422UnprocessableEntity,
            ApplicationResultStatus.NotFound => StatusCodes.Status404NotFound,
            ApplicationResultStatus.Conflict => StatusCodes.Status409Conflict,
            ApplicationResultStatus.Unauthorized => StatusCodes.Status403Forbidden,
            _ => StatusCodes.Status500InternalServerError
        };
        var extensions = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["errorCode"] = result.Error!.Code
        };
        if (result.Error.Validation is not null)
        {
            extensions["validation"] = result.Error.Validation;
        }

        return Results.Problem(
            statusCode: status,
            title: result.Error.Code,
            detail: result.Error.Detail,
            extensions: extensions);
    }

    public static bool TryResolveActor(
        HttpContext context,
        IPlanningActorResolver resolver,
        out PlanningActor actor,
        out IResult? failure)
    {
        ApplicationResult<PlanningActor> result = resolver.Resolve(context);
        if (!result.Succeeded)
        {
            actor = default!;
            failure = result.ToHttpResult();
            return false;
        }

        actor = result.Value!;
        failure = null;
        return true;
    }
}
