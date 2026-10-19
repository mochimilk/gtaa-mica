import assert from "node:assert/strict";
import test from "node:test";
import {
    applyTimelineFilters,
    autoScrollDelta,
    createTimelineScale,
    parseInterval,
    proposeTimelineMove,
    timelineOverlaysForRow,
    transitionTimelineIntent,
} from "../src/index.ts";
import { items, overlays, rows, window } from "./syntheticFixture.ts";

test("synthetic fixture is domain-neutral and preserves cross-midnight intervals", () => {
    assert.deepEqual(rows.map((row) => row.id), ["cell-cut", "cell-finish"]);
    assert.equal(overlays[0]?.payload.reason, "Preventive maintenance");
    const interval = parseInterval(items[0]!.displayInterval!);
    assert.equal(interval!.endMs - interval!.startMs, 60 * 60_000);
    assert.equal(items[1]?.state, "unassigned");
    assert.equal(items[1]?.displayInterval, null);
});

test("scale maps, clips, and hit-tests intervals", () => {
    const scale = createTimelineScale(window, 2);
    assert.equal(scale.width, 720);
    assert.equal(scale.xForTime(Date.parse("2026-10-17T00:00:00.000Z")), 240);
    assert.equal(scale.timeForX(240), Date.parse("2026-10-17T00:00:00.000Z"));

    const geometry = scale.geometry({
        startUtc: "2026-10-16T21:30:00.000Z",
        endUtc: "2026-10-16T22:30:00.000Z",
    });
    assert.deepEqual(geometry, {
        left: 0,
        width: 60,
        clippedStart: true,
        clippedEnd: false,
    });
    assert.equal(scale.contains(items[0]!.displayInterval!, 190), true);
    assert.equal(scale.contains(items[0]!.displayInterval!, 400), false);
    const itemEnd = scale.xForTime(Date.parse(items[0]!.displayInterval!.endUtc));
    assert.equal(scale.contains(items[0]!.displayInterval!, itemEnd), false);
});

test("invalid and missing intervals stay explicit", () => {
    assert.equal(parseInterval({ startUtc: "invalid", endUtc: "2026-10-17T00:00:00Z" }), null);
    assert.equal(parseInterval({
        startUtc: "2026-10-17T00:00:00Z",
        endUtc: "2026-10-17T00:00:00Z",
    }), null);
    assert.throws(
        () => createTimelineScale({ ...window, timeZone: "" }, 2),
        /timeZone is required/,
    );
    assert.throws(
        () => proposeTimelineMove(items[1]!, {
            targetRowId: "cell-finish",
            pointerTimeMs: 1,
            grabOffsetMs: 0,
            snapMinutes: 5,
        }),
        /without a display interval/,
    );
});

test("move proposal shifts display and reservation without conflating them", () => {
    const item = items[0]!;
    const displayStartMs = Date.parse(item.displayInterval!.startUtc);
    const intent = proposeTimelineMove(item, {
        targetRowId: "cell-finish",
        pointerTimeMs: displayStartMs + 47 * 60_000,
        grabOffsetMs: 2 * 60_000,
        snapMinutes: 5,
        intentId: "intent-1",
    });

    assert.equal(intent.sourceRowId, "cell-cut");
    assert.equal(intent.targetRowId, "cell-finish");
    assert.equal(intent.proposedDisplayInterval.startUtc, "2026-10-17T00:15:00.000Z");
    assert.equal(intent.proposedReservationInterval!.startUtc, "2026-10-17T00:05:00.000Z");
    assert.equal(
        Date.parse(intent.proposedReservationInterval!.startUtc)
            - Date.parse(intent.proposedDisplayInterval.startUtc),
        -10 * 60_000,
    );
    assert.equal(item.displayInterval!.startUtc, "2026-10-16T23:30:00.000Z");
});

test("intent state machine allows review outcomes but rejects rewrites", () => {
    const proposed = proposeTimelineMove(items[0]!, {
        targetRowId: "cell-finish",
        pointerTimeMs: Date.parse("2026-10-17T00:00:00.000Z"),
        grabOffsetMs: 0,
        snapMinutes: 5,
    });
    const pending = transitionTimelineIntent(proposed, "pending");
    const rejected = transitionTimelineIntent(pending, "rejected");
    assert.equal(rejected.status, "rejected");
    assert.throws(() => transitionTimelineIntent(rejected, "accepted"), /cannot transition/);
});

test("filters distinguish hidden items from visible dimmed evidence", () => {
    const result = applyTimelineFilters(items, [
        {
            id: "assigned-only",
            effect: "hide",
            predicate: (item) => item.state !== "excluded",
        },
        {
            id: "expedite-focus",
            effect: "dim",
            predicate: (item) => item.payload.priority === "expedite",
        },
    ]);
    assert.deepEqual(result.visible.map((item) => item.id), ["job-1042", "job-unassigned"]);
    assert.deepEqual([...result.dimmedIds], ["job-unassigned"]);
});

test("auto-scroll is zero in the safe area and proportional near edges", () => {
    assert.equal(autoScrollDelta(500, 1000), 0);
    assert.equal(autoScrollDelta(40, 1000), -10);
    assert.equal(autoScrollDelta(980, 1000), 15);
});

test("overlays are row-scoped and ordered by layer then identity", () => {
    const values = timelineOverlaysForRow([
        {
            id: "z-global",
            layer: 20,
            interval: overlays[0]!.interval,
            interaction: overlays[0]!.interaction,
            payload: overlays[0]!.payload,
        },
        overlays[0]!,
        {
            id: "a-global",
            layer: 20,
            interval: overlays[0]!.interval,
            interaction: overlays[0]!.interaction,
            payload: overlays[0]!.payload,
        },
    ], "cell-finish");
    assert.deepEqual(values.map((overlay) => overlay.id), [
        "maintenance-1",
        "a-global",
        "z-global",
    ]);
    assert.deepEqual(timelineOverlaysForRow(overlays, "cell-cut"), []);
});
