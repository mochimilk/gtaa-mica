import type { TimelineMoveIntent } from "@planning/timeline-core";
import type {
    ChangePreview,
    PlanSnapshot,
    PlanningActorHeaders,
    PlanningReviewDecision,
    PlanningReviewRequest,
    ReassignItemChange,
    TimelineApplicationError,
    TimelineApplicationFailureStatus,
    TimelineApplicationResult,
    TimelineIntervalBasis,
} from "./contracts.ts";

export interface PlanningTimelineApplicationClientOptions {
    baseUrl: string;
    actor: PlanningActorHeaders;
    fetch?: typeof globalThis.fetch;
}

export class PlanningTimelineApplicationClient {
    readonly #baseUrl: string;
    readonly #actor: PlanningActorHeaders;
    readonly #fetch: typeof globalThis.fetch;

    public constructor(options: PlanningTimelineApplicationClientOptions) {
        if (!options.baseUrl.trim()) {
            throw new RangeError("baseUrl is required.");
        }
        if (!options.actor.actorId.trim() || options.actor.access.length === 0) {
            throw new RangeError("A trusted actor ID and explicit access grants are required.");
        }
        this.#baseUrl = options.baseUrl.replace(/\/$/, "");
        this.#actor = options.actor;
        this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    }

    public getPlan(
        planId: string,
        signal?: AbortSignal,
    ): Promise<TimelineApplicationResult<PlanSnapshot>> {
        requireText(planId, "planId");
        return this.#request<PlanSnapshot>(
            `/api/v1/plans/${encodeURIComponent(planId)}`,
            { method: "GET", signal: signal ?? null },
        );
    }

    public createDraft(
        sourcePlanId: string,
        purpose: string,
        idempotencyKey: string,
        signal?: AbortSignal,
    ): Promise<TimelineApplicationResult<PlanSnapshot>> {
        requireText(sourcePlanId, "sourcePlanId");
        requireText(purpose, "purpose");
        requireText(idempotencyKey, "idempotencyKey");
        return this.#request<PlanSnapshot>("/api/v1/drafts", {
            method: "POST",
            body: JSON.stringify({ sourcePlanId, purpose, idempotencyKey }),
            signal: signal ?? null,
        });
    }

    public previewMove<TPayload>(
        draftId: string,
        expectedVersion: number,
        intent: TimelineMoveIntent<TPayload>,
        intervalBasis: TimelineIntervalBasis,
        signal?: AbortSignal,
    ): Promise<TimelineApplicationResult<ChangePreview>> {
        return this.#request<ChangePreview>(
            `/api/v1/drafts/${encodeURIComponent(draftId)}/preview`,
            {
                method: "POST",
                body: JSON.stringify({
                    expectedVersion,
                    changes: [moveIntentToChange(intent, intervalBasis)],
                }),
                signal: signal ?? null,
            },
        );
    }

    public commitMove<TPayload>(
        draftId: string,
        expectedVersion: number,
        intent: TimelineMoveIntent<TPayload>,
        intervalBasis: TimelineIntervalBasis,
        idempotencyKey: string,
        signal?: AbortSignal,
    ): Promise<TimelineApplicationResult<PlanSnapshot>> {
        requireText(idempotencyKey, "idempotencyKey");
        return this.#request<PlanSnapshot>(
            `/api/v1/drafts/${encodeURIComponent(draftId)}/changes`,
            {
                method: "POST",
                body: JSON.stringify({
                    expectedVersion,
                    changes: [moveIntentToChange(intent, intervalBasis)],
                    idempotencyKey,
                }),
                signal: signal ?? null,
            },
        );
    }

    public submitReview(
        draftId: string,
        expectedVersion: number,
        justification: string,
        idempotencyKey: string,
        signal?: AbortSignal,
    ): Promise<TimelineApplicationResult<PlanningReviewRequest>> {
        requireText(draftId, "draftId");
        requireText(justification, "justification");
        requireText(idempotencyKey, "idempotencyKey");
        return this.#request<PlanningReviewRequest>(
            `/api/v1/drafts/${encodeURIComponent(draftId)}/reviews`,
            {
                method: "POST",
                body: JSON.stringify({
                    expectedVersion,
                    justification,
                    idempotencyKey,
                }),
                signal: signal ?? null,
            },
        );
    }

    public getReview(
        reviewId: string,
        signal?: AbortSignal,
    ): Promise<TimelineApplicationResult<PlanningReviewRequest>> {
        requireText(reviewId, "reviewId");
        return this.#request<PlanningReviewRequest>(
            `/api/v1/reviews/${encodeURIComponent(reviewId)}`,
            { method: "GET", signal: signal ?? null },
        );
    }

    public decideReview(
        reviewId: string,
        decision: PlanningReviewDecision,
        note: string,
        idempotencyKey: string,
        signal?: AbortSignal,
    ): Promise<TimelineApplicationResult<PlanningReviewRequest>> {
        requireText(reviewId, "reviewId");
        requireText(note, "note");
        requireText(idempotencyKey, "idempotencyKey");
        return this.#request<PlanningReviewRequest>(
            `/api/v1/reviews/${encodeURIComponent(reviewId)}/decision`,
            {
                method: "POST",
                body: JSON.stringify({ decision, note, idempotencyKey }),
                signal: signal ?? null,
            },
        );
    }

    public publishReview(
        reviewId: string,
        idempotencyKey: string,
        signal?: AbortSignal,
    ): Promise<TimelineApplicationResult<PlanSnapshot>> {
        requireText(reviewId, "reviewId");
        requireText(idempotencyKey, "idempotencyKey");
        return this.#request<PlanSnapshot>(
            `/api/v1/reviews/${encodeURIComponent(reviewId)}/publish`,
            {
                method: "POST",
                body: JSON.stringify({ idempotencyKey }),
                signal: signal ?? null,
            },
        );
    }

    async #request<T>(
        path: string,
        init: RequestInit,
    ): Promise<TimelineApplicationResult<T>> {
        try {
            const response = await this.#fetch(`${this.#baseUrl}${path}`, {
                ...init,
                headers: {
                    "Content-Type": "application/json",
                    "X-Planning-Actor-Id": this.#actor.actorId,
                    "X-Planning-Actor-Kind": this.#actor.actorKind,
                    "X-Planning-Actor-Access": this.#actor.access.join(","),
                    ...init.headers,
                },
            });
            const content = await response.text();
            const payload = parseJson(content);
            if (payload === null) {
                return failure(
                    "failed",
                    "PLANNING_API_INVALID_RESPONSE",
                    "Planning API returned an empty or non-JSON response.",
                );
            }
            if (response.ok) {
                return { status: "succeeded", value: payload as T };
            }
            const error = readError(payload, response.status);
            return { status: statusFor(response.status), error };
        } catch (error) {
            if (init.signal?.aborted === true) {
                throw error;
            }
            return failure(
                "failed",
                "PLANNING_API_UNAVAILABLE",
                error instanceof Error ? error.message : "Planning API request failed.",
            );
        }
    }
}

export function moveIntentToChange<TPayload>(
    intent: TimelineMoveIntent<TPayload>,
    intervalBasis: TimelineIntervalBasis,
): ReassignItemChange {
    if (!intent.targetRowId.trim()) {
        throw new RangeError("Move intent targetRowId is required.");
    }
    const interval = intervalBasis === "reservation"
        ? intent.proposedReservationInterval
        : intent.proposedDisplayInterval;
    if (interval === null) {
        throw new RangeError(`Move intent has no ${intervalBasis} interval.`);
    }
    return {
        itemId: intent.item.id,
        newResourceId: intent.targetRowId,
        newStartUtc: interval.startUtc,
        newEndUtc: interval.endUtc,
    };
}

function requireText(value: string, name: string) {
    if (!value.trim()) {
        throw new RangeError(`${name} is required.`);
    }
}

function parseJson(content: string): unknown | null {
    if (!content.trim()) {
        return null;
    }
    try {
        return JSON.parse(content) as unknown;
    } catch {
        return null;
    }
}

function statusFor(status: number): TimelineApplicationFailureStatus {
    if (status === 404) return "not-found";
    if (status === 409) return "conflict";
    if (status === 401 || status === 403) return "unauthorized";
    if (status === 400 || status === 422 || status === 424) return "rejected";
    return "failed";
}

function readError(payload: unknown, status: number): TimelineApplicationError {
    if (typeof payload !== "object" || payload === null) {
        return {
            code: `HTTP_${status}`,
            detail: `Planning API returned HTTP ${status}.`,
        };
    }
    const value = payload as Record<string, unknown>;
    const error: TimelineApplicationError = {
        code: typeof value.errorCode === "string" ? value.errorCode : `HTTP_${status}`,
        detail: typeof value.detail === "string"
            ? value.detail
            : `Planning API returned HTTP ${status}.`,
    };
    if (isValidation(value.validation)) {
        error.validation = value.validation;
    }
    return error;
}

function isValidation(value: unknown): value is ChangePreview["validation"] {
    return typeof value === "object"
        && value !== null
        && Array.isArray((value as Record<string, unknown>).findings);
}

function failure<T>(
    status: TimelineApplicationFailureStatus,
    code: string,
    detail: string,
): TimelineApplicationResult<T> {
    return { status, error: { code, detail } };
}
