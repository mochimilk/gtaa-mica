---
title: Add an airport from source documents
description: Requirements, data formats, aircraft reuse, map alignment and an AI-assisted path from airport evidence to a validated synthetic stand schedule.
ms.date: 2026-10-28
---

## Choose a milestone

Keep airport facts, synthetic demand assumptions and generated assignments
separate. Use [GTAA](gtaa-airport.md) for source-backed infrastructure and exact
aircraft variants. Use [Contoso](scenario-generation.md) for compact examples
and stress cases. The current integration provides headless generation and
assignment and registered read-only schedules for GTAA and Contoso.

| Milestone | Required outcome | What it does not establish |
|-----------|------------------|----------------------------|
| Source-backed stubs | Inventory, stable IDs, provenance, approximate positions and explicit gaps | Assignment eligibility |
| Synthetic stand schedule | Reviewed ready stands, permissions, seats, handling, traffic and scenario profiles; independently validated assignments | Operational approval, clearance, gate processing or route feasibility |
| Prepared viewer | Source-matched prepared artifacts and explicit UI source registration | Automatic import of CLI output |
| Operational or routing model | Reconciled current rules, surveyed reference points and validated additional resources | Achieved by setting a readiness flag |

You can generate a stand-only simulation before modelling building footprints,
passenger movement or tow routes. Keep `planning_ready` and `routing_ready`
false until their separate requirements have been met. A stand's `ready`
status means its configuration can be evaluated, not that it is certified.

## Gather the inputs

Ask for the following in one intake. Record who supplied an assumption, its
effective date and whether it is source-backed, user-configured, synthetic
or unresolved. Do not treat a sample airport as evidence about the new airport.

| Input | Preferred format | Required details |
|-------|------------------|------------------|
| Airport identity | JSON or a short form | Stable airport ID, display name, IATA/ICAO codes, explicit catalog country and IANA time zone |
| Terminal and stand diagrams | Original vector PDF; annotated images also work | Terminal IDs, stand labels, gate labels, revision and page references; clarify alternate positions |
| Geographic alignment | Aligned map overlay plus known coordinates | `[longitude, latitude]`, the exact anchor feature, north direction, scale, crop/resize history and control points |
| Aircraft/stand compatibility | ASM PDF, CSV or readable workbook | Exact aircraft variants, physical table cells, section/row scope, arrivals/departures/parking exceptions |
| Neighbor rules | ASM pages or explicit authored lists | Affected stand, triggering neighbor, aircraft/sector conditions and restriction result |
| Airline and sector permissions | JSON, CSV or readable workbook | Separate arrival/departure sectors, explicit airline planning groups, contact status and availability |
| Fleet metadata | Existing catalog subset plus references | Exact identity, size letter, simulation seat count and source qualifications |
| Operating assumptions | JSON or approved values | Per-size arrival/departure handling and default tow minutes |
| Synthetic traffic | Approved dated scenario | Local date, visit counts by sector/market, aircraft/operators, PAX, stay ranges and boundary context |

Treat encrypted or inaccessible sources as blocked inputs. Ask for an authorized,
readable export or manual transcription. Do not bypass access restrictions.
Conflicting source dates, missing stands and ambiguous expressions belong in
the airport's data-gap record, not in guessed permissions.

## Align diagrams to longitude and latitude

1. Identify the exact anchor point. A map URL may identify a pin or an earlier
   viewport center, not the center of the cropped image. Ask the user to confirm
   which feature carries the coordinate.
2. Record source dimensions, PDF page/origin/units, rotation, crop offsets and
   image resizing. PDF label coordinates are not geographic coordinates.
3. Use a visible metric scale or known distances. Zoom level is a cross-check;
   screenshot pixels are not necessarily browser CSS pixels.
4. For an affine alignment, collect at least three non-collinear matching control
   points per independently transformed layer. Keep additional points out of the
   fit to check registration.
5. Convert through the declared projection, then persist exchange coordinates
   in `OGC:CRS84` order: longitude first, latitude second.
6. Save the anchor, transform, source references and held-out residuals. Record
   what the point represents: label anchor, parking reference point or gate door.
7. Flag unlocated entities explicitly. A placeholder is not a surveyed location.
   Never claim geographic accuracy from drawing-registration residuals alone.

GTAA's [georeferencing record](../data/airports/gtaa/georeferencing.json) is a
worked example. Its reference coordinate is `[-79.622388, 43.682157]`.
That coordinate order differs from tools that display latitude first.
Its approximate label positions support visualization, not clearance,
operational distance or routing calculations.

## Create the airport files

Use manifest-relative dataset paths and stable, case-sensitive IDs without
whitespace. Keep source documents local when redistribution is not authorized;
persist filenames, hashes, revisions and page/cell evidence instead.

| File or dataset | Contract and purpose |
|-----------------|----------------------|
| Airport manifest | `id`, `datasets.stands`, `datasets.gates`, `datasets.buildings`; add explicit `country`, `iata_code` and `time_zone` for catalog-backed scenarios |
| Buildings | `buildings` array; each building has an `id` and `levels` with stable level IDs |
| Gates | `gates` array; each gate has an `id`, `building_id`, `level_id` and optional stand/coordinate references |
| Stands | [Stand schema 2.0.0](../data/schemas/stands.schema.json); identity, coordinates, contact, permissions, availability and neighbor rules |
| Aircraft | `aircraft` array; exact `id`, descriptive name, `ICAO-code` size letter and integer `seats` for scenario aircraft |
| Aircraft groups | `aircraft-groups` array with `id` and explicit `aircraft-ids` |
| Shared reference catalogs | [Airlines](../data/airlines.json), [airports](../data/airports.json), [sectors](../data/sectors.json), [sector groups](../data/sector-groups.json) and disjoint [airline planning groups](../data/airline-groups.json) |
| Operating policy | [Operating schema](../data/schemas/operating-policy.schema.json); airport ID, per-size handling and tow fallback |
| Hourly traffic | [Traffic schema](../data/schemas/traffic-profile.schema.json); 24 nonnegative weights per configured sector/direction, interpreted in airport-local time |
| Scenario profile | [Scenario-profile schema](../data/schemas/scenario-profile.schema.json); dated window, seed, traffic volumes/mix, routes and cases |
| Tow preparation | [Tow-profile schema](../data/schemas/tow-profile.schema.json); experimental selection knobs, separate from physical handling policy |
| Evidence and gaps | Airport-local source hashes, revisions, raw expressions, interpretations and outstanding questions |
| Additional geometry/routing | GeoJSON and airport-local infrastructure following GTAA/Contoso examples; empty collections mean unmodelled |

The manifest, aircraft, buildings and gates are validated by
[the airport loader](../scripts/airport-model.mjs), not separate standalone
JSON schemas. Do not invent a schema filename. Refer to the linked schemas
for their required properties and allowed versions.

A minimal manifest layout with local aircraft overrides is:

```json
{
  "id": "example",
  "name": "Example Airport",
  "iata_code": "XXX",
  "country": "Canada",
  "time_zone": "America/Toronto",
  "planning_ready": false,
  "routing_ready": false,
  "datasets": {
    "buildings": "infrastructure/buildings.json",
    "gates": "infrastructure/gates.json",
    "stands": "infrastructure/stands.json",
    "aircraft": "aircraft.json",
    "aircraft_groups": "aircraft-groups.json",
    "operating_policy": "operating-policy.json",
    "traffic_profile": "demand/traffic-profile.json"
  }
}
```

Replace the example identity and verify its external code against the reference
catalog. Omitting both aircraft override paths retains the shared Contoso
catalogs; overriding only one does not automatically remap group members.

## Reuse GTAA aircraft facts, not GTAA stand permissions

The [GTAA aircraft catalog](../data/airports/gtaa/aircraft.json) contains 112
ASM identities, source-backed size classifications and user-configured seats.
Use it as a reference library without moving it or changing its existing IDs.

1. Select the exact variants needed by the new airport's source documents.
2. Copy the relevant aircraft records into its local catalog. If you give them
   new namespaced IDs, retain an explicit original-ID mapping and provenance,
   then update every new aircraft-group and scenario reference.
3. Preserve W/SSW, NEO, MAX, ER/LR and folded-wing distinctions. A shared
   external code does not establish identical stand compatibility.
4. Verify external designators before feed integration. The GTAA IATA/ICAO
   mappings have outstanding audit findings; catalog breadth does not mean
   every external code is certified.
5. Review seats for the intended simulation layout. Seats are not universal
   model capacity or proof that a particular operator uses that configuration.
6. Build airport-local compatibility groups from the new airport's evidence.
   Never copy GTAA stoplines, neighbor closures or stand fit to another airport.

Keep the following fields distinct:

| Field | Example | Meaning |
|-------|---------|---------|
| `id` | `gtaa:aircraft:B737-800-W` | Authoritative exact simulation/ASM identity |
| `ICAO-code` | `C` | Aerodrome size letter, not aircraft designator |
| `ICAO-type` | `B738` | External aircraft type designator; may repeat |
| `IATA-type` | `737` | Published generic equipment/group code, when used |
| `IATA-subtype` | `73H` | Specific published equipment code |
| `seats` | `189` | Authored simulation layout |

The loader and stand evaluator do not currently validate the external-code
hierarchy or use it to merge exact identities. Do not deduplicate on IATA or ICAO
designator. Keep planned/cancelled models out of normal traffic unless their
use is explicitly an experimental scenario.

## Review stand rules and readiness

Follow [stand authoring](stand-rules.md) for executable examples.
Extract physical PDF cells before expanding wrapped aircraft shorthand.
Preserve raw tokens and page/section scope; unresolved tokens grant no fit.

* Put a neighbor rule on the affected target stand, referencing the triggering
  neighbor. Do not automatically make closures symmetric.
* Intersect restrictions with base permissions. Closures take precedence.
* Keep arrival and departure eligibility separate. An empty leg-specific
  aircraft group denies that leg; an omitted group inherits base eligibility.
* Treat airline groups as authored planning sets, not an automatically updated
  alliance directory. Missing authorization does not mean common use.
* Keep stoplines, bridge sequencing, spotters, GPU, ramps and similar manual
  procedures as explicit requirements. Passing assignment checks does not
  verify their execution.

Start unknown positions as `geometry-only`; use `contact: null` if necessary.
After the user has reviewed a simulation subset, set only approved stands
to `ready` with boolean contact and complete rule fields. Do not promote
stands because their coordinates exist or because a solver needs capacity.
Validate inverse stand/gate references without inferring shared-gate capacity.

## Author the synthetic configuration profile

Copy the structure, not the traffic claims, of
[GTAA's profile](../data/airports/gtaa/demand/scenario-profile.json) or
[Contoso's full day](../data/airports/contoso/demand/full-day-profile.json).
Confirm these choices with the user before generating:

1. Airport identity, seed, local calendar date and UTC window. The supported
   window is 1-48 elapsed hours; local daylight-saving days can be 23 or 25 hours.
2. Total visits and sector/market mix. The current prototype supports 1-200
   visits per case. One paired visit creates two source flight legs.
3. Aircraft/operator rows, integer PAX bounds within their seat counts and
   minimum/maximum stay in elapsed minutes.
4. Route markets and airport weights, plus whether boundary visits or deliberate
   pressure banks are needed. Do not fabricate overnight state.
5. An explicit tow profile. Start stand-only with
   `maximum_generated_movements: 0` unless a tow demonstration is requested.
6. Expected coverage/movements to verify. Measure actual assignment results;
   do not relax airport rules or hide unassigned demand to satisfy expectations.

Use either `count` per traffic row, or `traffic_targets` plus each row's
`target_id` and positive integer `weight`. Do not mix the two modes on a row.
Targets allocate visits using eligible stand credits split among participating
planning groups, then carrier/fleet row weights. Shared stands are not counted
twice, but alternate stand positions and neighbor constraints still reduce
simultaneous capacity. Credits are not guaranteed capacity or measured demand.

Catalog-backed domestic routes use the host country. Transborder routes are
explicitly Canada-US in either direction and fail for other host countries.
Foreign carriers retain their hub/home-country intersections. For GTAA, place
US airports only in the transborder market and non-US foreign airports in
international markets. The existing international sampler remains a generic
foreign-market policy; it does not automatically partition every country into
airport-specific customs sectors.

Hourly traffic weights shape timing, not volumes. Handling minima constrain
elective tows; do not add arrival and departure minima together to invent a
minimum continuous-stay turnaround.

## Validate and generate

Use explicit paths so Contoso defaults cannot leak into a new airport run.
GTAA is an executable example:

```powershell
npm run validate:airport -- data\airports\gtaa\airport.json
npm run validate:catalogs
npm run generate:scenario -- --airport data\airports\gtaa\airport.json --profile data\airports\gtaa\demand\scenario-profile.json --case full-day --output .\gtaa-demand-scenario.json
npm run run:scenario -- --airport data\airports\gtaa\airport.json --profile data\airports\gtaa\demand\scenario-profile.json --case full-day --tow-profile data\airports\gtaa\demand\tow-profile.json --time-limit-seconds 30 --output .\gtaa-review.json
npm run test:airport
npm run test:catalogs
npm run test:scenarios
```

Outputs are exclusive-create files; choose a fresh name for each run. A
standalone generation package contains `raw_demand`; a solved review contains
`scenario.raw_demand`, both assignment variants and a measured summary.
Neither package is automatically imported into the UI.

## Verify the generated review

| Runner exit | Meaning |
|-------------|---------|
| `0` | Standalone demand generated |
| `1` | Invalid input, execution or I/O failure |
| `2` | Solved review written, expectations failed |
| `3` | Solved review matched expectations, with explicit model limitations |

Verify counts, source linkage, PAX, route geography, determinism, native solver
status and independent stand validation. Report every unassigned visit and
remaining gap. Preserve profiles, airport inputs, versions and output evidence
for reproducibility; a profile fingerprint alone does not freeze all inputs.

Do not run `prepare:gtaa-asm` as a generic onboarding command. It is
GTAA-specific and rebuilds aircraft records, potentially losing manually
authored seats and external codes. Back up or reconcile metadata before any
source regeneration.

## Register a read-only schedule source

Verify both generated plans, then run the compact schedule preparation command
with explicit manifest, profile, case, tow-profile and output paths, as shown
in the [schedule integration guide](local-assignment.md#select-or-prepare-an-airport-schedule).
Add a lazy snapshot import using `preparedSource` in the
[source registry](../src/data-sources/registry.ts). Airport metadata must match
the registry ID. The current prepared-source helper registers full-day cases.
Adding a source does not require airport branches in chart or agent code.

The chart, lists, filters and agent context must refer to the same active
dataset. Check airport and case identity together, preserve exact stand and
aircraft IDs, and test switching, reload restoration and unassigned flights.
Source changes require confirmation and a full reload, so pending agent work
and session-scoped stores cannot cross airports. Keep new solver sources
read-only until their editing and validation contracts are implemented.
Keep buffers, waiting, capacity/atlas, accommodation, decision review and tow
windows unavailable until airport-specific profiles and evidence exist.
Never reuse Contoso assumptions to fill gaps. Evidence for an approved plan
must not be presented as current after that plan changes.

## Use the AI onboarding prompt

Run `/add-airport` in VS Code, using the repository-shared
[prompt](../.github/prompts/add-airport.prompt.md). Supply the airport ID and
attach source documents, diagrams and coordinates.

For example:

```text
/add-airport
Airport: example, Canada, America/Toronto.
Use the attached terminal diagrams and ASM documents.
The red pin, not the cropped image center, is [-79.622388, 43.682157].
Create source-backed stubs first and list missing decisions.
Reuse verified GTAA aircraft facts without changing GTAA or Contoso.
Ask before selecting traffic volumes, marking stands ready or enabling tows.
```

Expect an intake, source/gap register, airport-local files, approved profile,
validation results and explicit remaining limitations. The AI must not invent
missing rules or certify operational readiness. Viewer source registration,
capacity probes and route modelling are separate follow-on tasks.
