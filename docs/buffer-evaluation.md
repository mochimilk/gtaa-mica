---
title: Scheduled stand buffer review
description: Compare frozen prepared plans using a versioned reporting-only buffer metric and inspect tight handovers on the timeline.
---

## Presenter workflow

Choose a prepared Contoso plan in [Demo settings](demo-settings.md), then select
**Buffers** beside the chart controls. The original fixture has no buffer-review
controls and remains unchanged.

The review compares baseline and tow options from the same prepared snapshot.
Select **Tight below (minutes)** and enable **Show tight handovers on the chart**.
Close the dialog to inspect dashed amber gap intervals. Click a marker, or focus
it and press Enter or Space, to reopen the review with both affected visits and
the release/next-start times. Zero-minute gaps have a small boundary marker;
its visual width is not a time reservation.

The handover selector also exposes gaps that are not below the threshold.
Chart filters dim nonmatching markers, but do not change the measurement
population or remove occupancy. The summary always describes the whole plan.

Overlay visibility, threshold overrides and inspected evidence are session
state. They reset on dataset/plan switching and reload. Existing dataset
preferences continue to persist separately.

## Definition and boundaries

`airport-scheduled-stand-buffer`, version `1.0.0`, is derived and scoring-only,
corresponding to the generic component's `Derived` and `ScoringOnly` semantics.
The [browser evaluator](../src/demo/buffer-evaluation.ts) operates locally on
frozen viewer snapshots; it does not instantiate another metric registry or
claim to execute the generic .NET scoring pipeline.

For consecutive occupancies of different visits on the same stand:

```text
buffer minutes = (next occupancy start - previous occupancy end) / 60,000
tight = buffer minutes < configured threshold
```

The review includes parking/service occupancy, not only passenger-gate activity.
Consecutive returns of the same visit do not create a handover between aircraft.
It does not subtract an assumed service/separation allowance or add forecast
padding. These values are scheduled separation, not predicted resilience,
gate waiting, compatible spare capacity or financial savings.

Both endpoints of a handover must fall within the half-open evaluation horizon.
A known release exactly at horizon start can contribute a zero-minute handover.
No gaps are invented before the first or after the last occupancy, and an
interval crossing a horizon boundary is not treated as a complete handover.
Capacity analysis may examine those spaces separately with boundary evidence.

The summary reports handover count, tight count, minimum, median and P10:

* Zero-minute handovers are valid and count as tight when the threshold is positive.
* A gap exactly equal to the threshold is not tight.
* P10 uses nearest rank: sorted index `ceil(0.1 * count) - 1`.
* Median averages the middle pair for an even population.
* No eligible handovers produces `not-applicable`, with null minute summaries.
* Overlapping occupancies produce separate, horizon-clipped pair evidence.
  They make the assessment `invalid`; minute summaries and the overlay are
  unavailable, not zero or negative buffers.

Nested intervals are checked against the occupied union so a shorter interval
inside a longer stay cannot manufacture free time. Every overlapping pair is
reported, not only consecutive pairs.

## Profile and comparison evidence

The [evaluation profile](../data/airports/contoso/evaluation/buffer-profile.json)
selects the exact metric version and defaults to a 20-minute review threshold.
Its [schema](../data/schemas/buffer-evaluation-profile.schema.json) allows finite
thresholds from 0 through 120 minutes. The UI offers common values. The threshold
is a review assumption, not an authorized operating minimum.

Evaluation settings are separate from generation, hard rules, tow preparation
and solver objectives. Threshold changes do not mutate inputs, generate new
flights, change assignments or run the solver.

The calculated result retains the metric definition, resolved profile parameters,
demand identity, horizon and each solver request fingerprint, with raw evidence
for both plans. Comparisons disclose:

* Assigned/unassigned visits and generated tows
* Solver status and buffer availability
* Gained and lost visit identities
* Changed and unchanged retained visits
* Raw buffer summaries and, where applicable, tow-options-minus-baseline deltas

Assignment changes compare stand/time segment patterns per visit, including
split stays, rather than internal stay IDs. Equal coverage counts do not prove
equal assigned populations. If assigned sets differ, the UI warns and suppresses
buffer deltas. Invalid or not-applicable assessments also have no buffer delta.
Even when assigned sets match, gap counts and handover identities can change;
these remain descriptive comparisons, not proof of operational improvement.

This slice deliberately does not compare arbitrary snapshots or rule/model
versions. It evaluates two variants within one frozen prepared scenario.
Prepared snapshots do not contain the full rule/candidate proof; this metric
does not replace independent stand validation.

## Validation

```powershell
npm run test:demo
npm run build:desktop
```

Tests include hand-calculated gaps and percentiles, threshold boundaries,
no-handover cases, same-visit returns, horizon edges, nested overlaps, input
validation, assignment-pattern comparisons, population changes and all three
prepared scenarios. The tests disable runtime string-code generation, preserving
the desktop's no-eval boundary.
