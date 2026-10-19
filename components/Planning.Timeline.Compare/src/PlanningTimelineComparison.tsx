import type {
    TimelineFilter,
    TimelineItem,
    TimelineMoveIntent,
    TimelineOverlay,
    TimelineRenderHooks,
    TimelineRow,
    TimelineWindow,
} from "@planning/timeline-core";
import {
    PlanningTimeline,
} from "@planning/timeline-react";
import React, {
    useMemo,
    useState,
    type ReactNode,
} from "react";
import {
    compareTimelineEvidence,
    compareTimelineItems,
    type TimelineComparisonBasis,
    type TimelineComparisonChangeKind,
    type TimelineIdentitySelector,
    type TimelineMetric,
} from "./comparison.ts";

export interface TimelineComparisonRevision<TPayload, TOverlayPayload> {
    title: string;
    items: readonly TimelineItem<TPayload>[];
    overlays?: readonly TimelineOverlay<TOverlayPayload>[];
    metrics: readonly TimelineMetric[];
    basis: TimelineComparisonBasis;
}

export interface PlanningTimelineComparisonProps<
    TPayload = unknown,
    TOverlayPayload = unknown,
> {
    rows: readonly TimelineRow[];
    window: TimelineWindow;
    baseline: TimelineComparisonRevision<TPayload, TOverlayPayload>;
    candidate: TimelineComparisonRevision<TPayload, TOverlayPayload>;
    identity?: TimelineIdentitySelector<TPayload>;
    filters?: readonly TimelineFilter<TimelineItem<TPayload>>[];
    renderers?: TimelineRenderHooks<TPayload, ReactNode>;
    selectedKey?: string | null;
    initialPxPerMinute?: number;
    editableCandidate?: boolean;
    onSelectionChange?: (key: string) => void;
    onCandidateMoveIntent?: (intent: TimelineMoveIntent<TPayload>) => void;
}

export function PlanningTimelineComparison<TPayload, TOverlayPayload>({
    rows,
    window,
    baseline,
    candidate,
    identity = (item) => item.id,
    filters = [],
    renderers,
    selectedKey,
    initialPxPerMinute = 2,
    editableCandidate = false,
    onSelectionChange,
    onCandidateMoveIntent,
}: PlanningTimelineComparisonProps<TPayload, TOverlayPayload>) {
    const [scrollLeft, setScrollLeft] = useState(0);
    const [pxPerMinute, setPxPerMinute] = useState(initialPxPerMinute);
    const comparisons = useMemo(
        () => compareTimelineItems(baseline.items, candidate.items, identity),
        [baseline.items, candidate.items, identity],
    );
    const evidence = useMemo(
        () => compareTimelineEvidence(
            baseline.basis,
            candidate.basis,
            baseline.metrics,
            candidate.metrics,
        ),
        [baseline.basis, baseline.metrics, candidate.basis, candidate.metrics],
    );
    const comparisonByKey = useMemo(
        () => new Map(comparisons.map((comparison) => [comparison.key, comparison])),
        [comparisons],
    );
    const baselineItems = useMemo(
        () => decorateItems(baseline.items, comparisonByKey, identity),
        [baseline.items, comparisonByKey, identity],
    );
    const candidateItems = useMemo(
        () => decorateItems(candidate.items, comparisonByKey, identity),
        [candidate.items, comparisonByKey, identity],
    );
    const selectedComparison = selectedKey === null || selectedKey === undefined
        ? undefined
        : comparisonByKey.get(selectedKey);

    const select = (item: TimelineItem<TPayload>) => {
        onSelectionChange?.(identity(item));
    };

    return (
        <section className="planning-timeline-comparison" aria-label="Timeline comparison">
            <ComparisonSummary comparisons={comparisons} />
            <ComparisonEvidence evidence={evidence} />
            <div className="planning-timeline-comparison__revision">
                <h2>{baseline.title}</h2>
                <PlanningTimeline
                    ariaLabel={`${baseline.title} timeline`}
                    viewportTestId="baseline-timeline-viewport"
                    rows={rows}
                    items={baselineItems}
                    overlays={baseline.overlays ?? []}
                    filters={filters}
                    window={window}
                    {...(renderers === undefined ? {} : { renderers })}
                    {...(selectedComparison?.before === undefined
                        ? {}
                        : { selectedId: selectedComparison.before.id })}
                    pxPerMinute={pxPerMinute}
                    scrollLeft={scrollLeft}
                    onScrollLeftChange={setScrollLeft}
                    onZoomChange={setPxPerMinute}
                    onSelect={select}
                />
            </div>
            <div className="planning-timeline-comparison__revision">
                <h2>{candidate.title}</h2>
                <PlanningTimeline
                    ariaLabel={`${candidate.title} timeline`}
                    viewportTestId="candidate-timeline-viewport"
                    rows={rows}
                    items={candidateItems}
                    overlays={candidate.overlays ?? []}
                    filters={filters}
                    window={window}
                    {...(renderers === undefined ? {} : { renderers })}
                    {...(selectedComparison?.after === undefined
                        ? {}
                        : { selectedId: selectedComparison.after.id })}
                    editable={editableCandidate}
                    pxPerMinute={pxPerMinute}
                    scrollLeft={scrollLeft}
                    onScrollLeftChange={setScrollLeft}
                    onZoomChange={setPxPerMinute}
                    onSelect={select}
                    {...(onCandidateMoveIntent === undefined
                        ? {}
                        : { onMoveIntent: onCandidateMoveIntent })}
                />
            </div>
        </section>
    );
}

function decorateItems<TPayload>(
    items: readonly TimelineItem<TPayload>[],
    comparisonByKey: ReadonlyMap<string, {
        changeKinds: readonly TimelineComparisonChangeKind[];
    }>,
    identity: TimelineIdentitySelector<TPayload>,
): readonly TimelineItem<TPayload>[] {
    return items.map((item) => {
        const comparison = comparisonByKey.get(identity(item));
        const changeToken = comparison?.changeKinds.join("-") ?? "unchanged";
        return {
            ...item,
            visual: {
                ...item.visual,
                patternToken: `comparison-${changeToken}`,
            },
        };
    });
}

function ComparisonSummary({
    comparisons,
}: {
    comparisons: readonly {
        changeKinds: readonly TimelineComparisonChangeKind[];
    }[];
}) {
    const kinds: readonly TimelineComparisonChangeKind[] = [
        "added",
        "removed",
        "moved",
        "retimed",
        "unchanged",
    ];
    return (
        <section className="planning-timeline-comparison__summary" aria-label="Change summary">
            {kinds.map((kind) => (
                <div key={kind}>
                    <strong>{comparisons.filter((entry) => entry.changeKinds.includes(kind)).length}</strong>
                    <span>{kind}</span>
                </div>
            ))}
        </section>
    );
}

function ComparisonEvidence({
    evidence,
}: {
    evidence: ReturnType<typeof compareTimelineEvidence>;
}) {
    return (
        <section
            className="planning-timeline-comparison__evidence"
            aria-label="Comparison evidence"
            data-comparable={evidence.comparable}
        >
            <h2>{evidence.comparable ? "Comparable revisions" : "Comparison limitations"}</h2>
            {evidence.basisIssues.length > 0 && (
                <ul>
                    {evidence.basisIssues.map((issue) => (
                        <li key={issue.code}>{issue.message}</li>
                    ))}
                </ul>
            )}
            <table>
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Baseline</th>
                        <th>Candidate</th>
                        <th>Delta</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {evidence.metrics.map((metric) => (
                        <tr key={metric.id}>
                            <th>{metric.label}</th>
                            <td>{formatMetric(metric.beforeValue, metric.unit)}</td>
                            <td>{formatMetric(metric.afterValue, metric.unit)}</td>
                            <td>{formatMetric(metric.delta, metric.unit, true)}</td>
                            <td>{metric.comparable ? "Comparable" : metric.issues.join(" ")}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}

function formatMetric(
    value: number | null,
    unit: string | null,
    signed = false,
): string {
    if (value === null || unit === null) {
        return "Not comparable";
    }
    const prefix = signed && value > 0 ? "+" : "";
    return `${prefix}${value} ${unit}`;
}
