---
title: Switch demo datasets without restarting
description: Use local demo settings to switch the complete workspace between the original fixture and prepared Contoso plans.
---

## Presenter workflow

Open **Demo** beside the chart's Views and Filters controls.
Choose **Existing demo** or **Contoso scenarios**. For Contoso, choose
**Comfortable** or **Constrained**, then **Baseline** or **Tow options**.
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

An unassigned visit stays in the flight lists and produces unassigned-flight
alerts; no chart stay is invented for it. Explicit tow endpoints are drawn on
the selected plan's arrival, parking and departure stays.

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

The two [prepared snapshots](../src/demo/prepared) are checked-in, compact
viewer projections of the existing
[scenario generation and local solver](scenario-generation.md).
They contain source flights, visits, stand rows, fixed selected stays, explicit
tow endpoints, solver request fingerprints and measured coverage counts.
They omit the solver's large candidate/conflict evidence.

Snapshots and their validator load on demand when Contoso is selected. No
backend, native bridge, network solver or .NET process is used by the viewer.
The reusable [timeline renderer](../src/stand-timeline) is unchanged; adapters
provide its chart-neutral rows, visits and intervals.

Developers can regenerate both checked-in snapshots after intentionally
changing the airport or scenario profile:

```powershell
npm run prepare:demo
npm run test:demo
npm run build
```

Regeneration requires the local .NET 10 solver and existing dependencies.
It runs both cases, checks scenario expectations and the
[snapshot schema](../data/schemas/demo-scenario.schema.json), then replaces
the two known snapshot files and their generated standalone validator.
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
