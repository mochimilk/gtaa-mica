---
title: Stand-occupancy segment derivation
description: Derive fixed, flexible and open parking intervals from raw legs without inventing tow times, assignments or initial and final state.
ms.date: 2026-10-21
---

## Position in the planning flow

The [occupancy model](../scripts/occupancy-model.mjs) takes raw demand and airport
configuration, calls [visit linking](visit-linking.md), and partitions the
reconciled activity into stand-occupancy segments:

```text
Raw legs -> linked visits -> normalized/reconciled movements -> occupancy segments
```

An occupancy segment describes time parked at one stand, not time in transit.
Its optional `stand_id` is a constraint from a supplied movement endpoint,
not a solver-created assignment. No stand is selected for an unassigned visit.

The [package schema](../data/schemas/occupancy.schema.json) is version `1.0.0`.
The embedded `linked_demand` retains linked schema `2.0.0`, including original
legs, movement timing provenance, visit IDs and provisional tow requirements.
The raw seed and airport configuration are not changed.

## Distinguish three timing states

| Timing status | Meaning | Next decision |
|---------------|---------|---------------|
| `fixed` | Both boundaries have actual scheduled event times | Validate stand eligibility and assignment |
| `flexible` | A single-leg service interval has an unscheduled tow boundary | Select or supply a tow time |
| `open` | A parking interval has an unknown outer boundary | Resolve initial or final aircraft state |

Every segment has at least one fixed event. Boundaries are explicit objects,
not null values or special timestamp strings.

### Fixed boundary

```json
{
  "kind": "fixed",
  "event": "movement-off-block",
  "source_leg_id": "contoso:movement:both-times",
  "time": "2026-10-21T19:00:00Z"
}
```

Start events are `arrival-on-block` or `movement-on-block`. End events are
`departure-off-block` or `movement-off-block`. A fixed boundary can come from
an inferred ground-movement endpoint; consult `linked_demand.ground_movements`
for `timing_source` before treating it as a supplied observation.

### Flexible boundary

An unmatched class-C arrival at 17:00 has an earliest tow-out at 17:45:

```json
{
  "kind": "flexible",
  "event": "pending-tow-out",
  "source_leg_id": "contoso:unmatched:arrival",
  "tow_requirement_id": "tow-out:contoso%3Aunmatched%3Aarrival",
  "earliest": "2026-10-21T17:45:00.000Z"
}
```

The boundary has no `time`. The aircraft is not assumed to leave at 17:45;
that is only the earliest allowable off-block time. An unmatched departure uses
`pending-tow-in` and `latest` for the latest allowable tow-in on-block time.
The requirement ID links to the existing provisional requirement, not another
generated ground leg.

Handling bounds come from the airport's policy: 45 minutes for A/B/C and
60 minutes for D/E/F in Contoso. Arrival and departure handling windows remain
independent; their sum is not a mandatory minimum turn duration.

### Unknown boundary

```json
{
  "kind": "unknown"
}
```

Unknown boundaries have no assumed time, bound or source event. They are not
extended to plan start/end. An explicit movement tells us when an aircraft left
its origin stand and reached its destination; it does not establish when the
aircraft first occupied the origin or finally left the destination.

## Partition visits and movement chains

Without movements, a connected arrival/departure pair becomes one fixed
interval. Long stays are not automatically split or nominated for towing.

Consider an arrival at 01:00, departure at 06:00 and these explicit movements:

* Stand 101 to R01, off-block 02:00 and inferred on-block 02:12
* R01 to 103, off-block 04:00 and inferred on-block 04:12

The derived occupancy is:

| Segment | Interval | Stand constraint | Flight scope |
|---------|----------|------------------|--------------|
| Arrival service | 01:00 to 02:00 | 101 | Arrival leg only |
| Intermediate parking | 02:12 to 04:00 | R01 | No flight leg |
| Departure service | 04:12 to 06:00 | 103 | Departure leg only |

Neither 12-minute travel interval occupies a stand. Touching movement endpoints
produce no zero-duration parking bar.

Only a segment actually bordering a flight carries `arrival_leg_id` or
`departure_leg_id`. Do not copy both flight sectors onto every parking segment.
Per-leg operating airlines, sectors and PAX remain in the source snapshot.
Intermediate parking can still carry an operating airline through its movement
source; parking-airline eligibility belongs to the future assignment adapter.

A single-leg visit with matched explicit movements keeps its known service
intervals and the unknown parking edge on the other side. The matched movement
already covers the provisional tow requirement, so no duplicate tow is created.

A standalone ground chain produces:

* Unknown start through the first off-block event at the origin stand
* Fixed on-block through next off-block intervals at intermediate stands
* Last on-block through unknown end at the destination stand

Chains are not joined across intervening flight events, associated movements
or movements requiring review. Missing or conflicting activity must not become
an invented continuous parking interval.

## Preserve incomplete and conflicting state

The package contains:

* `segments`, each with stable ID, aircraft, source legs, boundaries and timing status
* Optional `visit_id` and endpoint-derived `stand_id` constraints
* `unresolved_segment_ids` for all flexible or open segments
* `blocked_source_leg_ids` for ambiguous or conflicting sources
* `findings`, retaining linking/movement findings and adding occupancy diagnostics
* `timing_complete`, true only without unresolved boundaries or blocking errors

Root findings add `segment_ids`; inherited source-level findings use an empty
array because they can prevent segments from being constructed at all.

Ambiguous flight legs do not become ordinary occupancies. A conflicting
movement chain blocks its visit rather than being ignored in favor of an
optimistic full-stay interval. A review movement overlapping an otherwise
connected visit also blocks partitioning even when no movement association
could be chosen. Blocked provisional tows do not become flexible segments.
Independent valid visits remain available alongside these findings.

`timing_complete` is not a feasibility certificate. Stand physical compatibility,
airline authorization, sector rules, adjacent-stand closures, competing
occupancies, routes and towing resources still require assignment validation.
An empty snapshot is timing complete only because it has no retained demand.

Intervals are half-open. Retained visit and context-chain times remain unclipped,
including times outside the plan. Display clipping is a separate concern and
must not replace unknown boundaries with display edges.

IDs encode the boundary source IDs and event roles, not timestamps, array
positions or random values. Arrays are deterministic and segments are ordered
by ID, not chronology. Reordering input or adjusting times without changing
the event relationships preserves segment IDs.

## Run the Contoso example

```powershell
npm run derive:occupancy -- --plan-start 2026-10-21T14:00:00Z --plan-end 2026-10-22T14:00:00Z --output .\contoso-occupancy.json
npm run test:occupancy
```

The unchanged [16-leg seed](../data/airports/contoso/demand/validation-legs.json)
produces 12 segments:

* Four fixed connected-visit intervals
* Two flexible single-leg service intervals
* Six open parking intervals around three independent ground movements

Eight segment timings remain unresolved. The three deliberately ambiguous flight
legs remain blocked. No initial/final parking extent, stand assignment or
flexible tow time is invented.

The [CLI](../scripts/derive-occupancy.mjs) accepts `--demand`, `--airport`,
`--plan-start`, `--plan-end` and `--output`, like the linking CLI. Default paths
are script-relative; explicit paths are relative to your working directory.
Without `--output`, JSON goes to standard output; diagnostics go to standard
error. Use `node .\scripts\derive-occupancy.mjs` with the same arguments when you
need standard output without npm's command banner.

| Exit code | Meaning |
|-----------|---------|
| `0` | Timing complete, with no error findings |
| `1` | Invalid input, range, arguments or output I/O |
| `2` | Review package generated with blocking error findings |
| `3` | Package generated without errors, but flexible/open boundaries remain |

Blocking errors take precedence over unresolved-boundary status. The Contoso
example exits `2` while writing its review package. Output uses exclusive
creation and never overwrites an existing file.

## Next boundary

Resolve or explicitly model flexible tows and initial/final state before
adapting occupancy to a fixed-window solver.
[Selective tow preparation](tow-preparation.md) now inspects candidate stand
pools, measures relaxed pressure and proposes optional connected-visit tow
timings. Single-leg extents and unknown parking state remain unresolved.
Complete assignment validation and an explicit Gantt data-source switch are
still required. Delay overlays, historical-delay patterns, broader tow-window
optimization and towing-resource scheduling remain separate work.
