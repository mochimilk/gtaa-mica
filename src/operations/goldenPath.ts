// DEMO SEAM: the disruption demo's golden path, driven by the presenter (see
// docs/disruption-demo.md). Every step of it waits for the user, never a
// timer: the news lands when they cue it, Skye reviews when they press Review
// (or say yes), Travis is called when they press Review with baggage (or say
// yes), Skye briefs him once they have greeted him, and the plan is applied
// when they press Approve. In between, Skye and Travis do their part.
//
// One key does the user's next step from wherever the demo has got to, by
// pressing the control on screen for it, so it is seen being pressed: Ctrl+Alt+N
// from the keyboard, or PageDown, which is what a presentation clicker sends
// for "next". As Travis picks up, it hands the call to Skye, should she not
// have taken it from the user's greeting. While it is Skye's or Travis's
// turn, it does nothing.
import { useEffect, useRef } from "react";
import { callingNames } from "../live/callGuests";
import { disruptionState } from "./disruption";
import { outputs } from "./outputs";
import { placingSignoffCall, setSignoffStage, skyeReview } from "./skyeReview";

/**
 * The user's steps on the golden path: cue the news, Review it, call baggage
 * in, greet Travis and hand over to Skye, Approve the plan, then open its logs.
 */
export type GoldenBeat = "news" | "review" | "call" | "handover" | "approve" | "logs";

/** The user's next step, from where the demo is now; null while it is Skye's or Travis's turn, or once it is over. */
export function nextGoldenBeat(): GoldenBeat | null {
  const news = disruptionState();
  if (news.landedAt === null) return "news";
  if (news.notice === "shown") return "review";
  if (news.notice === "approved") return "logs";
  // Skye still at work: what she changes joins what waits, so it waits for her.
  if (outputs().some((request) => request.actor === "skye" && request.working)) return null;
  const review = skyeReview();
  if (!review) return null;
  const waiting = review.signoffs.find((entry) => entry.state !== "approved");
  if (!waiting) return "approve";
  if (waiting.state === "asked" && waiting.stage === "joined") return "handover";
  const reachable = waiting.state === "needed" && !callingNames().includes(waiting.name);
  return reachable && !placingSignoffCall() ? "call" : null;
}

/** Whether the demo is under way, so PageDown is the presenter's rather than the page's. */
const underWay = (): boolean => {
  const { landedAt, notice } = disruptionState();
  return landedAt === null || (notice !== "closed" && notice !== "dismissed");
};

/** Ctrl+Alt+N, or PageDown (a presentation clicker's "next"): the user's next step. */
export const isNextBeatKey = (event: KeyboardEvent): boolean =>
  (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === "n") ||
  (event.key === "PageDown" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey);

/** The controls each step presses, most specific first: the notification's action, or the decision. */
const CONTROLS: Record<Exclude<GoldenBeat, "news" | "handover">, readonly string[]> = {
  review: ['.skye-notif[data-notif="disruption"] .skye-notif__action'],
  logs: ['.skye-notif[data-notif="disruption"] .skye-notif__action'],
  // The call's shared approval when it is on screen, else the approval on the board.
  call: ["[data-approval-plan] [data-approval-decision]", "[data-approval-decision]", "[data-outputs-decision]"],
  approve: ["[data-approval-plan] [data-approval-decision]", "[data-approval-decision]", "[data-outputs-decision]"],
};

/** Whether `element` is on screen and can be pressed: not hidden, out of sight (inert), or disabled. */
function pressable(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0 || element.closest("[inert], [hidden]")) return false;
  return !(element as HTMLButtonElement).disabled && element.getAttribute("aria-disabled") !== "true";
}

function controlFor(beat: Exclude<GoldenBeat, "news" | "handover">): HTMLElement | null {
  for (const selector of CONTROLS[beat]) {
    const found = [...document.querySelectorAll<HTMLElement>(selector)].find(pressable);
    if (found) return found;
  }
  return null;
}

/** How long a control pressed for the user shows it was, ms (data-golden-press, disruptionNotice.css). */
const PRESS_MS = 450;

/** Presses `button` as the user would, showing it was pressed. */
function press(button: HTMLElement): void {
  button.setAttribute("data-golden-press", "");
  setTimeout(() => button.removeAttribute("data-golden-press"), PRESS_MS);
  button.focus({ preventScroll: true });
  button.click();
}

/**
 * Does the user's next step (nextGoldenBeat): `cueNews` lands the news, the
 * handover moves Travis's sign-off on to Skye presenting, which has her brief
 * him, and every other step presses its control on screen. Returns the step
 * taken, or null when there was none, or its control is not on this page.
 */
export function advanceGoldenPath(cueNews: () => void): GoldenBeat | null {
  const beat = nextGoldenBeat();
  if (beat === "news") {
    cueNews();
    return beat;
  }
  if (beat === "handover") {
    const joined = skyeReview()?.signoffs.find((entry) => entry.state === "asked" && entry.stage === "joined");
    if (joined) setSignoffStage(joined.name, "presenting");
    return beat;
  }
  const control = beat && controlFor(beat);
  if (!beat || !control) return null;
  press(control);
  return beat;
}

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** The presenter's key for the next step on the golden path (advanceGoldenPath). */
export function useGoldenPath(cueNews: () => void): void {
  const cueRef = useRef(cueNews);
  cueRef.current = cueNews;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.repeat || !isNextBeatKey(event)) return;
      const clicker = event.key === "PageDown";
      // PageDown is the page's again once the demo is over, and in a text field.
      if (clicker && (editable(event.target) || !underWay())) return;
      event.preventDefault();
      const taken = advanceGoldenPath(cueRef.current);
      if (import.meta.env?.DEV) console.debug("[golden-path]", taken ?? "nothing to do yet", "· next:", nextGoldenBeat());
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, []);
}
