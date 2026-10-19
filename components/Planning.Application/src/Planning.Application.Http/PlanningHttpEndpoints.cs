namespace Planning.Application.Http;

/// <summary>HTTP adapters for authoritative planning application operations.</summary>
public static class PlanningHttpEndpoints
{
    /// <summary>Maps the versioned planning HTTP API.</summary>
    public static IEndpointRouteBuilder MapPlanningHttpEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        RouteGroupBuilder group = app.MapGroup("/api/v1");
        group.MapGet("/plans/{planId}", GetPlanAsync);
        group.MapPost("/drafts", CreateDraftAsync);
        group.MapPost("/drafts/{draftId}/preview", PreviewChangesAsync);
        group.MapPost("/drafts/{draftId}/changes", CommitChangesAsync);
        group.MapPost("/drafts/{draftId}/reviews", SubmitReviewAsync);
        group.MapGet("/reviews/{reviewId}", GetReviewAsync);
        group.MapPost("/reviews/{reviewId}/decision", DecideReviewAsync);
        group.MapPost("/reviews/{reviewId}/publish", PublishReviewAsync);
        return app;
    }

    private static async Task<IResult> GetPlanAsync(
        string planId,
        HttpContext context,
        IPlanningActorResolver resolver,
        IPlanningApplicationService service,
        CancellationToken cancellationToken)
    {
        if (!HttpResultMapper.TryResolveActor(context, resolver, out PlanningActor actor, out IResult? failure))
        {
            return failure!;
        }

        return (await service.GetPlanAsync(planId, actor, cancellationToken).ConfigureAwait(false))
            .ToHttpResult();
    }

    private static async Task<IResult> CreateDraftAsync(
        CreateDraftHttpRequest request,
        HttpContext context,
        IPlanningActorResolver resolver,
        IPlanningApplicationService service,
        CancellationToken cancellationToken)
    {
        if (!HttpResultMapper.TryResolveActor(context, resolver, out PlanningActor actor, out IResult? failure))
        {
            return failure!;
        }

        return (await service.CreateDraftAsync(
                new CreateDraftCommand(
                    request.SourcePlanId,
                    request.Purpose,
                    request.IdempotencyKey,
                    actor),
                cancellationToken)
            .ConfigureAwait(false)).ToHttpResult();
    }

    private static async Task<IResult> PreviewChangesAsync(
        string draftId,
        PreviewChangesHttpRequest request,
        HttpContext context,
        IPlanningActorResolver resolver,
        IPlanningApplicationService service,
        CancellationToken cancellationToken)
    {
        if (!HttpResultMapper.TryResolveActor(context, resolver, out PlanningActor actor, out IResult? failure))
        {
            return failure!;
        }

        return (await service.PreviewChangesAsync(
                new PreviewChangesQuery(
                    draftId,
                    request.ExpectedVersion,
                    request.Changes.Select(change => change.ToApplicationChange()).ToArray(),
                    actor),
                cancellationToken)
            .ConfigureAwait(false)).ToHttpResult();
    }

    private static async Task<IResult> CommitChangesAsync(
        string draftId,
        CommitChangesHttpRequest request,
        HttpContext context,
        IPlanningActorResolver resolver,
        IPlanningApplicationService service,
        CancellationToken cancellationToken)
    {
        if (!HttpResultMapper.TryResolveActor(context, resolver, out PlanningActor actor, out IResult? failure))
        {
            return failure!;
        }

        return (await service.CommitChangesAsync(
                new CommitChangesCommand(
                    draftId,
                    request.ExpectedVersion,
                    request.Changes.Select(change => change.ToApplicationChange()).ToArray(),
                    request.IdempotencyKey,
                    actor),
                cancellationToken)
            .ConfigureAwait(false)).ToHttpResult();
    }

    private static async Task<IResult> SubmitReviewAsync(
        string draftId,
        SubmitReviewHttpRequest request,
        HttpContext context,
        IPlanningActorResolver resolver,
        IPlanningApplicationService service,
        CancellationToken cancellationToken)
    {
        if (!HttpResultMapper.TryResolveActor(context, resolver, out PlanningActor actor, out IResult? failure))
        {
            return failure!;
        }

        return (await service.SubmitForReviewAsync(
                new SubmitForReviewCommand(
                    draftId,
                    request.ExpectedVersion,
                    request.Justification,
                    request.IdempotencyKey,
                    actor),
                cancellationToken)
            .ConfigureAwait(false)).ToHttpResult();
    }

    private static async Task<IResult> GetReviewAsync(
        string reviewId,
        HttpContext context,
        IPlanningActorResolver resolver,
        IPlanningApplicationService service,
        CancellationToken cancellationToken)
    {
        if (!HttpResultMapper.TryResolveActor(context, resolver, out PlanningActor actor, out IResult? failure))
        {
            return failure!;
        }

        return (await service.GetReviewAsync(reviewId, actor, cancellationToken).ConfigureAwait(false))
            .ToHttpResult();
    }

    private static async Task<IResult> DecideReviewAsync(
        string reviewId,
        DecideReviewHttpRequest request,
        HttpContext context,
        IPlanningActorResolver resolver,
        IPlanningApplicationService service,
        CancellationToken cancellationToken)
    {
        if (!HttpResultMapper.TryResolveActor(context, resolver, out PlanningActor actor, out IResult? failure))
        {
            return failure!;
        }

        return (await service.DecideReviewAsync(
                new DecideReviewCommand(
                    reviewId,
                    request.Decision,
                    request.Note,
                    request.IdempotencyKey,
                    actor),
                cancellationToken)
            .ConfigureAwait(false)).ToHttpResult();
    }

    private static async Task<IResult> PublishReviewAsync(
        string reviewId,
        PublishReviewHttpRequest request,
        HttpContext context,
        IPlanningActorResolver resolver,
        IPlanningApplicationService service,
        CancellationToken cancellationToken)
    {
        if (!HttpResultMapper.TryResolveActor(context, resolver, out PlanningActor actor, out IResult? failure))
        {
            return failure!;
        }

        return (await service.PublishApprovedRevisionAsync(
                new PublishApprovedRevisionCommand(
                    reviewId,
                    request.IdempotencyKey,
                    actor),
                cancellationToken)
            .ConfigureAwait(false)).ToHttpResult();
    }
}
