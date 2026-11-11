// DEMO SEAM: when the disruption's news "arrives" (see ./disruption).
//
// A real Skye hears of a late inbound from a feed (the airline's new ETA)
// whenever it comes, call or no call. This prototype has no feed, so the demo
// picks the moment. By default the presenter does, as the first step of the
// golden path (./goldenPath): Ctrl+Alt+N or the clicker's PageDown, or
// Ctrl+Alt+D, once they have said hello to Skye and set the scene. That is a
// stand-in for the feed, not how Skye works, and this is the one place to
// change it:
//   - "manual": only when the presenter cues it (the default);
//   - "connect": once a call to Skye is up, after `afterMs`;
//   - "load": `afterMs` after the page opens, call or not (closest to a feed).
// Either way the late flight and its conflict show on the board first, and
// Skye spots them and speaks up `noticeAfterMs` later, as she would.
// Whichever is chosen, the cue lands it at once. It lands once per page load;
// reload to run the demo again.
import { useCallback, useEffect, useRef } from "react";
import type { CallPhase } from "../live/callController";

export type DisruptionTrigger = { on: "connect" | "load" | "manual"; afterMs: number; noticeAfterMs: number };

/** Change `on` here to have the news land on its own again. */
export const DISRUPTION_TRIGGER: DisruptionTrigger = { on: "manual", afterMs: 3_000, noticeAfterMs: 600 };

/** Ctrl+Alt+D: lands the disruption at once. */
export const isDisruptionShortcut = (event: KeyboardEvent) =>
  event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === "d";

/** How often a landing held back while Skye is at work tries again, ms. */
const RETRY_MS = 1_000;

/**
 * Lands the disruption on the board (`land`) when `trigger` says, and on the
 * shortcut, then has Skye speak up about it (`announce`) a moment later.
 * Held back while Skye is at work (`busy`), so the news never arrives in the
 * middle of a change she is making; it lands once she is done. Returns the
 * cue, which lands it now, as the shortcut does (for ./goldenPath).
 */
export function useDisruptionTrigger(
  phase: CallPhase,
  busy: boolean,
  land: () => void,
  announce: () => void,
  trigger: DisruptionTrigger = DISRUPTION_TRIGGER,
): () => void {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const landRef = useRef(land);
  landRef.current = land;
  const announceRef = useRef(announce);
  announceRef.current = announce;

  // Once landed, Skye speaks up even if the call ends in the meantime.
  const announceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(announceTimer.current);
      clearTimeout(retry.current);
    },
    [],
  );

  const noticeAfterMs = useRef(trigger.noticeAfterMs);
  noticeAfterMs.current = trigger.noticeAfterMs;
  const whenFree = useCallback(() => {
    clearTimeout(retry.current);
    if (busyRef.current) {
      retry.current = setTimeout(whenFree, RETRY_MS);
      return;
    }
    landRef.current();
    clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => announceRef.current(), noticeAfterMs.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.repeat || !isDisruptionShortcut(event)) return;
      event.preventDefault();
      whenFree();
    };
    window.addEventListener("keydown", onKeyDown);
    const wanted = trigger.on === "load" || (trigger.on === "connect" && phase === "connected");
    const timer = wanted ? setTimeout(whenFree, trigger.afterMs) : undefined;
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(timer);
    };
  }, [phase, trigger.on, trigger.afterMs, whenFree]);

  return whenFree;
}
