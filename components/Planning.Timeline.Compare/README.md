---
title: Planning timeline comparison
description: Revision matching, comparability evidence, metric deltas, and linked timeline composition
---

## Status

This package compares two revisions over the shared contracts from
`@planning/timeline-core` and composes two `@planning/timeline-react` renderers.
It does not infer row catalogs, planning horizons, identities, metric
definitions, exclusions, or rule versions.

## Included

- Caller-defined stable identity matching across revision-local item IDs
- Added, removed, moved, retimed, combined moved-and-retimed, and unchanged
  classifications
- Explicit handling of assigned and unassigned transitions
- Duplicate-identity rejection
- Shared row catalog and planning window
- Linked selection using stable comparison keys
- Synchronized horizontal scrolling and zoom
- Shared presentation filters
- Separate baseline and candidate overlays
- Raw metric values and deltas
- Comparability evidence for populations, horizons, rows, rules, metric
  definitions, exclusions, and units
- Candidate-only move intents through the existing authority boundary

## Comparison semantics

A comparison key identifies the same planned subject across revisions. It is not
required to equal either revision's item ID. Callers must provide an identity
selector when item IDs are revision-local.

An item can be both moved and retimed. Assignment to or from the unassigned
shelf is a move and can also be a retime when intervals change. Label, payload,
and visual differences do not change placement classification.

Metrics remain visible when evidence differs, but the package marks them as not
comparable. It does not normalize units or claim that values produced from
different populations, rules, exclusions, horizons, or definitions have a
meaningful delta.

## Styles

Import both packaged stylesheets:

```typescript
import "@planning/timeline-react/styles.css";
import "@planning/timeline-compare/styles.css";
```

Comparison classifications are exposed through `data-pattern` values beginning
with `comparison-`. Host applications can replace the included visual treatment
without changing the comparison logic.

## Validate

```powershell
Set-Location .\components\Planning.Timeline.Compare
npm install
npm run check
```
