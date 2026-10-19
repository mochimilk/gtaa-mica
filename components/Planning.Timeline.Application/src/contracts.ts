export type PlanningActorKind = "Human" | "Agent" | "Service";
export type TimelineIntervalBasis = "display" | "reservation";
export type TimelineApplicationFailureStatus =
    | "rejected"
    | "not-found"
    | "conflict"
    | "unauthorized"
    | "failed";
export type PlanningReviewStatus =
    | "Pending"
    | "Approved"
    | "Rejected"
    | "Withdrawn"
    | "Published";
export type PlanningReviewDecision = "Approved" | "Rejected";

export interface PlanningActorHeaders {
    actorId: string;
    actorKind: PlanningActorKind;
    access: readonly string[];
}

export interface PlanningAssignment {
    itemId: string;
    resourceId: string;
    startUtc: string;
    endUtc: string;
}

export interface PlanSnapshot {
    planId: string;
    version: number;
    state: "Published" | "Draft";
    sourcePlanId: string | null;
    assignments: readonly PlanningAssignment[];
    fingerprint: string;
}

export interface PlanningValidationFinding {
    code: string;
    detail: string;
    itemId: string | null;
    otherItemId: string | null;
    resourceId: string | null;
}

export interface PlanningValidationResult {
    findings: readonly PlanningValidationFinding[];
    passed: boolean;
}

export interface PlanningReviewRequest {
    reviewRequestId: string;
    draftId: string;
    draftVersion: number;
    draftFingerprint: string;
    status: PlanningReviewStatus;
    justification: string;
    submittedBy: string;
    decidedBy: string | null;
    decisionNote: string | null;
    publishedPlanId: string | null;
}

export interface ReassignItemChange {
    itemId: string;
    newResourceId: string;
    newStartUtc: string;
    newEndUtc: string;
}

export interface ChangePreview {
    proposed: PlanSnapshot;
    validation: PlanningValidationResult;
    changes: readonly ReassignItemChange[];
}

export interface TimelineApplicationError {
    code: string;
    detail: string;
    validation?: PlanningValidationResult;
}

export type TimelineApplicationResult<T> =
    | { status: "succeeded"; value: T }
    | { status: TimelineApplicationFailureStatus; error: TimelineApplicationError };
