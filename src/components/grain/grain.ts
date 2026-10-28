// Whether the app's film grain (grain.css) shows, a choice in the board's
// View menu. Off sets data-grain="off" on the root element, since the grain
// is a layer over the whole page, <body>'s portals and all.
import { useSyncExternalStore } from "react";

let on = true;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setGrain(next: boolean): void {
  on = next;
  if (next) document.documentElement.removeAttribute("data-grain");
  else document.documentElement.setAttribute("data-grain", "off");
  for (const listener of listeners) listener();
}

/** Whether the grain shows, re-rendering on a change. */
export function useGrain(): boolean {
  return useSyncExternalStore(subscribe, () => on);
}
