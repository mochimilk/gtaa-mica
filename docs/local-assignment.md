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
before importing App. Compatibility consumers seal that choice; replacing it
later throws. Do not pass a different dataset only to the chart.

## Select or prepare an airport schedule

Open Settings > Schedule source to choose the original editable fixture,
Contoso or GTAA, with baseline and tow-options plans for each airport.
The confirmation reloads the page, clearing stand changes, selections,
reviews, pending agent work and active calls. Appearance settings and saved
drawings remain. Selection is URL-backed, for example
`?source=gtaa&plan=baseline`, so reloads, bookmarks and shared links retain it.
Invalid sources or corrupt snapshots show a startup error with explicit retry
and original-fixture recovery, never a silent airport fallback.

[The source registry](../src/data-sources/registry.ts) is the extension point.
Prepared plans preserve exact source IDs and scheduled UTC times, including
context flights outside the displayed window. Wholly unassigned paired visits
appear in the No stand lane with both original flights. Current full-day
snapshots contain 160 visits and 320 legs each: GTAA assigns all legs; Contoso
assigns 298 and leaves 11 paired visits visible without stands.

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
```

Alternatively, `npm run prepare:schedule -- <explicit arguments>` builds first.
The preparation command overwrites its output and generates the browser-safe
standalone schema validator; AJV compilation stays in Node, not the browser.
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

The first migration phase includes scheduled buffers and synthetic gate
waiting for both Contoso plans. GTAA and the original fixture have no registered
profiles, so their toolbar is hidden. Availability comes from the active
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

Capacity/atlas, accommodation, decision review and tow windows remain later
phases. Their prepared evidence must match airport, case, variant and request
fingerprint before registration. Regenerate evidence for the current plan;
do not attach stale prototype results or claim they remain current after edits.
Editable datasets cannot carry these prepared overlay profiles.

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
