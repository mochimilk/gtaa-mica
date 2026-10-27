// How a call reads in the UI.
import type { LiveCallState } from "./callController.ts";

/** Whether the outgoing ring tone should be playing. */
export function isRinging(state: LiveCallState): boolean {
  return state.phase === "starting" || state.phase === "connecting";
}
