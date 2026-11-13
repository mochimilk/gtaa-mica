---
title: Local stand assignment with CP-SAT
description: Run the airport baseline and admitted tow alternatives locally with atomic visits, authored stand constraints and independent validation.
ms.date: 2026-10-29
---

## Local execution

The assignment runner is a short-lived command-line process, not a service:

```text
Raw demand + airport + tow profile
  -> baseline occupancy and tow preparation
  -> JSON candidate/conflict requests
  -> local .NET / OR-Tools CP-SAT
  -> independent stand validation
  -> JSON comparison package
```

You need the .NET 10 SDK and the existing Node dependencies. The solver's scoped
[build configuration](../components/Planning.Solver/Directory.Build.props) and
[package versions](../components/Planning.Solver/Directory.Packages.props)
restore the missing import scaffolding without affecting other components.
Versions match the imported solver's cached dependency metadata.

The first build restores NuGet dependencies, including OR-Tools and its native
libraries. That normally requires internet access unless packages are cached.
After restoration, solving is local and can run offline. No planning data is
submitted to an external solver. Native execution has been verified on this
Windows x64 environment; other OS/architecture combinations require their own
runtime verification.

No Azure resources, database, container, queue, web server, credentials or
persistent background process are required. CPU and memory are used locally.

## Run

```powershell
npm run build:solver
npm run solve:airport -- --plan-start 2026-10-21T14:00:00Z --plan-end 2026-10-22T14:00:00Z --output .\contoso-local-assignment.json
npm run test:assignments
```

The solve command performs an incremental build before execution. Optional flags:

| Flag | Purpose |
|------|---------|
| `--demand` | Raw-leg snapshot |
| `--airport` | Airport manifest |
| `--profile` | Tow-preparation profile |
| `--time-limit-seconds` | CP-SAT limit per variant, greater than zero through 300; default 10 |
| `--output` | New output file; existing files are never overwritten |

Default input paths are module-relative; explicit paths are working-directory
relative. JSON goes to stdout when output is omitted. Build messages,
diagnostics and limitations go to stderr. Invoke
`node .\scripts\solve-airport.mjs` directly to avoid npm's stdout banner.

The .NET host accepts a request on stdin and emits its result on stdout:

```powershell
Get-Content -Raw .\request.json | dotnet .\components\Planning.Solver\src\Planning.Solver.Cli\bin\Debug\net10.0\Planning.Solver.Cli.dll
```

Requests are compiled by the airport adapter, not manually inferred from a
relaxed pressure report. The
[request schema](../data/schemas/local-solver-request.schema.json) defines the
wire contract. Invalid fields, duplicate identities and broken references fail
explicitly. The host requires all constructor fields, including boolean flags.

## Two variants and one fair objective

The [Node adapter](../scripts/local-assignment.mjs) creates two requests:

* `baseline` permits no additional discretionary tow.
* `tow-options` also admits the alternatives selected by the preparation profile.

Both use the same represented demand and objective:

1. Maximize the number of represented flight legs covered.
2. Among equally covering solutions, minimize generated movements.

One connected visit contributes two flight legs whether it occupies one stand
continuously or uses three segments with two tows. Extra parking segments never
inflate coverage. The host uses an integer coverage multiplier greater than the
maximum possible movement count, making this objective lexicographic rather
than an approximate balance of incomparable weights.

The preparation profile still governs which tow options are admitted. Its
shortage-minute penalty is a screening score, not the solver objective or a
financial cost. This runner does not claim to implement a general operational
KPI profile.

No-additional-tow remains available for every admitted alternative. The solver
can reject a relaxed recommendation when adjacency makes it infeasible, or
choose the original stay when towing provides no extra coverage. This removes
unnecessary generated tows within the admitted option set without a destructive
post-solve rollback.

The imported generic `CpSatStrategy` currently supports one-resource subjects
and resource-level conflicts, not atomic multi-segment visit alternatives or
aircraft-dependent candidate-pair restrictions. The new
[CLI host](../components/Planning.Solver/src/Planning.Solver.Cli/Program.cs)
uses the existing OR-Tools dependency directly for these additional constraints.
It does not silently feed repeated VisitIds to the generic airport adapter, nor
claim to use its manifest/scoring pipeline. Existing generic contracts and
strategies remain unchanged and retain their tests.

## Demand identity and atomicity

Only fully fixed segments enter executable requests. Minimum-service rows used
by [pressure analysis](tow-preparation.md) are not fixed tow choices and do not
enter this solver. Flexible/open segments remain in `excluded_segment_ids`;
blocked source legs remain in the embedded preparation baseline.

Every placement references a unique occupancy demand ID, with visit/source
segment identity preserved separately. A visit containing supplied movements
can therefore occupy several fixed intervals without an at-most-one-by-visit
constraint accidentally discarding its other segments.

Visit segments are grouped atomically. A tow alternative is either fully
assigned across arrival service, parking and departure service, or not selected
at all. The no-additional-tow and tow alternatives are mutually exclusive.
Incomplete assignment of only the easy service segments is not a solution.

Fixed intervals pinned by supplied ground endpoints are mandatory and cannot
be dropped to improve coverage. If those supplied occupancies conflict, the
request is infeasible. Unknown parking surrounding a supplied movement is still
excluded, not invented. A mandatory fixed subset does not establish the missing
initial/final aircraft state.

## Authored stand constraints

The adapter reuses static candidate eligibility from
[stand pressure](../scripts/stand-pressure.mjs), including aircraft, flight
sectors, known operators, closures, readiness and fixed endpoints.

For overlapping candidate placements it evaluates pairs through the existing
[stand-rule evaluator](../scripts/airport-model.mjs). Each violating pair becomes
a CP-SAT incompatibility, with reason codes and authored rule paths retained.
This enforces:

* Non-overlap on the same stand for the entire continuous interval
* Occupancy-dependent neighboring-stand closures
* Aircraft/sector-filtered triggers
* Conditional restrictions, with the existing AND/OR and intersection semantics

These current authored rules are pairwise: any violating neighbor is sufficient
to prohibit the pair. The compiler must be revisited if future rules require
three-way interactions or new resource semantics.

Generated movement endpoints must use different stands, even though travel
separates their occupancy intervals. Tow-out and tow-back endpoints are resolved
from the selected service and parking placements. Known source times are not
shifted or rounded. Half-open touching intervals do not receive invented buffers.

Shared gate references are not automatically whole-stay resource conflicts.
Gate service windows, bus availability and related staffing require explicit
resource models before enforcement.

The current compiler enumerates candidate pairs. It is intended for bounded
prototype scenarios, not a claim of full-airport production throughput.

## Validate independently

The runner checks every returned placement against the compiled request,
rejects duplicate or fabricated placements, verifies atomic option membership,
mandatory demand, coverage counts and compiled conflict constraints, and then
evaluates the complete selected occupancy through the stand-rule evaluator.

Each variant records:

* Native engine/version and solver status
* Selected options, assignments and unassigned groups
* Assigned demands with full intervals and source identity
* Generated movements with resolved stand endpoints
* Stand-validation evidence and excluded timing segments
* The request, SHA-256 request fingerprint, candidate exclusions and conflict evidence

The fingerprint identifies the exact solver request, not a production event-feed
version or the generic solver pipeline's artifact lineage.

`optimal` means optimal for the compiled model and admitted alternatives only.
`feasible` can be returned when the time budget ends with an incumbent; it is not
an optimality certificate. `unknown`, `infeasible` and `modelinvalid` never
produce successful stand-validation evidence.

A variant disposition is `no-solution`, `partial-assignment`, or
`stand-rules-validated`. The last means all represented groups were assigned and
the selected occupancies passed stand checks. It does not establish complete-day
coverage or operational readiness.

The [comparison schema](../data/schemas/local-assignment.schema.json) requires
`operationally_ready: false`. Towing crews, routes, travel feasibility, gate/bus
resources, missing timing and blocked demand remain explicit limitations.

## Review the Contoso result

The unchanged seed currently produces the same result for both variants:

* Six represented flight legs assigned, across three connected visits
* One connected visit unassigned because its departure has no eligible stand
* Zero generated movements
* Eight flexible/open segments excluded from fixed-window execution
* Three intentionally ambiguous flight legs retained as blocked source evidence

No airport permission is relaxed to manufacture a successful demo.
A separate constrained integration fixture verifies that an admitted tow pair
increases covered flight legs from four to six. Another fixture proves that a
neighbor closure can veto a relaxed recommendation.

For repeatable full demo days, use
[scenario generation](scenario-generation.md). Its separate profile preserves
this validation seed, supplies complete scheduled overnight context and checks
the actual comfortable/constrained coverage and tow counts.

| Exit code | Meaning |
|-----------|---------|
| `1` | Invalid input, build/native execution, validation or output I/O failure |
| `2` | Package generated with source errors, unassigned groups or no solution |
| `3` | Stand-assignment review generated; operational limitations remain |

There is no operational-success exit code. Source errors and incomplete
assignments take precedence over review-only status.

## Preserve the current Gantt

The assignment runner writes comparison JSON only. The original fixture and
its editing behavior remain available. Source selection uses separately
prepared compact schedules; analysis overlays remain deferred.
The scenario runner resolves boundary state for its
complete scheduled feed; generic initial-state overlays, single-leg tow
scheduling and explicit gate/towing resources remain separate modeling steps.

## Shared application dataset boundary

[The active dataset](../src/operations/activeDataset.ts) owns the board for one
page session. [The dataset factory](../src/operations/dataset.ts) accepts
source identity, reference date, timeline domain, stand and aircraft metadata,
chart records, flight records and unplaced stays. It copies those inputs,
checks identifiers and cross-references, and creates flight indexes whose
entries refer to the same mutable flight objects as the lists and editor.
Creating another dataset does not register visits or change the active board.

[The fixture builder](../src/stand-timeline-demo/fixtureDataset.ts) contains
the original sample projection, including its five waiting flights. Existing
chart and operations imports remain compatibility entry points into this
single dataset. Allocation, KPIs, agent stand validation, chart dates and Studio
aircraft metadata now read that dataset rather than importing fixture values.
The original records, sample editing rules and UTC presentation are unchanged.

The allocation baseline, filters, pending agent work, selections and review
state are session-scoped. Bootstrap loads and validates the selected dataset
before importing App. Compatibility consumers seal the source choice; general
replacement later throws. The narrowly scoped accommodation transition below
updates all compatibility records and allocation indexes together before
publishing a new workspace revision. Do not replace only the chart's dataset.

## Select or prepare an airport schedule

Open **Scenarios** in the planner toolbar, or Settings > Schedule source.
Choose an airport or the original editable fixture, a demand scenario, then
Baseline or Tow options. Both entry points share the same picker and confirmation.
Contoso offers Comfortable, Constrained and Full day; GTAA offers Full day.
The original fixture has one editable scenario and only its baseline.
The confirmation reloads the page, clearing stand changes, selections,
reviews, pending agent work and active calls. Appearance settings and saved
drawings remain. Selection is URL-backed, for example
`?source=contoso&scenario=constrained&plan=tow-options`, so reloads, bookmarks
and shared links retain all three choices. Older airport links without a
scenario still select Full day. Changing airports resets to that source's
default scenario and Baseline; changing scenarios retains the selected plan.
Draft changes and cancellation do not change the active board.
Invalid sources, scenarios, plans or corrupt snapshots show a startup error with explicit retry
and original-fixture recovery, never a silent airport fallback.

[The source registry](../src/data-sources/registry.ts) is the extension point.
Prepared plans preserve exact source IDs and scheduled UTC times, including
context flights outside the displayed window. Wholly unassigned paired visits
appear in the No stand lane with both original flights. Current full-day
snapshots contain 160 visits and 320 legs each: GTAA assigns all legs; Contoso
assigns 298 and leaves 11 paired visits visible without stands.

| Contoso scenario | Baseline assigned visits | Tow options assigned visits | Added tow movements |
|------------------|--------------------------|-----------------------------|---------------------|
| Comfortable      | 36 / 36                  | 36 / 36                     | 0                   |
| Constrained      | 40 / 41                  | 41 / 41                     | 2                   |
| Full day         | 149 / 160                | 149 / 160                   | 0                   |

Each Contoso scenario includes matching buffers, synthetic waiting, capacity,
Atlas, tow-window, accommodation and fixed-plan comparison evidence.
GTAA remains schedule-only; it does not inherit Contoso analysis assumptions.

Prepared sources disable dragging, stand mutations and agent proposals at both
UI and core boundaries. Their summary reports coverage, tow count and solver
status instead of fixture KPIs. Fixture notices, disruptions and analyses do
not run. The sample narrow/wide rules are not GTAA ASM compatibility rules;
unknown metadata is not labeled as narrowbody or unrestricted compatibility.

Build the native CLI once, then regenerate each compact snapshot explicitly:

```powershell
npm run build:solver
node scripts\prepare-schedule.mjs --airport data\airports\gtaa\airport.json --profile data\airports\gtaa\demand\scenario-profile.json --case full-day --tow-profile data\airports\gtaa\demand\tow-profile.json --output src\data-sources\prepared\gtaa\full-day.json
node scripts\prepare-schedule.mjs --airport data\airports\contoso\airport.json --profile data\airports\contoso\demand\full-day-profile.json --case full-day --tow-profile data\airports\contoso\demand\tow-profile.json --output src\data-sources\prepared\contoso\full-day.json
node scripts\prepare-schedule.mjs --airport data\airports\contoso\airport.json --profile data\airports\contoso\demand\scenario-profile.json --case comfortable --tow-profile data\airports\contoso\demand\tow-profile.json --output src\data-sources\prepared\contoso\comfortable.json
node scripts\prepare-schedule.mjs --airport data\airports\contoso\airport.json --profile data\airports\contoso\demand\scenario-profile.json --case constrained --tow-profile data\airports\contoso\demand\tow-profile.json --output src\data-sources\prepared\contoso\constrained.json
```

For Comfortable and Constrained, regenerate the evidence with the capacity,
Atlas, tow-window and accommodation commands below, substituting
`scenario-profile.json` for `full-day-profile.json` and the selected case for
`full-day` in `--case`, snapshot and output paths. Generate the schedule first,
capacity second and Atlas after capacity; tow-window and accommodation evidence
also require the matching schedule. Existing evaluation profiles support all
three cases. Never rename or reuse Full day evidence for another scenario.

Alternatively, `npm run prepare:schedule -- <explicit arguments>` builds first.
The preparation command overwrites its output and generates the browser-safe
standalone schema validator; AJV compilation stays in Node, not the browser.
Keep lazy JSON imports free of native JSON import attributes: Vite's development
server transforms JSON into JavaScript modules. The Node test resolver supplies
native JSON metadata separately. Verify schedule startup in development as well
as the production preview.
Runtime validation also checks source/case identity, flight endpoints,
complete assignments, tow chains, same-stand overlap and displayed counts.
Neither solver status nor independent stand-rule validation is operational
certification. No capacity, accommodation or tow-window evidence is inferred.

## Register isolated timeline features

The [overlay package](../src/overlays) owns feature availability, selection,
controls, chart annotations and evidence reviews. Keep calculations and
feature state out of [App](../src/App.tsx). Its integration is limited to
`TimelineOverlayProvider`, `OverlayToolbar`, `OverlayLayers` in the chart's
underlay and overlay slots, and `OverlayReviews`. Reattach those composition
points after a host UI merge instead of copying feature-specific UI logic.
Use the same isolated composition pattern for later prototype analyses.

The host retains its navigation history, shared panel widths, Chat, agent calls
and approval workflows. The planner stays mounted while another page is visible;
overlay selections survive navigation, but planner reviews, scenario pickers and
request confirmations close instead of floating over another page. Feature
dialogs use the host's window and child-portal layers below Settings.
Dataset initialization must precede importing the host and its context menu,
because their operations stores capture the selected dataset at module startup.
Prepared sources disable the host's stand context-menu actions and fixture-only
background disruption watcher as well as direct and agent-driven mutations.
Session accommodation is a reference-data replacement, not an operational stand
edit or approval request; it cancels pending agent work and ends active calls.

The overlay features include scheduled buffers, synthetic gate waiting,
single-turn capacity and one-way tow windows. Session-only late requests and
the read-only reference decision summary live separately in **Requests**.
Both workflows use source-owned profiles for the selected Contoso plan.
GTAA and the original fixture have no registered
profiles, so their toolbar is hidden. A labeled **Overlays** control beside
**Scenarios** appears when the active dataset has registered features; its
enabled count updates as chart layers are toggled. Availability comes from the active
dataset, not an airport-name condition or a global list of enabled features.
Overlays start off; toggles work independently. Inspect opens a feature's
review and options without enabling its annotations. Hide all clears toggles,
while options remain in the current session. A source, plan or profile change
resets feature selection and options together.

To add another feature:

1. Define its browser-safe data parser in
   [profiles](../src/overlays/profiles.ts) and register the parser by feature ID.
   Validate airport, dataset, profile and metric/model versions before rendering.
   Keep this boundary free of React and active-dataset module initialization.
2. Load source-owned profiles or evidence through the optional lazy loader in
   [the source registry](../src/data-sources/registry.ts). Bind the bundle to
   the exact dataset ID. Missing data means unavailable; malformed or mismatched
   data is an error. Never fill gaps using another airport's assumptions.
3. Add metadata to
   [the overlay registry](../src/overlays/registry.ts): ID, label and description.
   Duplicate IDs and data without a matching registration fail explicitly.
   Set `reviewOnly` for analyses without chart layers. They offer Inspect,
   not an enablement checkbox.
4. Implement a feature-local provider when options or shared state are needed,
   optional `Underlay` and `Overlay` presentations, and a required `Review`.
   Register them in
   [TimelineOverlays](../src/overlays/TimelineOverlays.tsx).
   No host changes are needed. Keep plot alignment, clipping, filter dimming,
   pinned rows and pointer-event behavior consistent with the existing layers.
5. Add pure calculation and availability regressions, then exercise the toolbar,
   options and chart in the browser. Confirm absence on unsupported sources
   and reset behavior across source/plan changes.

Buffer highlights are strictly shorter than the selected threshold, not equal
to it. Waiting uses an explicitly synthetic source assumption:
`probability * max(0, conditional release delay - scheduled buffer)`.
Unassigned, context and unassessed arrivals are separate populations.
No applicable handovers is not evidence of zero risk or zero delay.
Overlapping occupancies invalidate both analyses. Neither overlay changes
assignments, defines stand-safety rules or supplies operational certification.

Atlas frequency modes remain a later phase.
Prepared evidence must match airport, case, variant and request
fingerprint before registration. Regenerate evidence for the current plan;
do not attach stale prototype results or claim they remain current after edits.
Editable datasets cannot carry these prepared overlay profiles.

### Prepare and inspect single-turn capacity

The [capacity feature](../src/overlays/CapacityFeature.tsx) registers its provider,
bands and review inside the overlay package. It requires no additional host
composition. Select **Inspect Single-turn capacity** in the overlay menu to
choose an aircraft/operator/sector probe, duration and UTC search window.
Changing probes restores that probe's source-defined duration.

Bands show inclusive feasible arrival-start ranges for one additional turn,
not the entire empty occupancy interval. An exact-duration fit is a point.
The review compares the same query against baseline and tow-options plans,
but the chart draws only the selected source variant. Blocking assignment
IDs, rule reasons, rule paths and static exclusions remain visible in the
evidence tables. Invalid queries show an error and suppress bands; zero valid
ranges is not a finding of zero airport capacity. Existing unassigned demand
is not filled and no stand edits or movements are proposed.

Generate evidence against the current frozen schedule with explicit inputs:

```powershell
node scripts\prepare-capacity.mjs --airport data\airports\contoso\airport.json --profile data\airports\contoso\demand\full-day-profile.json --case full-day --snapshot src\data-sources\prepared\contoso\full-day.json --capacity-profile data\airports\contoso\evaluation\capacity-profile.json --output src\data-sources\prepared\contoso\full-day.capacity.json
```

`npm run prepare:capacity -- <explicit arguments>` invokes the same command.
It does not rerun the solver. It evaluates fixed assignments against the airport
compatibility rules and writes the sidecar plus its browser-safe standalone
schema validator. Inputs are required; there is no implicit airport fallback.

Regenerate capacity after regenerating the schedule. At startup, validation
checks airport, case, demand, horizon, SHA-256 of the entire frozen snapshot
and both plan request fingerprints. It also checks complete stand assessment,
assignment references and the exact complement between blocking intervals and
free windows. Prepared dataset identity and the selected request are checked
again at the dataset boundary. Missing or stale registered evidence is an
explicit startup error, not a hidden fallback to another plan.
Browser fingerprint verification requires HTTPS or localhost.

Run `npm run test:capacity` for preparation/rule replay regressions and
`npm test` for source-binding and UI-query calculation regressions.

### Prepare and inspect synthetic Atlas frequency

The [Atlas evaluator](../src/overlays/atlas.ts) and
[Atlas review](../src/overlays/CapacityAtlasReview.tsx) extend single-turn
capacity without another toolbar toggle or host composition change.
Contoso supplies a `capacity-atlas` entry in `overlays.companions`, separate
from feature registration profiles. Other sources retain current-plan
capacity without frequency modes unless they supply matching evidence.
Unknown or invalid companions fail validation; Atlas requires source-owned
capacity on an exact read-only prepared plan.

In **Inspect Single-turn capacity**, **Capacity view** defaults to **Current
plan**. The other views show synthetic planned-day frequency, modeled
end-of-day frequency or conditional retention. They split and color only
the current plan's inclusive feasible arrival-start ranges. They do not
display every opportunity occurring in the replays. Inspect a range and
exact UTC arrival start to see counts and individual replay outcomes.
Changing probe, duration or search window resets that inspection.
Changing mode or navigating to Studio preserves it.

Planned and modeled end-of-day rates divide fitting replays by all assessed
replays. Retention divides replays fitting both phases by replays fitting
the planned phase. Zero planned fits means **Not assessed**, not zero
retention, and uses a dashed band. A measured zero remains visible.
Whole occupancy must fit, including an exact final feasible start.
Independent opportunities are not additive or jointly allocatable.

Prepare the schedule first, capacity second, and Atlas third:

```powershell
node scripts\prepare-atlas.mjs --airport data\airports\contoso\airport.json --profile data\airports\contoso\demand\full-day-profile.json --case full-day --snapshot src\data-sources\prepared\contoso\full-day.json --capacity src\data-sources\prepared\contoso\full-day.capacity.json --atlas-profile data\airports\contoso\evaluation\capacity-atlas-profile.json --output src\data-sources\prepared\contoso\full-day.atlas.json
```

`npm run prepare:atlas -- <explicit arguments>` invokes the same command.
All inputs are explicit. Preparation reproduces authoritative capacity
before accepting its fingerprint, then replays fixed assignments without
solving, retiming the source or assigning existing unassigned demand.
The [version 2 schema](../data/schemas/capacity-atlas.schema.json) records
the exact capacity hash, source/airport/demand hashes, horizon and both
request fingerprints. Startup verifies these bindings and complete
probe/stand assessments for every replay and phase.

Contoso uses 30 deterministic timing experiments on one reference day.
Replay dates are labels and seeds, not operational history. Planned
uniform shift/scale transforms are followed by modeled outcome
shift/scale transforms; absolute timestamps remain relative to the
reference UTC horizon, not the label dates. These are not actual
end-of-day observations, a monthly demand model, calibrated probabilities,
weather or staffing forecasts, or proof of sustainable airport capacity.
Profiles, seeds and parameter ranges are disclosed in the review.
The decision summary continues to report current reference-plan evidence,
independently of the selected frequency mode.

Run `npm run test:atlas` for deterministic preparation and authoritative
rule replays; `npm test` covers source bindings, exact-time segmentation,
per-day membership, conditional denominators and inspection validation.

### Prepare and inspect one-way tow windows

The [tow-window feature](../src/overlays/TowWindowFeature.tsx) registers its own
provider, annotations and review without changes to the host application.
Select **Inspect One-way tow windows**, choose a visit, and optionally show
only that visit's annotations. Inspecting does not enable the overlay.

Hatched bands inside assigned stays show inclusive possible tow-start times,
not scheduled movements or movement durations. A point is an exact fit.
Each opportunity moves from the current stand to a compatible departure
stand, which must remain available from tow arrival through departure.
Arrival handling, departure handling and one configured tow travel time
bound the range. Fixed assignments and bidirectional adjacency conflicts
can delay its start or exclude a destination. The review retains assignment
IDs, release times, rule paths and static exclusion reasons.

Only complete, single assigned stays are assessed. Unassigned visits,
incomplete boundaries, existing movement chains, insufficient handling/travel
time and no compatible available destination have distinct statuses.
Known context times are retained; unknown boundaries are not invented.
Display ranges are clipped to the half-open horizon, skip pinned No stand
rows, dim with filters and do not intercept allocation selection.

Generate against the current frozen schedule with explicit inputs:

```powershell
node scripts\prepare-tow-windows.mjs --airport data\airports\contoso\airport.json --profile data\airports\contoso\demand\full-day-profile.json --case full-day --snapshot src\data-sources\prepared\contoso\full-day.json --output src\data-sources\prepared\contoso\full-day.tow-windows.json
```

The command uses the selected airport's operating-policy handling minima
and default one-way travel time, not the solver's optional tow-selection
profile. It replays stand rules against the fixed plan; it neither runs the
solver nor applies movements. No implicit airport or case is selected.
It writes a sidecar and standalone browser schema validator.
`npm run test:tow-windows` checks preparation and independent full-plan replay;
`npm test` checks source binding, statuses and display ranges.

Evidence version 3.0.0 adds explicit case, demand, horizon, both request
fingerprints and destination-blocking evidence to the prototype's version 2
contract. Regenerate rather than attaching old prototype files.
Startup verifies the full snapshot SHA-256, both requests, exact flight and
stay links, handling/travel bounds, destination coverage and blocking references.
The selected dataset is checked again before registration.
Contoso's capacity and tow sidecars must also agree on airport and demand
fingerprints. Regenerate both after changing airport rules or demand, and all
sidecars after regenerating a schedule. GTAA remains unavailable until its own
evidence is prepared and registered; Contoso assumptions never fill its gaps.

These are independent opportunities, not a jointly feasible movement plan,
added flights or operational authorization. Parking-and-return cycles,
adjustments to existing chains, tow routes, crews, tugs and shared-gate
resources are not assessed. Ordinary turn handling rules and flight times
are unchanged.

### Prepare and inspect late-request accommodation

Open **Requests**, then **Late request**. The incoming turn card shows both
flight numbers, origin/destination, UTC dates and times, and turn duration.
Select an option to see the explicit sequence: reassign an existing whole
turn if needed, then assign the new turn to the released stand. A direct fit
requires no reassignment.

The contextual chart places the affected stands together on one time scale,
with **Reference** and **With option** rows and at least one hour before and after
the affected turns. All supplied occupancy intersecting that window remains
visible. The gap table gives exact neighboring turn times and scheduled gaps;
missing neighbors are unknown, not unlimited availability. A tight gap is
strictly below the source buffer threshold, not an operational separation rule.
Selecting or clearing an option does not change the board. Closing the dialog
preserves selection; source or plan changes reset it. Additional consequence
metrics, waiting assumptions and provenance are collapsed below the decision.

After reviewing an alternative and its source-owned waiting assumption, choose
**Apply option**, acknowledge the rehearsal's limits, then confirm. The
chart, flight lists, filters, agent context and Studio use one amended session
workspace. The applied option and assumption remain visible in this review.
**Replace applied option** always rebuilds from the original approved reference;
it never accumulates incoming requests or previous reassignments.
**Undo accommodation**, also available directly in the planner toolbar,
reinstates the exact original dataset after confirmation.

Accept, replace and restore clear selections, filters, reviews and agent outputs
and cancel pending typed work and active calls. Appearance settings, saved
drawings and drawing drafts are retained. Nothing is written to a backend.
Reloading or changing airport, scenario or plan discards the session choice.
This is a synthetic rehearsal, not operational approval.

Generate evidence against an already prepared schedule, without running a solver:

```powershell
node scripts\prepare-accommodation.mjs --airport data\airports\contoso\airport.json --profile data\airports\contoso\demand\full-day-profile.json --case full-day --snapshot src\data-sources\prepared\contoso\full-day.json --capacity-profile data\airports\contoso\evaluation\capacity-profile.json --accommodation-profile data\airports\contoso\evaluation\accommodation-profile.json --output src\data-sources\prepared\contoso\full-day.accommodation.json
npm run test:accommodation
```

The [generator](../scripts/accommodation.mjs) searches direct fits first.
Only when none exist does it search one complete existing turn reassigned
to another compatible stand before arrival. Every independent alternative
passes the full rule evaluator, including bidirectional adjacency. Existing
flight times and unassigned demand are unchanged. Existing tow chains and
boundary-context stays are protected. A whole-turn reassignment is not an
added tow. No acceptable option within this bounded search is not proof of
infeasibility.

Evidence version 2.0.0 binds the exact snapshot, airport, scenario, demand,
horizon, both plan request fingerprints and source-owned capacity probe.
Regenerate prototype version 1 evidence. Startup rejects stale or mismatched
data, inconsistent alternatives and invalid source references. The synthetic
approval and receipt timestamps are story assumptions, not an actual audit.
The preparation command also regenerates the standalone browser validator.

The [feature](../src/requests/AccommodationFeature.tsx) uses isolated
[comparison previews](../src/overlays/accommodation.ts). Explicit acceptance
builds a complete validated operations dataset, retaining every original visit,
unassigned stay, flight time and tow chain and adding exactly one new service.
The [session state](../src/overlays/accommodationSession.ts) retains the original
reference separately. The amended dataset carries no prepared-plan
certification, offline evidence or companions. Only the source buffer and
waiting configurations are rebound to the amended dataset; waiting defaults
to the explicitly accepted assumption.

While accommodation is active, buffers and synthetic waiting recalculate from
the amended occupancies and flights. Their toggles and settings remain usable
in **Overlays**; there is no pause to release. Capacity/Atlas and tow-window
controls are unavailable until their offline analyses are regenerated.
**Requests** retains the original reference for option comparisons and
**Reference analysis**, explicitly labeled as such. Undo restores the original
overlay controls, initially disabled.

Consequence metrics use only the source's buffer threshold and selected
synthetic waiting assumption. Tight buffers are strictly below the threshold.
Waiting comparisons use the same existing assessed arrivals in both views,
with incoming waiting reported separately. Assessed and unassessed counts
remain visible; unavailable profiles or missing predecessors are not zero
delay. Alternatives are paginated in deterministic order, not ranked.
These comparisons do not certify financial, passenger or operational outcomes.

### Inspect the read-only decision summary

Open **Requests**, then **Reference analysis**. It brings assignment coverage,
scheduled buffers, synthetic waiting, single-turn capacity and one-way tow
opportunities into one review for the selected reference plan.
When the source supplies both fixed plans, it also compares baseline and
tow options without switching the active board.
The [pure summary](../src/overlays/decisionSummary.ts) reuses the validated
source profiles and calculations; it does not generate another solver result
or require a duplicate summary sidecar.

The source opts in with a
[decision-review profile](../data/airports/contoso/evaluation/decision-review-profile.json),
validated against the
[registration contract](../data/schemas/decision-review-profile.schema.json)
and the exact read-only dataset envelope. Missing companion profiles are
shown as unavailable, not zero. Malformed, stale or mismatched evidence fails
explicitly. Available sidecars must share snapshot, airport, demand and both
plan request fingerprints.

Coverage includes all source records, with context flight legs identified
separately. Waiting uses an explicitly selected source assumption. Capacity
shows each probe's default duration and separation across the full horizon;
it does not copy query controls or chart filters. Tow status populations
remain separate from destination choices. Neither capacity bands nor tow
choices are additive, scheduled or jointly feasible opportunities.

The [review component](../src/overlays/DecisionSummaryFeature.tsx) shares
accommodation selection and its waiting assumption with Late-request
accommodation. Switching between those reviews preserves the same preview.
The scheduled-buffer and gate-wait chart controls remain independent.
The summary offers a separate hypothetical comparison with coverage changes,
common-existing-arrival waiting, incoming waiting, affected stands and exact
UTC flight times. Both reviews reuse the same
[consequence table](../src/overlays/AccommodationMeasures.tsx).

Capacity and tow evidence remain reference-only and are never attached to
the accommodation comparison. Selecting or clearing a preview leaves chart
allocations, flight times and existing unassigned demand unchanged. Closing
the review or navigating to Studio preserves session state; a source, plan
or profile change resets it. Acceptance, replacement and restore require
confirmation in Late-request accommodation, not in this summary. Retiming,
financial ranking and an overall resilience score remain unavailable.

### Compare baseline and tow options without applying either plan

The [plan comparison](../src/overlays/PlanComparisonReview.tsx) appears inside
Decision summary. The selected source plan is the active reference; the
other variant is comparison-only. No second toolbar toggle, plan activation
or acceptance action is added. Switching the source plan reverses the
comparison direction after the normal reload.

The table compares assigned/unassigned visits and flight legs, context
flight legs, and generated tow movements. It identifies retained visits,
newly assigned existing demand, lost assignments and changed retained
visits. Changed-assignment details show every stand interval, tow endpoint
and exact source UTC flight time. Cosmetic stay IDs and request hashes do
not count as assignment changes. Both plans share one source flight
schedule, so no additional demand or retiming is introduced.

Buffers use the same source threshold in both plans. Synthetic waiting
uses the summary's shared assumption, also used by accommodation review.
Only arrivals assessed in both plans contribute to the waiting comparison;
empty populations and absent profiles remain unassessed, not zero.
Missing or gained assignments therefore cannot create a misleading waiting
improvement by changing the assessed population.

Sources opt in with `overlays.companions["plan-comparison"]`, alongside the
existing decision-review profile. The
[source helper](../src/data-sources/planComparison.ts) prepares this
versioned in-memory envelope from the already-loaded schedule, with its
SHA-256 fingerprint and both complete variants. No extra generated sidecar
or source-specific UI branch is needed. Both variants pass the shared
prepared adapter; validation checks the active board's exact records,
airport, case, demand, horizon, selected request and all available
analysis snapshot/request bindings. Use `preparePlanComparison(snapshot)`
during asynchronous source bootstrap rather than constructing an unchecked
envelope. A source without this companion keeps its existing summary and
explicitly reports plan comparison as unassessed.

The current Contoso full-day variants have identical assignments:
149 assigned visits, 11 unassigned visits, 298 assigned flight legs and
zero generated tow movements each. The review reports no assignment
differences rather than manufacturing a benefit from enabling tow options.
Comfortable also has no assignment differences. Constrained demonstrates
the coverage gain from 40 to 41 visits and its two complete tow movements,
including the reverse comparison when Tow options is the active plan.
Tests also exercise gained/lost assignments, multiple tow legs, reverse
comparisons, context flights, shared assumptions and malformed evidence.

Reference capacity, Atlas and tow-window controls remain independent.
Accommodation remains a separate hypothetical preview; selecting it does
not replace either fixed plan in this comparison. Stand-rule validation
does not establish operational readiness, available crews, tug routes,
passenger handling or a preferred plan.

## Validate the imported foundation

Use the existing Node dependencies and a .NET 10 SDK:

```powershell
npm run test:planning
npm run test:solver
npm run build
```

`test:planning` builds the CLI once and combines the headless airport, catalog,
demand, linking, occupancy, tow, assignment and scenario regressions. It
includes the native GTAA full-day coverage check. `test:solver` runs all five
native solver test projects through the component-scoped solution.
Main's application tests remain separate under `npm test`.
On Node 22.16, run them with type stripping enabled in the current PowerShell
process; no persistent environment or main test-runner change is required:

```powershell
$env:NODE_OPTIONS = ($env:NODE_OPTIONS + ' --experimental-strip-types').Trim()
npm test
```

The component's own build and central package files apply only beneath
`components/Planning.Solver`; the migration does not introduce global .NET
settings or overwrite main's dependencies and scripts. Other copied component
families, prototype analysis tests and analysis-specific preparation commands
remain on `feature/solver` until their own integration work.
