import type {
    PlanningValidationFinding,
    PlanningValidationResult,
} from "@planning/timeline-application";

export interface TimelineReviewRevision {
    planId: string;
    version: number;
    fingerprint: string;
}

export interface TimelineReviewPopulation {
    totalCount: number;
    assignedCount: number;
    unassignedCount: number;
    excludedCount: number;
    droppedCount: number;
}

export interface TimelineReviewEvidence {
    revision: TimelineReviewRevision;
    validation: PlanningValidationResult;
    unverifiableChecks: readonly string[];
    population: TimelineReviewPopulation;
    validatorId: string;
    ruleSetFingerprint: string;
    referenceDataFingerprint: string;
    validatedAtUtc: string;
}

export type TimelineReviewReadinessIssueCode =
    | "EVIDENCE_PLAN_MISMATCH"
    | "EVIDENCE_VERSION_MISMATCH"
    | "EVIDENCE_FINGERPRINT_MISMATCH"
    | "VALIDATION_FAILED"
    | "VALIDATION_FINDINGS_PRESENT"
    | "UNVERIFIABLE_CHECKS_PRESENT"
    | "POPULATION_NOT_RECONCILED"
    | "EVIDENCE_PROVENANCE_MISSING"
    | "VALIDATION_TIMESTAMP_INVALID";

export interface TimelineReviewReadinessIssue {
    code: TimelineReviewReadinessIssueCode;
    message: string;
}

export interface TimelineReviewReadiness {
    ready: boolean;
    issues: readonly TimelineReviewReadinessIssue[];
}

export function assessTimelineReviewReadiness(
    revision: TimelineReviewRevision,
    evidence: TimelineReviewEvidence,
): TimelineReviewReadiness {
    const issues: TimelineReviewReadinessIssue[] = [];
    addIssue(
        issues,
        revision.planId === evidence.revision.planId,
        "EVIDENCE_PLAN_MISMATCH",
        "Validation evidence belongs to a different plan or draft.",
    );
    addIssue(
        issues,
        revision.version === evidence.revision.version,
        "EVIDENCE_VERSION_MISMATCH",
        "Validation evidence belongs to a different revision version.",
    );
    addIssue(
        issues,
        revision.fingerprint === evidence.revision.fingerprint,
        "EVIDENCE_FINGERPRINT_MISMATCH",
        "Validation evidence belongs to a different revision fingerprint.",
    );
    addIssue(
        issues,
        evidence.validation.passed,
        "VALIDATION_FAILED",
        "Independent complete-plan validation did not pass.",
    );
    addIssue(
        issues,
        evidence.validation.findings.length === 0,
        "VALIDATION_FINDINGS_PRESENT",
        "Validation findings must be resolved before review submission.",
    );
    addIssue(
        issues,
        evidence.unverifiableChecks.length === 0,
        "UNVERIFIABLE_CHECKS_PRESENT",
        "Required validation checks remain unverifiable.",
    );
    addIssue(
        issues,
        populationReconciles(evidence.population),
        "POPULATION_NOT_RECONCILED",
        "Assigned, unassigned, excluded, and dropped counts do not reconcile to the total population.",
    );
    addIssue(
        issues,
        evidence.validatorId.trim().length > 0
            && evidence.ruleSetFingerprint.trim().length > 0
            && evidence.referenceDataFingerprint.trim().length > 0,
        "EVIDENCE_PROVENANCE_MISSING",
        "Validator, rule-set, and reference-data provenance are required.",
    );
    addIssue(
        issues,
        Number.isFinite(Date.parse(evidence.validatedAtUtc)),
        "VALIDATION_TIMESTAMP_INVALID",
        "Validation timestamp must be a valid date and time.",
    );
    return { ready: issues.length === 0, issues };
}

export function findingsForItem(
    findings: readonly PlanningValidationFinding[],
    itemId: string,
): readonly PlanningValidationFinding[] {
    return findings.filter(
        (finding) => finding.itemId === itemId || finding.otherItemId === itemId,
    );
}

function populationReconciles(population: TimelineReviewPopulation): boolean {
    const values = [
        population.totalCount,
        population.assignedCount,
        population.unassignedCount,
        population.excludedCount,
        population.droppedCount,
    ];
    return values.every((value) => Number.isInteger(value) && value >= 0)
        && population.assignedCount
            + population.unassignedCount
            + population.excludedCount
            + population.droppedCount
            === population.totalCount;
}

function addIssue(
    issues: TimelineReviewReadinessIssue[],
    condition: boolean,
    code: TimelineReviewReadinessIssueCode,
    message: string,
) {
    if (!condition) {
        issues.push({ code, message });
    }
}
