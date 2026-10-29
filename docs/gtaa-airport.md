---
title: GTAA source-backed airport configuration
description: Toronto Pearson stand rules, source evidence, synthetic demand profile, readiness limits and outstanding operational inputs.
ms.date: 2026-10-28
---

## Coverage

The [GTAA manifest](../data/airports/gtaa/airport.json) follows Contoso's
infrastructure and routing layout. It identifies Toronto Pearson as YYZ/CYYZ
with the `America/Toronto` time zone. This integration includes the headless
airport model and synthetic scenario tools. Main's existing application UI
is unchanged; selectable solver datasets and overlays are a later integration.

| Area | Stand stubs | Interior gates | Stands in current ASM tables | Stand-level directional closures |
|------|-------------|----------------|------------------------------|---------------------------------|
| Terminal 1 | 97 | 86 | 87 | 70 |
| Terminal 3 | 57 | 48 | 57 | 33 |
| Infield Concourse | 14 | 13 | 14 | 10 |
| Total | 168 | 147 | 158 | 113 |

The inventory is the union of exterior map stand labels and current ASM table
headings. Alternate positions are separate resources, not extra simultaneous
capacity. Passenger gate names need not match physical stand names. For example,
T3 stand A1A maps provisionally to passenger gate B1A; T1 stand 124 has D24/D4
gate labels. Shared gate labels do not establish gate-processing capacity.

The ASM import includes 112 exact aircraft variants, 52 additional
aircraft-conditioned closures and 14 neighboring restrictions. Seven malformed
or ambiguous aircraft expressions remain explicit review items. Size metadata
is sourced for all 112 variants. Folded and extended 777-9 configurations remain
distinct; the cancelled A350-800 retains a planning-only qualification.
All 112 variants now have user-configured simulation seat counts. These are
not verified operator layouts or universal aircraft capacities. MTOW values
have not been invented.

## Files and provenance

* [Buildings](../data/airports/gtaa/infrastructure/buildings.json) identify T1,
  T3 and IFC, with explicitly unverified passenger-level placeholders.
* [Stands](../data/airports/gtaa/infrastructure/stands.json) hold stable
  namespaced IDs, partial closures, provisional gate associations and provenance.
* [Gates](../data/airports/gtaa/infrastructure/gates.json) hold interior gate
  identities and the inverse of `stands.gate_ids`.
* [Source evidence](../data/airports/gtaa/source-evidence.json) records all ten
  source hashes, revisions, page ranges, transcribed ASM sections and physical
  table-cell boundaries on all 94 current-table pages.
* [Exact aircraft variants](../data/airports/gtaa/aircraft.json) and
  [aircraft groups](../data/airports/gtaa/aircraft-groups.json) supply GTAA-local
  permissions without changing the shared Contoso catalog.
* [ASM rules](../data/airports/gtaa/asm-rules.json) preserve normalized aircraft
  cells, service-leg eligibility, stoplines, separate bridge instructions,
  rule provenance and unresolved interpretations.
* [Operating policy](../data/airports/gtaa/operating-policy.json) and
  [traffic profile](../data/airports/gtaa/demand/traffic-profile.json) hold
  user-approved synthetic assumptions, not verified GTAA operating figures.
* [Scenario profile](../data/airports/gtaa/demand/scenario-profile.json) and
  [tow profile](../data/airports/gtaa/demand/tow-profile.json) define the initial
  160-visit stand-only simulation, independently of hourly traffic weights.
* [Georeferencing](../data/airports/gtaa/georeferencing.json) records the map
  anchor, scale, terminal transforms, control vertices and registration checks.
* [Data gaps](../data/airports/gtaa/data-gaps.json) record blockers, source
  discrepancies and examples needing aircraft-specific rule review.

Source documents and the copied overview remain local under the gitignored
`data/samples/` directory. Digest subtests verify their bytes when present and
explicitly skip missing local sources in other checkouts. Coordinate and
operational-safeguard tests always run against the persisted JSON datasets.

Current ASM tables cover T1 pages 1-52 (v144, September 11, 2025), T3 pages
1-31 (v127, May 1, 2025) and IFC pages 1-11 (v36, June 11, 2026).
General notes are retained separately. Later revision-history pages are
referenced but not treated as current compatibility or closure rules.

Aircraft, IATA, restrictions, stopline and VDGS text is transcribed in reading
order. Cells can span several rows. Dual-bridge sections also retain separate
bridge columns. Source spelling, shorthand and inconsistencies are preserved;
do not interpret every aircraft mentioned in a restriction as compatible.
For T3 ASM tables, extraction rotates native PDF coordinates for reading:
`x = native y`, `source_y = -native x`.

The maps retain native PDF label positions in points, with a bottom-left origin.
These are label anchors, not aircraft parking reference points. PDF text colors
distinguish black exterior stands from blue interior gates. Nearby labels provide
provisional associations, with visual reconciliation of shared-label exceptions.
Operational confirmation remains required.

## Approximate geographic positions

The two user-aligned Bing overlays and the preserved
[alignment overview](../data/samples/gtaa/gtaa_alignment_overview.png)
place 166 stands and all 147 gates approximately. Native vector frame vertices
recover T1 and T3 placement, including geometry outside the PDF artboards.
The exported IFC layer is empty, so its placement uses three frame corners
selected from the overview image.

The user confirmed that `[-79.622388, 43.682157]` identifies the red pin's
position before cropping. Its stem tip, not its circular icon or either cropped
image centre, anchors the transform. The overview's Bing background bounds map
that tip to the full 3472 by 1798 pixel embedded screenshot.

The screenshot's 100 m scale spans 114 physical pixels, approximately 0.877 m
per pixel. The 300 ft scale spans 103 pixels; its implied scale differs by
approximately 1.21%, consistent with limited scale-bar resolution. Zoom 16.4 is
a cross-check, not a substitute for this calibration: screenshot physical
pixels cannot be assumed to equal CSS pixels. North-up image offsets convert
through spherical Web Mercator about the confirmed anchor.

Held-out frame checks reproduce T1/T3 vector placement within 0.01 m and IFC
frame placement within approximately 3.2 m. These are drawing-registration
residuals, **not absolute geographic accuracy**. The map anchor, overlay
alignment and displacement from a label to an actual parking point have not
been independently surveyed. A 20-50 m accuracy claim is not established.

Coordinates represent the arithmetic mean of an entity's source label anchors,
not aircraft centroids, parking stop points or gate doors. Each located record
links to its transform and retains its original PDF anchors. Six decimal places
preserve calculation results, not surveyed precision.

T1 stand 193 and IFC stand 528A have no located map label. They alone retain the
earlier `[-79.628365, 43.67984]` airport-reference placeholder, explicitly flagged.

## Readiness limits

> [!WARNING]
> Located coordinates support approximate visualization only. Do not plot the
> two flagged placeholders as real stand positions. None of these coordinates
> is approved for operational distance, routing, capacity or clearance calculations.

All 168 stands are user-configured as `configuration_status: "ready"`, with
boolean contact values, arrival/departure sector groups, airline authorizations
and explicit availability. They can participate in stand-rule evaluation.
This does not certify geographic accuracy, simultaneous capacity or manual
procedures. Both airport readiness flags remain false. Geometry-only records
still cannot be assigned by the evaluator.

The 113 stand-level closures translate explicit headings. Aircraft-conditioned
closures and neighboring restrictions are encoded separately, including the
scoped 120A/124 widebody prohibitions and six Code C-or-smaller neighbor limits.
Rules reside on the affected target and refer to the triggering neighbor.
They are directional, not automatically symmetric.

Every current ASM stand has explicit aircraft compatibility. W, SSW, NEO, MAX,
ER, LR and regional variants remain separate catalog identities. Literal B737
numeric intervals enumerate plain series only, never winglet or MAX variants.
Unresolved source tokens grant no compatibility and remain review items.

Optional arrival/departure aircraft groups narrow base compatibility for each
present leg. For example, the merged A319/A320/A321 cell at T1 254 is
arrivals-only, while its CRJ and DH8 cells permit departures. IFC 521's regional
cells are parking-only; that does not prohibit passenger service for every
aircraft on the stand.

Bridge sequencing, PBB use, spotters, GPU/MBA, ramps and wingwalkers remain manual
requirements. Stoplines and section-scoped VDGS text are retained as evidence,
not inferred aircraft-specific approvals. Passing assignment checks does not
certify that these procedures are satisfied.

Geographic footprints, passenger zones and route connectivity remain unmodelled.
Empty GeoJSON and airfield collections are stubs, not assertions that the airport
lacks those facilities. Contoso operating and traffic assumptions were copied
only with explicit user approval for a synthetic test baseline.

## Synthetic operating and demand defaults

The configured minimum arrival and departure handling windows are each
45 minutes for size codes A-C and 60 minutes for D-F. Tow travel is separate;
the default tow duration is 12 minutes when completing a single-anchor movement.
Supplied movement intervals are preserved. These windows do not impose a
summed minimum turnaround duration.

Domestic, international and transborder arrival/departure weights match the
Contoso demo patterns. They are interpreted in `America/Toronto` local time,
including daylight saving changes, rather than Contoso's Pacific time.
Weights distribute demand across hours; they are neither flight counts nor
capacity limits. Scenario volumes and aircraft/airline mixes remain separate
inputs. Replace these assumptions with GTAA measurements before operational use.

## Inputs needed next

The sector workbook remains rights-management encrypted and was not decrypted.
Separate arrival/departure sector permissions have instead been entered by the
user, together with airline authorizations and contact values.

Ten older T1 map positions have no current ASM heading: 101, 101A, 103A, 105A,
107A, 160A, 162A, 162B, 164 and 245B. T1 stand 193 and IFC stand 528A appear in
current ASM tables but have no located label on the supplied maps. Their gate
associations are left empty. Absence from either source does not establish
whether a stand is currently open or closed.

Before operational use, independently of the user-approved simulation readiness:

1. Reconcile current stand inventory and source effective dates.
2. Locate the two remaining stands and confirm actual parking/gate reference
   points and required geographic accuracy.
3. Confirm passenger gate associations and levels.
4. Review unresolved source aircraft expressions, external aircraft-code audit
   findings, planning-only types and operator-specific seat configurations.
5. Review the translated neighbor rules and confirm manual operating procedures.
6. Review user-configured sector/airline permissions and availability for the
   stands selected for testing.
7. Replace synthetic handling, tow and traffic assumptions before operational use.

The shared C/D/E/F groups are not used to infer ASM compatibility. A Code C
neighbor restriction uses verified catalog size metadata and fails closed if
that metadata is missing. "B737-500 or smaller" still needs an explicit allowed
model set for stand 176 while 175A is occupied; it is not a general Code C rule.

## Synthetic full-day configuration

The initial [scenario profile](../data/airports/gtaa/demand/scenario-profile.json)
follows Contoso's full-day process for October 28, 2026, from Toronto local
midnight to midnight: `2026-10-28T04:00:00Z` through `2026-10-29T04:00:00Z`.

| Target | Visits | Source legs |
|--------|--------|-------------|
| Canadian domestic | 64 | 128 |
| US transborder | 64 | 128 |
| Europe international | 16 | 32 |
| Asia international | 16 | 32 |
| Total | 160 | 320 |

The user approved the date and 64/64/32 sector split. The equal Europe/Asia split,
fleet/operator rows, PAX ranges, stay ranges and market weights are illustrative
choices following Contoso, not measured Pearson demand or verified airline
fleets/service. Five exact catalog identities are selected: A220-300, A320,
EMB175, B737-800-W and B787-9. Cancelled and preliminary types are excluded.
Air Canada supplies the configured domestic pool; this is not a claim that
other Canadian operators do not serve Pearson.

Planning-group shares derive from eligible stands, splitting shared credits,
then applying the configured carrier/fleet weights. The initial result has
125 Star, 18 Oneworld and 17 SkyTeam visits using the authored planning groups,
not a verified alliance directory. These static credits are not independent
simultaneous capacity.

There are no fabricated boundary visits or pressure banks. The separate
[tow profile](../data/airports/gtaa/demand/tow-profile.json) disables elective
generated movements. With the checked-in seed and current configuration, both
native solver variants were optimal: 160 assigned visits, 320 assigned legs,
zero unassigned visits and zero generated tows. Both plans passed independent
stand-rule validation and all scenario expectation checks.

```powershell
npm run generate:scenario -- --airport data\airports\gtaa\airport.json --profile data\airports\gtaa\demand\scenario-profile.json --case full-day --output .\gtaa-full-day-scenario.json
npm run run:scenario -- --airport data\airports\gtaa\airport.json --profile data\airports\gtaa\demand\scenario-profile.json --case full-day --tow-profile data\airports\gtaa\demand\tow-profile.json --time-limit-seconds 30 --output .\gtaa-full-day-review.json
```

Use fresh output filenames; existing files are not overwritten. Generation
returns exit `0`; a solved review matching expectations returns `3`, while
failed expectations return `2`. These commands create synthetic CLI artifacts;
they do not register GTAA in the application or replace main's fixture.
The prototype viewer and analysis tooling remain on `feature/solver` for a
separate modular integration. Airport-specific analysis assumptions must not
be replaced with Contoso defaults during that integration.
See the [onboarding guide](airport-onboarding.md) for reusable input requirements,
formats, diagram alignment and AI assistance.

## Regeneration

```powershell
npm run prepare:gtaa-asm
```

The generator uses persisted source transcription and cell boundaries, so no PDF
package or local source documents are needed. It replaces its reserved
`gtaa-asm-fit` conditions and derived aircraft permissions, preserving user sector
groups, airline groups, coordinates, contact status, availability and readiness.
Review items are printed explicitly and retained in the generated rules.

The generator rebuilds the aircraft catalog from ASM evidence. Back up or
reconcile manually authored aircraft metadata, including IATA codes and seat
counts, before running it. Configuring operating policy and traffic does not
require regeneration.

## Validation

```powershell
npm run validate:airport -- data\airports\gtaa\airport.json
npm run test:airport
```

GTAA validation should report no errors and no geometry-only warnings for the
168 user-ready stands. Run `npm run test:scenarios` for both Contoso and GTAA
generation/native assignment regressions.
The regression tests verify inventory counts, source hashes and page coverage,
pin/scale calibration, transform residuals, coordinate reproduction, remaining
placeholders, closure direction, gate inverses, exact variants, physical cell
scope, parking-only and arrivals-only permissions, neighboring restrictions,
regeneration, missing permissions and readiness safeguards.
Passing validation is not operational approval or certification.
