---
title: Planning timeline core
description: Domain-neutral timeline contracts, geometry, filtering, and interaction intents
---

## Status

This package is the first extraction slice for a reusable planning timeline. It
contains no React, application API, router, storage, airport, or deployment
dependency.

## Included

- Explicit rows, items, display intervals, reservation intervals, and windows
- Assigned, unassigned, and excluded item states
- Typed custom visual tokens, accessibility labels, and renderer hooks
- Deterministically ordered, row-scoped overlays with explicit hit-test behavior
- Hide and dim filter semantics
- Time-to-coordinate conversion and interval clipping
- Hit testing, snap calculations, and drag auto-scroll calculations
- Proposal-only movement with immutable source items
- Proposed, pending, accepted, rejected, and cancelled intent states
- Synthetic machine-scheduling fixtures

Display intervals and reservation intervals remain separate. Moving an item
shifts both intervals by the same snapped delta while preserving their original
offset. The core does not interpret a visual edge resize as authorization to
change an operational or forecast interval.

## Authority boundary

The timeline emits an intent. It does not validate, commit, or silently repair
that intent. A host application must:

1. Translate the intent into an authoritative preview request.
2. Display pending and rejection evidence without hiding the source item.
3. Commit only an accepted preview against the expected draft version.
4. Update the rendered item from the returned authoritative snapshot.

Filters affect presentation only. Hidden items may still constrain server-side
validation.

## Validate

```powershell
Set-Location .\components\Planning.Timeline
npm install
npm run check
```

## Next boundary

The React renderer now lives in
[`Planning.Timeline.React`](../Planning.Timeline.React/README.md). The next
application binding lives in
[`Planning.Timeline.Application`](../Planning.Timeline.Application/README.md),
with a runnable workflow in
[`Planning.Timeline.Demo`](../Planning.Timeline.Demo/README.md).
