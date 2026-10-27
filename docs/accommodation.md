---
title: Late-request accommodation
description: Rehearse a post-approval airline request with direct placements, one-turn stand repairs, inspectable consequences and reversible session-only acceptance.
---

## Presenter workflow

Select a Contoso scenario and plan in [Demo settings](demo-settings.md), then
open **Late request**.

1. Read the incoming airline, aircraft, sectors, route and exact occupancy.
2. Preview an alternative. The chart and approved reference remain unchanged.
3. Inspect the affected flight pair, stand changes, buffers and synthetic waiting.
   **Open executive brief** opens the [plan decision brief](decision-brief.md)
   with the same option and assumption. **Review accommodation decision**
   returns here without accepting or changing the chart.
4. Confirm the coordination checkbox and select **Accept accommodation**.
5. Inspect the updated chart, flight lists and unassigned alerts.
6. Reopen **Late request** to compare another choice or **Restore approved reference**.

Acceptance is a decision rehearsal, not operational authorization. It is not
stored in local storage, written to a plan file or submitted to an airline.
Reloading or changing the dataset/plan clears it. Choosing a replacement
always starts from the original reference; repairs never accumulate.
The selected synthetic waiting assumption is retained with the session choice
so reopening the review does not silently change its measurement context.

The original demo has no late-request controls.

## Synthetic requests

The [profile](../data/airports/contoso/evaluation/accommodation-profile.json)
authors one post-approval request per scenario:

| Scenario | Service | Start relative to horizon | Duration | Current result |
|----------|---------|---------------------------|----------|----------------|
| Comfortable | American B738 domestic | +60 min | 75 min | Direct placements |
| Constrained | British Airways B789 international | +240 min | 120 min | Direct placements |
| Full day | American B738 domestic | +870 min | 120 min | One-turn stand repairs |

These are requests added after the reference was prepared, not original
solver-unassigned traffic. The modeled reference approval is 24 hours before
the horizon start; receipt is 12 hours before it. These timestamps establish
the synthetic story, not an actual approval audit.

Routes reuse the existing airline/country/sector-aware catalog sampler.
Aircraft registrations and flight numbers are explicitly synthetic and
collision-checked. A comfortable or constrained plan is not forced into an
artificial shortage. The full-day reference has no direct fit for its request
but has eight one-turn relocation alternatives under the implemented rules.
For a blocked-service experiment, change the full-day profile case to
`baw-international`, start offset `900`, duration `120`, and regenerate
accommodation evidence. This international-bank request produces no acceptable
direct or one-turn repair option against either reference variant. Existing
demand is not removed to manufacture an accommodation.

## Search and operating protections

The [offline evaluator](../scripts/accommodation.mjs) reuses `standCandidates`
and `evaluatePlan`. It does not duplicate stand rules in the browser or
change the CP-SAT solver.

First, it tests the requested interval on every statically compatible stand.
If any direct placements exist, it returns those and does not search for
unnecessary repair.

Otherwise, it considers stands blocked by exactly one existing occupancy.
That occupancy can move only when it represents a complete, single-stay
turn entirely inside the horizon, with both commercial flight endpoints.
It tests relocation to every compatible alternative stand while adding
the incoming request. Every returned option independently passes full-plan
hard-rule evaluation, including adjacency restrictions in both directions.

Protections are explicit:

* Preserve every existing assigned visit, aircraft and flight endpoint
* Keep all existing arrival/departure times unchanged
* Do not alter tow chains, boundary-context stays or add tows
* Never relax aircraft, airline, sector, readiness or adjacency rules
* Move at most one existing whole turn
* Leave existing unresolved traffic unresolved, rather than trading it away

Evidence v1.1 preserves every rule-valid alternative, not only the first three.
The UI selects up to the profile's display limit (currently three), covering
contact/non-contact strategies first, then distinct reported measurements and
affected turns. It does not fill the list with cosmetic placements.
An active or explicitly selected choice is retained alongside representatives
when necessary.

Both **Late request** and **Compare plans** use the same representative set.
Labels name the incoming stand and any existing flight pair and destination
stand. Equivalent reported summaries are identified across both synthetic
waiting assumptions; this does not establish identical passenger, cost or
coordination consequences. No financial or resilience ranking is implied.
The full-day case now illustrates contact and non-contact relocations,
including alternatives with different assessed populations and tight handovers.
Finding no option means no acceptable option within this narrow search,
not proof that the service is infeasible. There is no solver-timeout status:
the finite offline search completes or preparation fails explicitly.

Moving a future whole turn to another stand is an assignment change, not a
physical tow or a flight retiming. Any future service retiming would require
a separate airline approval and is not included here.

## Consequence measurements

Preview uses the existing versioned
[scheduled buffer](buffer-evaluation.md) and
[synthetic gate-wait](gate-wait-evaluation.md) calculations.

The comparison reports retained existing visits, existing unresolved visits,
incoming service accommodation, changed stand assignments, unchanged flight
times/tows, tight handovers, minimum buffer and synthetic waiting.

Adding a turn changes the handover population. Tight-handover counts are
whole-plan observations, not a same-population causal improvement or an
overall resilience score. The configured 20-minute review threshold is not
a hard operating minimum or an optimization objective.

Waiting totals compare only existing arrivals assessed in both the reference
and proposal. The incoming arrival estimate is separate. Assessed/unassessed
counts remain visible; an unassessed arrival is not assigned zero waiting.
If there is no common assessed population or measured buffer, show N/A.
Changing the synthetic release-delay assumption resets the approval checkbox.

No dollars, revenue uplift or passenger satisfaction benefit is estimated.
Shared gates, staffing, passenger handling and tow resources are not certified.
An authorized local exception can therefore be discussed without pretending
to have measured every operational consequence.

## Reference and active workspace

The [demo provider](../src/demo/DemoContext.tsx) retains the original dataset
and accepted option separately. Preview never changes the active dataset.
Accepting builds one derived operational view through the shared
[prepared adapter](../src/demo/prepared-adapter.ts), updating chart occupancies,
visit/flight links, lists, filters and alerts together.

The amended dataset does not carry the original prepared-plan metadata,
solver status, capacity evidence or atlas as though they described the new
assignments. Its subtitle explicitly identifies a session accommodation,
not a new solver run. Reference capacity/atlas and chart-metric review controls
are hidden until the original reference is restored. The late-request
comparison and **Compare plans** remain available against that reference.

## Preparation and validation

```powershell
npm run prepare:accommodation
npm run test:accommodation
npm run test:demo
npm run build:desktop
```

`prepare:accommodation` reads the frozen plans and reconstructed source demand
without running the solver or rewriting approved snapshots.
`prepare:capacity` and `prepare:demo` regenerate accommodation evidence after
their other prepared sidecars.

The [profile schema](../data/schemas/accommodation-profile.schema.json)
fixes the one-visit bound. The
[evidence schema](../data/schemas/accommodation.schema.json) carries request
provenance, source fingerprints, option moves, static exclusions and direct
blocking assignments, finding codes and rule paths.

Loading checks the exact snapshot and airport/demand identities, known probe
requirements, canonical UTC instants, request/flight links, non-colliding
identities, option counts and move scope. Browser checks also reject
same-stand overlaps and protected/unknown-stay changes. Authoritative physical
and adjacency checks run offline; the browser is not a second solver.
The schema validator is generated offline and works without runtime string
code generation.

Preparation takes the route-generation profile explicitly rather than
internally loading Contoso preferences. The airport, demand, probes and
accommodation profile remain separate inputs for another airport.

Tests reproduce every prepared alternative, replay full hard-rule validation,
retain original commitments, exercise no-option/invalid-source paths, compare
the same assessed waiting population and verify all active dataset surfaces.
Broader repairs, profile-based replanning, real approval/audit storage and
historical outcome collection remain separate increments.
