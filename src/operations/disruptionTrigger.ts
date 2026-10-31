// DEMO SEAM: when the disruption's news "arrives" (see ./disruption).
//
// A real Skye hears of a late inbound from a feed (the airline's new ETA)
// whenever it comes, call or no call. This prototype has no feed, so the demo
// picks the moment. By default that is 3 seconds after the user connects to
// Skye, so the news lands while they are talking to her. That is a stand-in
// for the feed, not how Skye works, and this is the one place to change it:
//   - "connect": once a call to Skye is up, after `afterMs` (the default);
//   - "load": `afterMs` after the page opens, call or not (closest to a feed);
//   - "manual": only from the shortcut.
// Either way the late flight and its conflict show on the board first, and
// Skye spots them and speaks up `noticeAfterMs` later, as she would.
// Whichever is chosen, Ctrl+Alt+D lands it at once, for rehearsing without
// voice. It lands once per page load; reload to run the demo again.
import { useEffect, useRef } from "react";
import type { CallPhase } from "../live/callController";

export type DisruptionTrigger = { on: "connect" | "load" | "manual"; afterMs: number; noticeAfterMs: number };

/** Change `on` here to walk the on-connect trigger back. */
export const DISRUPTION_TRIGGER: DisruptionTrigger = { on: "connect", afterMs: 3_000, noticeAfterMs: 1_000 };

/** Ctrl+Alt+D: lands the disruption at once. */
export const isDisruptionShortcut = (event: KeyboardEvent) =>
  event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === "d";

/** How often a landing held back while Skye is at work tries again, ms. */
const RETRY_MS = 1_000;

/**
 * Lands the disruption on the board (`land`) when `trigger` says, and on the
 * shortcut, then has Skye speak up about it (`announce`) a moment later.
 * Held back while Skye is at work (`busy`), so the news never arrives in the
 * middle of a change she is making; it lands once she is done.
 */
export function useDisruptionTrigger(
  phase: CallPhase,
  busy: boolean,
  land: () => void,
  announce: () => void,
  trigger: DisruptionTrigger = DISRUPTION_TRIGGER,
): void {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const landRef = useRef(land);
  landRef.current = land;
  const announceRef = useRef(announce);
  announceRef.current = announce;

  // Once landed, Skye speaks up even if the call ends in the meantime.
  const announceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(announceTimer.current), []);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    const whenFree = () => {
      if (busyRef.current) {
        retry = setTimeout(whenFree, RETRY_MS);
        return;
      }
      landRef.current();
      clearTimeout(announceTimer.current);
      announceTimer.current = setTimeout(() => announceRef.current(), trigger.noticeAfterMs);
    };
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
      clearTimeout(retry);
    };
  }, [phase, trigger.on, trigger.afterMs, trigger.noticeAfterMs]);
}
