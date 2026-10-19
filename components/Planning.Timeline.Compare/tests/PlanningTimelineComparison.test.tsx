import "./setupDom.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import type {
    TimelineItem,
    TimelineRow,
    TimelineWindow,
} from "@planning/timeline-core";
import {
    PlanningTimelineComparison,
    type TimelineComparisonBasis,
} from "../src/index.ts";

interface Job {
    stableId: string;
}

const windowValue: TimelineWindow = {
    startUtc: "2026-10-16T10:00:00Z",
    endUtc: "2026-10-16T16:00:00Z",
    timeZone: "UTC",
};
const rows: readonly TimelineRow[] = [
    { id: "one", label: "Cell one", order: 1 },
    { id: "two", label: "Cell two", order: 2 },
];
const basis: TimelineComparisonBasis = {
    populationFingerprint: "population-1",
    planningHorizon: windowValue,
    rowCatalogFingerprint: "rows-1",
    ruleSetFingerprint: "rules-1",
    metricDefinitionFingerprint: "metrics-1",
    exclusionsFingerprint: "none",
};

const makeItem = (
    id: string,
    stableId: string,
    rowId: string | null,
    startUtc: string | null,
    endUtc: string | null,
): TimelineItem<Job> => ({
    id,
    rowId,
    label: stableId,
    accessibilityLabel: `${stableId} ${id}`,
    state: rowId === null ? "unassigned" : "assigned",
    displayInterval: startUtc === null || endUtc === null
        ? null
        : { startUtc, endUtc },
    reservationInterval: startUtc === null || endUtc === null
        ? null
        : { startUtc, endUtc },
    payload: { stableId },
});

const baselineItems = [
    makeItem("baseline-a", "a", "one", "2026-10-16T11:00:00Z", "2026-10-16T12:00:00Z"),
    makeItem("baseline-removed", "removed", "two", "2026-10-16T12:00:00Z", "2026-10-16T13:00:00Z"),
] satisfies readonly TimelineItem<Job>[];
const candidateItems = [
    makeItem("candidate-a", "a", "two", "2026-10-16T11:30:00Z", "2026-10-16T12:30:00Z"),
    makeItem("candidate-added", "added", null, null, null),
] satisfies readonly TimelineItem<Job>[];

test.afterEach(cleanup);

test("links selection, scrolling, zoom, filters, and comparison evidence", () => {
    const selected: string[] = [];
    const result = render(
        <PlanningTimelineComparison
            rows={rows}
            window={windowValue}
            baseline={{
                title: "Baseline",
                items: baselineItems,
                metrics: [{ id: "hold", label: "Expected hold", value: 40, unit: "minutes" }],
                basis,
            }}
            candidate={{
                title: "Candidate",
                items: candidateItems,
                metrics: [{ id: "hold", label: "Expected hold", value: 25, unit: "minutes" }],
                basis,
            }}
            identity={(item) => item.payload.stableId}
            selectedKey="a"
            filters={[{
                id: "hide-removed",
                effect: "hide",
                predicate: (item) => item.payload.stableId !== "removed",
            }]}
            onSelectionChange={(key) => selected.push(key)}
        />,
    );

    const baselineViewport = result.getByTestId("baseline-timeline-viewport");
    const candidateViewport = result.getByTestId("candidate-timeline-viewport");
    baselineViewport.scrollLeft = 140;
    fireEvent.scroll(baselineViewport);

    assert.equal(candidateViewport.scrollLeft, 140);
    assert.equal(result.getAllByLabelText("Timeline zoom")[0]?.textContent, "2.0 px/min");
    fireEvent.click(result.getAllByRole("button", { name: "Zoom in" })[1]!);
    assert.deepEqual(
        result.getAllByLabelText("Timeline zoom").map((node) => node.textContent),
        ["2.5 px/min", "2.5 px/min"],
    );

    const baselineA = result.getByRole("button", { name: "a baseline-a" });
    const candidateA = result.getByRole("button", { name: "a candidate-a" });
    assert.equal(baselineA.getAttribute("aria-pressed"), "true");
    assert.equal(candidateA.getAttribute("aria-pressed"), "true");
    assert.equal(candidateA.getAttribute("data-pattern"), "comparison-moved-retimed");
    fireEvent.click(candidateA);
    assert.deepEqual(selected, ["a"]);

    assert.equal(result.queryByRole("button", { name: "removed baseline-removed" }), null);
    assert.ok(result.getByRole("region", { name: "Unassigned items" }));
    assert.match(result.getByRole("region", { name: "Comparison evidence" }).textContent ?? "", /-15 minutes/);
    assert.match(result.getByRole("region", { name: "Change summary" }).textContent ?? "", /1added/);
});
