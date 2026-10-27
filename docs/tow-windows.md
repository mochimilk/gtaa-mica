---
title: Destination-checked tow windows
description: Highlight one-way tow-start opportunities inside existing lozenges using handling, travel, compatible destination occupancy and adjacency rules.
---

## Presenter workflow

Select a prepared Contoso plan, then open **Tow windows** beside the chart
controls. Enable **Show destination-checked tow windows**.

* Gold hatched sections with dotted borders sit inside existing lozenges
* Wider sections indicate more tow-start flexibility, not more added flights
* Click a section or use keyboard focus and Enter/Space to inspect destinations
* Use **Visit assessment** to inspect visits without a displayed opportunity
* Exact-fit opportunities retain a narrow marker and keyboard/click target

Each highlighted start has at least one compatible destination available from
tow arrival through the unchanged departure. If no destination is available,
there is no gold band. Individual destinations can have narrower start ranges
than the combined band; inspect their exact bounds before choosing a time.

The inspector shows destination stand codes, permitted tow-start ranges,
destination occupancy requirements and how long the current stand could be
released. Earlier starts release the current stand for longer. The highlighted
start range is not itself newly available stand occupancy.

The overlay is read-only. It does not schedule a movement, remove occupancy,
retime flights or change other assignments. Filters dim the corresponding
bands without removing their inspection targets or recalculating the evidence.

| Prepared scenario | Baseline candidates | Tow-options candidates |
|-------------------|---------------------|------------------------|
| Comfortable       | 10                  | 10                     |
| Constrained       | 11                  | 10                     |
| Full day          | 22                  | 22                     |

These are individual alternatives, not simultaneously feasible relocations or
an additive capacity count. Some context ranges fall outside the visible
horizon. The original fixture has no authored airport policy overlay.

## One-way calculation

The [offline preparation](../scripts/tow-windows.mjs) reuses the existing
[visit linker](visit-linking.md), aircraft-size handling policy and full
airport rule evaluator. The
[shared range calculation](../src/demo/tow-window-ranges.mjs) is also used
when loading evidence in the browser.

```text
earliest tow start = arrival + arrival handling
latest tow start   = departure - departure handling - tow travel

source occupancy      = [arrival, tow start)
destination occupancy = [tow start + travel, departure)
```

Only one movement is required. There is no return tow or minimum parking
requirement in this overlay. Handling protects the proposed movement; it
does not impose a universal sum-of-handling minimum on ordinary complete turns.

For a class-C visit from 12:00 to 14:00, with 45-minute handling at each end
and 12-minute travel, the timing-only start range is 12:45 to 13:03.
If the compatible destination is occupied until 13:00, the feasible start range
becomes 12:48 to 13:03. If occupied until 13:15, only the exact 13:03 start
remains. One millisecond later eliminates that destination.

Ranges are inclusive start instants. Occupancies are half-open, so a tow may
arrive exactly when the preceding aircraft releases the destination.
Chart clipping preserves exact fits and does not invent or extend boundaries.

## Destination checks

For every complete, assigned, single-stay source visit, preparation evaluates
other stands against aircraft, operating airline and departure-sector rules.
The source retains arrival handling; only the destination needs to support
the departure. This allows a single-sector departure stand to release a
scarce multi-sector arrival stand.

The destination must remain usable through departure, not merely have a short
gap at tow arrival. Direct occupancy and conditional adjacency conflicts in
either direction can delay the earliest start or eliminate the destination.
With a fixed departure, the destination interval is a shortening suffix as
the tow starts later, so its earliest start follows the latest conflicting
release. Both endpoints independently pass the full proposed-plan evaluator;
tests also check interior times. There is no minute-grid approximation.

Other assignments and all flight times remain fixed. Windows describe one
relocation at a time; they are not a search for a wider repair.
Unassigned visits receive no invented chart occupancy. Existing tow chains
are excluded rather than retimed without validating connected movements.

## Scope and evidence

The [evidence schema](../data/schemas/tow-windows.schema.json), version 2.0.0,
records one-way semantics, airport identity, travel duration, source handling
and per-plan source/destination start ranges.
Loading verifies snapshot, airport and raw-demand fingerprints, complete
visit coverage, flight links, source stays, destination row identities and
handling bounds. The schema validator is generated offline and needs no
runtime string code generation.

The prepared viewer requires known paired flight boundaries.
Incomplete or ambiguous source data fails preparation rather than guessing
an arrival, departure or parking extent.

Shared-gate resources, tow routes, crews, equipment and operational
authorization are not certified. A highlight means feasible under the modeled
stand rules, not permission to move an aircraft or guaranteed accommodation
of a particular incoming service.

Parking-and-return remains a different operation in
[tow preparation](tow-preparation.md), with two travel legs, a parking interval
and a return opening. It is not inferred by this overlay. Adjustments to
existing tow chains are also outside this bounded assessment.

Accepted session accommodations hide these reference overlays rather than
reusing stale evidence. Restore the reference to show them again.

## Regeneration and checks

```powershell
npm run prepare:tow-windows
node --test scripts\tow-windows.test.mjs
npm run test:demo
npm run build:desktop
```

Both `prepare:demo` and `prepare:capacity` regenerate tow-window evidence after
the other plan sidecars. No dependency, service or runtime solver is added.
