import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { CoralProvider, type CoralConfig } from "@coral-ai/react";
import "@coral-ai/markdown/styles";
import { initializeActiveDataset } from "./operations/activeDataset";
import { loadSourceDataset, readSourceSelection, sourceSelectionUrl } from "./data-sources/registry";
import coralConfig from "../coral.config.json";
import "./components/cursor/cursor.css";
import "./components/grain/grain.css";
import "./components/effects/effects.css";
import "./index.css";

/**
 * Fades out the static boot splash in index.html. Rendered after <App />, so
 * its effect runs once the whole app has committed; the two frames let that
 * DOM paint beneath the splash before it fades, so the reveal is ready to use.
 */
function BootSplashDismiss() {
  React.useEffect(() => {
    const splash = document.getElementById("boot-splash");
    if (!splash) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        splash.classList.add("boot-splash--done");
        splash.addEventListener("transitionend", () => splash.remove(), { once: true });
        // Fallback for reduced motion (no transition) or a missed transitionend.
        setTimeout(() => splash.remove(), 400);
      }),
    );
  }, []);
  return null;
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

async function bootstrap() {
  try {
    const dataset = await loadSourceDataset(readSourceSelection(window.location.search));
    initializeActiveDataset(dataset);
    const { default: App } = await import("./App");
    root.render(
      <React.StrictMode>
        <CoralProvider config={coralConfig as CoralConfig} glow={false}>
          <App />
          <BootSplashDismiss />
        </CoralProvider>
      </React.StrictMode>,
    );
  } catch (error) {
    console.error("Schedule startup failed.", error);
    root.render(
      <main role="alert">
        <h1>Unable to load the selected schedule</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
        <button onClick={() => window.location.assign(sourceSelectionUrl(new URL(window.location.href), { source: "fixture", plan: "baseline" }))}>
          Load original fixture
        </button>
        <BootSplashDismiss />
      </main>,
    );
  }
}

void bootstrap();
