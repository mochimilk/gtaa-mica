// The colour Skye's light is drawn in while her helpers work (her orb's glow,
// the ring round it, the helpers, the tethers and the light along them), a
// choice in the board's View menu. Each choice sets --agent-cursor-light
// (agent-cursor.css), through data-skye-glow on the root element, since the
// cursors' layers are portalled to <body>.
import { useSyncExternalStore } from "react";

export type SkyeGlow = "default" | "aurora" | "glacier";

/**
 * The choices, in the order the View menu cycles through them, with their
 * names there: ink (black over a light page, white over a dark one); the
 * blue-violet of the northern lights; and an electric ice-blue.
 */
export const SKYE_GLOWS: readonly { value: SkyeGlow; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "aurora", label: "Aurora" },
  { value: "glacier", label: "Glacier" },
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
