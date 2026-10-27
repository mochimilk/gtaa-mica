---
title: Switch demo datasets without restarting
description: Use local demo settings to switch the complete workspace between the original fixture and prepared Contoso plans.
---

## Presenter workflow

Open **Demo** beside the chart's Views and Filters controls.
Choose **Existing demo** or **Contoso scenarios**. For Contoso, choose
**Comfortable**, **Constrained** or **Full day**, then **Baseline** or **Tow options**.
Select **Apply** to change the whole workspace. **Cancel** leaves it unchanged.
**Reset to original demo** restores the original source and default preferences.

The header always identifies the active source, case, plan, synthetic status
and UTC display zone. Switching requires no shell commands, solver installation,
server restart or page reload.

The original fixture remains the default on a fresh browser profile. Prepared
plans show scheduled STA/STD times, while the original fixture retains its
synthetic ETA/ETD presentation. All represented flights, including scheduled
context outside the visible horizon, remain available in the lists.

| Prepared case | Baseline                     | Tow options                    |
|---------------|------------------------------|--------------------------------|
| Comfortable   | 36 visits, no added movements | 36 visits, no added movements |
| Constrained   | 40 of 41 visits assigned      | 41 assigned with 2 movements  |
| Full day      | 149 of 160 visits assigned    | 149 assigned, no added movements |

Full day represents October 24, 2026 in Contoso's local US time zone:
136 domestic visits, 12 Europe visits and 12 Asia visits. It retains all
320 source legs, including 22 legs from 11 unassigned visits. These appear
as alerts and list entries, not invented chart occupancy. Market weights
are illustrative. See the [full-day configuration and measured results](scenario-generation.md#generate-a-full-contoso-day).

An unassigned visit stays in the flight lists and produces unassigned-flight
alerts; no chart stay is invented for it. Explicit tow endpoints are drawn on
the selected plan's arrival, parking and departure stays.

Prepared plans expose a **Buffers** control for
[scheduled buffer review](buffer-evaluation.md). It compares baseline/tow plans
and can highlight tight handovers without changing occupancy or solver settings.
The adjacent **Gate waiting** control adds
[synthetic point-estimate waiting](gate-wait-evaluation.md), with explicit
delay assumptions and inspectable blue arrival markers in the same review dialog.
The **Capacity** control opens a [single-turn capacity probe](capacity-probe.md)
with editable duration and UTC search bounds. Colored borders show individually
feasible arrival starts against the fixed plan, not additional assigned flights.
Show all three probes together, then choose planned, modeled end-of-day or
retention intensity from an explicitly synthetic 30-day timing replay.
Click a segment to inspect its exact start and all daily assessments.
These are not observed actuals or independently solved operating days.
The **Late request** control adds a
[post-approval accommodation rehearsal](accommodation.md): preview a direct fit
or one-turn stand repair, inspect consequences and explicitly accept a
session-only choice. Restore the approved reference from the same control.
Reload and dataset/plan switching clear acceptance. Reference capacity/atlas
and paired reviews are hidden while amended assignments are active rather
than displaying stale evidence.

## State and persistence

The chart, lists, filters, alerts and selection details consume one shared
dataset. Applying a different dataset resets selections, details, views,
filters and alert acknowledgements together. This prevents references to
flights or stays from the previous source.

Only preferences are stored under `gtaa-mica.demo.v1` in localStorage:

```json
{
  "version": 1,
  "source": "contoso",
  "scenario": "constrained",
  "variant": "tow-options"
}
```

The active dataset lives in React state. Full plans, alert acknowledgements
and selections are not written to localStorage.

Persistence is specific to the browser profile and origin, including its port.
A browser tab, development Electron window and packaged Electron app do not
automatically share settings. Clearing site storage restores fresh-install
defaults on the next load.

Invalid saved preferences display a warning and leave the original demo active.
If a requested prepared dataset fails loading or validation, the current dataset
is retained and an error is shown. If storage is unavailable, applying a valid
dataset still works for the session, with an explicit persistence warning.

## Prepared snapshots and developer maintenance

The three [prepared snapshots](../src/demo/prepared) are checked-in, compact
viewer projections of the existing
[scenario generation and local solver](scenario-generation.md).
They contain source flights, visits, stand rows, fixed selected stays, explicit
tow endpoints, solver request fingerprints and measured coverage counts.
They omit the solver's large candidate/conflict evidence.

Snapshots and their validator load on demand when Contoso is selected. No
backend, native bridge, network solver or .NET process is used by the viewer.
The reusable [timeline renderer](../src/stand-timeline) is unchanged; adapters
provide its chart-neutral rows, visits and intervals.

Developers can regenerate all checked-in snapshots after intentionally
changing the airport or scenario profile:

```powershell
npm run prepare:demo
npm run test:demo
npm run build
```

Regeneration requires the local .NET 10 solver and existing dependencies.
It runs all three cases, checks scenario expectations and the
[snapshot schema](../data/schemas/demo-scenario.schema.json), then replaces
three known snapshot files and their generated standalone validator.
It also writes the generated [full-day raw demand](../data/airports/contoso/demand/full-day-demand.json).
The validator requires no runtime code generation, preserving the packaged
Electron app's content security policy. Presenters do not need this command.
Airport configuration changes do not silently change the prepared viewer plans.

The browser validates schema, IDs, endpoint associations, timing and displayed
coverage/tow counts before applying a prepared plan. It does not rerun authored
airport rules; those were checked when generating the snapshot.
These plans are synthetic stand-assignment reviews, not operational certification.

## Deferred capabilities

Importing arbitrary review files, running the solver from the app, editing
scenario profiles, simulating day-of actuals and connecting agent schedule
context remain separate increments. This selector adds no allocation controls
and does not change the authored airport or the original fixture.
