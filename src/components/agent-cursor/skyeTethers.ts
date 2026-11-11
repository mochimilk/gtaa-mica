// Whether Skye's tethers show while her helpers work (the lines, the web and
// the light along them; showTethers in agentSwarm.ts), a choice in Settings'
// Appearance page; off by default, so her echoes are orbs alone. On sets
// data-skye-tethers on the root element, since the tethers' layer is
// portalled to <body>; agent-cursor.css hides it otherwise.
import { useSyncExternalStore } from "react";

let on = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setSkyeTethers(next: boolean): void {
  on = next;
  document.documentElement.toggleAttribute("data-skye-tethers", next);
  for (const listener of listeners) listener();
}

/** Whether the tethers show, re-rendering on a change. */
export function useSkyeTethers(): boolean {
  return useSyncExternalStore(subscribe, () => on);
}
