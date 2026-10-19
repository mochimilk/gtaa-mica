import "./setupDom.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import type {
    TimelineItem,
    TimelineMoveIntent,
    TimelineOverlay,
    TimelineRow,
    TimelineWindow,
} from "@planning/timeline-core";
import { PlanningTimeline } from "../src/index.ts";

interface Job {
    workOrder: string;
    priority: "normal" | "expedite";
}

const windowValue: TimelineWindow = {
    startUtc: "2026-10-16T22:00:00.000Z",
    endUtc: "2026-10-17T04:00:00.000Z",
    timeZone: "America/Los_Angeles",
};
const rows: readonly TimelineRow[] = [
    { id: "machine-a", label: "Machine A", order: 1 },
    { id: "machine-b", label: "Machine B", order: 2 },
];
const items: readonly TimelineItem<Job>[] = [
    {
        id: "job-1",
        rowId: "machine-a",
        label: "WO-1",
        accessibilityLabel: "Expedite work order one",
        state: "assigned",
        displayInterval: {
            startUtc: "2026-10-16T23:30:00.000Z",
            endUtc: "2026-10-17T00:30:00.000Z",
        },
        reservationInterval: {
            startUtc: "2026-10-16T23:20:00.000Z",
            endUtc: "2026-10-17T00:40:00.000Z",
        },
        visual: {
            shapeToken: "hexagonal",
            fillToken: "expedite",
            badgeTokens: ["hold"],
        },
        payload: { workOrder: "WO-1", priority: "expedite" },
    },
    {
        id: "job-2",
        rowId: null,
        label: "WO-2",
        accessibilityLabel: "Unassigned work order two",
        state: "unassigned",
        displayInterval: null,
        reservationInterval: null,
        payload: { workOrder: "WO-2", priority: "normal" },
    },
];
const overlays: readonly TimelineOverlay<{ label: string }>[] = [
    {
        id: "maintenance",
        layer: 10,
        interval: {
            startUtc: "2026-10-17T01:00:00.000Z",
            endUtc: "2026-10-17T02:00:00.000Z",
        },
        rowIds: ["machine-b"],
        interaction: "select",
        payload: { label: "Maintenance" },
    },
];

test.afterEach(cleanup);

test("renders custom item content, visual channels, overlays, and unassigned demand", () => {
    const selectedOverlays: string[] = [];
    const result = render(
        <PlanningTimeline
            rows={rows}
            items={items}
            overlays={overlays}
            window={windowValue}
            selectedId="job-1"
            intentStatusByItemId={new Map([["job-1", "rejected"]])}
            renderers={{
                body: ({ item }) => <span>{item.payload.priority}</span>,
                label: ({ item }) => <strong>{item.payload.workOrder}</strong>,
                badges: ({ item }) => item.visual?.badgeTokens?.map((badge) => <i key={badge}>{badge}</i>) ?? [],
                details: ({ item }) => <span>Details for {item.label}</span>,
            }}
            renderOverlay={(overlay) => <span>{overlay.payload.label}</span>}
            onOverlaySelect={(overlay) => selectedOverlays.push(overlay.id)}
        />,
    );

    const item = result.getByRole("button", { name: "Expedite work order one" });
    assert.equal(item.getAttribute("data-shape"), "hexagonal");
    assert.equal(item.getAttribute("data-fill"), "expedite");
    assert.equal(item.getAttribute("data-intent-status"), "rejected");
    assert.equal(item.getAttribute("aria-pressed"), "true");
    assert.match(item.textContent ?? "", /WO-1/);
    assert.match(item.textContent ?? "", /hold/);
    assert.match(item.textContent ?? "", /Details for WO-1/);
    fireEvent.click(result.getByRole("button", { name: "Maintenance" }));
    assert.deepEqual(selectedOverlays, ["maintenance"]);
    assert.ok(result.getByRole("region", { name: "Unassigned items" }));
    assert.ok(result.getByRole("button", { name: "Unassigned work order two" }));
    assert.ok(result.getByText("03:00 PM"));
});

test("selection, zoom, and scroll synchronization stay host-controlled", () => {
    const selected: string[] = [];
    const zooms: number[] = [];
    const scrolls: number[] = [];
    const result = render(
        <PlanningTimeline
            rows={rows}
            items={items}
            window={windowValue}
            scrollLeft={120}
            onSelect={(item) => selected.push(item.id)}
            onZoomChange={(zoom) => zooms.push(zoom)}
            onScrollLeftChange={(value) => scrolls.push(value)}
        />,
    );

    const viewport = result.getByTestId("timeline-viewport");
    assert.equal(viewport.scrollLeft, 120);
    fireEvent.click(result.getByRole("button", { name: "Expedite work order one" }));
    fireEvent.click(result.getByRole("button", { name: "Zoom in" }));
    viewport.scrollLeft = 180;
    fireEvent.scroll(viewport);

    assert.deepEqual(selected, ["job-1"]);
    assert.deepEqual(zooms, [2.5]);
    assert.deepEqual(scrolls, [180]);
});

test("controlled zoom and accessible instance labels support composed timelines", () => {
    const zooms: number[] = [];
    const result = render(
        <PlanningTimeline
            ariaLabel="Candidate timeline"
            viewportTestId="candidate-viewport"
            rows={rows}
            items={items}
            window={windowValue}
            pxPerMinute={3}
            onZoomChange={(zoom) => zooms.push(zoom)}
        />,
    );

    assert.ok(result.getByRole("region", { name: "Candidate timeline" }));
    assert.ok(result.getByTestId("candidate-viewport"));
    assert.equal(result.getByLabelText("Timeline zoom").textContent, "3.0 px/min");

    fireEvent.click(result.getByRole("button", { name: "Zoom in" }));

    assert.deepEqual(zooms, [3.5]);
    assert.equal(result.getByLabelText("Timeline zoom").textContent, "3.0 px/min");
});

test("drag emits a proposal without mutating the source item", () => {
    const intents: TimelineMoveIntent<Job>[] = [];
    const result = render(
        <PlanningTimeline
            rows={rows}
            items={items}
            window={windowValue}
            editable
            onMoveIntent={(intent) => intents.push(intent)}
        />,
    );
    const source = result.getByRole("button", { name: "Expedite work order one" });
    const target = result.container.querySelector<HTMLElement>('[data-timeline-row-id="machine-b"]')!;
    const sourceTrack = result.container.querySelector<HTMLElement>('[data-timeline-row-id="machine-a"]')!;
    sourceTrack.getBoundingClientRect = () => rectangle(0, 0, 720, 48);
    target.getBoundingClientRect = () => rectangle(0, 48, 720, 48);
    result.getByTestId("timeline-viewport").getBoundingClientRect =
        () => rectangle(0, 0, 720, 300);
    document.elementFromPoint = () => target;

    fireEvent.pointerDown(source, { clientX: 190, clientY: 24, pointerId: 1 });
    fireEvent.pointerMove(source, { clientX: 310, clientY: 72, pointerId: 1 });
    fireEvent.pointerUp(source, { clientX: 310, clientY: 72, pointerId: 1 });

    assert.equal(intents.length, 1);
    assert.equal(intents[0]?.targetRowId, "machine-b");
    assert.equal(intents[0]?.status, "proposed");
    assert.equal(items[0]?.rowId, "machine-a");
    assert.equal(items[0]?.displayInterval?.startUtc, "2026-10-16T23:30:00.000Z");
});

test("vertical-only drag between rows still emits a proposal", () => {
    const intents: TimelineMoveIntent<Job>[] = [];
    const result = render(
        <PlanningTimeline
            rows={rows}
            items={items}
            window={windowValue}
            editable
            onMoveIntent={(intent) => intents.push(intent)}
        />,
    );
    const source = result.getByRole("button", { name: "Expedite work order one" });
    const target = result.container.querySelector<HTMLElement>('[data-timeline-row-id="machine-b"]')!;
    const sourceTrack = result.container.querySelector<HTMLElement>('[data-timeline-row-id="machine-a"]')!;
    sourceTrack.getBoundingClientRect = () => rectangle(0, 0, 720, 48);
    target.getBoundingClientRect = () => rectangle(0, 48, 720, 48);
    result.getByTestId("timeline-viewport").getBoundingClientRect =
        () => rectangle(0, 0, 720, 300);
    document.elementFromPoint = () => target;

    fireEvent.pointerDown(source, { clientX: 190, clientY: 24, pointerId: 1 });
    fireEvent.pointerMove(source, { clientX: 190, clientY: 72, pointerId: 1 });
    fireEvent.pointerUp(source, { clientX: 190, clientY: 72, pointerId: 1 });

    assert.equal(intents.length, 1);
    assert.equal(intents[0]?.targetRowId, "machine-b");
});

function rectangle(
    left: number,
    top: number,
    width: number,
    height: number,
): DOMRect {
    return {
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON: () => ({}),
    };
}
