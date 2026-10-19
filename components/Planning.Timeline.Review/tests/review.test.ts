import assert from "node:assert/strict";
import test from "node:test";
import {
    assessTimelineReviewReadiness,
    findingsForItem,
    type TimelineReviewEvidence,
    type TimelineReviewRevision,
} from "../src/index.ts";

const revision: TimelineReviewRevision = {
    planId: "draft-1",
    version: 3,
    fingerprint: "fingerprint-3",
};

const readyEvidence: TimelineReviewEvidence = {
    revision,
    validation: { passed: true, findings: [] },
    unverifiableChecks: [],
    population: {
        totalCount: 5,
        assignedCount: 3,
        unassignedCount: 1,
        excludedCount: 1,
        droppedCount: 0,
    },
    validatorId: "complete-plan-validator@1",
    ruleSetFingerprint: "rules-1",
    referenceDataFingerprint: "references-1",
    validatedAtUtc: "2026-10-16T20:00:00Z",
};

test("accepts only complete evidence for the exact revision", () => {
    assert.deepEqual(
        assessTimelineReviewReadiness(revision, readyEvidence),
        { ready: true, issues: [] },
    );

    const invalid = assessTimelineReviewReadiness(revision, {
        ...readyEvidence,
        revision: { ...revision, fingerprint: "other" },
        validation: {
            passed: true,
            findings: [{
                code: "OVERLAP",
                detail: "Assignments overlap.",
                itemId: "job-1",
                otherItemId: "job-2",
                resourceId: "machine-a",
            }],
        },
        unverifiableChecks: ["Compatibility matrix unavailable"],
        population: { ...readyEvidence.population, droppedCount: 2 },
    });

    assert.equal(invalid.ready, false);
    assert.deepEqual(
        invalid.issues.map((issue) => issue.code),
        [
            "EVIDENCE_FINGERPRINT_MISMATCH",
            "VALIDATION_FINDINGS_PRESENT",
            "UNVERIFIABLE_CHECKS_PRESENT",
            "POPULATION_NOT_RECONCILED",
        ],
    );
});

test("links both sides of a finding to their affected items", () => {
    const finding = {
        code: "OVERLAP",
        detail: "Assignments overlap.",
        itemId: "job-1",
        otherItemId: "job-2",
        resourceId: "machine-a",
    };

    assert.deepEqual(findingsForItem([finding], "job-1"), [finding]);
    assert.deepEqual(findingsForItem([finding], "job-2"), [finding]);
    assert.deepEqual(findingsForItem([finding], "job-3"), []);
});
