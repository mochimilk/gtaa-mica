---
title: Single-turn usable capacity
description: Find and inspect individually feasible arrival-start ranges for a specified extra turn against frozen assignments and authored stand rules.
---

## Presenter workflow

Choose a prepared Contoso plan in [Demo settings](demo-settings.md), then select
**Capacity** beside **Buffers** and **Gate waiting**.

1. Choose a prepared aircraft/operator/sector probe.
2. Set the required occupancy duration in whole minutes.
3. Set the search start and end in UTC, inside the prepared horizon.
4. Enable **Show feasible arrival-start ranges on the chart**.
5. Optionally select **Show all prepared probes** and an **Opportunity evidence** mode.
6. Close the dialog and click a colored range, or focus it and press Enter or Space.

The original fixture has no capacity controls. Probe, duration, search window,
visibility and inspection choices are session-only and reset on dataset/plan
switching and reload. Flight filters do not change or dim capacity evidence:
the query is explicitly for the selected probe, not the filtered flights.
Buffer and waiting annotations remain independently selectable.

## What a range means

`airport-single-turn-capacity`, version `1.0.0`, asks:

> Where could one additional turn fit without changing the current assignments?

Colored borders represent feasible **arrival start times**, not available
occupancy intervals or additional assigned flights. Given a free stand window
`[a, b)` and required duration `d`, the start range is `[a, b - d]`.
Both start endpoints are included. An exact fit has one feasible start instant,
drawn with a minimum-width marker for inspection, not as added duration.

For example, a free window from 10:00 through 12:00 with a 75-minute turn
permits starts from 10:00 through 10:45. Starting at 10:45 releases the stand
at 12:00. A 74-minute free interval cannot accommodate that turn.

The search window constrains the entire occupancy, not only the arrival.
Before-first, between-assignment, after-last and wholly unused stand windows
are included. Context occupancy outside the horizon still blocks any
overlapping portion inside it. Touching release/arrival endpoints are valid
when configured extra separation is zero.

## Rules and evidence

The [local evaluator](../scripts/capacity-probe.mjs) reuses `standCandidates`
and `evaluatePlan`, the same rule checks used by local assignment preparation
and independent plan validation. No rule implementation is duplicated in
the browser.

It checks:

* Aircraft compatibility, operating-airline permissions and both sectors
* Stand readiness and configured closures
* Existing stand occupancy
* Occupancy-triggered adjacency closures and restrictions
* Restrictions triggered in either direction, including a probe that would
  invalidate an existing neighboring assignment
* Explicit extra same-stand separation before and after existing occupancy

For each eligible stand, conflicting fixed assignments produce blocking
intervals. Overlapping and touching intervals are merged into a union.
Its complement supplies continuous free windows. The browser clips these
prepared windows to the requested search interval and subtracts the duration.
This is not a minute-grid sample or a count of hypothetical jointly assigned
turns. Static-incompatible stands and their exclusion reasons remain visible.

The inspection shows the feasible start bounds, last possible release and
the stand window's preceding/following blocking evidence, including assignment
references, finding codes and authored rule paths. Horizon boundaries are
explicit rather than invented neighboring flights.

The [profile](../data/airports/contoso/evaluation/capacity-profile.json) and
its [schema](../data/schemas/capacity-profile.schema.json) define prepared
probe choices. Initial probes are American/B738 domestic, United/A320 domestic
and British Airways/B789 international. The defaults are 75, 75 and 120 minutes,
respectively, with zero extra separation. These are experiment settings, not
authorized operating minima. The
[operating policy](../data/airports/contoso/operating-policy.json) does not impose
a summed minimum duration for a complete supplied turn.
The [buffer-review threshold](buffer-evaluation.md) is independent and never
silently becomes a capacity protection buffer.

## Comparison boundaries and limitations

Each range is individually feasible against its fixed plan under the
implemented stand rules. Two alternatives can conflict through occupancy
or adjacency. Neither range count nor stand count is an additive turn-slot
count, fleet throughput, utilization percentage or airport-wide capacity score.

Baseline/tow comparisons disclose assigned-visit coverage beside static
eligibility, stands with feasible starts and start-range counts.
When assigned populations differ, the UI warns against claiming a
same-coverage improvement. More fragmented ranges are not necessarily better.
Spare windows can coexist with unassigned demand: those flights may require
different times, aircraft compatibility or operating permissions than this probe.

This is reporting-only evidence, not a solver objective or operational
authorization. It does not move existing assignments, recover unassigned
flights, generate tows, model predicted delay padding or simulate queues.
Shared gate resources, passenger handling, crews, staffing and tow travel
are not validated. No opening-hours calendar is currently modeled; time
variation here comes from the actual fixed occupancy and triggered rules.

## Synthetic opportunity month

The atlas overlays three profiles together: green for American, purple for
United and teal for British Airways. All-probe mode uses each probe's default
duration. Switch back to single-probe mode to experiment with another duration.
The current fixtures have separate eligible stand pools. Separate row bands
also support future probes that share stands without drawing one over another.

Borders always show the current plan's individually feasible starts.
Historical-style fill is clipped to those borders; it does not draw monthly
opportunities that the current plan cannot accommodate. Click a heat segment
to inspect its first start, or use Enter/Space to inspect the first visible
start in a range. Inspection names the exact UTC instant and duration and
lists all daily assessments.

`airport-opportunity-recurrence`, version `1.0.0`, reports three distinct ratios:

* Planned recurrence: days accommodating the exact start/duration / assessed days
* Modeled end-of-day recurrence: days accommodating it at end-of-day / assessed days
* Retention: days accommodating it in both phases / days accommodating it as planned

For example, 20 planned days, 18 end-of-day days and 15 common days out of
30 produce 67% planned recurrence, 60% end-of-day recurrence and 75% retention.
The three newly available end-of-day opportunities are not retained ones.
Zero planned days means retention is N/A, not 0%. All prepared records cover
30/30 days; missing dates, probes or eligible stands fail loading rather than
silently counting as unavailable. An assessed stand with no free windows is
a valid unavailable assessment.

Color identifies the profile; fill opacity runs from empty at 0% to darkest
at 100%. N/A retention also has no fill, with an explicit N/A denominator in
inspection. The display partitions exact millisecond-resolution start ranges
at all monthly support boundaries. Inclusive latest starts and exact fits
are preserved; intensity is not a sampled time bin or a green-pixel ratio.

### Synthetic provenance and limits

The [atlas profile](../data/airports/contoso/evaluation/capacity-atlas-profile.json)
defines 30 dates, September 24 through October 23, 2026, and a deterministic seed.
Each date replays the same frozen demand mix, stand assignments and tow
relationships. A shared shift of -30 to +30 minutes and scale of 97.5% to
102.5% produces the planned pattern. The modeled end-of-day pattern adds a
shared 0 to 35 minute shift and a further 100% to 103% scale. Timing transforms
apply to all occupancies, including horizon context, without truncating them.
Every transformed full plan passes the authoritative hard-rule evaluator.

These are correlated timing replays, not 30 independently generated demand
days, independently solved plans, calibrated flight delays or observed actuals.
Both variants use identical daily timing parameters for a matched scenario.
Days align by elapsed UTC time from the source horizon start; this is not
a local-time or daylight-saving reconstruction.

The atlas demonstrates how recurring evidence could guide an operations
question about aircraft, airline permissions, sector and time. Its percentages
are synthetic evidence frequencies, not empirical probabilities, increased
throughput or proof that extra demand could operate. Existing unassigned
demand remains unresolved. It neither attributes a commercial benefit to the
solver nor changes planner priorities or resilience protections.

The [late-request workflow](accommodation.md) separately demonstrates
request-specific direct placement and bounded one-turn repairs.
Real observed history, changing demand mixes and broader replanning remain
future increments.

## Preparation and validation

```powershell
npm run prepare:capacity
npm run test:capacity
npm run test:atlas
npm run test:demo
npm run build:desktop
```

`prepare:capacity` evaluates the committed snapshots without invoking the
solver or rewriting demand/assignments. It reconstructs deterministic source
demand to recover sector metadata and rejects mismatches with the frozen
snapshot. If demand/profile/catalog changes prevent reconstruction, do not
silently substitute new traffic for an old plan. Preserve the original demand
or deliberately prepare a new scenario.

`prepare:demo` also refreshes capacity evidence when deliberately rebuilding
plans. Sidecars are lazy-loaded per scenario and follow the
[capacity evidence schema](../data/schemas/capacity-snapshot.schema.json).
They retain calculation/profile versions, resolved probes, horizon, airport
and demand fingerprints, both solver request fingerprints and the full
snapshot fingerprint. Browser loading verifies the exact snapshot using
SHA-256 and rejects stale or malformed evidence through the existing demo
error notification. Verification requires localhost, HTTPS or the desktop
app's secure context.

Tests cover exact-fit boundaries, horizon/context windows, static exclusions,
both adjacency directions, conditional restrictions, merged blocks, explicit
separation, invalid plans and non-additivity. Prepared opportunities are replayed
against the authoritative rule evaluator for all three scenarios and both
variants. Browser-side tests verify fingerprints, complete stand assessments,
blocking evidence, invalid inputs and CSP-safe loading without runtime string
code generation.

Both `prepare:capacity` and `prepare:demo` refresh the atlas after capacity
preparation. `npm run prepare:atlas` regenerates only the synthetic month
against the frozen capacity sidecars, without running the solver. It rejects
stale snapshot, demand or airport identities. The browser validates the
[atlas schema](../data/schemas/capacity-atlas.schema.json), exact capacity
fingerprint, dates, complete assessments, parameters and window boundaries.
Schema validators are generated offline for CSP-safe loading.
