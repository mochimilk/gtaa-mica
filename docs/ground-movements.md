---
title: Ground-movement timing and reconciliation
description: Complete single-anchor movements with a configured tow duration and reconcile them with aircraft visits without inventing assignments.
ms.date: 2026-10-21
---

## Airport timing policy

[Contoso's operating policy](../data/airports/contoso/operating-policy.json)
sets `default-tow-minutes: 12`. This is an airport-wide synthetic travel duration,
separate from minimum arrival/departure handling time.

The field is optional for airports whose movements already provide both
timestamps. When present, it must be a positive whole number with safe
millisecond precision. A single-anchor movement requires the policy; there is
no hardcoded fallback.

The [movement model](../scripts/movement-model.mjs) runs as part of
[visit linking](visit-linking.md). It normalizes supplied ground legs before
context filtering, then reconciles relevant movements with linked visits.

## Preserve anchors and record inference

Normalization follows three rules:

* With off-block only, infer on-block as off-block plus 12 elapsed minutes.
* With on-block only, infer off-block as on-block minus 12 elapsed minutes.
* With both supplied, preserve both, even when the interval is not 12 minutes.

The configured value, not a constant in code, controls inference. For example:

* Off-block at 20:00 UTC becomes on-block at 20:12 UTC.
* On-block at 21:00 UTC becomes off-block at 20:48 UTC.
* A supplied 19:00 through 19:15 movement stays 15 minutes.

These are the three movement cases in the
[fixed seed](../data/airports/contoso/demand/validation-legs.json).

Original fields remain unchanged in `source_legs`. Derived `ground_movements`
carry complete `scheduled_off_block` and `scheduled_on_block` values,
`timing_source` and, when inference was used, `inferred_duration_minutes`.
`timing_source` is `supplied`, `inferred-off-block` or `inferred-on-block`.
Supplied timestamp text is preserved, including its original precision.

Arithmetic uses elapsed UTC milliseconds across midnight and clock changes.
Invalid or overflowing derived dates fail explicitly. No schedule is clamped
or shifted to make it fit.

An inferred interval can overlap the context boundary even if its original
anchor is outside it. Normalization therefore precedes filtering. A future live
feed query should include interval-overlapping ground records or tow-duration
padding so such anchors are not lost upstream. The flight connection-search
radius remains the plan duration.

## Associate with visits

Aircraft registration determines which visits can be considered. A connected
visit uses its arrival on-block through departure off-block as the association
window. For a single-leg visit, the open side is bounded by the plan-duration
search radius:

* Arrival-only: arrival on-block through arrival plus the radius
* Departure-only: departure minus the radius through departure off-block

A movement must fit exactly one candidate window. An unambiguous association
records `visit_id`; no candidate is chosen by array order, nearest time or stand
preference. Ground movement visible in the plan can retain a visit whose flight
event is in the surrounding context.

The derived movement status is:

* `associated`: uniquely linked to a visit with the implemented timing/chain checks passing
* `standalone`: no visit association is established and no detected conflict requires review
* `needs-review`: chronology, handling, continuity or association is unresolved

A standalone movement is not discarded or treated as operationally certified.
It can be useful independently, but surrounding occupancy may still be unknown.
Unresolved flight connections for that registration prevent guessed movement
associations.

## Check timing and stand continuity

For each visit's chronological movement chain:

* The first movement cannot leave before arrival handling ends.
* The last movement must arrive before or at the departure handling cutoff.
* Consecutive ground legs must join destination stand to origin stand unless a
  supplied flight cycle separates them.
* Ground intervals for the same aircraft cannot overlap. Touching intervals are
  allowed.

Handling is still 45 minutes for A/B/C and 60 for D/E/F, selected from the
aircraft catalog. Equality at the arrival/departure cutoff is allowed. A
one-millisecond violation is reported, not rounded away.

Ground legs crossing flight block events, or occurring after a supplied flight
departure without an intervening arrival, require review. Gaps can reflect
incomplete feed context; the model does not silently invent the missing event.

Conflicting values are retained. Error findings identify source legs, and
affected movement chains are marked `needs-review`.

## Avoid duplicate tow requirements

When a valid associated chain covers a single-leg visit's tow requirement:

* Arrival-only uses the chain's first movement as the explicit tow-out.
* Departure-only uses the chain's last movement as the explicit tow-in.

The package records that relationship in `movement_matches` and removes the
duplicate provisional requirement. This does not create another ground leg.
Connected visits can have internal movements without generating new tow requests.

If related movements are conflicting or ambiguous, the provisional requirement
remains with `blocked_by_ground_leg_ids`. It must not be used to create a new
movement until the conflict is reviewed. An unrelated movement on the same
aircraft no longer suppresses a legitimate requirement.

## Package version and validation boundary

The [linked package schema](../data/schemas/linked-demand.schema.json) is now
version `2.0.0`. It adds required `ground_movements` and `movement_matches` arrays
and optional blocked-ground references on outstanding requirements.
Raw snapshots and airport operating policy retain version `1.0.0`.

These checks establish input chronology and explicit movement relationships,
not a feasible assignment plan. Stand aircraft/sector/airline permissions,
neighbor closures, towing resources, routes and overlapping stand occupancy
still need the solver/assignment validation layer.

The movement model derives no holding stand, towing crew or flexible tow time.
The separate [occupancy stage](occupancy-segments.md) now converts visits and
reconciled movements into fixed, flexible and open stand-occupancy segments.
Unknown initial/final parking boundaries remain explicit.

## Run and verify

```powershell
npm run validate:airport
npm run validate:demand
npm run test:linking
```

The existing [linking CLI](visit-linking.md#run-the-contoso-example) now includes
normalization and reconciliation. Its source snapshot is unchanged. The seed
retains its deliberate flight ambiguity, so its package still needs review and
the CLI still exits with `2`.
