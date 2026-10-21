---
title: Coral base starter
description: Local airport planning prototype with a shared browser and Electron interface.
---

A minimal Vite + React app with all six Coral libraries installed:

- `@coral-ai/react` — provider, layout, and UI components
- `@coral-ai/markdown` — markdown and code rendering
- `@coral-ai/charts` — bar and line charts
- `@coral-ai/bundleicons` — Fluent icons
- `@coral-ai/chat` — chat surfaces and agent helpers
- `@coral-ai/docs` — documentation layout and table of contents

## Start

```sh
npm install
npm run dev
```

The scaffold includes a navbar and welcome page. Edit `src/App.tsx` to build your app. Chat and charts are available to import when needed; this starter requires no backend or API credentials.

## Project configuration

`src/main.tsx` imports `coral.config.json` and passes it directly to `CoralProvider`. Change the app name or brand color there. If you rename the config or switch to TypeScript config, update the import too. Markdown styles are already imported in `src/main.tsx`.

## Check and build

```sh
npm run build
npm run preview
```

`build` checks TypeScript and creates the production output in `dist`.

## Airport configuration

See [Stand configuration and occupancy-dependent rules](docs/stand-rules.md)
for the airport data contract, closure/restriction examples, Contoso remote-stand
use cases, and the distinction between configuration validation and solver support.
See [Airport characteristics and operating policies](docs/airport-characteristics.md)
for local-time sector demand weights, non-overlapping airline planning groups,
and minimum arrival/departure handling windows.
See [Raw airport demand legs](docs/raw-demand.md) for the leg-first input contract,
fixed Contoso seed, linking cases and validation commands.
See [Visit linking and provisional tow requirements](docs/visit-linking.md) for
plan-duration search windows, ambiguity findings and the derived JSON package.
See [Ground-movement timing and reconciliation](docs/ground-movements.md) for the
12-minute airport fallback, explicit movement matching and conflict handling.
See [Stand-occupancy segment derivation](docs/occupancy-segments.md) for fixed
intervals, flexible tow boundaries and unknown initial/final parking state.
See [Capacity pressure and selective tow preparation](docs/tow-preparation.md)
for scarce stand pools, ranked alternatives, adjustable costs and provisional
selection. These outputs do not replace the Gantt data source.
See [Local stand assignment with CP-SAT](docs/local-assignment.md) for local
.NET execution, baseline/tow comparison, atomic visits and authored stand-rule
enforcement. No hosted infrastructure is needed.
See [Repeatable airport demo scenarios](docs/scenario-generation.md) for seeded
comfortable/constrained demand, overnight context and measured assignment/tow
comparisons. Generated output remains separate from the Gantt.

```sh
npm run validate:airport
npm run test:airport
npm run validate:demand
npm run test:demand
npm run test:linking
npm run test:occupancy
npm run test:tows
npm run test:assignments
npm run test:scenarios
```

## Add recipes

The existing `@coral-ai/cli` is included as a dev dependency:

```sh
npx coral add chat
```

You can also import any of the six libraries directly without adding a recipe.

## Desktop development (Electron)

The desktop window and browser use the same React/Coral UI in `src/`.
Use Node 22.12 or newer and install dependencies with `npm install`.

```sh
npm run dev             # Existing browser workflow
npm run dev:desktop     # Vite + a native Electron window, with renderer hot reload
```

The desktop command starts its own Vite server on an available loopback port
and prints the exact URL. It leaves existing web servers running; that printed
URL can also be opened in a browser. React/CSS edits update both renderers.
Restart `dev:desktop` after changing Electron's main process or its launcher.
Quit the app with Cmd+Q (macOS) or stop the command with Ctrl+C to stop its
owned Vite server. On macOS, closing the last window leaves the app running;
click its Dock icon to reopen it.

```sh
npm run build:desktop   # Check desktop JavaScript types and build the shared UI
npm run start:desktop   # Open the built UI locally (run build:desktop first)
npm run package:desktop # Build an unsigned prototype for the current OS/CPU
```

Local bundles are written to the ignored `desktop-out/` directory. These are
smoke-test bundles, without installers, release signing, notarization or
updates. Packaging runs on the current host; Windows distribution still needs
Windows testing. The browser production output remains `dist/`.

`electron/main.mjs` owns only the window, lifecycle and restricted local asset
protocol (`mica://app`). The packaged app loads `dist/` without a web server;
root-relative public assets, including the Pearson logo, resolve on that origin.
The renderer has Node integration disabled, context isolation and sandboxing
enabled, denied native permission requests, and restricted navigation/popups.
No preload or IPC is needed for this UI. Packaged content has a CSP; inline
styles remain allowed for Fluent/Griffel. Development uses Vite's usual HMR
scripts. A future native capability should expose a narrow validated preload
API rather than adding Node access to React.

Selection and alert acknowledgement remain in-memory demo state. Electron does
not add a backend, login or persistence. UI state in separate windows/browser
tabs is independent even though the source code is shared.
