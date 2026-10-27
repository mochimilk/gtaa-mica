---
title: Executive plan decision brief
description: Compare a retained reference with a prepared alternative or late-request accommodation without applying the preview or inventing capacity and financial scores.
---

## Presenter workflow

Select a Contoso scenario and reference plan in [Demo settings](demo-settings.md).
Open **Compare plans**.

1. Select the other prepared plan or one of the late-request options.
2. Read additional services, retained/lost demand, changed assignments and tows.
3. Review the side-by-side measurements under the same waiting assumption.
4. Expand **What changed?** for affected flight pairs and exact stand/time details.
5. Expand **Rules, assumptions and evidence** for measurement versions,
   synthetic delay parameters, solver request identities and search provenance.
6. For a late request, select **Review accommodation decision** to return to
   the explicit checkbox and acceptance workflow with that option and assumption.

You can also select **Open executive brief** from a late-request preview.
The dialogs hand off after closing so they do not compete for keyboard focus.
Closing returns focus to the appropriate toolbar control.

Selecting a comparison never changes the chart, approval, saved preferences,
filters or solver outputs. The original fixture has no comparison control.
This view compares one synthetic day and demand source, not different days,
independently optimized policy profiles or actual operational performance.
Accommodation entries are the same representative repairs shown by
**Late request**, with descriptive stand/flight labels rather than numbered
lookalikes. All valid candidates are assessed; equivalent summaries are
disclosed, and cosmetic duplicates do not fill a required count.
The comparison screen does not generate another set of alternatives.

## Measurements and interpretation

The [comparison contract](../src/demo/decision-brief.ts) derives a brief from
the selected reference and alternative. Both the brief and
[late-request review](accommodation.md) use the same consequence table.

* Assigned visits have an explicit demand denominator
* Existing unresolved demand stays separate from a newly requested service
* Gained, retained and lost visit identities are tracked independently
* Changes compare stand/time/endpoints/tow patterns, ignoring internal stay IDs
  and array order
* Existing flight retimings and generated tow counts are separate observations
* Handovers, tight handovers and minimum buffers retain their measured populations
* Waiting totals use only arrival identities assessed in both plans
* Assessed/unassessed counts and the incoming arrival estimate remain separate

Buffer counts and minima are not presented as like-for-like improvement deltas
when the underlying handovers change. No common assessed arrivals or no measured
buffer means N/A, not zero risk. A request can be accommodated while worsening
local margins; the brief does not turn these consequences into a universal score.

The existing [buffer metric](buffer-evaluation.md) and
[synthetic waiting model](gate-wait-evaluation.md) remain reporting-only.
The brief identifies their versions, profiles and chosen release-delay assumption.
It does not change either calculator or the solver objective.

The constrained baseline/tow comparison illustrates a coverage/tow trade-off.
Reversing that comparison explicitly warns when previously assigned demand is
lost. The full-day late request illustrates a localized repair that preserves
original assigned demand while leaving its 11 original unresolved visits visible.
Alternatives are not ranked by revenue, passenger satisfaction or resilience.

## Inspecting an alternative without applying it

**What changed?** shows reference and alternative occupancy details independently.
Stand buttons reveal and focus that stand in the active chart. Flight buttons
use the existing operational selection and detail popover for the active flight.
Those links do not replace the chart with the preview.

A proposed incoming flight has no chart link until it exists in the active
session dataset. Its proposed route, schedule, aircraft, carrier and stand remain
visible in the brief. An existing unassigned flight remains unassigned in the
active chart until a plan is explicitly selected; inspection does not invent a bar.
Filters may dim assigned bars but do not remove their inspection targets.

After accommodation acceptance, the brief still compares against the retained
reference. It distinguishes the active session choice from another preview.
Reference capacity/atlas and chart-metric overlays remain suppressed against the
amended workspace; the brief recalculates its consequences from the validated
alternative rather than reusing those stale overlays.

## Decision boundary

The brief separates measured consequences from human judgment. Stand-rule
validation is offline against authored synthetic physical compatibility,
airline/sector permissions, overlap and adjacency rules. This is not airport
certification.

Staffing, shared gates, passenger handling, stand opening calendars and tow
crews/routes need separate operational confirmation. No revenue uplift,
airport-wide capacity percentage or overall resilience score is calculated.
Accommodating one additional service is not proof of sustainable extra demand
over a month.

Acceptance remains [session-only and reversible](accommodation.md).
No approval record, comparison selection or brief is persisted. Broader
replanning, commercial valuation, cross-day comparisons and durable approvals
remain outside this increment.
