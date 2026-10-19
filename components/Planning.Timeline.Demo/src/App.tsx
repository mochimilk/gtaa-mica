import {
    PlanningTimelineApplicationClient,
    type ChangePreview,
    type PlanSnapshot,
    type PlanningAssignment,
    type PlanningReviewRequest,
    type PlanningValidationFinding,
    type TimelineApplicationError,
} from "@planning/timeline-application";
import {
    PlanningTimelineComparison,
    type TimelineComparisonBasis,
    type TimelineMetric,
} from "@planning/timeline-compare";
import type {
    TimelineIntentStatus,
    TimelineItem,
    TimelineMoveIntent,
    TimelineRenderHooks,
    TimelineRow,
    TimelineWindow,
} from "@planning/timeline-core";
import { PlanningTimeline } from "@planning/timeline-react";
import {
    PlanningTimelineReview,
    type TimelineReviewActor,
    type TimelineReviewEvidence,
} from "@planning/timeline-review";
import React, { useMemo, useState } from "react";

const sourcePlanId = "plan-local-1";
const timelineWindow: TimelineWindow = {
    startUtc: "2027-01-15T08:00:00.000Z",
    endUtc: "2027-01-15T13:00:00.000Z",
    timeZone: "UTC",
};
const comparisonBasis: TimelineComparisonBasis = {
    populationFingerprint: "manufacturing-orders-2027-01-15",
    planningHorizon: timelineWindow,
    rowCatalogFingerprint: "assembly-cells-v1",
    ruleSetFingerprint: "manufacturing-overlap-rules-v1",
    metricDefinitionFingerprint: "manufacturing-demo-metrics-v1",
    exclusionsFingerprint: "none",
};
const rows = rowsFor();

const editorClient = clientFor(
    "timeline-demo-editor",
    "Human",
    ["Read", "DraftWrite"],
);
const submittingAgentClient = clientFor(
    "timeline-demo-agent",
    "Agent",
    ["Read", "ReviewSubmit"],
);
const reviewerClient = clientFor(
    "timeline-demo-reviewer",
    "Human",
    ["Read", "ReviewDecide"],
);
const publisherClient = clientFor(
    "timeline-demo-publisher",
    "Human",
    ["Read", "Publish"],
);

type WorkspaceStage = "edit" | "compare" | "review";
type ReviewPerspective = "agent" | "human";

interface PendingMove {
    intent: TimelineMoveIntent<PlanningAssignment>;
    preview: ChangePreview;
    expectedVersion: number;
}

export function App() {
    const [source, setSource] = useState<PlanSnapshot | null>(null);
    const [draft, setDraft] = useState<PlanSnapshot | null>(null);
    const [review, setReview] = useState<PlanningReviewRequest | null>(null);
    const [published, setPublished] = useState<PlanSnapshot | null>(null);
    const [stage, setStage] = useState<WorkspaceStage>("edit");
    const [reviewPerspective, setReviewPerspective] = useState<ReviewPerspective>("agent");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [statuses, setStatuses] = useState<ReadonlyMap<string, TimelineIntentStatus>>(new Map());
    const [pending, setPending] = useState<PendingMove | null>(null);
    const [error, setError] = useState<TimelineApplicationError | null>(null);
    const [message, setMessage] = useState("Start the demo to create an isolated draft.");
    const [busy, setBusy] = useState(false);
    const sourceItems = useMemo(() => itemsFor(source), [source]);
    const draftItems = useMemo(() => itemsFor(draft), [draft]);
    const evidence = useMemo(
        () => draft === null ? null : evidenceFor(draft),
        [draft],
    );

    const startDemo = async () => {
        setBusy(true);
        setError(null);
        setPending(null);
        setReview(null);
        setPublished(null);
        const loaded = await editorClient.getPlan(sourcePlanId);
        if (loaded.status !== "succeeded") {
            finishWithError(loaded.error, "The source plan could not be loaded.");
            return;
        }
        const created = await editorClient.createDraft(
            loaded.value.planId,
            "Timeline portability demonstration",
            crypto.randomUUID(),
        );
        if (created.status !== "succeeded") {
            finishWithError(created.error, "The isolated draft could not be created.");
            return;
        }
        setSource(loaded.value);
        setDraft(created.value);
        setStatuses(new Map());
        setStage("edit");
        setReviewPerspective("agent");
        setMessage("Draft created. Drag a work order to preview a change.");
        setBusy(false);
    };

    const previewMove = async (intent: TimelineMoveIntent<PlanningAssignment>) => {
        if (draft === null) {
            return;
        }
        setPending(null);
        setError(null);
        setStatus(intent.item.id, "pending");
        setMessage("Checking the complete proposed schedule...");
        const result = await editorClient.previewMove(
            draft.planId,
            draft.version,
            intent,
            "reservation",
        );
        if (result.status !== "succeeded") {
            setStatus(intent.item.id, "rejected");
            setError(result.error);
            setMessage("The application could not preview this proposal.");
            return;
        }
        if (!result.value.validation.passed) {
            setStatus(intent.item.id, "rejected");
            setError({
                code: "CHANGE_REJECTED",
                detail: "The authoritative complete-plan check rejected this proposal.",
                validation: result.value.validation,
            });
            setMessage("Proposal rejected. The draft remains unchanged.");
            return;
        }
        setStatus(intent.item.id, "accepted");
        setPending({
            intent,
            preview: result.value,
            expectedVersion: draft.version,
        });
        setMessage("Preview accepted. Review the proposed revision before committing.");
    };

    const commitMove = async () => {
        if (draft === null || pending === null) {
            return;
        }
        setBusy(true);
        setError(null);
        setStatus(pending.intent.item.id, "pending");
        const result = await editorClient.commitMove(
            draft.planId,
            pending.expectedVersion,
            pending.intent,
            "reservation",
            crypto.randomUUID(),
        );
        if (result.status !== "succeeded") {
            setStatus(pending.intent.item.id, "rejected");
            finishWithError(result.error, "Commit failed. Preview the current draft before retrying.");
            return;
        }
        setDraft(result.value);
        setStatus(pending.intent.item.id, "accepted");
        setPending(null);
        setMessage(`Draft version ${result.value.version} committed. Compare it with the baseline.`);
        setBusy(false);
    };

    const submitReview = async (justification: string) => {
        if (draft === null) {
            return;
        }
        setBusy(true);
        setError(null);
        const result = await submittingAgentClient.submitReview(
            draft.planId,
            draft.version,
            justification,
            crypto.randomUUID(),
        );
        if (result.status !== "succeeded") {
            finishWithError(result.error, "Review submission failed.");
            return;
        }
        setReview(result.value);
        setReviewPerspective("agent");
        setMessage(`Agent submitted ${result.value.reviewRequestId} for human review.`);
        setBusy(false);
    };

    const decideReview = async (
        decision: "Approved" | "Rejected",
        note: string,
    ) => {
        if (review === null) {
            return;
        }
        setBusy(true);
        setError(null);
        const result = await reviewerClient.decideReview(
            review.reviewRequestId,
            decision,
            note,
            crypto.randomUUID(),
        );
        if (result.status !== "succeeded") {
            finishWithError(result.error, "The review decision was not recorded.");
            return;
        }
        setReview(result.value);
        setMessage(`Human reviewer ${decision.toLowerCase()} the exact revision.`);
        setBusy(false);
    };

    const publishReview = async () => {
        if (review === null) {
            return;
        }
        setBusy(true);
        setError(null);
        const result = await publisherClient.publishReview(
            review.reviewRequestId,
            crypto.randomUUID(),
        );
        if (result.status !== "succeeded") {
            finishWithError(result.error, "Publication failed.");
            return;
        }
        const refreshed = await publisherClient.getReview(review.reviewRequestId);
        if (refreshed.status !== "succeeded") {
            finishWithError(refreshed.error, "The published review could not be refreshed.");
            return;
        }
        setPublished(result.value);
        setReview(refreshed.value);
        setMessage(`Published ${result.value.planId} from the exact approved fingerprint.`);
        setBusy(false);
    };

    const finishWithError = (nextError: TimelineApplicationError, nextMessage: string) => {
        setError(nextError);
        setMessage(nextMessage);
        setBusy(false);
    };

    const cancelMove = () => {
        if (pending !== null) {
            setStatus(pending.intent.item.id, "cancelled");
        }
        setPending(null);
        setError(null);
        setMessage("Proposal cancelled. The draft remains unchanged.");
    };

    const setStatus = (itemId: string, status: TimelineIntentStatus) => {
        setStatuses((current) => {
            const next = new Map(current);
            next.set(itemId, status);
            return next;
        });
    };

    const reviewActor: TimelineReviewActor = review === null
        ? { kind: "Agent", access: ["ReviewSubmit"] }
        : reviewPerspective === "agent"
            ? { kind: "Agent", access: ["ReviewDecide", "Publish"] }
            : {
                kind: "Human",
                access: review.status === "Approved" ? ["Publish"] : ["ReviewDecide"],
            };

    return (
        <main>
            <header className="demo-header">
                <div>
                    <p className="eyebrow">Reusable component portability proof</p>
                    <h1>Manufacturing planning lifecycle</h1>
                    <p>
                        Edit an authoritative draft, compare it with its immutable
                        baseline, then review and publish the exact validated revision.
                    </p>
                </div>
                <button type="button" onClick={startDemo} disabled={busy}>
                    {draft === null ? "Start demo" : "Reset workflow"}
                </button>
            </header>

            <section className="status-panel" aria-live="polite">
                <div>
                    <span>Status</span>
                    <strong>{message}</strong>
                </div>
                {draft !== null && (
                    <dl>
                        <div><dt>Draft</dt><dd>{draft.planId}</dd></div>
                        <div><dt>Version</dt><dd>{draft.version}</dd></div>
                        <div><dt>Fingerprint</dt><dd>{draft.fingerprint.slice(0, 12)}</dd></div>
                        {published !== null && (
                            <div><dt>Published</dt><dd>{published.planId}</dd></div>
                        )}
                    </dl>
                )}
            </section>

            {error !== null && <EvidencePanel error={error} />}

            {draft === null || source === null || evidence === null ? (
                <section className="empty-state">
                    <h2>Local deterministic workflow</h2>
                    <p>
                        Start the planning HTTP fixture on port 5050, then create
                        an isolated draft to exercise the full lifecycle.
                    </p>
                </section>
            ) : (
                <>
                    <nav className="stage-navigation" aria-label="Workflow stages">
                        <button
                            type="button"
                            aria-current={stage === "edit" ? "page" : undefined}
                            onClick={() => setStage("edit")}
                        >
                            1. Edit
                        </button>
                        <button
                            type="button"
                            aria-current={stage === "compare" ? "page" : undefined}
                            onClick={() => setStage("compare")}
                        >
                            2. Compare
                        </button>
                        <button
                            type="button"
                            aria-current={stage === "review" ? "page" : undefined}
                            onClick={() => setStage("review")}
                        >
                            3. Review
                        </button>
                    </nav>
                    {stage === "edit" && (
                        <EditStage
                            items={draftItems}
                            selectedId={selectedId}
                            statuses={statuses}
                            busy={busy}
                            onSelect={setSelectedId}
                            onMoveIntent={previewMove}
                        />
                    )}
                    {stage === "compare" && (
                        <PlanningTimelineComparison
                            rows={rows}
                            window={timelineWindow}
                            baseline={{
                                title: "Immutable baseline",
                                items: sourceItems,
                                metrics: metricsFor(source),
                                basis: comparisonBasis,
                            }}
                            candidate={{
                                title: `Draft version ${draft.version}`,
                                items: draftItems,
                                metrics: metricsFor(draft),
                                basis: comparisonBasis,
                            }}
                            selectedKey={selectedId}
                            onSelectionChange={setSelectedId}
                            renderers={renderers}
                        />
                    )}
                    {stage === "review" && (
                        <>
                            {review !== null && (
                                <div className="perspective-switcher">
                                    <span>Review perspective</span>
                                    <button
                                        type="button"
                                        aria-pressed={reviewPerspective === "agent"}
                                        onClick={() => setReviewPerspective("agent")}
                                    >
                                        Agent
                                    </button>
                                    <button
                                        type="button"
                                        aria-pressed={reviewPerspective === "human"}
                                        onClick={() => setReviewPerspective("human")}
                                    >
                                        Human
                                    </button>
                                </div>
                            )}
                            <PlanningTimelineReview
                                revision={{
                                    planId: draft.planId,
                                    version: draft.version,
                                    fingerprint: draft.fingerprint,
                                }}
                                evidence={evidence}
                                review={review}
                                actor={reviewActor}
                                rows={rows}
                                items={draftItems}
                                window={timelineWindow}
                                renderers={renderers}
                                busy={busy}
                                onSelectItem={setSelectedId}
                                onSubmit={submitReview}
                                onDecide={decideReview}
                                onPublish={publishReview}
                            />
                        </>
                    )}
                </>
            )}

            {pending !== null && (
                <section className="proposal-panel">
                    <div>
                        <span>Accepted preview</span>
                        <strong>
                            {pending.intent.item.label} to {rowLabel(pending.intent.targetRowId)}
                        </strong>
                        <small>
                            Proposed version {pending.preview.proposed.version},
                            not yet persisted
                        </small>
                    </div>
                    <div className="proposal-actions">
                        <button type="button" onClick={cancelMove} disabled={busy}>Cancel</button>
                        <button type="button" onClick={commitMove} disabled={busy}>Commit draft</button>
                    </div>
                </section>
            )}
        </main>
    );
}

function EditStage({
    items,
    selectedId,
    statuses,
    busy,
    onSelect,
    onMoveIntent,
}: {
    items: readonly TimelineItem<PlanningAssignment>[];
    selectedId: string | null;
    statuses: ReadonlyMap<string, TimelineIntentStatus>;
    busy: boolean;
    onSelect: (itemId: string) => void;
    onMoveIntent: (intent: TimelineMoveIntent<PlanningAssignment>) => void;
}) {
    return (
        <>
            <section className="instructions">
                <h2>Try the authority boundary</h2>
                <ol>
                    <li>Drag Work order 2 onto Assembly cell A while Work order 1 is active.</li>
                    <li>Observe the authoritative overlap rejection.</li>
                    <li>Move it after Work order 1 and commit the accepted preview.</li>
                </ol>
            </section>
            <PlanningTimeline
                rows={rows}
                items={items}
                window={timelineWindow}
                selectedId={selectedId}
                intentStatusByItemId={statuses}
                editable={!busy}
                onSelect={(item) => onSelect(item.id)}
                onMoveIntent={onMoveIntent}
                renderers={renderers}
            />
        </>
    );
}

function EvidencePanel({ error }: { error: TimelineApplicationError }) {
    return (
        <section className="evidence-panel" aria-label="Application error">
            <div>
                <span>{error.code}</span>
                <strong>{error.detail}</strong>
            </div>
            {error.validation?.findings.map((finding, index) => (
                <article key={`${finding.code}-${index}`}>
                    <strong>{finding.code}</strong>
                    <span>{finding.detail}</span>
                </article>
            ))}
        </section>
    );
}

const renderers: TimelineRenderHooks<PlanningAssignment, React.ReactNode> = {
    label: ({ item }) => <strong>{item.label}</strong>,
    badges: ({ item }) => item.visual?.badgeTokens?.map((badge) => (
        <span className="demo-badge" key={badge}>{badge}</span>
    )) ?? [],
    details: ({ item }) => (
        <span>
            {item.payload.itemId} on {item.payload.resourceId}
        </span>
    ),
};

function clientFor(
    actorId: string,
    actorKind: "Human" | "Agent",
    access: readonly string[],
) {
    return new PlanningTimelineApplicationClient({
        baseUrl: "/planning-api",
        actor: { actorId, actorKind, access },
    });
}

function rowsFor(): readonly TimelineRow[] {
    return ["resource-1", "resource-2"].map((id, index) => ({
        id,
        label: rowLabel(id),
        order: index,
    }));
}

function itemsFor(snapshot: PlanSnapshot | null): readonly TimelineItem<PlanningAssignment>[] {
    if (snapshot === null) {
        return [];
    }
    return snapshot.assignments.map((assignment, index) => ({
        id: assignment.itemId,
        rowId: assignment.resourceId,
        label: `Work order ${index + 1}`,
        accessibilityLabel: `Work order ${index + 1} on ${rowLabel(assignment.resourceId)}`,
        state: "assigned",
        displayInterval: {
            startUtc: assignment.startUtc,
            endUtc: assignment.endUtc,
        },
        reservationInterval: {
            startUtc: assignment.startUtc,
            endUtc: assignment.endUtc,
        },
        visual: {
            shapeToken: index % 2 === 0 ? "rounded" : "hexagonal",
            fillToken: index % 2 === 0 ? "primary" : "secondary",
            badgeTokens: index === 1 ? ["priority"] : [],
        },
        payload: assignment,
    }));
}

function evidenceFor(snapshot: PlanSnapshot): TimelineReviewEvidence {
    const findings = validateAssignments(snapshot.assignments);
    return {
        revision: {
            planId: snapshot.planId,
            version: snapshot.version,
            fingerprint: snapshot.fingerprint,
        },
        validation: {
            passed: findings.length === 0,
            findings,
        },
        unverifiableChecks: [],
        population: {
            totalCount: 2,
            assignedCount: snapshot.assignments.length,
            unassignedCount: 0,
            excludedCount: 0,
            droppedCount: 2 - snapshot.assignments.length,
        },
        validatorId: "synthetic-complete-plan-validator@1",
        ruleSetFingerprint: comparisonBasis.ruleSetFingerprint,
        referenceDataFingerprint: "manufacturing-reference-fixture-v1",
        validatedAtUtc: new Date().toISOString(),
    };
}

function validateAssignments(
    assignments: readonly PlanningAssignment[],
): readonly PlanningValidationFinding[] {
    const findings: PlanningValidationFinding[] = [];
    for (let left = 0; left < assignments.length; left++) {
        for (let right = left + 1; right < assignments.length; right++) {
            const first = assignments[left]!;
            const second = assignments[right]!;
            if (
                first.resourceId === second.resourceId
                && Date.parse(first.startUtc) < Date.parse(second.endUtc)
                && Date.parse(first.endUtc) > Date.parse(second.startUtc)
            ) {
                findings.push({
                    code: "RESOURCE_OVERLAP",
                    detail: `Items '${first.itemId}' and '${second.itemId}' overlap.`,
                    itemId: first.itemId,
                    otherItemId: second.itemId,
                    resourceId: first.resourceId,
                });
            }
        }
    }
    return findings;
}

function metricsFor(snapshot: PlanSnapshot): readonly TimelineMetric[] {
    const resourceOneMinutes = snapshot.assignments
        .filter((assignment) => assignment.resourceId === "resource-1")
        .reduce(
            (total, assignment) => total
                + (Date.parse(assignment.endUtc) - Date.parse(assignment.startUtc)) / 60_000,
            0,
        );
    const starts = snapshot.assignments.map((assignment) => Date.parse(assignment.startUtc));
    const ends = snapshot.assignments.map((assignment) => Date.parse(assignment.endUtc));
    const scheduleSpan = snapshot.assignments.length === 0
        ? 0
        : (Math.max(...ends) - Math.min(...starts)) / 60_000;
    return [
        {
            id: "cell-a-occupancy",
            label: "Cell A occupied time",
            value: resourceOneMinutes,
            unit: "minutes",
        },
        {
            id: "schedule-span",
            label: "Schedule span",
            value: scheduleSpan,
            unit: "minutes",
        },
    ];
}

function rowLabel(id: string) {
    const labels: Record<string, string> = {
        "resource-1": "Assembly cell A",
        "resource-2": "Assembly cell B",
    };
    return labels[id] ?? id;
}
