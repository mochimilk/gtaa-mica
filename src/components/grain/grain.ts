// Whether the app's film grain (grain.css) shows, a choice in Settings'
// Appearance page; off by default. On sets data-grain on the root element,
// since the grain is a layer over the whole page, <body>'s portals and all.
import { useSyncExternalStore } from "react";

let on = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setGrain(next: boolean): void {
  on = next;
  document.documentElement.toggleAttribute("data-grain", next);
  for (const listener of listeners) listener();
}

/** Whether the grain shows, re-rendering on a change. */
export function useGrain(): boolean {
  return useSyncExternalStore(subscribe, () => on);
}
