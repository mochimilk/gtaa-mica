import type {
    TimelineInterval,
    TimelineItem,
} from "@planning/timeline-core";

export type TimelineComparisonChangeKind =
    | "added"
    | "removed"
    | "moved"
    | "retimed"
    | "unchanged";

export interface TimelineItemComparison<TPayload> {
    key: string;
    changeKinds: readonly TimelineComparisonChangeKind[];
    before?: TimelineItem<TPayload>;
    after?: TimelineItem<TPayload>;
}

export type TimelineIdentitySelector<TPayload> =
    (item: TimelineItem<TPayload>) => string;

export interface TimelineComparisonBasis {
    populationFingerprint: string;
    planningHorizon: TimelineInterval;
    rowCatalogFingerprint: string;
    ruleSetFingerprint: string;
    metricDefinitionFingerprint: string;
    exclusionsFingerprint: string;
}

export type TimelineComparabilityIssueCode =
    | "POPULATION_MISMATCH"
    | "HORIZON_MISMATCH"
    | "ROW_CATALOG_MISMATCH"
    | "RULE_SET_MISMATCH"
    | "METRIC_DEFINITION_MISMATCH"
    | "EXCLUSIONS_MISMATCH";

export interface TimelineComparabilityIssue {
    code: TimelineComparabilityIssueCode;
    message: string;
}

export interface TimelineMetric {
    id: string;
    label: string;
    value: number;
    unit: string;
}

export interface TimelineMetricComparison {
    id: string;
    label: string;
    unit: string | null;
    beforeValue: number | null;
    afterValue: number | null;
    delta: number | null;
    comparable: boolean;
    issues: readonly string[];
}

export interface TimelineComparisonEvidence {
    comparable: boolean;
    basisIssues: readonly TimelineComparabilityIssue[];
    metrics: readonly TimelineMetricComparison[];
}

export function compareTimelineItems<TPayload>(
    before: readonly TimelineItem<TPayload>[],
    after: readonly TimelineItem<TPayload>[],
    identity: TimelineIdentitySelector<TPayload> = (item) => item.id,
): readonly TimelineItemComparison<TPayload>[] {
    const beforeByKey = indexByIdentity(before, identity, "before");
    const afterByKey = indexByIdentity(after, identity, "after");
    const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])]
        .sort((left, right) => left.localeCompare(right));

    return keys.map((key) => {
        const beforeItem = beforeByKey.get(key);
        const afterItem = afterByKey.get(key);
        if (beforeItem === undefined) {
            return { key, changeKinds: ["added"], after: afterItem! };
        }
        if (afterItem === undefined) {
            return { key, changeKinds: ["removed"], before: beforeItem };
        }

        const changeKinds: TimelineComparisonChangeKind[] = [];
        if (
            beforeItem.rowId !== afterItem.rowId
            || beforeItem.state !== afterItem.state
        ) {
            changeKinds.push("moved");
        }
        if (
            !intervalsEqual(beforeItem.displayInterval, afterItem.displayInterval)
            || !intervalsEqual(beforeItem.reservationInterval, afterItem.reservationInterval)
        ) {
            changeKinds.push("retimed");
        }
        if (changeKinds.length === 0) {
            changeKinds.push("unchanged");
        }
        return {
            key,
            changeKinds,
            before: beforeItem,
            after: afterItem,
        };
    });
}

export function compareTimelineEvidence(
    beforeBasis: TimelineComparisonBasis,
    afterBasis: TimelineComparisonBasis,
    beforeMetrics: readonly TimelineMetric[],
    afterMetrics: readonly TimelineMetric[],
): TimelineComparisonEvidence {
    const basisIssues = assessComparisonBasis(beforeBasis, afterBasis);
    const beforeById = indexMetrics(beforeMetrics, "before");
    const afterById = indexMetrics(afterMetrics, "after");
    const metricIds = [...new Set([...beforeById.keys(), ...afterById.keys()])]
        .sort((left, right) => left.localeCompare(right));
    const metrics = metricIds.map((id): TimelineMetricComparison => {
        const beforeMetric = beforeById.get(id);
        const afterMetric = afterById.get(id);
        const issues = basisIssues.map((issue) => issue.message);
        if (beforeMetric === undefined || afterMetric === undefined) {
            issues.push(
                beforeMetric === undefined
                    ? "Metric is missing from the baseline revision."
                    : "Metric is missing from the candidate revision.",
            );
        } else if (beforeMetric.unit !== afterMetric.unit) {
            issues.push(
                `Metric units differ: ${beforeMetric.unit} and ${afterMetric.unit}.`,
            );
        }
        const sameUnit = beforeMetric !== undefined
            && afterMetric !== undefined
            && beforeMetric.unit === afterMetric.unit;
        return {
            id,
            label: afterMetric?.label ?? beforeMetric?.label ?? id,
            unit: sameUnit ? beforeMetric.unit : null,
            beforeValue: beforeMetric?.value ?? null,
            afterValue: afterMetric?.value ?? null,
            delta: sameUnit ? afterMetric.value - beforeMetric.value : null,
            comparable: issues.length === 0,
            issues,
        };
    });

    return {
        comparable: basisIssues.length === 0 && metrics.every((metric) => metric.comparable),
        basisIssues,
        metrics,
    };
}

function assessComparisonBasis(
    before: TimelineComparisonBasis,
    after: TimelineComparisonBasis,
): TimelineComparabilityIssue[] {
    const issues: TimelineComparabilityIssue[] = [];
    addMismatch(
        issues,
        before.populationFingerprint === after.populationFingerprint,
        "POPULATION_MISMATCH",
        "Revision populations differ.",
    );
    addMismatch(
        issues,
        intervalsEqual(before.planningHorizon, after.planningHorizon),
        "HORIZON_MISMATCH",
        "Planning horizons differ.",
    );
    addMismatch(
        issues,
        before.rowCatalogFingerprint === after.rowCatalogFingerprint,
        "ROW_CATALOG_MISMATCH",
        "Row catalogs differ.",
    );
    addMismatch(
        issues,
        before.ruleSetFingerprint === after.ruleSetFingerprint,
        "RULE_SET_MISMATCH",
        "Rule sets differ.",
    );
    addMismatch(
        issues,
        before.metricDefinitionFingerprint === after.metricDefinitionFingerprint,
        "METRIC_DEFINITION_MISMATCH",
        "Metric definitions differ.",
    );
    addMismatch(
        issues,
        before.exclusionsFingerprint === after.exclusionsFingerprint,
        "EXCLUSIONS_MISMATCH",
        "Documented exclusions differ.",
    );
    return issues;
}

function addMismatch(
    issues: TimelineComparabilityIssue[],
    matches: boolean,
    code: TimelineComparabilityIssueCode,
    message: string,
) {
    if (!matches) {
        issues.push({ code, message });
    }
}

function indexByIdentity<TPayload>(
    items: readonly TimelineItem<TPayload>[],
    identity: TimelineIdentitySelector<TPayload>,
    revision: string,
): ReadonlyMap<string, TimelineItem<TPayload>> {
    const result = new Map<string, TimelineItem<TPayload>>();
    for (const item of items) {
        const key = identity(item);
        if (key.length === 0) {
            throw new RangeError(`Timeline identity cannot be empty in the ${revision} revision.`);
        }
        if (result.has(key)) {
            throw new RangeError(`Duplicate timeline identity '${key}' in the ${revision} revision.`);
        }
        result.set(key, item);
    }
    return result;
}

function indexMetrics(
    metrics: readonly TimelineMetric[],
    revision: string,
): ReadonlyMap<string, TimelineMetric> {
    const result = new Map<string, TimelineMetric>();
    for (const metric of metrics) {
        if (!Number.isFinite(metric.value)) {
            throw new RangeError(`Metric '${metric.id}' in the ${revision} revision is not finite.`);
        }
        if (result.has(metric.id)) {
            throw new RangeError(`Duplicate metric '${metric.id}' in the ${revision} revision.`);
        }
        result.set(metric.id, metric);
    }
    return result;
}

function intervalsEqual(
    left: TimelineInterval | null,
    right: TimelineInterval | null,
): boolean {
    return left === right
        || (
            left !== null
            && right !== null
            && left.startUtc === right.startUtc
            && left.endUtc === right.endUtc
        );
}
