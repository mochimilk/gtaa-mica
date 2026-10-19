import type {
    PlanningActorKind,
    PlanningReviewDecision,
    PlanningReviewRequest,
    PlanningValidationFinding,
} from "@planning/timeline-application";
import type {
    TimelineFilter,
    TimelineItem,
    TimelineOverlay,
    TimelineRenderHooks,
    TimelineRow,
    TimelineWindow,
} from "@planning/timeline-core";
import { PlanningTimeline } from "@planning/timeline-react";
import React, {
    useMemo,
    useState,
    type ReactNode,
} from "react";
import {
    assessTimelineReviewReadiness,
    type TimelineReviewEvidence,
    type TimelineReviewRevision,
} from "./review.ts";

export type TimelineReviewAccess = "ReviewSubmit" | "ReviewDecide" | "Publish";

export interface TimelineReviewActor {
    kind: PlanningActorKind;
    access: readonly TimelineReviewAccess[];
}

export interface PlanningTimelineReviewProps<
    TPayload = unknown,
    TOverlayPayload = unknown,
> {
    revision: TimelineReviewRevision;
    evidence: TimelineReviewEvidence;
    review?: PlanningReviewRequest | null;
    actor: TimelineReviewActor;
    rows: readonly TimelineRow[];
    items: readonly TimelineItem<TPayload>[];
    overlays?: readonly TimelineOverlay<TOverlayPayload>[];
    filters?: readonly TimelineFilter<TimelineItem<TPayload>>[];
    window: TimelineWindow;
    renderers?: TimelineRenderHooks<TPayload, ReactNode>;
    busy?: boolean;
    onSelectItem?: (itemId: string) => void;
    onSubmit?: (justification: string) => void;
    onDecide?: (decision: PlanningReviewDecision, note: string) => void;
    onPublish?: () => void;
}

export function PlanningTimelineReview<TPayload, TOverlayPayload>({
    revision,
    evidence,
    review = null,
    actor,
    rows,
    items,
    overlays = [],
    filters = [],
    window,
    renderers,
    busy = false,
    onSelectItem,
    onSubmit,
    onDecide,
    onPublish,
}: PlanningTimelineReviewProps<TPayload, TOverlayPayload>) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [justification, setJustification] = useState("");
    const [decisionNote, setDecisionNote] = useState("");
    const [publishConfirmed, setPublishConfirmed] = useState(false);
    const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
    const readiness = useMemo(
        () => assessTimelineReviewReadiness(revision, evidence),
        [revision, evidence],
    );
    const exactReview = review === null
        || (
            review.draftId === revision.planId
            && review.draftVersion === revision.version
            && review.draftFingerprint === revision.fingerprint
        );
    const canSubmit = review === null
        && actor.access.includes("ReviewSubmit")
        && readiness.ready
        && justification.trim().length > 0
        && !busy;
    const canDecide = review?.status === "Pending"
        && actor.kind === "Human"
        && actor.access.includes("ReviewDecide")
        && exactReview
        && decisionNote.trim().length > 0
        && !busy;
    const canPublish = review?.status === "Approved"
        && actor.kind === "Human"
        && actor.access.includes("Publish")
        && exactReview
        && publishConfirmed
        && !busy;

    const selectItem = (itemId: string) => {
        setSelectedId(itemId);
        onSelectItem?.(itemId);
    };

    return (
        <section className="planning-timeline-review" aria-label="Timeline review workspace">
            <ReviewHeader revision={revision} review={review} exactReview={exactReview} />
            <div className="planning-timeline-review__layout">
                <div>
                    <PlanningTimeline
                        ariaLabel="Revision under review"
                        viewportTestId="review-timeline-viewport"
                        rows={rows}
                        items={items}
                        overlays={overlays}
                        filters={filters}
                        window={window}
                        selectedId={selectedId}
                        {...(renderers === undefined ? {} : { renderers })}
                        onSelect={(item) => selectItem(item.id)}
                    />
                </div>
                <aside>
                    <EvidencePanel
                        evidence={evidence}
                        readiness={readiness}
                        itemIds={itemIds}
                        selectedId={selectedId}
                        onSelectItem={selectItem}
                    />
                    <ReviewActions
                        review={review}
                        actor={actor}
                        justification={justification}
                        decisionNote={decisionNote}
                        publishConfirmed={publishConfirmed}
                        canSubmit={canSubmit}
                        canDecide={canDecide}
                        canPublish={canPublish}
                        onJustificationChange={setJustification}
                        onDecisionNoteChange={setDecisionNote}
                        onPublishConfirmedChange={setPublishConfirmed}
                        onSubmit={() => onSubmit?.(justification.trim())}
                        onDecide={(decision) => onDecide?.(decision, decisionNote.trim())}
                        onPublish={() => onPublish?.()}
                    />
                </aside>
            </div>
        </section>
    );
}

function ReviewHeader({
    revision,
    review,
    exactReview,
}: {
    revision: TimelineReviewRevision;
    review: PlanningReviewRequest | null;
    exactReview: boolean;
}) {
    return (
        <header className="planning-timeline-review__header">
            <div>
                <span>Revision</span>
                <strong>{revision.planId} v{revision.version}</strong>
                <code>{revision.fingerprint}</code>
            </div>
            <div>
                <span>Review status</span>
                <strong>{review?.status ?? "Not submitted"}</strong>
                {review !== null && (
                    <>
                        <code>{review.reviewRequestId}</code>
                        <span>Submitted by {review.submittedBy}</span>
                        {review.decidedBy !== null && <span>Decided by {review.decidedBy}</span>}
                        {review.decisionNote !== null && <span>{review.decisionNote}</span>}
                        {review.publishedPlanId !== null && (
                            <span>Published as {review.publishedPlanId}</span>
                        )}
                    </>
                )}
                {review !== null && !exactReview && (
                    <span role="alert">Review references a different revision.</span>
                )}
            </div>
        </header>
    );
}

function EvidencePanel({
    evidence,
    readiness,
    itemIds,
    selectedId,
    onSelectItem,
}: {
    evidence: TimelineReviewEvidence;
    readiness: ReturnType<typeof assessTimelineReviewReadiness>;
    itemIds: ReadonlySet<string>;
    selectedId: string | null;
    onSelectItem: (itemId: string) => void;
}) {
    return (
        <section className="planning-timeline-review__evidence" aria-label="Validation evidence">
            <h2>{readiness.ready ? "Ready for review" : "Not ready for review"}</h2>
            <dl>
                <div><dt>Validator</dt><dd>{evidence.validatorId || "Missing"}</dd></div>
                <div><dt>Rule set</dt><dd>{evidence.ruleSetFingerprint || "Missing"}</dd></div>
                <div><dt>Reference data</dt><dd>{evidence.referenceDataFingerprint || "Missing"}</dd></div>
                <div><dt>Validated</dt><dd>{evidence.validatedAtUtc}</dd></div>
                <div><dt>Total population</dt><dd>{evidence.population.totalCount}</dd></div>
                <div><dt>Assigned</dt><dd>{evidence.population.assignedCount}</dd></div>
                <div><dt>Unassigned</dt><dd>{evidence.population.unassignedCount}</dd></div>
                <div><dt>Excluded</dt><dd>{evidence.population.excludedCount}</dd></div>
                <div><dt>Dropped</dt><dd>{evidence.population.droppedCount}</dd></div>
            </dl>
            {readiness.issues.length > 0 && (
                <ul aria-label="Readiness issues">
                    {readiness.issues.map((issue) => (
                        <li key={issue.code}>{issue.message}</li>
                    ))}
                </ul>
            )}
            {evidence.validation.findings.length > 0 && (
                <ul aria-label="Validation findings">
                    {evidence.validation.findings.map((finding, index) => (
                        <Finding
                            key={`${finding.code}-${index}`}
                            finding={finding}
                            itemIds={itemIds}
                            selectedId={selectedId}
                            onSelectItem={onSelectItem}
                        />
                    ))}
                </ul>
            )}
            {evidence.unverifiableChecks.length > 0 && (
                <ul aria-label="Unverifiable checks">
                    {evidence.unverifiableChecks.map((check) => <li key={check}>{check}</li>)}
                </ul>
            )}
        </section>
    );
}

function Finding({
    finding,
    itemIds,
    selectedId,
    onSelectItem,
}: {
    finding: PlanningValidationFinding;
    itemIds: ReadonlySet<string>;
    selectedId: string | null;
    onSelectItem: (itemId: string) => void;
}) {
    const targets = [finding.itemId, finding.otherItemId]
        .filter((itemId): itemId is string => itemId !== null)
        .filter((itemId, index, values) => values.indexOf(itemId) === index);
    return (
        <li>
            <strong>{finding.code}</strong>
            <span>{finding.detail}</span>
            {targets.map((itemId) => itemIds.has(itemId) ? (
                <button
                    type="button"
                    key={itemId}
                    aria-pressed={selectedId === itemId}
                    onClick={() => onSelectItem(itemId)}
                >
                    Focus {itemId}
                </button>
            ) : <code key={itemId}>{itemId}</code>)}
        </li>
    );
}

function ReviewActions({
    review,
    actor,
    justification,
    decisionNote,
    publishConfirmed,
    canSubmit,
    canDecide,
    canPublish,
    onJustificationChange,
    onDecisionNoteChange,
    onPublishConfirmedChange,
    onSubmit,
    onDecide,
    onPublish,
}: {
    review: PlanningReviewRequest | null;
    actor: TimelineReviewActor;
    justification: string;
    decisionNote: string;
    publishConfirmed: boolean;
    canSubmit: boolean;
    canDecide: boolean;
    canPublish: boolean;
    onJustificationChange: (value: string) => void;
    onDecisionNoteChange: (value: string) => void;
    onPublishConfirmedChange: (value: boolean) => void;
    onSubmit: () => void;
    onDecide: (decision: PlanningReviewDecision) => void;
    onPublish: () => void;
}) {
    if (review === null) {
        return (
            <section className="planning-timeline-review__actions" aria-label="Review actions">
                <label>
                    Review justification
                    <textarea
                        value={justification}
                        onChange={(event) => onJustificationChange(event.currentTarget.value)}
                    />
                </label>
                <button type="button" disabled={!canSubmit} onClick={onSubmit}>
                    Submit exact revision for review
                </button>
            </section>
        );
    }
    if (review.status === "Pending") {
        const humanRequired = actor.kind !== "Human";
        return (
            <section className="planning-timeline-review__actions" aria-label="Review actions">
                {humanRequired && <p>Only a human reviewer can approve or reject.</p>}
                <label>
                    Decision note
                    <textarea
                        value={decisionNote}
                        onChange={(event) => onDecisionNoteChange(event.currentTarget.value)}
                    />
                </label>
                <div>
                    <button
                        type="button"
                        disabled={!canDecide}
                        onClick={() => onDecide("Approved")}
                    >
                        Approve exact revision
                    </button>
                    <button
                        type="button"
                        disabled={!canDecide}
                        onClick={() => onDecide("Rejected")}
                    >
                        Reject exact revision
                    </button>
                </div>
            </section>
        );
    }
    if (review.status === "Approved") {
        return (
            <section className="planning-timeline-review__actions" aria-label="Review actions">
                {actor.kind !== "Human" && <p>Only a human publisher can publish.</p>}
                <label>
                    <input
                        type="checkbox"
                        checked={publishConfirmed}
                        onChange={(event) => onPublishConfirmedChange(event.currentTarget.checked)}
                    />
                    Publish the exact approved version and fingerprint
                </label>
                <button type="button" disabled={!canPublish} onClick={onPublish}>
                    Publish approved revision
                </button>
            </section>
        );
    }
    return (
        <section className="planning-timeline-review__actions" aria-label="Review actions">
            <p>No actions are available for a {review.status.toLowerCase()} review.</p>
        </section>
    );
}
