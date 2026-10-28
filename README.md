# GTAA Mica

Stand planning for Norvara Intl Airport, with Skye, a chat and voice
assistant. A Vite + React app on the Coral libraries, also shipped as an
Electron desktop app.

Coral libraries used:

- `@coral-ai/react` — provider, layout, and UI components
- `@coral-ai/markdown` — markdown and code rendering (chat messages)
- `@coral-ai/chat` — chat surfaces and agent helpers
- `@coral-ai/charts` — not used directly; `@coral-ai/chat` requires it
- `@coral-ai/bundleicons` — Fluent icons

## Start

```sh
npm install
npm run dev
```

Voice needs the local broker (`npm run dev:voice`, `server/micaLiveServer.mjs`)
and its settings (see `.env.example` and `docs/gpt-live-voice.md`). Without it
the app runs and shows voice as disconnected.

## Project configuration

`src/main.tsx` imports `coral.config.json` and passes it directly to `CoralProvider`. Change the app name or brand color there. If you rename the config or switch to TypeScript config, update the import too. Markdown styles are already imported in `src/main.tsx`.

## Check and build

```sh
npm run build
npm run preview
```

`build` checks TypeScript and creates the production output in `dist`.

## Add recipes

The existing `@coral-ai/cli` is included as a dev dependency:

```sh
npx coral add chat
```

You can also import any of the Coral libraries directly without adding a recipe.

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
root-relative public assets resolve on that origin.
The renderer has Node integration disabled, context isolation and sandboxing
enabled, denied native permission requests, and restricted navigation/popups.
On Windows and Linux the page draws the title bar (`src/components/title-bar`):
File, Edit, View and Window at its start, the native window controls over its
end, in the page's colour. Its menus are the only preload API
(`electron/preload.cjs`), checked in `electron/titleBar.mjs`; macOS keeps its
own title bar and menu bar. Packaged content has a CSP; inline
styles remain allowed for Fluent/Griffel. Development uses Vite's usual HMR
scripts. A future native capability should expose a narrow validated preload
API rather than adding Node access to React.

Selection and alert acknowledgement remain in-memory demo state. Electron does
not add a backend, login or persistence. UI state in separate windows/browser
tabs is independent even though the source code is shared.
