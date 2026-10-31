// The colour Skye's light is drawn in while her helpers work (her orb's glow,
// the ring round it, the helpers, the tethers and the light along them), a
// choice in Settings' Appearance page. Each choice sets --agent-cursor-light
// (agent-cursor.css), through data-skye-glow on the root element, since the
// cursors' layers are portalled to <body>.
import { useSyncExternalStore } from "react";

export type SkyeGlow = "default" | "aurora" | "seafoam" | "iris";

/**
 * The choices, in the order Settings shows them, with their names there:
 * ink (black over a light page, white over a dark one); the blue-violet of
 * the northern lights; a bright sea-green; and a soft sky blue.
 */
export const SKYE_GLOWS: readonly { value: SkyeGlow; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "aurora", label: "Aurora" },
  { value: "seafoam", label: "Seafoam" },
  { value: "iris", label: "Iris" },
];

let glow: SkyeGlow = "default";
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setSkyeGlow(next: SkyeGlow): void {
  glow = next;
  if (next === "default") document.documentElement.removeAttribute("data-skye-glow");
  else document.documentElement.setAttribute("data-skye-glow", next);
  for (const listener of listeners) listener();
}

/** The colour chosen, re-rendering on a change. */
export function useSkyeGlow(): SkyeGlow {
  return useSyncExternalStore(subscribe, () => glow);
}
