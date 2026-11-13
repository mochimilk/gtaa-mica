---
title: Airport characteristics and operating policies
description: Configure local-time demand weights, airline planning groups and minimum arrival/departure handling windows.
ms.date: 2026-10-21
---

## Traffic, eligibility and timing

Airport characteristics describe the traffic you want to experiment with.
Eligibility rules describe where that traffic may be accommodated.

* [The traffic profile](../data/airports/contoso/demand/traffic-profile.json)
  describes when arrival and departure demand is more likely.
* [The airline catalog](../data/airlines.json) defines operating-airline IDs.
* [Airline planning groups](../data/airline-groups.json) partition airlines into
  non-overlapping sets.
* Stand `airline-groups` authorize one or more of those sets. See
  [the stand rule guide](stand-rules.md#airline-permissions).
* [The operating policy](../data/airports/contoso/operating-policy.json)
  specifies minimum arrival/departure handling windows by aircraft size.

Traffic weights do not close stands, impose movement limits, allocate airlines
to stands, or override aircraft/sector eligibility.

> [!IMPORTANT]
> Contoso's traffic weights are explicitly synthetic assumptions. They are not
> measurements or claims about any real airport. Airline group membership is
> user-authored planning input, not a verified record of commercial alliances.
> The profile does not yet generate flight legs or feed the Gantt/solver.

[Selective tow preparation](tow-preparation.md) now uses normalized hourly
shapes as a tie-break among capacity-relief proposals. A high weight alone
does not justify a tow.

## Local-time hourly weights

[airport.json](../data/airports/contoso/airport.json) references the profile through
`datasets.traffic_profile`. Its `time_zone` is the sole time-zone authority.
The profile must identify the same airport and use `time_basis: "airport-local"`.

Each sector pattern has two arrays of exactly 24 nonnegative numbers:

| Field                      | Interpretation                                      |
|----------------------------|-----------------------------------------------------|
| `sector`                   | Sector ID, not sector-group ID                      |
| `arrival-hourly-weights`    | Relative distribution of arrival demand over a day   |
| `departure-hourly-weights`  | Relative distribution of departure demand over a day |

Index 0 describes local 00:00 through 01:00, index 7 describes 07:00 through
08:00, and index 23 describes 23:00 through midnight. Hour boundaries are
half-open. Arrival and departure arrays may have different peaks.

Normalize each array independently by its own total. A weight of 4 makes that
hour four times as likely as an hour with weight 1 within the same sector and
direction. Multiplying an entire array by a constant does not change its shape.
Each array must have a finite positive total.

These arrays do not specify the relative daily volumes of domestic versus
international traffic or total arrival versus departure counts. Those totals,
airline mix, route mix, aircraft mix and occupancy durations belong in a future
demand-generation scenario. A zero weight means no planned sampling in that
clock-hour bin, not a hard closure or a rejection of an actual delayed flight.

### Example morning arrivals and evening departures

This illustrative single-sector profile is a complete valid profile. The
current Contoso profile includes all three catalog sectors with separate shapes.

<!-- example: traffic-profile -->
```json
{
  "schema_version": "1.0.0",
  "airport_id": "contoso",
  "synthetic": true,
  "description": "Illustrative domestic morning-arrival and evening-departure banks.",
  "time_basis": "airport-local",
  "sector-patterns": [
    {
      "sector": "domestic",
      "arrival-hourly-weights": [1, 1, 1, 1, 1, 1, 2, 4, 4, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      "departure-hourly-weights": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 4, 4, 2, 1, 1, 1, 1]
    }
  ]
}
```

The checked-in synthetic Contoso assumptions currently emphasize:

* Domestic morning departures and evening arrivals
* International afternoon arrivals and evening departures
* Transborder morning departures and morning/evening arrivals

Every pattern is editable. A pattern can reference a sector with no eligible
stand, deliberately exposing unmet demand in a future experiment. Configuration
validation checks references, not whether that demand can be assigned.

### Date and daylight-saving behavior

The reference lookup takes an explicit UTC epoch-millisecond instant and uses
the airport's local clock hour. It never uses the machine's time zone or current
wall clock.

On a fall-back date, both occurrences of a repeated hour receive the same
clock-hour weight. On a spring-forward date, no instant maps to the skipped hour.
The normalized 24-bin distribution is not a precomputed probability distribution
over the 23 or 25 actual hours of a dated day. A future dated demand generator
must explicitly choose how to redistribute counts and preserve its daily total
on daylight-saving transition dates.

No flight timestamps are created by this profile. Future generated demand must
use complete, unambiguous UTC timestamps.

## Minimum arrival and departure handling windows

The airport manifest references its operating policy through
`datasets.operating_policy`. This is airport-specific timing configuration, not
part of a stand's geometry or the statistical traffic profile.

Contoso requires these minimum elapsed handling times:

| Aircraft size code | Arrival on-block to earliest tow-out off-block | Latest tow-in on-block to departure off-block |
|--------------------|-----------------------------------------------|----------------------------------------------|
| A, B, C            | 45 minutes                                    | 45 minutes                                   |
| D, E, F            | 60 minutes                                    | 60 minutes                                   |

Size comes from the aircraft catalog's `ICAO-code` field, not membership in a
custom aircraft group named C, D, E or F. Custom groups can overlap and may
describe other eligibility concepts; they do not select handling durations.

<!-- example: operating-policy -->
```json
{
  "schema_version": "1.0.0",
  "airport_id": "contoso",
  "description": "Minimum elapsed stand-handling time; excludes tow travel.",
  "default-tow-minutes": 12,
  "minimum-leg-windows": [
    {
      "aircraft-size-codes": ["A", "B", "C"],
      "arrival-minutes": 45,
      "departure-minutes": 45
    },
    {
      "aircraft-size-codes": ["D", "E", "F"],
      "arrival-minutes": 60,
      "departure-minutes": 60
    }
  ]
}
```

Arrival and departure minutes are separate configurable positive whole numbers,
even when their current values are equal. Each size code can occur in only one
rule. When a policy is configured, every catalog aircraft must have a size code
covered by the policy. Unknown sizes never fall back to 45 or 60 minutes.

### Arrival and departure boundaries

An arrival at 10:00 on-block produces:

* Class C: handling window `[10:00, 10:45)`; tow-out off-block no earlier than 10:45
* Class E: handling window `[10:00, 11:00)`; tow-out off-block no earlier than 11:00

A departure at 13:00 off-block produces:

* Class C: handling window `[12:15, 13:00)`; tow-in on-block no later than 12:15
* Class E: handling window `[12:00, 13:00)`; tow-in on-block no later than 12:00

Equality at the cutoff is permitted. Tow-in must be completed by the beginning
of the departure handling window, not merely started then. Tow travel duration
is separate from these handling minutes. If a ground movement is anchored at
destination on-block, its origin off-block must be calculated from the movement
duration separately.

Handling minutes are elapsed UTC time. Midnight and daylight-saving transitions
do not lengthen or shorten them. Use airport-local time for display, not
arithmetic on local clock labels.

### Future tow-window overlay

For a connected visit, the potential gap is between the end of its arrival
handling window and the beginning of its departure handling window:

```text
arrival on-block
    | minimum arrival handling |
                               earliest tow-out off-block
                               | potential tow space |
                                                     latest tow-in on-block
                                                     | minimum departure handling |
                                                                                   departure off-block
```

For class C arriving at 10:00 and departing at 13:00, that space runs from
10:45 through 12:15. This is a candidate interval, not proof of a feasible tow.
Tow-out travel, holding occupancy, tow-in travel, compatible stands and other
resources must fit the eventual plan.

If the handling windows touch or overlap, there is no positive gap to offer as
a tow candidate. Do not turn 45 plus 45 into a universal 90-minute minimum turn
rule, or 60 plus 60 into a 120-minute rule. An overlapping pair of handling
windows does not by itself reject a same-stand turn; connection/minimum-turn
feasibility is a separate policy.

The overlay and solver enforcement remain deferred.
[Visit linking](visit-linking.md) and
[ground-movement reconciliation](ground-movements.md) now use these handling
windows without rescheduling source legs.

## Default tow duration

Contoso configures `default-tow-minutes: 12` in its operating policy. It completes
missing ground-movement endpoints and supplies travel duration for new
[tow timing proposals](tow-preparation.md#generate-one-capacity-oriented-timing-pattern).
A fully supplied interval is preserved.
The optional field must be a positive whole number with safe millisecond
precision. Single-anchor normalization fails explicitly if no duration is
configured. This synthetic travel duration is separate from handling minutes,
stand eligibility and towing-resource availability.

## Airline catalog and non-overlapping groups

Preserve the authored IDs from the airline catalog. Codes are metadata, not
reference aliases: the Qantas entry uses ID `airline:QF` even though its ICAO code
is `QFA`. Group members must reference `airline:QF`, not infer an ID from that code.

The catalog shape is `airlines: [...]`. The group catalog retains the authored
`groups: [...]` shape, with each group containing `id`, `name`, and `airlines`.
The validator rejects:

* Unknown airline or group references
* Duplicate airline/group IDs
* Repeated members within an airline group
* An airline appearing in two different groups
* Unknown stand permission fields and null permission lists

An airline may be ungrouped while you are authoring the catalog, but it will
not match any stand's allowed groups. Add a separate disjoint planning group
for independent carriers if those airlines need access.

Multiple stands can authorize the same group. Multiple groups can be listed on
one stand. Neither case violates the membership partition: the non-overlap rule
applies to airline membership, not to stand access lists.

You do not need deny lists, group complements or a separate all-airlines group.
For a stand accepting all grouped airlines, list every existing group ID in its
`airline-groups` array. A separate all-airlines group would violate non-overlap.

## Validate and inspect the model

```sh
npm run validate:airport
npm run test:airport
```

The CLI reports group counts, stands with no authorized airlines, configured
traffic-profile sectors/time zone, minimum leg windows and default tow duration. Structural success
is not a statement that stands are open or that the airport can accommodate
demand.

For code using the local reference model:

```js
import {
  compileAirport,
  getHourlyDistribution,
  getMinimumLegWindow,
  loadAirport,
  trafficWeightAt,
} from './scripts/airport-model.mjs';

const model = compileAirport(loadAirport());
const arrivals = getHourlyDistribution(model, 'domestic', 'arrival');
const weight = trafficWeightAt(
  model,
  'domestic',
  'arrival',
  Date.parse('2026-10-21T14:00:00Z'),
);
const departureWindow = getMinimumLegWindow(
  model,
  'A320',
  'departure',
  Date.parse('2026-10-21T13:00:00Z'),
);
```

`arrivals` is a new normalized 24-element array. `weight` is the normalized
clock-hour entry for 07:00 local in Contoso on that date, not a flight count.
Unconfigured sectors, invalid directions and invalid instants throw explicit
errors; there is no silent uniform-distribution fallback.

`departureWindow` contains UTC epoch-millisecond `start` and `end`, plus
`minimumMinutes` and `aircraftSizeCode`. For this class C example it covers
12:15 through 13:00 UTC. The helper rejects missing operating policy, unknown
aircraft, invalid directions/timestamps and derived dates outside the supported
range. It never supplies a hardcoded timing default.

The schemas are available for
[airlines](../data/schemas/airlines.schema.json),
[airline groups](../data/schemas/airline-groups.schema.json),
[traffic profiles](../data/schemas/traffic-profile.schema.json), and
[operating policies](../data/schemas/operating-policy.schema.json).
