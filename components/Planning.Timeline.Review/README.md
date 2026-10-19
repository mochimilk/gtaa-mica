---
title: Planning timeline review workspace
description: Exact-revision validation evidence, review decisions, and publication controls for planning timelines
---

## Status

This package composes `@planning/timeline-react` with review evidence and
workflow controls. It does not validate plans, grant permissions, record review
decisions, or publish revisions. Those operations remain authoritative
application capabilities.

## Included

- Exact plan ID, version, and fingerprint matching
- Complete-plan validation status and findings
- Zero-unverifiable-check enforcement
- Assigned, unassigned, excluded, and dropped population reconciliation
- Validator, rule-set, reference-data, and timestamp provenance
- Findings linked to both affected timeline items
- Explicit review justification and decision notes
- Pending, approved, rejected, withdrawn, and published presentation
- Human-only approve, reject, and publish controls
- Explicit publication confirmation for the approved fingerprint
- Busy-state and capability gates

## Authority boundary

Client-side gates communicate intent and prevent accidental actions. They are
not authorization. The application service must independently enforce actor
permissions, human-only decisions and publication, optimistic version checks,
idempotency, and exact fingerprint matching.

The workspace accepts controlled review state and action callbacks. Hosts can
connect those callbacks to the review operations in
[`Planning.Timeline.Application`](../Planning.Timeline.Application/README.md).
An agent may submit an exact revision when granted `ReviewSubmit`, but it cannot
approve, reject, or publish even if a client accidentally supplies those access
labels.

## Evidence requirements

Submission readiness requires:

1. Evidence for the exact plan ID, version, and fingerprint.
2. A passed complete-plan validation with zero findings.
3. Zero required unverifiable checks.
4. Population counts that reconcile every assigned, unassigned, excluded, and
   dropped item to the total.
5. Non-empty validator, rule-set, and reference-data provenance.
6. A valid validation timestamp.

## Styles

```typescript
import "@planning/timeline-react/styles.css";
import "@planning/timeline-review/styles.css";
```

## Validate

```powershell
Set-Location .\components\Planning.Timeline.Review
npm install
npm run check
```
