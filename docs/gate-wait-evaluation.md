---
title: Synthetic predicted gate-wait review
description: Inspect versioned point-estimate waiting contributions from illustrative predecessor stand-release delays without changing assignments.
---

## Presenter workflow

Choose a prepared Contoso plan in [Demo settings](demo-settings.md), then select
**Gate waiting** beside **Buffers**. Both controls use the same review dialog.
**Review metric** switches between the two measurements without changing plans.
The original fixture remains unchanged and has neither review control.

Choose a **Synthetic release-delay assumption**, enable **Show positive waiting
estimates on the chart**, then close the review. Blue dots mark incoming
arrivals with positive estimates. Click a dot, or focus it and press Enter or
Space, to inspect the incoming flight, predecessor release, scheduled gap and
calculation. Focus returns to the marker after closing the review.

Blue dots do not encode a holding interval or extend occupancy. Dashed amber
intervals remain [scheduled buffers](buffer-evaluation.md). Both annotations
can be enabled together. Filters dim markers without changing the whole-plan
measurement population. Overlay and assumption choices reset on dataset/plan
switching and reload; existing source preferences persist separately.

## Calculation v1

`airport-predicted-stand-wait`, version `1.0.0`, is predicted and scoring-only:

```text
estimate minutes =
  P(predecessor stand-release delay)
  * max(0, mean release delay when delayed - scheduled stand gap)
```

For a 10-minute gap, delay probability 0.25 and conditional mean delay of
20 minutes, the contribution is `0.25 * (20 - 10) = 2.5 minutes`.
A gap at or above the conditional mean gives a valid zero estimate.

This reproduces the PoC's documented point-estimate formula, not the full
expectation over a delay distribution. In general,
`E[max(0, delay - gap)]` is not equal to applying `max` to the mean.
The number of arrivals with positive estimates is not an expected count or
probability of actual gate holds.

The delay belongs to the preceding occupancy's release, including departure
and tow releases. Incoming arrivals remain at scheduled times. Only an incoming
commercial arrival endpoint contributes: parking starts, tow-ins and
departure-service returns are not additional arrivals.

The evaluator uses raw scheduled occupancy separation, not forecast padding
or the configurable tight-buffer review threshold. It does not change source
times, reserve protection, propose intentional gate holds, propagate delays,
enforce downstream handling after a hold or run the solver.

## Synthetic inputs

The [profile](../data/airports/contoso/evaluation/gate-wait-profile.json) names
the metric, model and calculation versions and explicitly declares synthetic
source data. The [schema](../data/schemas/gate-wait-profile.schema.json) and
runtime parser reject missing/unsupported values, duplicate assumption IDs and
unknown default/selected assumptions.

| Assumption | Release-delay probability | Mean delay when delayed |
|------------|---------------------------|-------------------------|
| Illustrative routine releases | 0.25 | 20 minutes |
| Illustrative stressed releases | 0.50 | 40 minutes |

These values apply uniformly to every assessed predecessor release.
They are not learned from six months of records, calibrated forecasts,
time-specific delay banks or airline performance claims.
Probability can range from 0 through 1; conditional mean delay can range
from 0 through 240 minutes. Zero is a declared assumption, not a missing-data
fallback.

## Population and comparison boundaries

Report these separately:

* Assigned and unassigned visits, generated tows and solver status
* Assigned arrivals inside the half-open horizon
* Assessed arrivals with a complete known predecessor handover
* Unassessed assigned arrivals, with reasons retained in calculation evidence
* Assigned context arrivals outside the horizon
* Arrivals with positive estimates, total estimate and largest contribution

First-on-stand arrivals have no predecessor handover in this model.
They are unassessed, not zero-wait predictions. Gaps crossing the horizon are
not extrapolated. Known context occupancy can supply a predecessor release
inside the horizon. Unassigned demand remains unassigned; it is not silently
given a waiting estimate.

No assessable arrivals produces `not-applicable` and null minute summaries.
Overlapping stand occupancy makes the assessment `invalid`, with no waiting
total or overlay. This avoids treating invalid plans as zero-wait plans.
The scope includes assigned remote arrival stands as well as contact stands;
this is stand-conflict waiting, not a passenger-gate-only measure.

Baseline and tow options share one frozen snapshot and one resolved model
assumption. Waiting deltas are suppressed if either assigned visit sets or
assessed arrival sets differ, even when their counts match. Unavailable totals
also have no delta. Coverage and assessment scope stay visible beside all raw
values.

The [evaluator](../src/demo/gate-wait-evaluation.ts) retains profile/model
versions, resolved assumptions, demand identity, horizon, solver request
fingerprints and per-arrival contributions. No historical model service,
runtime solver, new dependencies or metric registry is introduced.
Results are synthetic review evidence, not observed savings, full queue/taxi
simulation, operational authorization or a new solver objective.

## Validation

```powershell
npm run test:demo
npm run build:desktop
```

Tests cover hand-calculated and fractional values, valid zero estimates,
no-predecessor and boundary cases, arrival versus tow endpoints, overlaps,
invalid model inputs/references, assessment-population differences,
deterministic ordering and unchanged source/buffer results for all prepared
cases. Runtime string-code generation remains disabled in the tests.
