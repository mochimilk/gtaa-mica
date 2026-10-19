import assert from "node:assert/strict";
import test from "node:test";
import type { TimelineItem, TimelineMoveIntent } from "@planning/timeline-core";
import {
    moveIntentToChange,
    PlanningTimelineApplicationClient,
} from "../src/index.ts";

const item: TimelineItem = {
    id: "job-1",
    rowId: "machine-a",
    label: "WO-1",
    accessibilityLabel: "Work order one",
    state: "assigned",
    displayInterval: {
        startUtc: "2027-01-15T09:10:00.000Z",
        endUtc: "2027-01-15T09:50:00.000Z",
    },
    reservationInterval: {
        startUtc: "2027-01-15T09:00:00.000Z",
        endUtc: "2027-01-15T10:00:00.000Z",
    },
    payload: {},
};
const intent: TimelineMoveIntent = {
    id: "intent-1",
    item,
    sourceRowId: "machine-a",
    targetRowId: "machine-b",
    originalDisplayInterval: item.displayInterval!,
    proposedDisplayInterval: {
        startUtc: "2027-01-15T10:10:00.000Z",
        endUtc: "2027-01-15T10:50:00.000Z",
    },
    originalReservationInterval: item.reservationInterval,
    proposedReservationInterval: {
        startUtc: "2027-01-15T10:00:00.000Z",
        endUtc: "2027-01-15T11:00:00.000Z",
    },
    status: "proposed",
};

test("interval basis explicitly controls the authoritative change window", () => {
    assert.deepEqual(moveIntentToChange(intent, "display"), {
        itemId: "job-1",
        newResourceId: "machine-b",
        newStartUtc: "2027-01-15T10:10:00.000Z",
        newEndUtc: "2027-01-15T10:50:00.000Z",
    });
    assert.deepEqual(moveIntentToChange(intent, "reservation"), {
        itemId: "job-1",
        newResourceId: "machine-b",
        newStartUtc: "2027-01-15T10:00:00.000Z",
        newEndUtc: "2027-01-15T11:00:00.000Z",
    });
});

test("preview sends actor headers, expected version, and one typed change", async () => {
    let captured: Request | null = null;
    const client = createClient(async (input, init) => {
        captured = new Request(input, init);
        return jsonResponse({
            proposed: snapshot(2),
            validation: { findings: [], passed: true },
            changes: [],
        });
    });

    const result = await client.previewMove(
        "draft/1",
        3,
        intent,
        "reservation",
    );

    assert.equal(result.status, "succeeded");
    assert.match(captured!.url, /draft%2F1\/preview$/);
    assert.equal(captured!.headers.get("X-Planning-Actor-Id"), "timeline-demo");
    assert.equal(captured!.headers.get("X-Planning-Actor-Access"), "Read,DraftWrite");
    const body = await captured!.json() as Record<string, unknown>;
    assert.equal(body.expectedVersion, 3);
    assert.deepEqual(body.changes, [{
        itemId: "job-1",
        newResourceId: "machine-b",
        newStartUtc: "2027-01-15T10:00:00.000Z",
        newEndUtc: "2027-01-15T11:00:00.000Z",
    }]);
});

test("rule rejection preserves validation evidence", async () => {
    const client = createClient(async () => jsonResponse({
        errorCode: "CHANGE_REJECTED",
        detail: "The proposed revision violates hard rules.",
        validation: {
            passed: false,
            findings: [{
                code: "RESOURCE_OVERLAP",
                detail: "Jobs overlap.",
                itemId: "job-1",
                otherItemId: "job-2",
                resourceId: "machine-b",
            }],
        },
    }, 422));

    const result = await client.commitMove(
        "draft-1",
        1,
        intent,
        "reservation",
        "commit-1",
    );

    assert.equal(result.status, "rejected");
    assert.equal(result.error.code, "CHANGE_REJECTED");
    assert.equal(result.error.validation?.findings[0]?.code, "RESOURCE_OVERLAP");
});

test("review operations preserve exact revisions, decisions, and actor headers", async () => {
    const requests: Request[] = [];
    const client = createClient(async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/publish")) {
            return jsonResponse(snapshot(4));
        }
        return jsonResponse(review("Pending"));
    });

    const submitted = await client.submitReview(
        "draft/1",
        4,
        "Independent validation passed.",
        "submit-1",
    );
    const loaded = await client.getReview("review/1");
    const decided = await client.decideReview(
        "review/1",
        "Approved",
        "Evidence reviewed.",
        "decision-1",
    );
    const published = await client.publishReview("review/1", "publish-1");

    assert.equal(submitted.status, "succeeded");
    assert.equal(loaded.status, "succeeded");
    assert.equal(decided.status, "succeeded");
    assert.equal(published.status, "succeeded");
    assert.match(requests[0]!.url, /draft%2F1\/reviews$/);
    assert.deepEqual(await requests[0]!.json(), {
        expectedVersion: 4,
        justification: "Independent validation passed.",
        idempotencyKey: "submit-1",
    });
    assert.match(requests[1]!.url, /reviews\/review%2F1$/);
    assert.deepEqual(await requests[2]!.json(), {
        decision: "Approved",
        note: "Evidence reviewed.",
        idempotencyKey: "decision-1",
    });
    assert.deepEqual(await requests[3]!.json(), {
        idempotencyKey: "publish-1",
    });
    assert.equal(requests[3]!.headers.get("X-Planning-Actor-Kind"), "Human");
});

test("non-json and network failures remain explicit while cancellation propagates", async () => {
    const invalid = createClient(async () => new Response("gateway failure", { status: 502 }));
    assert.deepEqual(await invalid.getPlan("plan-1"), {
        status: "failed",
        error: {
            code: "PLANNING_API_INVALID_RESPONSE",
            detail: "Planning API returned an empty or non-JSON response.",
        },
    });

    const unavailable = createClient(async () => {
        throw new TypeError("connection refused");
    });
    assert.deepEqual(await unavailable.getPlan("plan-1"), {
        status: "failed",
        error: {
            code: "PLANNING_API_UNAVAILABLE",
            detail: "connection refused",
        },
    });

    const cancellation = new AbortController();
    cancellation.abort();
    const cancelled = createClient(async () => {
        throw new DOMException("aborted", "AbortError");
    });
    await assert.rejects(
        cancelled.getPlan("plan-1", cancellation.signal),
        /aborted/,
    );
});

function createClient(fetch: typeof globalThis.fetch) {
    return new PlanningTimelineApplicationClient({
        baseUrl: "https://planning.test",
        actor: {
            actorId: "timeline-demo",
            actorKind: "Human",
            access: ["Read", "DraftWrite"],
        },
        fetch,
    });
}

function jsonResponse(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function snapshot(version: number) {
    return {
        planId: "draft-1",
        version,
        state: "Draft",
        sourcePlanId: "plan-1",
        assignments: [],
        fingerprint: `fingerprint-${version}`,
    };
}

function review(status: "Pending" | "Approved") {
    return {
        reviewRequestId: "review-1",
        draftId: "draft-1",
        draftVersion: 4,
        draftFingerprint: "fingerprint-4",
        status,
        justification: "Independent validation passed.",
        submittedBy: "timeline-demo",
        decidedBy: null,
        decisionNote: null,
        publishedPlanId: null,
    };
}
