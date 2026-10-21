---
title: Stand configuration and occupancy-dependent rules
description: Author airport stand permissions, closures and restrictions with worked Contoso examples and executable validation.
ms.date: 2026-10-20
---

## Start here

Configure physical stands in
[stands.json](../data/airports/contoso/infrastructure/stands.json).
Use [the stand schema](../data/schemas/stands.schema.json) for field validation
and the commands below for cross-file checks and behavioral regression tests:

```sh
npm run validate:airport
npm run test:airport
```

To check another airport against the repository's shared aircraft and sector
catalogs, pass its manifest:

```powershell
npm run validate:airport -- data\airports\another-airport\airport.json
```

> [!IMPORTANT]
> These commands validate authoring and exercise a reference rule evaluator.
> The application and imported .NET solver do not yet consume these rules.
> Passing validation is not a clearance calculation, capacity guarantee, solver
> acceptance, or operational certification.

## Separate the concepts

* A stand is the physical aircraft parking resource.
* A gate is a passenger-processing location inside or beside a terminal.
* `contact: true` identifies a contact stand; `false` identifies a non-contact
  stand. A remote stand can still have passenger gate references for bus service.
* Aircraft groups are authored sets of aircraft model IDs, not automatically
  interpreted ICAO classes.
* Sector groups are authored sets of sector IDs. Arrival and departure
  permissions are independent.
* A closure makes the affected stand unavailable.
* A restriction narrows permissions while a matching neighbor is occupied.

Rules constrain aircraft occupancy. Shared gate references do not automatically
create passenger gate-capacity constraints or infer boarding/arrival processing
windows. Those remain separate future planning concerns.

## File and identity conventions

The stand document uses `schema_version: "1.0.0"`, an `airport_id`, and a `stands`
array. Its `$schema` reference enables compatible editors to offer validation.

All IDs are case-sensitive strings without whitespace. Use descriptive,
namespaced stand and gate IDs such as `t1:stand:101` and `t1:gate:A1`.
References must resolve in the relevant dataset; the same text can be an ID
in different catalogs without making those entities interchangeable.

Use these shared catalogs:

* [Aircraft models](../data/aircraft.json)
* [Aircraft groups](../data/aircraft-groups.json)
* [Sectors](../data/sectors.json)
* [Sector groups](../data/sector-groups.json)

An aircraft matches a list of aircraft groups when it belongs to at least one
listed group. A sector matches a sector group when it is a member of that group.
Groups may overlap intentionally. Duplicate members produce a warning and are
deduplicated in memory; unknown members are errors.

Do not infer group membership from an aircraft's `ICAO-code`, its name, or the
name of a group. Edit the group's members explicitly.

## Stand fields and readiness

| Field                    | Meaning                                                        |
|--------------------------|----------------------------------------------------------------|
| `id`, `name`, `code`      | Stable identity and display labels                             |
| `coordinates`            | Stand reference point as `[longitude, latitude]`, not clearance |
| `associated_building_id` | Optional nearby building; not containment inside a floor        |
| `pier`                   | Optional display grouping                                      |
| `contact`                | Contact versus remote aircraft position                        |
| `gate_ids`               | Authoritative passenger gate associations; can be empty         |
| `aircraft-groups`        | Base allowed aircraft groups                                   |
| `arrival-sector-group`   | Base arrival permission                                        |
| `departure-sector-group` | Base departure permission                                      |
| `closed`                 | Unconditional closure                                          |
| `close-conditions`       | Neighbor occupancy conditions that close this stand            |
| `restriction-conditions` | Neighbor occupancy conditions with an `allow` result            |
| `configuration_status`   | `geometry-only` or `ready`                                      |
| `source`                 | Optional provenance, not executable policy                     |
| `description`            | Optional stand explanation, not executable policy              |

Both statuses require identity, coordinates and `contact`. A `ready` stand must
also supply all seven operational fields from `gate_ids` through
`restriction-conditions`. Use empty arrays deliberately rather than leaving
ready configuration incomplete.

A `geometry-only` record may contain partially authored permissions, but the
reference evaluator refuses to allocate occupancy to it. `ready` means the
configuration is complete enough to evaluate, not that it has been certified.
The airport's separate `planning_ready` flag is not set automatically.

An empty base aircraft list permits no aircraft. Base sector permissions are
explicit group IDs, not null or wildcard defaults.

### Example stand

This is the configuration shape for 101, without its optional diagram provenance.
It serves domestic legs, permits group C, and closes when a D/E aircraft occupies
102.

<!-- example: stand -->
```json
{
  "id": "t1:stand:101",
  "name": "Stand 101",
  "code": "101",
  "coordinates": [-122.14360092, 47.64948015],
  "associated_building_id": "t1",
  "pier": "A",
  "contact": true,
  "gate_ids": ["t1:gate:A1"],
  "arrival-sector-group": "domestic-general",
  "departure-sector-group": "domestic-general",
  "aircraft-groups": ["C"],
  "closed": false,
  "close-conditions": [
    {
      "stand": "t1:stand:102",
      "category": "fit",
      "description": "Closed while a group D or E aircraft occupies 102.",
      "aircraft-groups": ["D", "E"]
    }
  ],
  "restriction-conditions": [],
  "configuration_status": "ready"
}
```

## Base sector permissions and flight legs

Evaluate only legs present on the aircraft visit:

* A turn with arrival and departure must satisfy both base permissions.
* An arrival-only visit checks arrival permission, not departure permission.
* A departure-only visit checks departure permission, not arrival permission.
* Parking without a flight leg still checks aircraft compatibility and closures.

For example, a stand can accept an international arrival and a domestic departure.
This hypothetical configuration illustrates that combination; it does not change
Contoso's actual stand 302 policy.

<!-- example: stand -->
```json
{
  "id": "t1:stand:302",
  "name": "Mixed-sector example",
  "code": "302",
  "coordinates": [-122.14, 47.64],
  "contact": true,
  "gate_ids": ["t1:gate:C2"],
  "aircraft-groups": ["E", "F"],
  "arrival-sector-group": "international-general",
  "departure-sector-group": "domestic-general",
  "closed": false,
  "close-conditions": [],
  "restriction-conditions": [],
  "configuration_status": "ready"
}
```

An international-to-domestic turn would satisfy these sector permissions.
Domestic-to-international would not. An international arrival-only visit does
not need a departure just to make the stand compatible.

An absent leg and a present leg with an unknown sector are different inputs.
The reference evaluator rejects a present leg with missing/unknown sector data;
it does not turn it into a wildcard. Occupancy timing must also be supplied
explicitly for single-leg and parking requests.

## Closure conditions

Author a condition on the affected stand. Its `stand` property identifies the
triggering stand, not the affected stand.

Each condition requires `stand`, `category` and `description`. Categories are
descriptive strings, for example `fit`, `sector`, `security` or `maintenance`,
not a fixed enumeration. Descriptions explain intent but are never parsed to
decide behavior. No human-maintained rule ID is required.

| Trigger field            | Matching behavior                                              |
|--------------------------|----------------------------------------------------------------|
| `stand`                  | An overlapping occupancy must exist on this neighboring stand   |
| `aircraft-groups`         | Trigger aircraft belongs to at least one listed group          |
| `arrival-sector-group`   | Trigger has an arrival whose sector belongs to this group       |
| `departure-sector-group` | Trigger has a departure whose sector belongs to this group      |

For optional trigger filters:

* Omitted or `null` means no filter on that dimension.
* An empty aircraft-group filter list is invalid. Omit it for any aircraft.
* All supplied filters combine with AND and must match the same occupancy.
* Separate closure conditions combine with OR.
* A supplied arrival/departure filter cannot match an occupancy missing that leg.
* A trigger leg is evaluated independently of the affected visit's leg type.

### Close for any occupancy

Place this condition in H01's `close-conditions`. It closes H01 whenever 101 is
occupied, regardless of aircraft model or flight sector.

<!-- example: closure t1:stand:H01 -->
```json
{
  "stand": "t1:stand:101",
  "category": "fit",
  "description": "H01 is unavailable while 101 is occupied."
}
```

There is no need to repeat 101's current aircraft permissions in the trigger.
The rule remains accurate if those permissions change.

### Close for an international arrival or departure

This hypothetical pair on 221 means either qualifying leg closes the stand.
Contoso does not currently author these sector-triggered conditions.

<!-- example: closure t1:stand:221 -->
```json
[
  {
    "stand": "t1:stand:223",
    "category": "sector",
    "description": "Closed for an international arrival on 223.",
    "arrival-sector-group": "international-general"
  },
  {
    "stand": "t1:stand:223",
    "category": "sector",
    "description": "Closed for an international departure on 223.",
    "departure-sector-group": "international-general"
  }
]
```

Putting both leg filters into one condition would mean an international arrival
AND an international departure on the same triggering occupancy, not either leg.

### Combine aircraft and both leg filters

This hypothetical condition on 222 requires all three filters:

<!-- example: closure t1:stand:222 -->
```json
{
  "stand": "t1:stand:224",
  "category": "sector",
  "description": "Closed for a D/E aircraft arriving internationally and departing domestically on 224.",
  "aircraft-groups": ["D", "E"],
  "arrival-sector-group": "international-general",
  "departure-sector-group": "domestic-general"
}
```

A D/E domestic arrival does not match. A small aircraft with an international
arrival does not match. Two different occupancies cannot supply different parts
of this condition, even if both overlap the affected visit.

## Restriction conditions and allow

Restrictions use the same top-level trigger fields as closures. Their required
`allow` object describes permissions on the affected stand, not the trigger.

| Allow field               | Result on the affected stand                                  |
|---------------------------|---------------------------------------------------------------|
| `aircraft-groups`          | Allow aircraft in the union of these groups                    |
| `arrival-sector-groups`    | Allow arrivals in the union of these groups                    |
| `departure-sector-groups`  | Allow departures in the union of these groups                  |

Unlike the singular trigger sector-group fields, allow sector-group fields are
plural arrays. This supports multiple groups and an explicit empty allowed set.

* An omitted allow dimension leaves that base permission unchanged.
* An empty allowed list permits nothing in that dimension.
* Null allow dimensions are invalid; omit the dimension instead.
* An empty `allow` object is invalid because it cannot restrict anything.
* Each active restriction intersects with base permissions and other active
  restrictions. No restriction can expand permissions.
* Compare actual aircraft/sector membership, not equality of group names.
* Arrival/departure allow dimensions affect only legs present on the target.
* An active closure wins over restrictions. There is no last-wins ordering.

### Narrow aircraft compatibility

This hypothetical rule on 222 permits only group C while an E aircraft occupies
224. The trigger aircraft groups and allowed aircraft groups have different
roles and are deliberately separated.

<!-- example: restriction t1:stand:222 -->
```json
{
  "stand": "t1:stand:224",
  "category": "fit",
  "description": "Only group C may use this stand while an E aircraft occupies 224.",
  "aircraft-groups": ["E"],
  "allow": {
    "aircraft-groups": ["C"]
  }
}
```

If the affected stand's base permission were only E, this rule would not make C
legal. It would leave no compatible aircraft unless the group memberships
themselves overlap.

### Restrict an arrival without restricting departure

This hypothetical condition on 222 limits arrivals to domestic while an
international arrival occupies 224. Base departure permission remains unchanged.

<!-- example: restriction t1:stand:222 -->
```json
{
  "stand": "t1:stand:224",
  "category": "sector",
  "description": "Domestic arrivals only while 224 has an international arrival.",
  "arrival-sector-group": "international-general",
  "allow": {
    "arrival-sector-groups": ["domestic-general"]
  }
}
```

A departure-only visit on 222 is unaffected by this allow dimension, but the
trigger still requires an arrival on 224.

### Disable a dimension explicitly

Here no departure is allowed on 222 while 224 is occupied. An otherwise
compatible arrival-only or parking visit can still use 222.

<!-- example: restriction t1:stand:222 -->
```json
{
  "stand": "t1:stand:224",
  "category": "sector",
  "description": "No departures while 224 is occupied.",
  "allow": {
    "departure-sector-groups": []
  }
}
```

Use `closed` or a closure condition to prohibit all occupancy. Do not use an
empty departure list when you mean the stand is completely closed.

## Occupancy windows and evaluation

Use full timestamps for actual demand. The reference evaluator takes numeric
UTC epoch milliseconds with `start < end`. It rejects invalid windows instead of
assuming midnight rollover.

Occupancy windows are half-open: `[start, end)`. A visit ending at 10:00 does not
overlap one starting at 10:00. Any positive overlap activates a matching
condition for that overlap. No buffer is added.

The current fixed-window reference evaluation rejects an assignment that breaks
a condition during any part of its window. It does not shorten visits, split
them, insert a tow, or search for alternate times.

Sector filters inspect the triggering occupancy's leg data for its occupancy
window. They do not restrict the trigger to only the instant of landing,
boarding or departure.

Two aircraft cannot occupy the same stand during overlapping windows,
independently of authored neighbor rules.

### Do not propagate closed states

Conditions depend on occupancy, not another stand's computed open/closed state.
There is no recursive closure cascade:

1. A D/E aircraft occupies 102.
2. 101 and 103 cannot receive overlapping aircraft assignments.
3. Because 101 and 103 are unoccupied, their occupancy-only conditions do not
   close H01 and H03.
4. H01 and H03 can receive compatible aircraft, with passengers bussed through
   A1 and A3.

A plan that also assigns an aircraft to 101 remains invalid. Do not discard that
aircraft from validation because 101 should have been closed.

## Current Contoso use cases

These are intentional authoring choices, not rules inferred from geometry:

| Trigger or configuration | Effect                                                         |
|--------------------------|----------------------------------------------------------------|
| D/E occupies 102          | Close 101 and 103; H01/A1 and H03/A3 remain usable if unoccupied |
| D/E occupies 112          | Close 111 and 113; H04/A11 remains usable if 111 is unoccupied   |
| D/E occupies 105          | Close 106                                                      |
| D/E occupies 109          | Close 108                                                      |
| D/E occupies 223          | Close 221                                                      |
| D/E occupies 224          | Close 222                                                      |
| 101 is occupied          | Close H01                                                      |
| 103 is occupied          | Close H03                                                      |
| 111 is occupied          | Close H04                                                      |
| H02 uses A14             | Dedicated bus gate; no closure coupling with 113                |
| 107 and 220              | C-only tight positions, with no alternate-position complexity   |
| 302 through 307          | E/F aircraft, international arrivals and departures             |

H01, H03 and H04 share passenger gates with contact stands. They are not limited
to periods when 102 or 112 has a larger aircraft; their authored conditions allow
them whenever the corresponding contact stand is unoccupied and all other rules
are satisfied.

H02 is a full-time remote hard stand with dedicated gate A14. It can operate
concurrently with 113. Do not reintroduce that dependency.

There are currently no conditional restrictions in Contoso. The restriction
examples above illustrate supported contract semantics, not missing airport data.

## Author once and derive indexes

`stand.gate_ids` is authoritative. Derive gate-to-stand lookups from it.
[gates.json](../data/airports/contoso/infrastructure/gates.json) currently retains
legacy inverse `stand_ids` lists. The validator reports discrepancies as
warnings; the reference model ignores those lists when building its inverse.
You do not need to maintain both sides to make evaluation correct.

Similarly, author each condition only on its affected stand. Compilation places
the same internal condition reference under both the affected and triggering
stand IDs. This supports efficient lookup without a second authored rule.

For an authored condition on A triggered by B:

* Evaluating A finds the condition and checks matching B occupancy.
* Considering a B assignment can retrieve the same condition to check affected A.
* An incompatible overlapping pair cannot be selected together.
* This does not invent a reciprocal condition making B close whenever A is
  occupied under all circumstances.

The reference evaluator checks the complete supplied plan, so results do not
depend on stand or assignment iteration order. A future solver must use these
semantics for both fixed occupancy and pairs of selectable assignments; filtering
against a movable baseline alone would not enforce them.

Diagnostics derive a path from the target stand, condition collection and array
position. These paths are meaningful within a configuration snapshot, not stable
rule identities across reordering. No rule IDs need manual maintenance.

## What validation covers

The [validator and reference evaluator](../scripts/airport-model.mjs) check:

* Stand field shapes, known properties, version, coordinate ranges and readiness
* Unique IDs within each catalog and resolvable references
* Aircraft/sector group membership references
* Gate, associated-building and gate-level references
* Trigger references, self-trigger errors and allow references
* Derived gate consistency warnings without requiring duplicate authoring
* Reference plan windows, aircraft, legs, same-stand overlap and authored rules

The [regression suite](../scripts/airport-model.test.mjs) validates every JSON
configuration example above and exercises rule behavior, including ordering,
intersection, single-leg visits, wildcard filters and the Contoso alternatives.

Errors make the validation command exit unsuccessfully. Warnings identify
non-blocking authoring issues explicitly. Passing validation does not prove a
dataset has sufficient capacity or a feasible assignment.

Still outside this contract are surveyed clearance envelopes, stand pavement
geometry validation, gate processing capacity, bus availability, towing
feasibility, assignment authority, temporary override precedence and live-feed
leg pairing. Add those as explicit models when the prototype needs them rather
than hiding them in descriptions or special-case rules.
