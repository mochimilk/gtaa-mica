---
title: Visit linking and provisional tow requirements
description: Derive aircraft visits from raw legs using the plan duration as the connection-search radius.
ms.date: 2026-10-21
---

## From raw legs to a reviewable package

The [visit linker](../scripts/visit-linker.mjs) consumes a validated
[raw demand snapshot](raw-demand.md), airport configuration and an explicit plan
start/end. It returns a portable JSON package of connected visits, single-leg
visits, provisional tow requirements, original source legs and review findings.

It normalizes and reconciles supplied ground movements, but does not assign
stands, split occupancy around tows or run the solver. A connected visit is an
aircraft connection, not proof of stand capacity or operational feasibility.

## Search radius follows the plan range

The search radius is exactly `plan end - plan start`, measured in elapsed UTC
milliseconds. It is not the extent of the supplied feed or a fixed daily setting.

* A 24-hour plan searches up to 24 hours before or after each leg.
* An 8-hour plan searches up to 8 hours before or after each leg.
* An arrival must precede its departure. A gap equal to the radius is allowed;
  a gap even one millisecond greater is not.

The caller should supply surrounding feed context covering
`[plan start - radius, plan end + radius)`. The local prototype searches the
records actually supplied; it does not fetch missing airline data or claim that
this context is complete.

The plan window is half-open: events at its start belong to it; events at its end
do not. An outside-window partner can still complete a visible leg's visit.
Connected visits are retained when their interval overlaps the plan or their
departure event is exactly at plan start. Context-only unmatched legs do not
create visible visits or speculative tows unless a supplied ground movement
overlapping the plan makes that visit relevant.

The [airport time zone](../data/airports/contoso/airport.json) is for presentation.
Midnight and daylight-saving changes do not reset the search. A local calendar
day containing a clock change can have a different elapsed duration; the actual
supplied start/end determine its radius.

## Connection and ambiguity rules

The linker groups flight events by exact, case-sensitive aircraft registration.
The demand validator already requires a consistent aircraft model for that
registration. Operating airline, sector and flight number do not replace aircraft
identity or have to be equal across the connection.

Events are ordered by block timestamp. Arrival and departure runs define
candidate connections; a connection cannot skip an intervening flight cycle.
Only mutually unique arrival/departure candidates within the search radius are
linked. Multiple ordinary arrival/departure cycles can therefore create multiple
visits for one aircraft.

Competing arrivals/departures, repeated unmatched events within the radius and
simultaneous flight events produce explicit error findings. Their affected legs
remain in `unresolved_connection_leg_ids`, without guessed visits or inferred
tows. An independent later unambiguous visit is still retained.

The implementation uses sorted events and binary-search candidate ranges instead
of constructing every arrival/departure combination in a dense ambiguous run.
Input order does not choose a winner.

## Handling windows and provisional tows

Each visit refers back to its original arrival and/or departure leg. It includes
the relevant
[minimum handling window](airport-characteristics.md#minimum-arrival-and-departure-handling-windows):

* Arrival-only visits produce a provisional tow-out requirement whose
  `earliest_off_block` is arrival on-block plus the arrival handling minimum.
* Departure-only visits produce a provisional tow-in requirement whose
  `latest_on_block` is departure off-block minus the departure handling minimum.

Requirements carry source-leg and visit references, but no invented stand,
opposite timestamp, travel duration or scheduled ground leg. Their status is
always `provisional`: a partner might be absent from the supplied feed or outside
the current search radius.

Connected long-stay visits do not automatically create tows. Their handling
windows can later support a tow-window overlay and optimization. Overlapping
handling windows do not impose a summed 90/120-minute minimum turn rule.

## Existing ground movements

Original ground legs remain unchanged in `source_legs`. Relevant movements are
listed in `ground_movement_leg_ids`; movements crossing the context boundary are
retained even when neither endpoint lies inside it.

Contoso uses its configured 12-minute fallback to complete a single-anchor
movement. Both supplied timestamps are preserved. Derived values and inference
provenance are separate from the original source.

Uniquely associated movements are checked against handling windows, flight
chronology and stand-chain continuity. Valid explicit movements can cover
single-leg tow requirements through `movement_matches`, without creating a
duplicate request. Conflicts retain their original values and block automatic
planning. See [ground-movement reconciliation](ground-movements.md) for the
full rules and package-version change.

## Output contract and identity

The [linked demand schema](../data/schemas/linked-demand.schema.json) defines the
package shape. Register the
[raw schema](../data/schemas/raw-demand.schema.json) under its `$id` alongside it
when validating externally; the linked schema reuses its leg and timestamp
definitions.

The package contains:

* `airport_id`, `demand_id` and `synthetic` for provenance
* `plan_window`, `connection_search_radius_ms` and `context_window`
* `source_legs`, including unchanged values for records outside the search context
* `context_leg_ids` identifying records considered by this run
* `visits` with source-leg references and configured handling windows
* `tow_requirements` with provisional timing bounds
* `ground_movements` with normalized times, provenance and association status
* `movement_matches` identifying explicit movements covering tow requirements
* `ground_movement_leg_ids` and `unresolved_connection_leg_ids`
* `findings` with severity, source-leg IDs and explanatory messages

Derived IDs encode source IDs with delimiter escaping. They do not depend on
input order, current time, random values, PAX or airline/sector labels.
Changing a connection can change its derived visit ID; these are not externally
maintained airline visit IDs.

Output arrays have deterministic ordering. Input objects are not mutated, and
source objects are copied so modifying a result cannot modify the input.
Original per-leg operating airlines and sectors remain available to the future
stand-eligibility adapter.

## Run the Contoso example

From the repository root:

```powershell
npm run link:demand -- --plan-start 2026-10-21T14:00:00Z --plan-end 2026-10-22T14:00:00Z --output .\contoso-linked-demand.json
```

The [fixed seed](../data/airports/contoso/demand/validation-legs.json) produces:

* Four connected visits: normal, midnight, long-C and long-E
* Two single-leg visits with provisional tow requirements
* Three unresolved flight legs in the intentionally ambiguous case
* Three normalized ground movements, including two inferred 12-minute intervals
* One error finding and two warning findings

The unmatched arrival's earliest tow-out off-block is 17:45 UTC. The unmatched
departure's latest tow-in on-block is 17:15 UTC for its 18:00 departure.

Optional `--demand` and `--airport` paths select another snapshot and manifest.
Defaults resolve relative to the scripts; explicit paths use the working
directory. Omitting `--output` writes the JSON to standard output. Summary and
findings go to standard error.

The CLI uses these exit codes:

* `0`: linking completed without error findings; provisional warnings can remain
* `1`: invalid input, invalid range, unsupported arguments or an output I/O failure
* `2`: a package was generated, but error findings require review

The example deliberately exits with `2`, while still writing its reviewable
package. Existing output files are never overwritten; select a new filename for
another run. To capture JSON from standard output without npm's command banner,
invoke `node .\scripts\link-demand.mjs` directly with the same arguments.

## Tests and next boundary

```powershell
npm run test:linking
```

Tests verify exact 8/24-hour thresholds in both directions, outside-plan context,
midnight, clock changes, ambiguity, multiple visits per aircraft, source
preservation, stable IDs, output schema, provisional bounds and CLI error paths.

The next stage, [stand-occupancy derivation](occupancy-segments.md), partitions
visits and reconciled movements while preserving flexible tows and unknown
parking boundaries. The solver adapter and assignment package follow.
Stand-rule compilation, full-day seeded generation, Gantt replacement and
day-of overlays remain separate.
