---
title: Planning solver staging component
description: Domain-neutral solver contracts and a synthetic end-to-end vertical slice
---

## Status

This staging component proves a domain-neutral solver slice without referencing
GateFabric projects, Azure resources, Microsoft Foundry, databases, or queues.
Airport semantics remain isolated in a separate adapter.

Two strategies now exercise the same contracts. The deterministic greedy
strategy provides a transparent baseline. The OR-Tools strategy provides exact
CP-SAT optimization for the currently supported objective and rule set.

## Included

- Canonical subjects, segments, resources, commitments, and time windows
- Profile validation, executable compatibility checks, and stable fingerprints
- Frozen run manifests with component versions, horizon, cutoff, search controls,
  metric-input identity, feature flags, and optional parent-plan identity
- Deterministic SHA-256 fingerprints for problems, manifests, candidates, plans,
  validation evidence, and scores
- Versioned rule packages with typed candidate and complete-plan rules
- Typed candidate outcomes: passed, violated, unverifiable, and not applicable
- Rule descriptors covering classification, evaluation phase, solver
  representation, authority, and evidence
- Configured cross-resource conflicts with optional effective windows
- Eligible and rejected candidate alternatives with rule traces
- Pluggable optimization strategy contract
- Strategy capability declarations for metrics, objective composition, rule
  identities, versions, representations, and time limits
- Deterministic greedy first-slice strategy
- Isolated Google OR-Tools CP-SAT strategy
- Exact decimal-to-integer objective scaling without rounded coefficients
- Deterministic single-worker CP-SAT search with optional time limits and
  cancellation
- Transport-neutral idempotent job orchestration
- Separate worker execution, solver status, plan disposition, validation,
  acceptance, and publication evidence
- Atomic job-store and accepted-result publisher ports
- In-memory job store, publisher, channel transport, and local worker
- Independent complete-plan validation
- Versioned metric calculators, frozen input datasets, raw values, weighted
  contributions, and profile acceptance
- Explicit observed, predicted, and derived metric classifications
- Explicit exact, proxy, and scoring-only optimization classifications
- Configurable fail-run or unavailable-and-reject behavior for missing metric
  inputs
- Synthetic fixtures covering the full vertical slice
- An airport adapter that maps visits, stands, stand capabilities, and protected
  occupancy into canonical contracts
- Airport equivalence tests that compare direct canonical and adapter-generated
  artifacts through scoring
- An airport-owned virtual-capacity calculator with frozen stand, terminal,
  sector, slot-duration, and peak-window configuration
- Typed virtual slot placements plus terminal, sector, and peak aggregates
- An exact stand-aircraft model matrix shared by candidate filtering and
  demand-specific capacity evidence
- A domain-neutral bounded residual matcher with adapter-provided alternatives
- Airport matching evidence that proves how many unassigned visits can use
  preserved capacity simultaneously

## Run and artifact lineage

The pipeline freezes one manifest before candidate generation. Every subsequent
artifact records the manifest fingerprint, its immediate input fingerprint, and
its own content fingerprint:

```text
run manifest
  -> candidate batch
  -> optimization result
  -> validation result
  -> score
```

Each stage recalculates the fingerprints it consumes and fails explicitly when
content, component versions, profile, rules, or problem inputs no longer match.
Collection order does not change a canonical problem fingerprint; a material
field change does.

## Metric inputs and calculation

Metric calculation is registry-driven rather than embedded in the pipeline. A
metric definition binds its stable ID and version to its unit, direction, value
kind, optimization kind, and required datasets. The registry resolves the exact
calculator selected by the compiled profile.

Each external dataset carries:

- A stable dataset ID and version
- An observed, predicted, or derived value kind
- A knowledge cutoff
- A source description
- A deterministic content fingerprint

`MetricInputSet` validates each descriptor against the dataset content, rejects
duplicate IDs, sorts datasets canonically, and fingerprints the complete set.
The run manifest and orchestration request fingerprint include that set
fingerprint. Every scoring pass verifies the frozen content again and records
the descriptors actually used by each metric.

Profiles choose one of two missing-input policies. `FailRun` stops scoring with
an explicit error. `MarkUnavailableAndReject` preserves an unavailable metric
result with the reason and rejects plan acceptance. Neither policy substitutes a
default value or presents missing evidence as a valid score.

Optimization semantics are separate from evidence semantics. An exact metric
uses the same formula during search and final scoring. A proxy metric documents
that search uses an approximation while final scoring recalculates the selected
plan. A scoring-only metric produces review evidence without claiming that the
strategy optimized it.

Assignment coverage and resource cost remain domain-neutral derived metrics
that require no external dataset. Airport virtual capacity and predicted
gate-hold are intentionally not implemented in the core. Airport virtual
capacity is supplied by the airport adapter. Predicted gate hold remains a
future adapter and must provide frozen model inputs through this contract.

## Residual assignment matching

`Planning.Solver.Core` owns deterministic bounded matching for fixed-window
residual demand. An adapter supplies canonical alternatives after applying
domain-specific scope, such as airport sector alignment. The core then:

- Verifies subject, resource, alternative, and fixed-plan identities
- Evaluates every normalized candidate rule against each supplied alternative
- Prevents same-resource overlap and configured cross-resource conflicts
- Evaluates every complete-plan rule at complete search leaves
- Maximizes the number of simultaneously assigned residual subjects
- Returns explicit optimal, search-limit, or invalid-existing-plan evidence

This split keeps search mechanics reusable. A manufacturing adapter can map
jobs and machines into the same contract without referencing visits, stands,
aircraft models, sectors, or terminals. The airport adapter remains responsible
for producing sector-appropriate alternatives and presenting the generic
result in airport terms.

The matcher does not invent alternatives or reinterpret domain rules. Adapter
data and normalized rule packages remain frozen run inputs. A search-limit
result contains diagnostic incumbent evidence but does not prove optimality.

## Airport virtual capacity

`AirportVirtualCapacityInput` replaces the PoC's plan-derived dominant-sector
and hard-coded fleet-mix assumptions with explicit configuration. Each stand
has exactly one mutually exclusive terminal, sector, and slot-duration profile.
Peak windows are date-specific intervals on the normalized UTC timeline. The
dataset descriptor records its source, knowledge cutoff, semantic version, and
content fingerprint.

Version 1.0.0 uses these calculation rules:

- Count only gaps between consecutive assignments on the same stand
- Ignore the boundary before the first assignment and after the last assignment
- Pack fixed-duration slots from the preceding assignment's end
- Classify a slot as peak when its start is inside a matching terminal-sector
  peak window
- Suppress a slot when protected occupancy blocks the stand
- Suppress a slot when an assignment or protected occupancy on a resource
  conflicts through a normalized resource-conflict rule
- Report each slot and mutually exclusive terminal-sector-peak summaries

The raw metric is the total slot count. Generic metric breakdowns preserve the
stand, terminal, sector, peak classification, interval, and slot duration for
review and future timeline rendering.

The metric is scoring-only. Profiles must give it zero objective weight, and
strategies do not claim to optimize it. This distinction prevents a displayed
capacity score from being presented as an optimization objective before a
strategy implements matching semantics.

This first adapter does not:

- Count planning-horizon boundary gaps
- Infer or convert airport-local timezones
- Model aircraft compatibility classes
- Treat a stand as capacity for multiple sectors
- Claim that every virtual slot can accept remaining demand
- Replace governed airport reference data

### Compatibility-aware virtual capacity v2

Version 2.0.0 adds authoritative aircraft-class membership to each stand
capacity profile. It reuses the same physical-slot engine, including protected
occupancy, cross-resource conflicts, terminal, sector, and peak classification.

The raw metric remains the number of physical slots. A flexible slot compatible
with three aircraft classes contributes one physical slot, not three.
Compatibility evidence is a non-additive view over that physical inventory:

- Each slot records its sorted compatible aircraft-class IDs
- Class summaries retain terminal, sector, and peak dimensions
- Compatible-slot and shared-slot counts are labeled non-additive
- Exclusive-slot counts are additive because one exclusive slot belongs to one
  class
- Callers can filter typed slots for one aircraft class without recalculating
  the plan

The dataset fingerprint includes every stand-to-class mapping. Changing class
membership therefore changes the frozen metric input, run manifest, score
lineage, and orchestration request identity.

Version 2.0.0 does not classify each planning subject by aircraft class or prove
that a preserved slot matches an unassigned visit's exact timing and operational
requirements. That demand-specific query requires a separately frozen visit
classification and compatibility contract. Class summary totals must not be
summed to claim total capacity.

### Exact-model virtual capacity v3

Version 3.0.0 makes the stand-aircraft model matrix authoritative for fit. The
same frozen matrix is used by:

- A hard candidate-filter rule that evaluates every subject-resource pair
- Final virtual-capacity scoring and unassigned-visit fit evidence

Each visit has an exact aircraft model code and directional sector. Each
stand-model row has one effective outcome: allowed, denied, or unverifiable.
Missing visit models, stands without matrix evidence, and unresolved exact
rows fail closed. Once a stand has authoritative evidence, an unlisted model is
denied by the closed allowlist.

The metric input and candidate rule carry separate fingerprints:

- The eligibility fingerprint contains stand-model outcomes and visit-model
  identities
- The complete metric fingerprint also contains sector and optional aircraft
  class reporting metadata

This separation means changing an aircraft class rollup changes reporting
lineage but does not change candidate eligibility. Aircraft class never
authorizes a stand fit.

For every unassigned visit, v3 reports whether an exact-model-compatible stand
is available for the visit's complete required window. The check includes:

- Exact aircraft model allowlist outcome
- Directional sector
- Canonical required resource capabilities
- Selected assignments on the same stand
- Protected occupancy
- Normalized cross-resource conflict rules

Available-stand lists are demand-specific, non-additive evidence. Several
unassigned visits may identify the same stand and window, so these results do
not prove that all remaining demand can be assigned simultaneously.

### Globally matched virtual capacity v4

Version 4.0.0 retains the physical-slot raw value from v3 and adds an exact,
bounded matching proof for unassigned visits. The airport adapter creates
directional-sector alternatives and delegates search to the core residual
matcher. Together they evaluate every configured candidate rule, selected
assignment, protected commitment, same-resource overlap, cross-resource
conflict, and complete-plan rule. Several visits cannot claim the same stand
interval.

Search is deterministic:

- Order visits by eligible-candidate count and then visit ID
- Order stands by resource ID
- Explore placement branches before the unmatched branch
- Preserve the first maximum solution under that ordering
- Prune a branch only when its remaining visits cannot improve the incumbent

`AirportCapacityMatchingInput` freezes the maximum search-node count and adds
that policy to metric and run lineage. Matching evidence reports:

- `Optimal` when exhaustive search proves the maximum simultaneous placement
- `SearchLimitReached` when the node bound prevents proof
- `ExistingPlanInvalid` when fixed selected assignments violate candidate or
  complete-plan rules
- Matched assignments, unmatched visit IDs, explored nodes, and whether every
  visit was matched

The scoring calculator fails explicitly when the search limit is reached.
Callers may use the typed detailed result for diagnostics, but they must not
present its partial incumbent as an optimum. An invalid existing plan remains
visible as matching evidence and must still fail independent plan validation.

The v4 matcher is exact for the fixed-window canonical assignment model. It
does not move visit times, create boundary slots, infer local timezones, or
replace airport-governed model, sector, capability, and conflict data.

## Profile and rule compatibility

Profile compilation is the fail-closed boundary between authored intent and a
solver run. A profile selects a rule package, objective composition, metrics,
search controls, trace policy, and acceptance policy. Compilation rejects the
profile before candidate generation when the selected strategy cannot support:

- An objective metric or composition mode
- A requested search time limit
- A hard or operational rule representation that must be enforced during search
- The selected normalized rule package

Normalized rule descriptors preserve the authority and evidence behind each
rule. Their classifications distinguish hard constraints, operational policies,
preferences, model assumptions, and data-quality guards. Their evaluation
phases distinguish candidate checks from complete-plan checks. Their solver
representations distinguish candidate filters, pairwise conflicts, global
constraints, and validation-only rules.

Candidate eligibility is derived from both classification and outcome. Violated
or unverifiable hard rules, operational policies, and data-quality guards block
selection. A not-applicable result does not block selection. Preferences and
model assumptions remain evidence but do not silently become hard constraints.
Candidate filters execute in the shared generator, so adding a new normalized
candidate filter does not require strategy-specific encoding.

The resource-conflict rule carries frozen, fingerprinted pairs of resources that
cannot host overlapping assignments. Each pair may have an optional effective
window. The airport adapter maps stand conflicts into this domain-neutral rule.
Greedy and CP-SAT consume the same rule configuration, and the independent
validator evaluates the selected complete plan against it. Missing configured
resources produce unverifiable findings rather than being ignored.

Both strategies currently support weighted-sum objectives, assignment coverage,
resource cost, candidate filters, resource non-overlap, and configured resource
conflicts. A strategy must declare the exact complete-plan rule ID, rule version,
and solver representation it enforces. A generic pairwise-conflict declaration
is not sufficient.

The deterministic strategy does not advertise time limits. CP-SAT accepts an
optional positive wall-clock limit, uses the frozen random seed, and runs with
one search worker for reproducibility. Neither strategy advertises
lexicographic objectives, global constraints, or validation-only enforcement.
Focused tests prove that unsupported requests fail during profile compilation.

CP-SAT reports `Optimal`, `Feasible`, `Infeasible`, or `Unknown` separately from
independent validation and acceptance. It never converts an unavailable solver
result into a success-shaped fallback plan.

## Orchestration and worker outcomes

`Planning.Solver.Orchestration` coordinates the pure stages without depending on
a queue, database, cloud SDK, or concrete strategy implementation. An immutable
job request contains the canonical problem, normalized rules, authored profile,
run identity, candidate-batch identity, optional frozen metric inputs, optional
feature flags, and optional parent-plan fingerprint.

Request fingerprints provide idempotency. Repeating the same request under the
same key returns the existing job record without solving or publishing again.
Reusing a key for changed content fails explicitly.

The job record keeps these outcomes separate:

- Worker lifecycle: queued, running, succeeded, failed, or cancelled
- Solver status: optimal, feasible, infeasible, or unknown
- Plan disposition: accepted, rejected, no feasible solution, or not evaluated
- Publication status: not requested, published, or failed
- Structured failure phase, exception type, error code, and retryability

Only optimal or feasible results proceed to independent validation and scoring.
Only plans that pass validation and profile acceptance are sent to the result
publisher. An infeasible or unknown solve can therefore represent a successfully
executed worker job, but it is never represented or published as a successful
plan.

`Planning.Solver.Worker.Local` supplies an in-memory implementation for local
proof. Its channel is a transport adapter, not part of solver semantics. A
future Service Bus, database, or hosted-worker adapter should implement the same
job-store and publisher contracts without changing the coordinator.

## Project boundaries

- `Planning.Solver.Core` contains canonical contracts, candidate generation,
  profiles, validation, scoring, manifests, deterministic optimization, and
  bounded residual matching. It has no solver-library or cloud dependency.
- `Planning.Solver.OrTools` references the core and contains the native-backed
  CP-SAT strategy. It has no airport or infrastructure dependency.
- `Planning.Solver.Airport` references only the core and adapts airport data and
  rules into canonical inputs.
- `Planning.Solver.Orchestration` references only the core and coordinates
  strategy resolution, compilation, solving, validation, scoring, and accepted
  result publication.
- `Planning.Solver.Worker.Local` references orchestration and supplies the
  in-memory job store, publisher, channel, and worker loop.
- The airport tests reference both adapters to prove that CP-SAT produces
  equivalent artifacts from direct canonical and airport-adapted fixtures.

## Explicitly excluded

- Airport, flight, stand, terminal, sector, and tow semantics
- Current GateFabric database schemas and repositories
- Azure, Microsoft Foundry, MCP, identity, queue, and telemetry integrations
- Durable or distributed worker transport, persistence, leases, retries, and
  publication
- Airport expected-gate-hold formulas, prediction models, or datasets
- Claims of optimality beyond the explicit strategy or bounded-matcher status

## Run locally

```powershell
dotnet test .\components\Planning.Solver\tests\Planning.Solver.Core.Tests\Planning.Solver.Core.Tests.csproj
dotnet test .\components\Planning.Solver\tests\Planning.Solver.OrTools.Tests\Planning.Solver.OrTools.Tests.csproj
dotnet test .\components\Planning.Solver\tests\Planning.Solver.Airport.Tests\Planning.Solver.Airport.Tests.csproj
dotnet test .\components\Planning.Solver\tests\Planning.Solver.Orchestration.Tests\Planning.Solver.Orchestration.Tests.csproj
dotnet test .\components\Planning.Solver\tests\Planning.Solver.Worker.Local.Tests\Planning.Solver.Worker.Local.Tests.csproj
```

No cloud credentials or network resources are required.

Google OR-Tools includes platform-specific native binaries. Linux deployment
images need the native runtime dependencies required by the selected OR-Tools
package, including `libgomp1` for the current package.

## Next boundary

The reusable solver boundary is complete for the current extraction goal.
Expected gate hold remains a future predicted metric and must carry explicit
model and delay-dataset versions. Durable transport and persistence remain
separate adapters. The next componentization work should move to the planning
application service and its HTTP, MCP, and chat boundaries.
