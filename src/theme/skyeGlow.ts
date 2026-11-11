// The Glow chosen in Settings' Appearance page, the app's colour theme
// (./glowThemes). Fluent's tokens and Coral's brand follow it through
// FluentOverrides and main.tsx; everything else takes a style sheet on the root
// from here. Remembered on this device, as it is the whole look of the app.
import { useSyncExternalStore } from "react";
import { GLOW_THEMES, glowCss, isSkyeGlow, type SkyeGlow } from "./glowThemes";

const STORAGE_KEY = "mica.skyeGlow";
const DEFAULT_GLOW: SkyeGlow = "neon";

function stored(): SkyeGlow {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isSkyeGlow(value) ? value : DEFAULT_GLOW;
  } catch {
    return DEFAULT_GLOW;
  }
}

let glow = typeof window !== "undefined" ? stored() : DEFAULT_GLOW;
const listeners = new Set<() => void>();

let sheet: HTMLStyleElement | null = null;

function apply() {
  if (typeof document === "undefined") return;
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.id = "skye-glow-theme";
    document.head.appendChild(sheet);
  }
  sheet.textContent = glowCss(GLOW_THEMES[glow]);
}

// Before the first render, so the page never paints another Glow's colours first.
apply();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setSkyeGlow(next: SkyeGlow): void {
  glow = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembered, but still applies now.
  }
  apply();
  for (const listener of listeners) listener();
}

/** The Glow chosen, re-rendering on a change. */
export function useSkyeGlow(): SkyeGlow {
  return useSyncExternalStore(subscribe, () => glow, () => DEFAULT_GLOW);
}
