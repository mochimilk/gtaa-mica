# Coral — base starter

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

## Add recipes

The existing `@coral-ai/cli` is included as a dev dependency:

```sh
npx coral add chat
```

You can also import any of the six libraries directly without adding a recipe.
