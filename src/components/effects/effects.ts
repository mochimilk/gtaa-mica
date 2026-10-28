// Whether the app reduces its effects, a choice in Settings' Appearance page,
// for machines the full look slows down: the background glow and Skye's orbs
// hold still, and blur and the film grain are off (effects.css), through
// data-effects="reduced" on the root element.
// Remembered on this device, unlike the other appearance choices, since a
// slow machine stays slow.
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "mica.reduceEffects";

function stored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

let reduced = typeof window !== "undefined" && stored();
const listeners = new Set<() => void>();

function apply() {
  if (typeof document === "undefined") return;
  if (reduced) document.documentElement.setAttribute("data-effects", "reduced");
  else document.documentElement.removeAttribute("data-effects");
}

// Before the first render, so the page never paints its full effects first.
apply();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setReduceEffects(next: boolean): void {
  reduced = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, "on");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembered, but still applies now.
  }
  apply();
  for (const listener of listeners) listener();
}

/** Whether effects are reduced, re-rendering on a change. */
export function useReduceEffects(): boolean {
  return useSyncExternalStore(subscribe, () => reduced, () => false);
}
