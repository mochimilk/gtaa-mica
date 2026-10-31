import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { CoralProvider, type CoralConfig } from "@coral-ai/react";
import "@coral-ai/markdown/styles";
import App from "./App";
import { DefaultContextMenu } from "./components/context-menu";
import { hasDesktopBackdrop } from "./components/title-bar";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* On Mica, the window paints the body (hasDesktopBackdrop) in place of Coral. */}
    <CoralProvider
      config={coralConfig as CoralConfig}
      glow={false}
      bodyBackground={hasDesktopBackdrop() ? "transparent" : undefined}
    >
      <App />
      {/* Right-click's Cut, Copy and Paste, wherever the app has no menu of its own; never the browser's. */}
      <DefaultContextMenu />
      <BootSplashDismiss />
    </CoralProvider>
  </React.StrictMode>,
);
