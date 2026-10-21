---
title: Airport demand to solver to Gantt implementation plan
description: Inventory the current synthetic schedule and plan a reproducible, local, file-based demand and assignment workflow.
ms.date: 2026-10-20
---

## Outcome and scope

Create a stable demand dataset, combine it with an explicitly configured airport
and its stand rules, run the existing solver locally, and export a versioned
package that drives the existing Gantt chart and operations panel together.

Keep airline demand separate from assignment decisions. Keep human-authored
conditions minimal and derive lookup indexes and optimization constraints in
memory. Start with local JSON inputs and outputs, not hosted infrastructure.

This is a plan, not an implementation. The inventory was executed against the
current TypeScript fixture. No application code, demand dataset, aircraft catalog,
or airport configuration was changed while preparing it.

## Current data path

```text
syntheticFixture.ts
  29 synthetic stands
  25 handwritten visits with assigned stays
  67 deterministically generated visits with assigned stays
        |
        v
adapter.ts: adaptSyntheticDay()
  rows + visits + occupancies
  turnsById + stayPosition + endpoints
        |
        v
demoData.ts: module-level DEMO_DATA and DEMO_DOMAIN
        |
        +--> StandTimelineDemo + theme accessors --> StandTimeline
        |
        +--> operationsData.ts + five unassigned flight records
                |
                v
          arrivals / departures / alerts / filters / selection details
```

There is no airline feed, JSON demand loader, allocation backend, or solver call
on this path. The recently added Contoso infrastructure does not populate it.
The chart rows represent stands, not passenger gates.

### Source inventory

| Surface | Existing implementation | Required direction |
|---------|-------------------------|--------------------|
| Fixture | [syntheticFixture.ts](../../src/stand-timeline-demo/syntheticFixture.ts) | Preserve as a legacy regression source; stop treating preassigned stays as the demand contract |
| Fixture adapter | [adapter.ts](../../src/stand-timeline-demo/adapter.ts) | Extract a pure package-to-view adapter; retain explicit endpoint behavior |
| Shared constants and time formatting | [demoData.ts](../../src/stand-timeline-demo/demoData.ts) | Replace dataset globals with selected-package data; parameterize date and time zone |
| Chart host | [StandTimelineDemo.tsx](../../src/stand-timeline-demo/StandTimelineDemo.tsx) | Accept the selected view data rather than importing a fixed fixture |
| Bar presentation | [theme.tsx](../../src/stand-timeline-demo/theme.tsx) | Preserve carrier colors, registration labels, flight/tow endpoints, and accessible descriptions without requiring SyntheticTurn |
| Renderer contract | [model.ts](../../src/stand-timeline/model.ts) | Reuse rows, visits, occupancies and selection intents; keep solver semantics outside the renderer |
| Operations projections | [operationsData.ts](../../src/operations/operationsData.ts) | Derive all flight rows and alerts from the same demand and plan package |
| Shared UI state | [OperationsContext.tsx](../../src/operations/OperationsContext.tsx) | Own selected package and derived indexes alongside selection/filter state |
| Filters | [opsFilters.ts](../../src/operations/opsFilters.ts) | Build options and matchers from current data, including explicit carriers rather than flight-number slicing |
| Lists and summaries | [ArrivalList.tsx](../../src/operations/ArrivalList.tsx), [DepartureList.tsx](../../src/operations/DepartureList.tsx), [OperationsPanel.tsx](../../src/operations/OperationsPanel.tsx), [FilterStatus.tsx](../../src/operations/FilterStatus.tsx) | Remove static array/count imports and retain consistent counts |
| Alerts and details | [Alerts.tsx](../../src/operations/Alerts.tsx), [FlightActions.tsx](../../src/operations/FlightActions.tsx) | Resolve flights, visits and occupancy details against the selected package |
| App composition | [App.tsx](../../src/App.tsx) | Supply a consistent airport/package context; do not label Contoso as Toronto Pearson |
| Airport inputs | [airport.json](../../data/airports/contoso/airport.json), [stands.json](../../data/airports/contoso/infrastructure/stands.json) | Validate and explicitly configure planning inputs; geometry alone does not establish eligibility |
| Catalogs | [aircraft.json](../../data/aircraft.json), [aircraft-groups.json](../../data/aircraft-groups.json), [sector-groups.json](../../data/sector-groups.json), [sectors.json](../../data/sectors.json) | Pin versions/content, validate references and retain authored group semantics |
| Solver airport mapping | [AirportModel.cs](../../components/Planning.Solver/src/Planning.Solver.Airport/AirportModel.cs), [AirportProblemAdapter.cs](../../components/Planning.Solver/src/Planning.Solver.Airport/AirportProblemAdapter.cs) | Translate normalized demand and configured stands without dropping airport identity/evidence |
| Rule mapping | [AirportRuleAdapter.cs](../../components/Planning.Solver/src/Planning.Solver.Airport/AirportRuleAdapter.cs) | Add the agreed leg-sector and conditional closure/restriction semantics |
| Candidate/optimization boundary | [CandidateGenerator.cs](../../components/Planning.Solver/src/Planning.Solver.Core/CandidateGenerator.cs), [CpSatStrategy.cs](../../components/Planning.Solver/src/Planning.Solver.OrTools/CpSatStrategy.cs) | Preserve candidate rejection traces and encode conditional assignment incompatibilities |
| Existing execution | [SolverPipeline.cs](../../components/Planning.Solver/src/Planning.Solver.Core/SolverPipeline.cs), [OptimizationJobCoordinator.cs](../../components/Planning.Solver/src/Planning.Solver.Orchestration/OptimizationJobCoordinator.cs) | Reuse stages and outcome classifications through a small local runner |
| Application snapshot | [ApplicationContracts.cs](../../components/Planning.Application/src/Planning.Application.Core/ApplicationContracts.cs) | Preserve its authoritative draft boundary; do not confuse its assignment-only snapshot with a complete display package |
| HTTP fixture | [LocalFixture.cs](../../components/Planning.Application/src/Planning.Application.Http/LocalFixture.cs) | Separate two-item synthetic application demo, not the source of this airport chart |

### Measured fixture inventory

| Measure | Current value |
|---------|---------------|
| Base date | 2026-01-15 |
| Display window | 05:00 to 17:00 UTC |
| Stand rows | 29 |
| Handwritten visits | 25 |
| Generated visits | 67 |
| Total visits | 92 |
| Occupancy bars | 97 |
| Arrival list records | 94, including 3 explicitly unassigned |
| Departure list records | 93, including 2 explicitly unassigned |
| Assigned flight endpoints | 182 |
| Fixture alerts | 7 |
| Multi-stay visits | T09 has 3 stays; T21 has 2; X01 has 3 |
| Tow transfers | 5 explicit tow-outs and 5 explicit tow-ins |
| Parking-only visit | X02, with no flight endpoints |
| Intentionally empty stand | C25 |
| Earliest occupancy | 2026-01-14T22:30:00Z |
| Latest occupancy | 2026-01-15T18:32:00Z |
| Occupancies starting before the display window | 6 |
| Occupancies ending after the display window | 13 |

The 92 visits do not include the five separately authored unassigned flight
records. X02 has visit-level flight-like metadata for its description but
explicitly no flight endpoints, so it does not create arrival/departure list rows.

The generator uses fixed duration/gap tables and stand-index arithmetic, not
randomness, a clock, or a PRNG seed. Repeated execution already produces identical
data. However, inserting or reordering generated stands changes generated flight
IDs, times, and aircraft selections. It is stable for a fixed source revision,
not an independent reusable demand seed.

Two fresh Node processes produced the same inventory serialization SHA-256:

```text
8805ecbb5431b4934b4f99b0705d9a6fbb391c81999eff82e561a9158d6b2adb
```

This is an inventory-check fingerprint, not an established application wire
format or a canonical hashing specification.

## Findings that affect the plan

### Demand and assignment are currently mixed

SyntheticTurn contains SyntheticStay records with a stand already selected.
The chart adapts and displays those decisions; it does not allocate them.
Extracting demand must remove those stand choices and retain them separately as
an authored baseline plan.

Do not mechanically convert the five unassigned flight rows into complete
optimization subjects. They contain only a single leg estimate, not a full
required occupancy interval. U02 and U05 also lack aircraft types. Preserve these
as explicit incomplete-input regression cases unless the author supplies the
missing demand information. A missing registration alone need not invalidate an
otherwise sufficient allocation request.

### The UI consumes more than rectangles

The renderer needs rows, visits and occupancies. The application additionally
needs carriers, aircraft, registrations, routes, endpoint events, flight
identities, segment order, alert evidence, and time context.

A solver's assignment array is therefore not a sufficient replacement for
DEMO_DATA. It must be joined back to immutable demand and the appropriate airport
snapshot before the complete UI view is projected.

Changing only the chart would leave lists, filter options, counts and details on
the old dataset. All listed consumers must move together.

### Contoso is a separate airport, not a row rename

The screenshot uses 29 invented Pearson-oriented stand codes. Contoso has 46
identified stands, different gate associations, a different time zone, and
unconfigured stand eligibility. There is no established one-to-one stand map.

Preserve the existing fixture as a legacy visual regression. Create a separate
Contoso demand seed with declared sector assignments. A route that is transborder
relative to Toronto may be domestic relative to Contoso; do not carry inferred
sector labels across airports.

### Catalog and stand readiness are prerequisites

The fixture uses A339, B38M and E195, which are absent from the current aircraft
catalog. A319, A320, A321, A339, B38M and E195 have no authored aircraft-group
membership. Some authored groups overlap, and group E contains duplicate member
entries. Do not reinterpret custom groups as exclusive ICAO classes or
automatically fix their membership.

Resolve the selected seed's missing references through explicit catalog authoring
or select already defined aircraft. Do not silently replace aircraft models.
Normalize duplicate membership for in-memory lookups while reporting authoring
warnings.

Contoso stands are marked geometry-only and the airport is planning_ready=false.
Before a full-airport solve, author and validate the required aircraft/sector
permissions and conditions. An initial test can explicitly select a small
configured stand subset, with omitted resources reported. It must not silently
treat all geometry-only stands as unrestricted.

### Multi-stay visits need a segment identity bridge

CandidateGenerator requires unique SubjectId values as well as unique SegmentId
values. AirportProblemAdapter currently maps VisitId directly to SubjectId.
Passing T09's three segments under the same VisitId therefore fails uniqueness
validation.

The smallest proposed bridge is one solver subject per allocatable segment,
with a distinct stable segment ID and an external mapping back to the parent
visit and flight legs. Do not duplicate flight-leg identities for every segment.

Preserve preauthored tow/parking segments in the view contract. Independently
assigning them does not prove a valid tow chain. Initially optimize single-stay
visits and represent supported fixed multi-stay baseline occupancy as explicit
commitments. Report unsupported flexible multi-segment demand rather than
discarding it or claiming that the solver generated feasible towing.

### Rule support must be explicit

Existing rules cover capabilities, protected occupancy, optional exact-model fit,
same-stand non-overlap, and configured unconditional stand conflicts. The agreed
leg-specific sector checks and aircraft/sector-triggered restrictions are not
implemented by reading the authored stand JSON.

Compile each authored condition once. Build target-stand and triggering-stand
indexes from that same normalized condition. Filter candidates against fixed
trigger occupancy; encode incompatibilities between selectable candidate pairs.
Validate the final plan independently against the same frozen inputs.

Do not declare a reverse authored rule. Do not let stand iteration order or the
baseline's movable occupancy decide which candidates exist.

### Solver build scaffolding is not self-contained

The imported projects rely on absent shared build/package properties.
An MSBuild property inspection of Planning.Solver.Core returned empty
TargetFramework, Nullable, ImplicitUsings and ManagePackageVersionsCentrally.
No Directory.Build or Directory.Packages files were found in the repository.

Recover the intended framework, language configuration and package versions from
the component source before restoring/building. Do not invent dependency
versions from stale build artifacts.

## Proposed data boundaries

### Demand snapshot

A demand snapshot owns the request to accommodate aircraft, not the chosen stand.
Use string identities and versioned references:

* Dataset ID, schema version, airport ID, revision, source, knowledge cutoff,
  operating date, planning horizon and display time zone
* Explicit flight-leg IDs, direction, carrier, flight number, route endpoint,
  sector ID, and available scheduled/estimated/actual timestamps
* Aircraft model references and optional registrations
* Visits linking zero, one or two relevant flight legs, with an explicit visit
  kind rather than inferring a single-leg visit from a missing field
* Required occupancy segments with explicit full UTC start/end timestamps,
  purpose and endpoint events
* Explicit source/assumption records where an arrival-only or departure-only
  request needs an occupancy boundary not supplied by its flight leg
* Optional passenger counts later, with observed/predicted/synthetic provenance

Do not use HH:MM plus implicit rollover as the portable contract. The legacy
adapter may retain that conversion only at the fixture boundary. Do not label
on-block/off-block values as runway arrival/departure events.

### Scenario and baseline

A scenario pins demand, airport configuration, group catalogs, rule
configuration, profile and any explicit delay or closure overrides.

Keep a baseline assignment package separate from demand. Distinguish movable
baseline assignments from fixed commitments. Scenario changes must not edit the
original demand or baseline in place.

The planning horizon must cover relevant carry-in/carry-out occupancy and fixed
commitments. The visible Gantt window is a presentation choice, not permission
to drop out-of-view conflicts or demand.

### Plan package

Use a versioned serializable AirportPlanPackage as the local interchange boundary:

```text
manifest
  schemaVersion, packageId, airportId, demandRevision, input fingerprints
  run/profile/strategy versions, horizon, display window, time zone
  origin: authored-baseline or solver
airport row catalog
  stand identities, display labels, piers, gate associations
resolved demand snapshot
  flight legs, aircraft, visits, required segments, endpoint events
plan
  assignments and fixed commitments
  unassigned segments with reason evidence
  invalid-input and excluded records with explicit reasons
evidence
  solver status, independent validation, profile acceptance
  raw metric values, definitions, units, provenance, warnings
```

Embed the small demand and row snapshots needed to reopen a package without
following mutable source files. Record their input fingerprints. Full airport
GIS data does not need to be duplicated in every plan package.

Use arrays/objects in JSON. Derive Maps, Set memberships, lookup indexes,
endpoints, stay order and UI selectors in memory. Do not persist duplicated UI
lists as a second authoritative dataset.

The reusable chart receives a projection of this package, not solver DTOs.
Join assignment segment IDs to parent visits and flight legs to reconstruct
labels, grouping, tows and registration details.

Preserve every demand segment in exactly one explicit disposition:
assigned, unassigned, invalid input, or excluded. Account for fixed commitments
separately without double counting their represented demand. Do not fabricate
chart bars for unassigned demand or infer tows from missing flight endpoints.

An authored baseline can render without being described as solver-validated.
Infeasible, unknown, failed or validation-rejected solver results must remain
explicit outcomes, not success-shaped empty schedules.

## Reproducible demand strategy

Start with checked-in, versioned JSON demand snapshots. A frozen seed dataset is
sufficient for the first end-to-end slice; a configurable random generator is
not a prerequisite.

Maintain two separate fixtures:

1. A legacy visual-regression package matching the current screenshot data,
   including its authored baseline, tow cases, parking, clipping and incomplete
   standalone flight rows.
2. A Contoso single-stay solver seed using reviewed aircraft/sector catalogs and
   explicit required occupancy windows.

Once a generator is useful, give it explicit seed, generator version, operating
date, time zone, traffic parameters and catalog revision. Emit stable logical
IDs, avoid wall-clock/random defaults, and use a documented canonical
serialization for content fingerprints.

Demand generation must not depend on stand ordering, current assignment,
solver-selected strategy, objective weights, or the number of eligible stands.
Freeze and reuse the same demand while changing goals and stand rules. Record
different demand as a new revision, not an unnoticed regenerated input.

## Repository placement

The following paths are proposed, not created by this plan:

```text
data\
  demand\
    legacy-pearson\
      2026-01-15-v1\
        demand.json
    contoso\
      synthetic-day-01\
        demand.json
  scenarios\
    legacy-pearson\
      visual-baseline\
        scenario.json
        baseline-plan.json
    contoso\
      normal-day\
        scenario.json
  profiles\
    assignment-baseline.json
.local\
  runs\
    <run-id>\
      plan-package.json
```

Keep curated regression packages in Git and routine run outputs ignored.
Add the specific local-output ignore rule when implementing the runner.

Reuse the existing airport, solver and application component boundaries. Place
portable airport planning contracts with the airport-domain code; keep the
renderer projection in application-owned UI code. If a shared airport component
is introduced, make it the single contract owner rather than maintaining
independent C#, TypeScript and JSON definitions by hand.

## Implementation work packages

### W0: Restore local solver build readiness

Prerequisites: none; can proceed alongside W1.

* Recover the intended shared .NET build and dependency configuration.
* Restore/build the smallest relevant solver projects.
* Run existing core, airport and strategy tests before changing solver behavior.
* Record any unrelated baseline failures without silently fixing them.

Exit: a reproducible local solver build and an explicit test baseline.

### W1: Define demand, scenario and plan-package contracts

Prerequisites: this inventory.

* Define stable leg, visit, segment, stand and assignment identities.
* Define time semantics, optional metadata, dispositions and evidence.
* Separate input authoring errors from valid-but-unassigned solver outcomes.
* Choose one authoritative schema source and cross-language contract validation.
* Define package validation limits and explicit parse/version errors.

Exit: agreed representative JSON examples and contract tests for a turn,
arrival-only, departure-only, parking-only, fixed tow chain and unassigned demand.

### W2: Preserve the existing view through a package boundary

Prerequisites: W1.

* Export the existing deterministic fixture into demand plus authored baseline.
* Preserve incomplete standalone flight rows as explicit legacy observations.
* Build a pure package-to-view projection.
* Make the chart host, theme and all operations consumers use the selected
  package through one provider.
* Parameterize date, airport label, time zone and day-offset formatting.
* Preserve dim-not-remove filters, linked-stay selection, details, colors,
  accessibility and local alert acknowledgement.
* Reconcile selection/filter/acknowledgement state on package replacement;
  prevent references to flights or alerts from an old package.

Exit: the legacy package recreates the measured counts and behaviors without
requiring a solver or changing the generic StandTimeline renderer.

### W3: Establish Contoso planning input readiness

Prerequisites: W1. Can proceed alongside W2 and W0.

* Review the selected aircraft/group catalogs and repair missing references
  through author-approved edits.
* Author or confirm base aircraft and arrival/departure permissions for the
  explicitly selected stands.
* Retain human-authored closure/restriction classification and descriptions,
  without requiring manually managed condition IDs or mirrored rules.
* Keep geometry-only stands explicit. Reject a request that implies they have
  complete planning configuration.
* Resolve or defer B Pier sector choices explicitly, not through defaults.

Exit: a declared configured airport subset or full airport, with no unsupported
eligibility assumptions.

### W4: Freeze a Contoso demand seed and baseline scenario

Prerequisites: W1 and the catalog decisions in W3.

* Create a small readable single-stay seed before scaling to a screenshot-sized
  workload. Include domestic/international turns and deliberate saturation.
* Include complete arrival-only/departure-only requests with explicit occupancy
  boundaries, plus separate invalid-input cases.
* Store any hand-authored baseline assignments separately.
* Pin the input datasets, time context, rules and profile in a scenario.
* Test repeatable bytes/fingerprints and stable identities.

Exit: the seed is independent of stand allocation, and the exact same demand
can be used with changed objectives or stand restrictions.

### W5: Compile inputs and enforce the agreed stand semantics

Prerequisites: W0, W1, W3 and W4.

* Map one allocatable segment to one unique solver subject; retain parent
  visit/leg identity in the airport mapping.
* Resolve aircraft and sector groups without inferring semantics from group
  names. Omitted/null filters are wildcards; unknown required demand is not.
* Enforce each target assignment's present arrival/departure legs only.
* Match trigger conditions against the triggering occupancy independently of
  the target's leg kind. A supplied filter requires that trigger leg to exist.
* Use AND within a condition, OR between closures, and intersection of active
  restrictions with base permissions. Closure wins.
  All filters in one condition must match the same triggering occupancy.
  An omitted restriction dimension leaves that base permission unchanged; an
  explicit empty allowed list permits nothing.
* Apply conditions during overlapping triggering occupancy, without adding
  buffers or recursively propagating derived stand states.
* Index each condition under both affected stands without creating a reversed
  condition or making results dependent on source order.
* Handle fixed-trigger occupancy during eligibility checks; encode selectable
  trigger/target incompatibilities during optimization.
* Declare strategy capabilities accurately. Extend supported strategies or
  reject the profile explicitly; do not silently ignore new hard rules.
* Validate complete plans independently against the frozen input configuration.

Exit: one authored condition on A works whether A or B is considered first,
and both the optimizer and validator reject the same forbidden combinations.

### W6: Run locally and export a complete plan package

Prerequisites: W0, W4 and W5.

* Add the smallest local command wrapper over the existing solver execution
  components; avoid a new web service or duplicated worker framework.
* Load a scenario, validate references, freeze inputs and run the selected
  supported strategy/profile.
* Preserve worker/solver status, validation, acceptance and metric evidence.
  Do not equate producing a candidate with human publication.
* Join assignments and unassigned results back to demand and airport rows.
* Export the complete versioned package and retain the input fingerprints.
* Surface missing files, invalid data, cancellation and solver failures as
  explicit diagnostics and unsuccessful command results where appropriate.

Exit: a persisted package can be reopened independently of current source
configuration and reconciles all input demand.

### W7: Load and verify solver output in browser and desktop

Prerequisites: W2 and W6.

* Add a user-selected JSON package import using browser file APIs, shared by
  Vite/browser and Electron. No renderer filesystem access is needed.
* Validate before replacing the active package. On failure, show the error and
  retain the previous package clearly as the previous package, not the new run.
* Populate chart, lists, filters, counts, alerts and details atomically.
* Keep airport branding/context accurate when switching legacy and Contoso
  datasets.
* Expose provenance and solve/validation state without implying operational
  certification or publication.
* Update directly related startup and data-workflow documentation.

Exit: a local solve exports a file that fills the existing Gantt and its sidebar
consistently in both browser and desktop.

### Dependency summary

```text
W0 -----------------------------------------+
                                            |
W1 --> W2 ----------------------------------|------+
 |                                          |      |
 +--> W3 --> W4 --> W5 --------------------> W6 --> W7
             |       ^
             +-------+
```

The work-package prerequisite lists are authoritative. W5 also directly depends
on W0 and W1; W6 directly depends on W4. The diagram summarizes the main flow.

## Acceptance and regression checks

* Legacy round-trip: 29 rows, 92 visits, 97 bars, 94 arrivals, 93 departures,
  3 unassigned arrivals, 2 unassigned departures, and 7 initial fixture alerts.
* T09, T21 and X01 retain their segment order, linked selection and explicit tow
  endpoints. X02 creates parking occupancy but no invented flight list rows.
* Empty C25 remains visible. Out-of-window occupancy retains its full times
  and is clipped only in rendering.
* New complete single-leg visits do not synthesize an absent opposite leg or tow.
* Missing aircraft, missing occupancy boundaries, invalid IDs and unsupported
  schema versions yield explicit errors or invalid-input evidence.
* Every configured group reference resolves. Unknown sector/model data never
  becomes an unrestricted match.
* Aircraft/sector rules, closures and intersecting restrictions agree between
  eligibility, solver and complete-plan validation.
* A single authored adjacency condition blocks the pair regardless of stand or
  candidate ordering, with fixed and selectable triggering occupancy.
* Boundary-touching intervals do not overlap; partial overlaps do activate
  conditions. No implicit buffers are added.
* Each demand segment has exactly one disposition; fixed occupancy is included
  in validation without double counting demand or score.
* Baseline rendering does not claim independent validation unless evidence
  exists. Infeasible/unknown solver statuses do not appear as accepted plans.
* Package switching cannot mix airport rows, flight lists, filter options,
  time zones, selection or stale alert acknowledgement.
* Stable input serialization excludes volatile run IDs/timestamps from content
  fingerprints. A changed rule/profile does not regenerate demand.
* Use the deterministic baseline for exact regression snapshots. Fixed seeds
  and one CP-SAT worker do not guarantee identical time-limited incumbents or
  identical choices among equally optimal solutions across runtimes; compare
  feasibility, evidence and objective values where exact identity is unjustified.
* Run focused adapter/contract/rule tests first, then the affected solver suites.
  Run the existing root build and desktop checks once application code changes.
  Verify import and selection/filter behavior in the browser and packaged
  desktop workflow.

## Deferred scope and decision checkpoints

* Dynamic tow-chain generation, towing resource capacity and time optimization
* Automatic flight-leg pairing from live feeds
* Real airline integrations and external assignment-authority reconciliation
* Full passenger routing, staffing allocation and passenger-satisfaction models
* Resilience optimization, multi-recommendation selection and advanced KPI
  objectives beyond strategies' declared capabilities
* Hosted deployment, databases, authentication, queues and distributed workers
* Assistant/MCP integration and review/publication UI changes
* Replacement of the current chart with the imported reusable renderer
* Direct browser-to-solver execution and automatic Electron process management
* A general-purpose configurable synthetic generator before frozen seeds prove
  useful

Before implementation, confirm the W1 example contracts, the W3 aircraft/group
and stand-sector authoring choices, and whether the first Contoso solve covers
an explicit configured subset or the full airport.

The recommended first delivery is W1 and W2: preserve the current screen through
an explicit data package. W3 and W0 can then progress independently while the
demand seed and local solver path are completed.
