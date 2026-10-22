---
title: Repeatable airport demo scenarios
description: Generate seeded raw flight legs, complete scheduled context and measurable local stand-assignment comparisons without changing the Gantt.
---

## Run the two demo days

The [Contoso scenario profile](../data/airports/contoso/demand/scenario-profile.json)
defines a shared synthetic day and two cases. The existing 16-leg validation
seed remains separate and unchanged.

```powershell
npm run generate:scenario -- --case comfortable --output .\comfortable-demand.json
npm run run:scenario -- --case comfortable --output .\comfortable-review.json
npm run run:scenario -- --case constrained --output .\constrained-review.json
npm run test:scenarios
```

Generation needs only Node and the existing dependencies. Solved reviews also
need the [.NET 10 local solver](local-assignment.md); the command performs an
incremental build. It creates no service or hosted resource.

| Case        | Visits | Raw flight legs | Baseline coverage | Tow-option coverage | Generated movements |
|-------------|--------|-----------------|-------------------|---------------------|---------------------|
| Comfortable | 36     | 72              | 36 visits / 72 legs | 36 visits / 72 legs | 0                 |
| Constrained | 41     | 82              | 40 visits / 80 legs | 41 visits / 82 legs | 2                 |

These results were verified with the checked-in seed, airport rules and default
tow profile. They are assertions about this configuration, not guaranteed
outcomes after changing the inputs. Both variants passed independent stand
validation. One visit counts as two flight legs regardless of its tow pattern.

The constrained case adds five simultaneous United international B789 visits
to the same base demand. Four eligible service stands cannot hold all five.
The long visit can leave that pool, park on a compatible non-contact stand,
and return before departure handling. The solver chooses one tow pair to gain
one assigned visit; no stand permissions are relaxed.

## Profile configuration

The [profile schema](../data/schemas/scenario-profile.schema.json) and
[generator](../scripts/scenario-generator.mjs) define the contract.

| Field                      | Purpose                                                                 |
|----------------------------|-------------------------------------------------------------------------|
| `id`, `airport_id`, `seed`  | Suite identity, matching airport and repeatable random input             |
| `plan_window`              | Explicit UTC horizon, from 1 through 48 elapsed hours                    |
| `sampling_step_minutes`    | Arrival sampling grid relative to plan start, from 5 through 120 minutes |
| `external_airport_ids`     | Explicit synthetic route endpoints, distinct from the local airport     |
| `traffic_mix`              | Exact visit counts by aircraft, airline and arrival/departure sectors    |
| `boundary_visits`          | Complete scheduled pairs spanning a configured plan boundary            |
| `cases`                    | Optional pressure banks and required measured outcome expectations      |

Each traffic row supplies PAX bounds and minimum/maximum dwell in minutes.
The generator uses configured aircraft seat counts and rejects unknown
catalog entries, reversed ranges and mixes with no eligible uninterrupted
service stand. Invalid rows remain errors even when their configured count
is zero. This first generator does not create inherently tow-required
sector transitions.

A boundary row has `anchor: "plan-start"` or `"plan-end"` and signed arrival
and departure offsets. Negative arrival offsets and positive departure
offsets place the aircraft across that boundary. Both events must fit the
existing plan-duration linking and surrounding-context limits.

A pressure bank supplies `long_count`, `short_count`, `short_stay_minutes`,
`long_lead_minutes` and `long_lag_minutes`. Short visits share a sampled arrival;
long visits arrive before that instant and depart afterward. This deliberately
correlated stress is separate from ordinary weighted traffic.

Selected-case totals are limited to 200 visits. These bounds keep the current
candidate-pair compiler suitable for experimentation, not a production
full-airport throughput claim.

### Repeatability and timing

The generator uses keyed deterministic random streams, not the wall clock.
The same seed and inputs reproduce the same generated JSON. Reordering
ID-keyed profile rows or cases does not affect output. Route-array order
remains meaningful. Common traffic is identical between cases; adding a bank
does not resample it.

For ordinary traffic, dwell is sampled uniformly within its inclusive range.
Possible arrivals are weighted by:

```text
normalized arrival weight at local arrival hour
  * normalized departure weight at local departure hour
```

This joint preference uses the airport's existing sector traffic profile.
It does not promise independent hourly arrival/departure totals, observed
traffic volumes or capacity. Zero-weight combinations are never selected.
If a sampled dwell has no positive slots, generation fails explicitly rather
than moving demand or replacing the configured distribution.

UTC sampling covers actual elapsed instants; local repeated or skipped hours
follow the airport time zone. A 23-hour or 25-hour dated horizon retains its
configured counts. Departure is arrival plus sampled dwell, not rounded to
the sampling grid.

Arrival/departure handling minima constrain elective tows. They are not added
together to impose a universal minimum turn. An uninterrupted shorter turn
can still be generated and assigned.

### Source demand and boundary evidence

The [generated scenario schema](../data/schemas/scenario.schema.json) packages:

* Strict raw arrival/departure legs, without stand assignments, visit IDs or actuals
* A canonical profile copy and SHA-256 profile fingerprint
* Stable source IDs, generated registrations and per-visit timing trace
* Explicit initial/final scheduled aircraft presence
* Exact expected visit count and complete-timing assertion

The snapshot ID also hashes generated source legs, so changed airport timing
weights that change demand change that identity. The profile hash identifies
the profile alone, not all airport inputs. Preserve the airport configuration,
tow profile and solver version when reproducing a solved comparison.

Every aircraft has exactly one generated arrival/departure pair. This closed
feed intentionally supplies known surrounding source legs. It is not a
fleet-rotation model or a claim that an arbitrary live feed is complete.
The generator runs the existing visit linker and occupancy derivation and
rejects anything other than its exact connected, fully timed visit set.

Presence uses half-open intervals: an aircraft that departs exactly at plan
end is not in final aircraft state. The default comfortable case has 69 flight
events inside the horizon and three outside: two overnight context events
and one ordinary departure exactly at plan end. All 72 legs contribute to
complete represented visits. Each default case has one aircraft present
at each boundary.

Generated presence does not assign an initial or final stand. A solved review
resolves the selected stand, a generated movement in progress, or an explicit
unassigned state. It never fills an unknown parking boundary or invents a
stand. Generic initial-state overlays and missing single-leg tow scheduling
remain separate future work.

## Measurements and expectations

The [review schema](../data/schemas/scenario-run.schema.json) contains
`scenario`, the full local-solver `comparison`, and `summary`.
The [summary adapter](../scripts/scenario-report.mjs) records:

* Source event counts inside and outside the horizon
* Represented/assigned flight legs and assigned/unassigned visits
* Generated tow movements and baseline-to-variant coverage gain
* Contact and remote service flight counts, counting each flight once
* Occupied minutes, utilization and unoccupied intervals per open, ready,
  airline-authorized stand, clipped to the horizon
* Initial/final assigned or in-transit aircraft state
* Solver status, stand validation and unresolved/blocked source counts

Unoccupied stand time is schedule space, not compatible usable capacity.
Neighbor closures, shared gates, crews, routes, towing feasibility and bus
resources can prevent use of a gap. A contact-service count is not a
passenger-satisfaction score. No financial benefit, resilience score or
operational certification is inferred.

Case expectations specify baseline/variant completeness, minimum flight-leg
coverage gain, and minimum/maximum generated movements. The runner checks
actual native results against them, plus independent stand validation and
source/timing completeness. An intentionally partial constrained baseline
can pass its expectation; an unexpected partial variant cannot.

| Exit code | Meaning                                                                  |
|-----------|--------------------------------------------------------------------------|
| `0`       | Standalone demand generation completed                                    |
| `1`       | Invalid input, build/execution/validation failure or output I/O error       |
| `2`       | Solved review generated but measured scenario expectations failed          |
| `3`       | Solved review matched expectations; operational limitations still remain   |

The scenario runner's exit code `3` can include an expected partial baseline.
This differs from the raw [assignment runner](local-assignment.md), which
marks any unassigned group as incomplete.

## Command options and application boundary

`--case` is required. Optional flags are `--profile`, `--airport`, `--output`,
and `--solve`. Solved reviews also accept `--tow-profile` and
`--time-limit-seconds` (greater than zero through 300, default 10 per variant).
The latter two flags are errors without `--solve`.

Default paths are module-relative; explicit paths are working-directory
relative. Output files are created exclusively and never overwritten.
Without `--output`, JSON goes to stdout and diagnostics go to stderr. Invoke
`node .\scripts\generate-scenario.mjs` directly when a machine consumer
requires stdout without npm's banner. Extract `raw_demand` from the standalone
package to use it with the existing raw-demand commands.

The generator does not alter the Gantt, existing fixture or airport rules.
[Demo settings](demo-settings.md) now provide an explicit switch between the
original fixture and compact prepared plans. Arbitrary command-line review
files are not imported automatically. Historical delay distributions and
day-of actuals are not generated here.
