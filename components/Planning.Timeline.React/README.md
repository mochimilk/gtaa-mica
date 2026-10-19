---
title: Planning timeline React renderer
description: Domain-neutral React timeline with custom visuals, overlays, zoom, selection, and move proposals
---

## Status

This package renders the contracts from `@planning/timeline-core`. It does not
import application API DTOs, routers, global stores, or domain terminology.

## Included

- Ordered resource rows and UTC time ticks
- Sticky row labels and time header
- Custom item body, label, badge, and detail render hooks
- Shape, fill, pattern, selection, dimming, and intent-state data channels
- Row-scoped overlays with custom content
- Visible unassigned-item shelf
- Accessible item names and keyboard-focus details
- Controlled selection callbacks
- Controlled or uncontrolled zoom
- Controlled horizontal scroll synchronization
- Proposal-only pointer movement with snapping and auto-scroll
- CSS variables for host visual theming

## Authority boundary

Pointer movement emits a `TimelineMoveIntent`. The renderer does not update the
source item, validate the proposal, or commit it. The host must preview the
intent through its authoritative application boundary and provide the resulting
pending, accepted, rejected, or cancelled state back to the renderer.

The unassigned shelf does not invent intervals for missing data. Filters affect
presentation only and do not remove hidden items from server-side validation.

## Styles

Import the packaged stylesheet:

```typescript
import "@planning/timeline-react/styles.css";
```

Hosts can override the `--timeline-*` CSS variables on the component container.
Custom visual tokens are exposed through `data-shape`, `data-fill`, and
`data-pattern` attributes without assigning domain meaning in this package.

## Validate

```powershell
Set-Location .\components\Planning.Timeline.React
npm install
npm run check
```

## Composition boundaries

The synthetic workflow and authoritative application binding now live in
[`Planning.Timeline.Demo`](../Planning.Timeline.Demo/README.md) and
[`Planning.Timeline.Application`](../Planning.Timeline.Application/README.md).
Baseline-versus-candidate composition now lives in
[`Planning.Timeline.Compare`](../Planning.Timeline.Compare/README.md). The
renderer exposes instance-specific accessible labels, viewport test IDs, and
host-controlled zoom so multiple timelines can coordinate without importing
comparison policy into the chart.
