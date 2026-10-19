import "./setupDom.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import type {
    PlanningReviewRequest,
    PlanningValidationFinding,
} from "@planning/timeline-application";
import type {
    TimelineItem,
    TimelineRow,
    TimelineWindow,
} from "@planning/timeline-core";
import {
    PlanningTimelineReview,
    type TimelineReviewEvidence,
    type TimelineReviewRevision,
} from "../src/index.ts";

const revision: TimelineReviewRevision = {
    planId: "draft-1",
    version: 3,
    fingerprint: "fingerprint-3",
};
const windowValue: TimelineWindow = {
    startUtc: "2026-10-16T10:00:00Z",
    endUtc: "2026-10-16T14:00:00Z",
    timeZone: "UTC",
};
const rows: readonly TimelineRow[] = [
    { id: "machine-a", label: "Machine A", order: 1 },
];
const items: readonly TimelineItem[] = [
    {
        id: "job-1",
        rowId: "machine-a",
        label: "Job one",
        accessibilityLabel: "Job one",
        state: "assigned",
        displayInterval: {
            startUtc: "2026-10-16T11:00:00Z",
            endUtc: "2026-10-16T12:00:00Z",
        },
        reservationInterval: {
            startUtc: "2026-10-16T11:00:00Z",
            endUtc: "2026-10-16T12:00:00Z",
        },
        payload: {},
    },
];

test.afterEach(cleanup);

test("blocks submission when evidence is incomplete and links findings to items", () => {
    const selected: string[] = [];
    const finding: PlanningValidationFinding = {
        code: "RESOURCE_OVERLAP",
        detail: "Jobs overlap.",
        itemId: "job-1",
        otherItemId: "missing-job",
        resourceId: "machine-a",
    };
    const result = renderWorkspace({
        evidence: evidence({
            validation: { passed: false, findings: [finding] },
            unverifiableChecks: ["Compatibility matrix unavailable"],
        }),
        onSelectItem: (itemId) => selected.push(itemId),
    });

    const submit = result.getByRole("button", { name: "Submit exact revision for review" });
    assert.equal(submit.hasAttribute("disabled"), true);
    fireEvent.click(result.getByRole("button", { name: "Focus job-1" }));
    assert.deepEqual(selected, ["job-1"]);
    assert.equal(result.getByRole("button", { name: "Job one" }).getAttribute("aria-pressed"), "true");
    assert.match(result.getByLabelText("Readiness issues").textContent ?? "", /did not pass/);
    assert.ok(result.getByText("missing-job"));
});

test("submits a validated exact revision with an explicit justification", () => {
    const submissions: string[] = [];
    const result = renderWorkspace({
        onSubmit: (justification) => submissions.push(justification),
    });
    const submit = result.getByRole("button", { name: "Submit exact revision for review" });
    assert.equal(submit.hasAttribute("disabled"), true);
    fireEvent.change(result.getByLabelText("Review justification"), {
        target: { value: "Validation and population evidence reviewed." },
    });
    assert.equal(submit.hasAttribute("disabled"), false);
    fireEvent.click(submit);
    assert.deepEqual(submissions, ["Validation and population evidence reviewed."]);
});

test("requires a human reviewer and exact revision for decisions", () => {
    const decisions: string[] = [];
    const agent = renderWorkspace({
        review: review("Pending"),
        actor: { kind: "Agent", access: ["ReviewDecide"] },
        onDecide: (decision) => decisions.push(decision),
    });
    fireEvent.change(agent.getByLabelText("Decision note"), {
        target: { value: "Looks correct." },
    });
    assert.equal(agent.getByRole("button", { name: "Approve exact revision" }).hasAttribute("disabled"), true);
    assert.match(agent.getByLabelText("Review actions").textContent ?? "", /Only a human reviewer/);
    cleanup();

    const human = renderWorkspace({
        review: review("Pending"),
        actor: { kind: "Human", access: ["ReviewDecide"] },
        onDecide: (decision, note) => decisions.push(`${decision}:${note}`),
    });
    fireEvent.change(human.getByLabelText("Decision note"), {
        target: { value: "Evidence is complete." },
    });
    fireEvent.click(human.getByRole("button", { name: "Approve exact revision" }));
    assert.deepEqual(decisions, ["Approved:Evidence is complete."]);
});

test("blocks decisions when the review references another fingerprint", () => {
    const mismatched = {
        ...review("Pending"),
        draftFingerprint: "different-fingerprint",
    };
    const result = renderWorkspace({
        review: mismatched,
        actor: { kind: "Human", access: ["ReviewDecide"] },
    });

    fireEvent.change(result.getByLabelText("Decision note"), {
        target: { value: "This should not be accepted." },
    });

    assert.ok(result.getByRole("alert"));
    assert.equal(
        result.getByRole("button", { name: "Approve exact revision" }).hasAttribute("disabled"),
        true,
    );
});

test("requires human confirmation before publishing the exact approved revision", () => {
    let publications = 0;
    const result = renderWorkspace({
        review: review("Approved"),
        actor: { kind: "Human", access: ["Publish"] },
        onPublish: () => publications++,
    });
    const publish = result.getByRole("button", { name: "Publish approved revision" });
    assert.equal(publish.hasAttribute("disabled"), true);
    fireEvent.click(result.getByLabelText("Publish the exact approved version and fingerprint"));
    assert.equal(publish.hasAttribute("disabled"), false);
    fireEvent.click(publish);
    assert.equal(publications, 1);
});

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof PlanningTimelineReview>> = {}) {
    return render(
        <PlanningTimelineReview
            revision={revision}
            evidence={evidence()}
            actor={{ kind: "Human", access: ["ReviewSubmit"] }}
            rows={rows}
            items={items}
            window={windowValue}
            {...overrides}
        />,
    );
}

function evidence(
    overrides: Partial<TimelineReviewEvidence> = {},
): TimelineReviewEvidence {
    return {
        revision,
        validation: { passed: true, findings: [] },
        unverifiableChecks: [],
        population: {
            totalCount: 1,
            assignedCount: 1,
            unassignedCount: 0,
            excludedCount: 0,
            droppedCount: 0,
        },
        validatorId: "complete-plan-validator@1",
        ruleSetFingerprint: "rules-1",
        referenceDataFingerprint: "references-1",
        validatedAtUtc: "2026-10-16T20:00:00Z",
        ...overrides,
    };
}

function review(status: "Pending" | "Approved"): PlanningReviewRequest {
    return {
        reviewRequestId: "review-1",
        draftId: revision.planId,
        draftVersion: revision.version,
        draftFingerprint: revision.fingerprint,
        status,
        justification: "Ready",
        submittedBy: "author",
        decidedBy: status === "Approved" ? "reviewer" : null,
        decisionNote: status === "Approved" ? "Approved" : null,
        publishedPlanId: null,
    };
}
