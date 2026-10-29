---
title: Repeatable airport demo scenarios
description: Generate seeded raw flight legs, complete scheduled context and measurable local stand-assignment comparisons without changing the Gantt.
---

## Validate another airport

Use the [airport onboarding guide](airport-onboarding.md) for source requirements,
file formats, map alignment, aircraft reuse and the `/add-airport` AI prompt.
The [GTAA configuration](gtaa-airport.md#synthetic-full-day-configuration) now
provides a second executable 160-visit baseline with domestic, US transborder
and international traffic.

The next airport is an end-to-end portability exercise, not evidence that
every production planning problem is already modeled.
Keep airport configuration, raw demand, plans and evaluation profiles separate.
Steps 1-4 provide headless validation. Steps 5-6 register compact read-only
schedules; additional analysis tooling remains on `feature/solver`.

1. Author a manifest and referenced infrastructure with a consistent airport ID,
   timezone, stand/gate identities, physical permissions, airline/sector groups
   and adjacency conditions. Validate references before generating demand.
2. Configure aircraft-size handling, default tow travel, traffic weights, route
   preferences and a tow profile. Minimum parking is a profile choice, not a
   universal operating rule.
3. Generate complete paired visits for the prepared viewer, with short, long
   and boundary-context stays. Include long stays if tow windows are part of
   the demonstration. Keep unmatched/ambiguous feed validation separate;
   the underlying linker preserves unknown boundaries, but the prepared demo
   projection currently requires complete pairs.
4. Run baseline/tow assignments and independently validate the complete plans.
   Do not assume Contoso's coverage, tow counts or available capacity will recur.
5. Prepare source-matched compact snapshots using the
   [schedule-only command](local-assignment.md#select-or-prepare-an-airport-schedule).
   Capacity probes, atlas, accommodation and tow-window evidence require
   separate airport-specific inputs and remain unavailable in this viewer.
6. Register the new source and prepared artifact imports in the source registry,
   then validate chart rows, flight links, filters, unassigned demand,
   read-only boundaries and confirmed reloads.

The reusable generation and assignment functions accept an airport object
rather than selecting rules from an airport name. Command defaults target
Contoso; supply explicit GTAA manifest, scenario and tow-profile paths for GTAA.
The original application fixture retains its editing behavior. A manifest
does not register a selectable application dataset, and
application branding does not determine the solver's airport identity.

Portability tests cover a different airport identity, timezone and travel
duration. The next airport must additionally validate new
geometry, permissions, catalogs, demand mix and independently prepared evidence.
Staffing, shared-gate capacity, tow routes/crews, commercial valuation, broader
repairs and profile-based whole-day strategy optimization remain explicit
prototype limitations, not completed features.

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

## Generate a full Contoso day

The [full-day profile](../data/airports/contoso/demand/full-day-profile.json)
generates October 24, 2026 from local midnight to midnight in
`America/Los_Angeles`: 07:00 UTC October 24 through 07:00 UTC October 25.

```powershell
npm run generate:scenario -- --profile .\data\airports\contoso\demand\full-day-profile.json --case full-day --output .\contoso-full-day-scenario.json
```

The checked-in [raw demand](../data/airports/contoso/demand/full-day-demand.json)
contains 320 source legs for 160 visits. Copy it before authoring a
customer-specific schedule. The standalone generator command above writes a
scenario package containing `raw_demand`, profile, allocation evidence and
timing trace; it does not overwrite that checked-in demand or prepare the UI.

| Traffic target | Visits | Oneworld | Star | SkyTeam |
|----------------|--------|----------|------|---------|
| Domestic       | 136    | 68       | 34   | 34      |
| Europe         | 12     | 6        | 3    | 3       |
| Asia           | 12     | 6        | 3    | 3       |
| Total          | 160    | 80       | 40   | 40      |

These are authored planning groups, not a verified current alliance directory.
Each eligible stand contributes one credit, split equally among the enabled
groups that can use it. Shared Star/SkyTeam stands are not counted twice:
domestic credits are 19/9.5/9.5 and international credits are 4/2/2 for
Oneworld/Star/SkyTeam. Integer visit counts use largest remainders with stable
ID tie-breaking, first by group and then by configured airline weights.
Changing stand eligibility recomputes shares; they are not hardcoded percentages.

The eight international resources include six contact stands and two remote
stands. Credits describe static resource shares, not independent usable
widebody positions, guaranteed simultaneous capacity or a count inferred from
flight volume. Aircraft compatibility, closures and neighboring restrictions
still apply in the solver.

US operators account for 154 visits (96.25%): American 61, Delta 38, United 38
and Alaska 17. British Airways, Air France, Lufthansa, Japan Airlines,
China Eastern and EVA each supply one international visit.

Europe choices are LHR, FRA and CDG. Asia choices are HND, ICN, PVG, HKG and TPE.
Weights favor illustrative major hubs, not measured rankings or a traffic
forecast. Regional quotas count visits; both legs use that visit's region,
but arrival and departure endpoints may differ. Foreign operators use their
catalog hub/home-country choices intersected with the configured markets.
US operators may use these explicit international market choices.

The fixed seed produces 149 assigned visits in both optimal plans:
298 assigned legs and 22 unassigned legs. Eight international and three domestic
visits remain unassigned, with no additional tow benefit found by the current
preparation/solver model. All 320 legs remain in lists; unassigned visits have
alerts and no invented chart occupancy. This measured congestion is an expected
review outcome, not a generation failure or an operational capacity finding.
The data has not been reseeded to hide it.

Select **Contoso scenarios > Full day** in the existing demo settings to view it.
The original fixture remains the default. Comfortable/constrained still verify
the same 36/41-visit outcomes, with readable labels and unchanged timing/PAX.
The full day has no fabricated overnight context; all source events are within
its half-open horizon. The original cases retain their explicit overnight tests.

## Profile configuration

The [profile schema](../data/schemas/scenario-profile.schema.json) and
[generator](../scripts/scenario-generator.mjs) define the contract.

| Field                      | Purpose                                                                 |
|----------------------------|-------------------------------------------------------------------------|
| `id`, `airport_id`, `seed`  | Suite identity, matching airport and repeatable random input             |
| `plan_window`              | Explicit UTC horizon, from 1 through 48 elapsed hours                    |
| `sampling_step_minutes`    | Arrival sampling grid relative to plan start, from 5 through 120 minutes |
| `external_airport_ids`     | Explicit synthetic route endpoints, distinct from the local airport     |
| `route_generation`        | Catalog-backed domestic endpoints and weighted international markets    |
| `traffic_targets`         | Optional sector/market totals allocated using eligible stand shares     |
| `traffic_mix`              | Exact visit counts by aircraft, airline and arrival/departure sectors    |
| `boundary_visits`          | Complete scheduled pairs spanning a configured plan boundary            |
| `cases`                    | Optional pressure banks and required measured outcome expectations      |

Each traffic row supplies PAX bounds and minimum/maximum dwell in minutes.
Rows provide either an exact `count`, or `target_id` and positive airline
`weight`. Target rows must match the target's arrival/departure sector.
An international target can specify `market_id` to enforce its regional quota.
Boundary visits and pressure banks remain explicit counts outside those targets.
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

Legacy `external_airport_ids` array order remains meaningful. Catalog-backed
market/airport arrays and traffic targets are canonicalized by ID. Catalog
routes require an explicit host `country` in the airport manifest; country and
sector decisions are not inferred from airline nationality or the airport's
time zone. The manifest's `iata_code` identifies the host endpoint to exclude
when its internal `id` differs from the airport catalog code. Transborder targets
support Canada-US routes in either direction, filtering to the partner country
and the configured market/carrier pool. Unsupported host/sector policies and
empty intersections fail explicitly. International routing retains its generic
foreign-market semantics; GTAA authors non-US international markets separately
from its US transborder market.

Readable numbers use catalog IATA prefixes plus deterministic values from
100 through 9999, with collision probing per operating airline across the
whole generated case, including surrounding context. Flight numbers are labels;
source IDs and registrations remain separate. Catalog route/number draws do
not consume the timing/PAX streams, and the original two cases retain the
legacy attribute draw for PAX stability.

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
* Catalog routing warnings, region trace and stand-share allocation when enabled
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
Selectable solver datasets use explicitly prepared compact snapshots;
command-line review files are not imported automatically. Analysis overlays
remain a separate integration.
Historical delay distributions and day-of actuals are not generated here.
