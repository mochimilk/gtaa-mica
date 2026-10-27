import type { LiveCallState } from "../../live/callController";

export type VoiceState = "idle" | "listening" | "connecting" | "thinking" | "speaking" | "unavailable";

/** Follow Mica's existing call/executor; never invent speech activity. */
export function skyeState(state: LiveCallState, audioBlocked: boolean): VoiceState {
  if (state.phase === "failed") return "unavailable";
  if (state.phase === "starting" || state.phase === "connecting") return "connecting";
  if (state.phase === "closing") return "idle";
  if (state.phase === "connected" && state.agentSpeaking && !audioBlocked) return "speaking";
  if (state.working) return "thinking";
  if (state.phase === "connected" && !state.muted) return "listening";
  return "idle";
}
