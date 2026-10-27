// How a failed call is explained in the UI. Kept apart from callStatus.ts,
// which depends on the orb's types, so it stays a plain, testable module.
import type { LiveCallState } from "./callController.ts";

/** Failure codes that can only happen after the session was up. */
const AFTER_SESSION_FAILURE = /^(connection_lost|session_closed_)/;

/**
 * Why a failed call failed, for the UI; null unless the call failed.
 *
 * It never says the board is unchanged. A call can drop after Skye already
 * applied an action, and an applied action is not rolled back, so for a
 * failure after the session was up it says exactly that. A failure before the
 * session started gets the reason alone: the call state cannot prove anything
 * about the board, which typed requests can change with or without a call.
 */
export function callFailureText(state: LiveCallState): string | null {
  if (state.phase !== "failed") return null;
  const reason = state.error?.message ?? "Mica could not connect the voice session.";
  return state.error && AFTER_SESSION_FAILURE.test(state.error.code)
    ? `${reason} Anything Skye already changed on the board stays as it is.`
    : reason;
}
