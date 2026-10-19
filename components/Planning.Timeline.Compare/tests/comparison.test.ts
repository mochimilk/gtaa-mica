import assert from "node:assert/strict";
import test from "node:test";
import type {
    TimelineInterval,
    TimelineItem,
} from "@planning/timeline-core";
import {
    compareTimelineEvidence,
    compareTimelineItems,
    type TimelineComparisonBasis,
} from "../src/index.ts";

interface Job {
    stableId: string;
}

const interval = (
    startUtc: string,
    endUtc: string,
): TimelineInterval => ({ startUtc, endUtc });

function item(
    id: string,
    stableId: string,
    rowId: string | null,
    startUtc: string | null,
    endUtc: string | null,
): TimelineItem<Job> {
    const placement = startUtc === null || endUtc === null
        ? null
        : interval(startUtc, endUtc);
    return {
        id,
        rowId,
        label: stableId,
        accessibilityLabel: stableId,
        state: rowId === null ? "unassigned" : "assigned",
        displayInterval: placement,
        reservationInterval: placement,
        payload: { stableId },
    };
}

const baseline = [
    item("baseline-a", "a", "one", "2026-10-16T10:00:00Z", "2026-10-16T11:00:00Z"),
    item("baseline-b", "b", "one", "2026-10-16T11:00:00Z", "2026-10-16T12:00:00Z"),
    item("baseline-c", "c", "two", "2026-10-16T12:00:00Z", "2026-10-16T13:00:00Z"),
    item("baseline-d", "d", null, null, null),
    item("baseline-removed", "removed", "two", "2026-10-16T13:00:00Z", "2026-10-16T14:00:00Z"),
] satisfies readonly TimelineItem<Job>[];

const candidate = [
    item("candidate-a", "a", "one", "2026-10-16T10:00:00Z", "2026-10-16T11:00:00Z"),
    item("candidate-b", "b", "two", "2026-10-16T11:00:00Z", "2026-10-16T12:00:00Z"),
    item("candidate-c", "c", "one", "2026-10-16T12:30:00Z", "2026-10-16T13:30:00Z"),
    item("candidate-d", "d", "two", "2026-10-16T14:00:00Z", "2026-10-16T15:00:00Z"),
    item("candidate-added", "added", null, null, null),
] satisfies readonly TimelineItem<Job>[];

const basis: TimelineComparisonBasis = {
    populationFingerprint: "population-1",
    planningHorizon: interval("2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z"),
    rowCatalogFingerprint: "rows-1",
    ruleSetFingerprint: "rules-1",
    metricDefinitionFingerprint: "metrics-1",
    exclusionsFingerprint: "exclusions-1",
};

test("classifies stable identities across changed revision-local item IDs", () => {
    const result = compareTimelineItems(
        baseline,
        candidate,
        (value) => value.payload.stableId,
    );
    const byKey = new Map(result.map((entry) => [entry.key, entry]));

    assert.deepEqual(byKey.get("a")?.changeKinds, ["unchanged"]);
    assert.deepEqual(byKey.get("b")?.changeKinds, ["moved"]);
    assert.deepEqual(byKey.get("c")?.changeKinds, ["moved", "retimed"]);
    assert.deepEqual(byKey.get("d")?.changeKinds, ["moved", "retimed"]);
    assert.deepEqual(byKey.get("added")?.changeKinds, ["added"]);
    assert.deepEqual(byKey.get("removed")?.changeKinds, ["removed"]);
});

test("rejects ambiguous cross-revision identities", () => {
    assert.throws(
        () => compareTimelineItems(
            [baseline[0]!, { ...baseline[0]!, id: "duplicate" }],
            candidate,
            (value) => value.payload.stableId,
        ),
        /Duplicate timeline identity 'a'/,
    );
});

test("represents a split as one retained segment and one added segment", () => {
    const splitBaseline = [
        item(
            "baseline-visit",
            "visit:occupancy-1",
            "one",
            "2026-10-16T10:00:00Z",
            "2026-10-16T12:00:00Z",
        ),
    ];
    const splitCandidate = [
        item(
            "candidate-visit-first",
            "visit:occupancy-1",
            "one",
            "2026-10-16T10:00:00Z",
            "2026-10-16T11:00:00Z",
        ),
        item(
            "candidate-visit-second",
            "visit:occupancy-2",
            "two",
            "2026-10-16T11:00:00Z",
            "2026-10-16T12:00:00Z",
        ),
    ];

    const result = compareTimelineItems(
        splitBaseline,
        splitCandidate,
        (value) => value.payload.stableId,
    );

    assert.deepEqual(
        result.map((entry) => [entry.key, entry.changeKinds]),
        [
            ["visit:occupancy-1", ["retimed"]],
            ["visit:occupancy-2", ["added"]],
        ],
    );
});

test("reports raw metric deltas when comparison evidence matches", () => {
    const evidence = compareTimelineEvidence(
        basis,
        { ...basis },
        [
            { id: "capacity", label: "Virtual capacity", value: 22, unit: "slots" },
            { id: "hold", label: "Expected gate hold", value: 85, unit: "minutes" },
        ],
        [
            { id: "capacity", label: "Virtual capacity", value: 27, unit: "slots" },
            { id: "hold", label: "Expected gate hold", value: 70, unit: "minutes" },
        ],
    );

    assert.equal(evidence.comparable, true);
    assert.deepEqual(
        evidence.metrics.map((metric) => [metric.id, metric.delta]),
        [["capacity", 5], ["hold", -15]],
    );
});

test("keeps values visible but marks mismatched evidence noncomparable", () => {
    const evidence = compareTimelineEvidence(
        basis,
        { ...basis, populationFingerprint: "population-2" },
        [{ id: "hold", label: "Expected gate hold", value: 85, unit: "minutes" }],
        [{ id: "hold", label: "Expected gate hold", value: 1.1, unit: "hours" }],
    );

    assert.equal(evidence.comparable, false);
    assert.deepEqual(
        evidence.basisIssues.map((issue) => issue.code),
        ["POPULATION_MISMATCH"],
    );
    assert.equal(evidence.metrics[0]?.beforeValue, 85);
    assert.equal(evidence.metrics[0]?.afterValue, 1.1);
    assert.equal(evidence.metrics[0]?.delta, null);
    assert.equal(evidence.metrics[0]?.comparable, false);
});
