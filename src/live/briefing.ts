// What Skye says when asked to get going ("start my day", "how are the
// stands looking", "what's next"): a quick pass over what is open, a line
// each (each conflict, the flights waiting for a stand, what can't be placed,
// the notices), then an offer to take it all as one plan, worked around
// everything else on the board (see planFixAll). Alerts arrive most pressing
// first (see currentAlerts).
//
// Kept short on purpose: it is spoken, and it is held to the injection byte
// budget like everything else Skye is told to say.
import { offBoardStay, occupancyById, stayName } from "../operations/allocation.ts";
import type { OpsAlert } from "../operations/boardAlerts.ts";
import { OPS_FLIGHTS_BY_ID } from "../operations/operationsData.ts";
import { fixFor, movesLateStay, planFixAll, type AlertFix, type FixAllPlan } from "../operations/priorities.ts";
import { DEMO_DATA, formatUtc } from "../stand-timeline-demo/demoData.ts";
import { ghostMs } from "../stand-timeline-demo/delays.ts";
import { injectionByteLength, MAX_INJECTION_BYTES } from "./liveEvents.ts";

/** One open alert as something to do: what it is, and what Skye can do about it. */
export type WorkItem = {
  alert: OpsAlert;
  fix: AlertFix | null;
  /** "the A1 conflict: …; moving XB210/211 to C25 clears it". */
  said: string;
  /** "move XB210/211 to C25", for "Want me to …?"; null when there is no fix. */
  offer: string | null;
};

const stayLabel = (stayId: string) => {
  const stay = occupancyById(stayId) ?? offBoardStay(stayId);
  return stay ? stayName(stay) : stayId;
};

export function workItem(alert: OpsAlert): WorkItem {
  const fix = fixFor(alert);
  const flight = OPS_FLIGHTS_BY_ID.get(alert.flightId);
  if (alert.kind === "conflict") {
    const stand = alert.conflict?.standId ?? "";
    const offer = fix?.kind === "move" ? `move ${stayLabel(fix.stayId)} to ${fix.standId}` : null;
    return {
      alert,
      fix,
      said:
        `the ${stand} conflict: ${alert.title}` +
        (offer && fix ? `; moving ${stayLabel(fix.stayId)} to ${fix.standId} clears it` : "; no free stand clears it"),
      offer,
    };
  }
  if (alert.kind === "no_stand" && flight) {
    const stay = flight.unplacedStay;
    if (!stay) {
      return { alert, fix, said: `${flight.flight}, which has no stay times yet, so it can't be placed`, offer: null };
    }
    const from = formatUtc(stay.start);
    return fix
      ? {
          alert,
          fix,
          said: `${flight.flight}, which needs a stand from ${from}; ${fix.standId} is free for it`,
          offer: `put ${flight.flight} on ${fix.standId}`,
        }
      : { alert, fix, said: `${flight.flight}, which needs a stand from ${from}, and none that fits is free`, offer: null };
  }
  return { alert, fix: null, said: alert.title, offer: null };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const listWords = (words: readonly string[]) =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/** "2 conflicts, 5 flights with no stand and 2 notices". */
function counts(open: readonly OpsAlert[]): string {
  const of = (kind: OpsAlert["kind"]) => open.filter((alert) => alert.kind === kind).length;
  return listWords(
    [
      of("conflict") && plural(of("conflict"), "conflict", "conflicts"),
      of("no_stand") && plural(of("no_stand"), "flight with no stand", "flights with no stand"),
      of("notice") && plural(of("notice"), "notice", "notices"),
    ].filter((part): part is string => !!part),
  );
}

/** "55m", "1h", "1h 20m": how late, said quickly. */
function lateBy(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "A1 conflict, XA103/104 55m late." */
function conflictLine(alert: OpsAlert): string {
  const conflict = alert.conflict;
  if (!conflict) return `${alert.heading ?? alert.title}.`;
  const ms = ghostMs(DEMO_DATA.delays.get(conflict.stayId), conflict.side);
  return `${conflict.standId} conflict, ${stayLabel(conflict.stayId)} ${lateBy(ms)} late.`;
}

/**
 * Skye's offer to take what is open as one plan, saying what it keeps, so a
 * yes is to something specific; null when the plan changes nothing.
 */
function planOffer(plan: FixAllPlan): string | null {
  if (plan.moves.length + plan.assigns.length === 0) return null;
  return plan.moves.length > 0 && !movesLateStay(plan.moves)
    ? "I can take it as one plan: the late aircraft stay put and I fit everything else around them. Want me to?"
    : "I can take it as one plan, fitted around everything else. Want me to?";
}

/**
 * The briefing for the open alerts (most pressing first): how many, a few
 * words on each, and an offer to take them as one plan. `offersPlan` says a
 * yes should carry out fix_all, which plans again against the board as it is
 * then.
 */
export function briefing(open: readonly OpsAlert[]): {
  spoken: string;
  offersPlan: boolean;
  /** What it names, in the order it does. */
  mentioned: OpsAlert[];
} {
  if (open.length === 0) {
    return { spoken: "Nothing's open: no conflicts, and every flight that can have a stand has one.", offersPlan: false, mentioned: [] };
  }
  const plan = planFixAll(open, "all");
  const conflicts = open.filter((alert) => alert.kind === "conflict");
  // Every item, in the Alerts window's order, so the one she is on is picked
  // out there as she gets to it: flights that can be placed, then the ones
  // the plan can't place, then the notices.
  const placeable = (alert: OpsAlert) => !plan.left.some((entry) => entry.alertId === alert.id);
  const waiting = open.filter((alert) => alert.kind === "no_stand" && placeable(alert));
  const stuck = open.filter((alert) => alert.kind === "no_stand" && !placeable(alert));
  const notices = open.filter((alert) => alert.kind === "notice");
  const flightOf = (alert: OpsAlert) => OPS_FLIGHTS_BY_ID.get(alert.flightId)?.flight ?? alert.flightId;
  const stuckBeat = (alert: OpsAlert) =>
    OPS_FLIGHTS_BY_ID.get(alert.flightId)?.unplacedStay
      ? `${flightOf(alert)} has no stand that fits.`
      : `${flightOf(alert)} has no stay times yet.`;

  // "open items", not a bare number: said as "9 open", it was heard as 9 conflicts.
  const summary = `${plural(open.length, "open item", "open items")}.`;
  const offer = planOffer(plan);
  const say = (conflictBeats: readonly string[], waitingBeat: string) =>
    [
      summary,
      ...conflictBeats,
      waitingBeat,
      ...stuck.map(stuckBeat),
      notices.length > 0 ? `For info: ${listWords(notices.map((alert) => alert.title))}.` : "",
      offer ?? "",
    ]
      .filter(Boolean)
      .join(" ");
  const waitingNamed =
    waiting.length === 0
      ? ""
      : `${listWords(waiting.map(flightOf))} ${waiting.length === 1 ? "needs a stand" : "need stands"}.`;
  const waitingCounted = waiting.length > 1 ? `${waiting.length} flights need stands.` : waitingNamed;
  const conflictsCounted =
    conflicts.length > 0
      ? [`${plural(conflicts.length, "conflict", "conflicts")}, on ${listWords(conflicts.map((alert) => alert.conflict?.standId ?? ""))}.`]
      : [];
  // Each item named, unless that is too long to say; then the waiting flights
  // counted, then the conflicts too.
  const spoken =
    [
      say(conflicts.map(conflictLine), waitingNamed),
      say(conflicts.map(conflictLine), waitingCounted),
      say(conflictsCounted, waitingCounted),
    ].find((text) => injectionByteLength(text) <= MAX_INJECTION_BYTES) ?? `${summary.slice(0, -1)}: ${counts(open)}. ${offer ?? ""}`.trim();
  return {
    spoken,
    offersPlan: offer !== null,
    mentioned: [...conflicts, ...waiting, ...stuck],
  };
}

/**
 * After a change that cleared something: what is up next, offered the same
 * way, so the open items can be worked through one at a time. Null when
 * nothing left has a fix.
 */
export function nextUp(open: readonly OpsAlert[]): { spoken: string; fix: AlertFix; alert: OpsAlert } | null {
  const item = open
    .filter((alert) => alert.kind !== "notice")
    .map(workItem)
    .find((entry) => entry.offer && entry.fix);
  return item?.fix && item.offer
    ? { spoken: `Next up: ${item.said}. Want me to ${item.offer}?`, fix: item.fix, alert: item.alert }
    : null;
}
