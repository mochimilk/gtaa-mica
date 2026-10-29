---
title: Capacity pressure and selective tow preparation
description: Inspect eligible stand pools, detect overlapping demand shortages and select cost-aware tow timing proposals while preserving the baseline.
ms.date: 2026-10-21
---

## Keep the baseline and Gantt separate

[Tow preparation](../scripts/tow-preparation.mjs) is a local diagnostic stage:

```text
Raw legs -> baseline occupancy -> stand candidates -> pressure -> ranked tow proposals
```

The output embeds the unchanged [baseline occupancy](occupancy-segments.md).
Selected alternatives form a separate set of proposed assignment demands.
Neither raw demand nor supplied movements are rewritten. The current Gantt
and its fixture are unchanged. Generated plans must not replace that source
until an explicit data-source selector is available.

This stage does not run the assignment solver. Every selection has status
`provisional-review`, and `solver_ready` is always `false`.

## Inspect candidate stands

The [stand-pressure model](../scripts/stand-pressure.mjs) uses the existing
[rule evaluator](../scripts/airport-model.mjs), not a second aircraft/sector
eligibility implementation. It checks:

* Configured stand readiness and closure
* Aircraft model membership in allowed aircraft groups
* Each present flight's sector and operating airline
* All known operating airlines on parking demand
* Pinned stand constraints from supplied ground movements
* The profile's parking stand kind for generated alternatives

Every demand lists `candidate_stand_ids` and excluded stands with reason codes.
An uninterrupted connected stay must satisfy both flight scopes on one stand.
After a proposed split, arrival and departure service check only their own
flight scopes. Parking has no flight-sector scope and conservatively requires
authorization for both source operators when they differ.

Service demand may use any stand permitted by the authored rules, including a
remote stand with the necessary permissions. Contact preference is not silently
turned into a hard eligibility rule. Generated parking defaults to non-contact
stands, but the profile can allow `any` stand.

The reference evaluator accepts optional `operatingAirlineIds` on fixed
occupancies, including parking. The preparation adapter always provides known
source operators. Legacy callers omitting that field retain their prior
behavior; no operator is inferred from registration.

## Find shared-pool pressure

Counts alone can hide shortages. Three simultaneous occupancies can each have
two eligible stands yet compete for the same two stands.

The analysis splits the plan at known occupancy start/end events. Within each
half-open interval it computes maximum-cardinality bipartite matching between
active demands and eligible stands. Augmenting paths avoid an arbitrary greedy
assignment that strands a constrained demand.

Demand ordering uses smallest candidate count first, then longer duration and
stable ID. Stand exploration favors choices shared by fewer active demands.
These orderings make diagnostics deterministic; they do not replace matching.

For each deficient slice, the report records:

* Active demands and matched count
* Shortfall and unmatched demands in the diagnostic matching
* The shared deficient demand/stand pool, found through alternating paths
* Exact UTC start and end

An unmatched ID is a witness from one matching, not a decision to cancel that
flight. `total_shortfall_ms` integrates shortfall count times elapsed duration.
`shortfall_minutes` expresses the same diagnostic in occupancy-minutes, not
the number of flights that a complete solver will leave unassigned.

### Partial timing is not a complete capacity picture

Fixed segments retain their full source times. Flexible single-leg segments
contribute only their minimum required service interval:

* Arrival on-block through earliest allowable tow-out
* Latest allowable tow-in through departure off-block

Those rows have `timing_basis: "minimum-service"`. They are not new tow times or
trimmed baseline occupancies. Unknown parking boundaries remain unknown, and
their segments appear in `excluded_segment_ids`. Blocked source legs remain in
the baseline and findings; they do not become ordinary demand rows.

Pressure measurements clip known intervals to the plan window without changing
their stored boundaries. Open parking is never extended to display boundaries.

### Deliberate relaxation

The analysis does not enforce occupancy-dependent neighboring-stand rules,
shared gates, tow resources or routes. Independent matching in successive
slices also permits a demand's diagnostic match to change stands without a
movement. Consequently, zero relaxed shortfall is not proof of feasibility,
and positive relief is an estimate under this model.

The output repeats these limitations. Complete assignment validation is still
required, particularly for Contoso's mutually dependent contact/remote stands.

## Generate one capacity-oriented timing pattern

An eligible connected visit without supplied movements can produce one optional
pattern:

1. Keep arrival service through the configured minimum handling time.
2. Tow out using the airport's configured synthetic travel duration.
3. Park until the latest return movement can start.
4. Complete tow-in by the departure handling cutoff.
5. Keep departure service through off-block.

For a class-C stay from 00:00 to 06:00 with 45-minute handling and 12-minute
travel, this produces:

| Activity | UTC interval |
|----------|--------------|
| Arrival service | 00:00 to 00:45 |
| Tow out | 00:45 to 00:57 |
| Parking | 00:57 to 05:03 |
| Tow back | 05:03 to 05:15 |
| Departure service | 05:15 to 06:00 |

The 246 parked minutes exclude both movements and both handling windows.
Equality at the configured minimum parking duration is accepted; one millisecond
less is not. Aircraft size selects handling policy, not a class-C constant.

This initial pattern maximizes release of the original continuous stay.
It does not search alternative interior tow times or optimize towing crews.
Short stays, blocked visits, supplied movement chains and unresolved single-leg
extents receive explicit assessment reasons rather than guessed replacements.

Generated movements reference their source and destination demand IDs. They
have no assigned stand endpoints and are therefore not raw ground-movement
legs. Source segment and visit IDs remain available for provenance.

## Select only worthwhile alternatives

For each candidate, compare the entire alternative demand set against the
baseline. Include remote parking demand and both service intervals; do not
score only the released contact interval.

The first profile uses:

```text
estimated relief = baseline shortage-minutes - alternative shortage-minutes
movement cost   = two movements * configured movement penalty
net benefit     = estimated relief - movement cost
```

A candidate with no eligible service or parking stand is ineligible, even if
its partial replacement reduces the diagnostic shortage. Eligible proposals
rank before ineligible ones.

Eligible ranking uses net benefit, estimated relief, peak exposure, parking
duration and stable ID, in that order. Peak exposure is a tie-break, not an
independent reason to tow. It integrates the candidate's arrival/departure
sector demand shapes over its baseline deficient pool intervals, resolved at
UTC minute boundaries using the airport-local clock. Distributions are
normalized independently; multiplying a complete hourly array by a constant
does not change its influence. It is a synthetic shape indicator, not measured
traffic volume or capacity.

Automatic selection then:

1. Re-evaluates every remaining eligible proposal against the current variant.
2. Requires positive marginal relief and positive net benefit.
3. Applies the inclusive configurable minimum net-benefit threshold.
4. Selects the highest-ranked worthwhile alternative within the movement budget.
5. Repeats until no worthwhile alternative or complete movement pair remains.

Ranking scores describe each proposal against the baseline. Selection steps
record the marginal scores when it was chosen. Rejected proposals include
their final marginal score and a reason. This prevents two initially useful
proposals from both being chosen after the first resolves their shared shortage.

A busy hour with adequate compatible capacity produces no selected elective
tows. A compatibility problem can justify a split outside peak hours, but an
impossible departure cannot be repaired by inventing a tow.

## Configure the demo profile

[Contoso's profile](../data/airports/contoso/demand/tow-profile.json) is separate
from airport infrastructure and the raw feed. The
[profile schema](../data/schemas/tow-profile.schema.json) rejects unknown
methods, fields and invalid bounds.

<!-- example: tow-profile -->
```json
{
  "schema_version": "1.0.0",
  "id": "demo:capacity-selective:v1",
  "method": "greedy-marginal-shortfall",
  "minimum_parking_minutes": 60,
  "movement_penalty_minutes": 15,
  "minimum_net_benefit_minutes": 0,
  "maximum_generated_movements": 8,
  "parking_stand_kind": "non-contact"
}
```

The 60-minute minimum is the agreed starting assumption, not an operational
constant. The other defaults are illustrative tuning knobs: 15 equivalent
shortage-minutes per movement, a positive-net-benefit requirement and a budget
of eight generated movements. These are not monetary estimates.

Set the movement budget to zero for ranked proposals without automatic selection.
An odd budget leaves the final unused movement slot because pairs are atomic.
Increasing movement cost or the minimum net benefit makes selection more
conservative. Setting parking kind to `any` broadens parking eligibility without
overriding stand permissions.

The configured airport tow duration is required. Missing traffic patterns fail
explicitly if needed for peak scoring; missing policy never silently becomes
12 minutes. The package embeds the complete profile for reproducibility.

## Run and inspect

```powershell
npm run prepare:tows -- --plan-start 2026-10-21T14:00:00Z --plan-end 2026-10-22T14:00:00Z --output .\contoso-tow-review.json
npm run test:tows
```

Optional `--demand`, `--airport` and `--profile` paths select other inputs.
Defaults are module-relative; explicit paths are working-directory-relative.
JSON goes to standard output without `--output`; diagnostics go to standard
error. Invoke `node .\scripts\prepare-tows.mjs` directly to avoid npm's banner.
Output creation is exclusive and refuses to overwrite existing files.

| Exit code | Meaning |
|-----------|---------|
| `1` | Invalid inputs, configuration, arguments or output I/O |
| `2` | Review package generated with inherited blocking errors |
| `3` | Diagnostic package generated; assignment validation remains required |

There is no operational-success exit code at this stage.

The [package schema](../data/schemas/tow-preparation.schema.json) describes
baseline analysis, visit assessments, ranked proposals, selection steps,
rejection reasons and the resulting proposed demand analysis.

The unchanged Contoso seed currently generates two window-qualified proposals
and selects neither:

* Long-E has no relaxed shortage to relieve.
* Long-C's departure has no eligible stand under the current authored rules.

The baseline reports 300 relaxed shortage-minutes for the incompatible long-C
continuous stay, not a claim of airport-wide congestion. Its rejected split
still leaves an ineligible departure. The intentional flight ambiguity also
keeps the package in review status. Do not alter airport permissions merely to
make this demonstration select a tow.

Tests use a separate constrained fixture to prove that one tow pair relieves
three overlapping demands competing for two service stands, and that a second
redundant pair is rejected.

## Subsequent solver boundary

The next stage must validate continuous assignments, conditional rules, shared
gates and towing feasibility. A post-assignment pruning pass can attempt to
remove generated discretionary tows by restoring and validating whole stays.
It must not remove supplied movements or merge stays across an occupied gap.

Other timing patterns, aggressive trimming with repair, passenger-oriented
profiles and integrated optional-tow optimization remain separate methods.
Keep their profile identities and measurement units explicit so comparisons
with the unchanged baseline remain meaningful.

[Local assignment](local-assignment.md) now enforces continuous stand occupancy,
authored pairwise conditional rules and atomic no-tow/tow alternatives through
CP-SAT. It can reject unnecessary or infeasible admitted proposals. Shared gate
resources, towing crews/routes and unresolved timing remain outside that model.
The existing Gantt still requires a data-source selector before integration.
