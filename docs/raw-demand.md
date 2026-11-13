---
title: Raw airport demand legs
description: Validate a portable leg-first feed and repeatable Contoso examples before visit linking and stand planning.
ms.date: 2026-10-21
---

## Boundary between demand and plans

The [raw demand schema](../data/schemas/raw-demand.schema.json) describes an
airport-specific snapshot of arrival, departure and ground-movement legs.
Airlines supply legs; the prototype derives connections, visits and provisional
tow requirements before creating an assignment plan. See
[visit linking](visit-linking.md) for the next pipeline stage.

The [fixed Contoso seed](../data/airports/contoso/demand/validation-legs.json)
contains 16 legs: 6 arrivals, 7 departures and 3 ground movements. It is
hand-authored, versioned and independent of the current date or random numbers.
It does not yet replace the Gantt fixture.

> [!IMPORTANT]
> Passing validation means the input contract and catalog references are valid.
> It does not mean flights are connected, movements are feasible or stands have
> been assigned. The seed deliberately contains an ambiguous connection case.
> Its registrations, flight numbers and schedules are fictional, not airline
> operating data or a representative traffic mix.

Keep demand snapshots separate from the static airport manifest. You can reuse
one airport configuration with multiple demand scenarios without editing its
infrastructure. The [traffic profile](airport-characteristics.md#local-time-hourly-weights)
is a future generation input, not the source of this fixed seed.

## Snapshot and leg identity

A snapshot requires `schema_version: "1.0.0"`, a string `id`, `airport_id`,
`synthetic`, and a `legs` array. `$schema` and `description` are optional.
An empty array is a valid snapshot with no demand.

Every leg requires:

* `id`: a unique string within the snapshot, stable across feed updates
* `type`: `arrival`, `departure` or `ground-movement`
* `aircraft_id`: an aircraft model ID from the airport's aircraft catalog
* `aircraft_registration`: the same aircraft identity across related legs
* `operating_airline_id`: an airline catalog ID, not an airline-group ID

All identifiers are nonempty, whitespace-free, case-sensitive strings. The
snapshot ID identifies the package, not an individual visit. Use descriptive
source-qualified leg IDs to avoid collisions across suppliers.

A registration must identify one aircraft model within a snapshot. Different
legs may have different operating airlines or sectors; neither is a substitute
for aircraft identity. Missing registration is rejected by this version rather
than guessed. A future feed adapter can surface incomplete records separately.

For ground movements, the operating airline identifies the aircraft's operator,
not the tow-service vendor.

## Flight legs

Both arrival and departure legs also require `flight_number`, `sector_id`,
`origin_airport_id`, `destination_airport_id` and `passenger_count`.
Flight numbers are strings so leading zeros and suffixes survive.

Arrival legs require `scheduled_on_block` and must end at the snapshot airport.
Departure legs require `scheduled_off_block` and must start there. These are
stand block events, not runway landing or takeoff times.

`sector_id` references an individual sector, not a sector group. External airport
IDs are preserved as strings; there is no external airport catalog validation
yet. Sector classification is supplied explicitly, not guessed from the route.

Use `passenger_count: null` for unknown, or a nonnegative safe integer for a known
count. Zero is a known count, not missing data. Counts may change in subsequent
feed snapshots. Catalog seat counts are not treated as certified capacity limits.

An arrival example:

```json
{
  "id": "contoso:example:arrival",
  "type": "arrival",
  "operating_airline_id": "airline:UAL",
  "flight_number": "09101",
  "sector_id": "domestic",
  "origin_airport_id": "airport:PDX",
  "destination_airport_id": "contoso",
  "aircraft_registration": "SYN-EX001",
  "aircraft_id": "A320",
  "passenger_count": null,
  "scheduled_on_block": "2026-10-21T15:00:00Z"
}
```

## Ground-movement legs

A ground movement requires `origin_stand_id`, `destination_stand_id`, and at least
one of `scheduled_off_block` or `scheduled_on_block`. Endpoints must reference
different known stands in this airport.

When both timestamps are present, on-block must be strictly later than off-block.
Preserve both supplied values. A single timestamp remains an unresolved anchor
at this stage; validation does not invent the opposite time.

```json
{
  "id": "contoso:example:movement",
  "type": "ground-movement",
  "operating_airline_id": "airline:UAL",
  "aircraft_registration": "SYN-EX002",
  "aircraft_id": "A320",
  "origin_stand_id": "t1:stand:101",
  "destination_stand_id": "t1:stand:R01",
  "scheduled_off_block": "2026-10-21T19:00:00Z"
}
```

The [normalization step](ground-movements.md) now derives the other timestamp
using Contoso's configured 12-minute tow duration. This creates a separate
normalized record, not a raw-feed edit. The seed's supplied 15-minute interval
is preserved and does not override the policy.

Ground movements do not carry flight number, route, sector or passenger fields.
An inferred tow requirement is a different derived object: its opposite stand
and time might not be known. Do not fabricate a raw ground leg for it.

## Time and source preservation

Use full UTC timestamps ending in `Z`, with seconds and optionally exactly three
fractional digits, for example `2026-10-21T15:00:00.123Z`.
Invalid calendar dates, local timestamps, numeric epochs, leap seconds and
sub-millisecond precision are rejected. Normalize upstream offsets to UTC before
loading a snapshot.

Airport-local presentation uses the manifest's time zone. The midnight seed case
arrives at 23:30 on October 21 and departs at 01:30 on October 22 in
`America/Los_Angeles`, although both timestamps have the same UTC date.

The validator preserves input order and values. It does not pair legs, infer
timestamps, clamp PAX, alter schedules or generate IDs. This raw contract rejects
visit IDs, flight stand assignments, actual times and unknown fields. Future
prelinked/assigned imports and day-of overlays need explicit contracts rather
than silently mixing them into the raw seed.

## Seed cases and expected downstream outcomes

Case names appear in each leg ID between `contoso:` and the leg suffix. All times
below are UTC unless identified as airport-local.

* `normal` has an A320 arrival at 15:00 and departure at 16:00 on the same
  registration. Expect one connection. Its handling windows overlap by 30 minutes:
  there is no positive tow gap, but no universal 90-minute minimum turn is imposed.
* `midnight` has a B738 pair on the same registration across local midnight.
  Expect one connection, not two unmatched legs split by a calendar-day filter.
* `unmatched` uses different registrations for its lone arrival and departure.
  Expect a tow-out requirement after arrival handling ends at 17:45, and a
  tow-in requirement with destination on-block no later than 17:15 for the 18:00
  departure. Other endpoints and times remain unresolved.
* `long-c` has an A320 arrival at 17:00 and departure at 22:00. Expect one
  connection with a candidate tow interval of 17:45 through 21:15. Its domestic
  arrival and transborder departure must retain separate sector eligibility.
* `long-e` has a B789 arrival at 16:00 and departure at 23:00. Expect one
  connection with a candidate tow interval of 17:00 through 22:00, using
  60-minute handling windows.
* `ambiguous` has one arrival and two later departures on the same registration.
  Expect an unresolved connection finding from the linker, not an
  arbitrary earliest-departure choice or two visits sharing the same arrival.
* `movement` supplies three independently registered aircraft: one fully timed
  15-minute movement, one off-block-only movement and one on-block-only movement.
  Raw validation preserves all supplied values. The linking stage completes
  the single-anchor movements with the configured 12-minute duration.

The [linker](visit-linking.md#run-the-contoso-example) now verifies these flight
connection, ambiguity and provisional tow outcomes for the documented plan range.
Ground-movement time inference and reconciliation now run during linking; see
[the movement guide](ground-movements.md).

Unmatched means unmatched within this example input, not proven absent from the
airline's wider feed. Before deriving real requirements, the linker must inspect
surrounding feed context rather than treating the display-day boundary as the
aircraft's arrival or departure boundary. This snapshot does not assert feed
completeness.

Positive tow intervals still need travel time, holding capacity, compatible
stands and available towing resources. See
[minimum handling windows](airport-characteristics.md#minimum-arrival-and-departure-handling-windows).

## Validation and tests

Run the [demand validator](../scripts/validate-demand.mjs):

```sh
npm run validate:demand
npm run test:demand
```

Pass a different demand file and optionally an airport manifest:

```powershell
npm run validate:demand -- .\my-demand.json .\data\airports\contoso\airport.json
```

The default seed and airport resolve relative to the scripts, independent of the
working directory. Explicit paths resolve from the caller's working directory.
Configured airport files and catalog references must validate first. Missing or
malformed input, unknown references and invalid movement intervals produce errors
and a nonzero CLI exit status.

The JSON Schema validates structure and UTC timestamp shape. The JavaScript
validator also checks real calendar dates, duplicate leg IDs, consistent
registration/model identity, local flight endpoints, catalog references and
movement ordering. It does not check stand eligibility or operating feasibility.

Run [visit linking](visit-linking.md) after raw validation. Occupancy-segment
derivation, seeded full-day generation, solver integration, Gantt replacement
and actual-time scenario overlays remain separate.
