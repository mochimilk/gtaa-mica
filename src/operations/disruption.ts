// Scenario 1, disruption resolution (see docs/disruption-demo.md): a late
// arrival, caught as the news comes in. XD472/473, a B789 on B11, is found
// running 1h 50m late, so its 3h 00m turn now ends at 13:30. That runs into
// the two arrivals behind it on B11, and the knock-on would hold three more:
// five aircraft off their stand. Skye says so (DisruptionNotice, above Ask
// Skye), and on Review weighs it across the plan and moves the two it runs
// into (resolve_disruption), keeping the late aircraft where it is. Two moves,
// on purpose: one on the same pier, one to another pier that brings baggage in,
// which is the whole story in the time a demo has.
//
// When the news "arrives" is the demo's choice, not Skye's: see
// ./disruptionTrigger. Everything here works from the board as it is, so
// the words on the notice and in Skye's replies stay true to it.
//
// SYNTHETIC: the flight, its cause and its delay are invented for the demo.
import type { Occupancy } from "../stand-timeline";
import { DEMO_DATA, formatUtc } from "../stand-timeline-demo/demoData";
import { formatDelay, ghostClashes, ghostKey, GHOST_SIDES, type GhostClashes } from "../stand-timeline-demo/delays";
import { AIRPORT_NAMES } from "../stand-timeline-demo/airports";
import { SYNTHETIC_STANDS } from "../stand-timeline-demo/syntheticFixture";
import { logActivity } from "./activity";
import { bagMove, maintenanceMove, type MaintenanceMove } from "./baggage";
import { boardKpis, type BoardKpis, type GateHold } from "./boardKpis";
import {
  closedDuring,
  fitsStand,
  flightsAtStay,
  occupancyById,
  setRunningLate,
  standArea,
  standState,
  stayName,
  type AreaMove,
} from "./allocation";
import { OPS_FLIGHTS_BY_ID, formatDuration } from "./operationsData";
import { stayLabel, type OutputDecision } from "./outputs";
import type { ReviewChange } from "./skyeReview";

/** The disruption: which stay runs late, by how much, and why. */
export const DISRUPTION = {
  /** XD472/473's stay on B11. */
  stayId: "T24-1",
  /** Its inbound flight, XD472, which the news is about. */
  flightId: "T24-ARR",
  /** Minutes late onto its stand. */
  delayIn: 110,
  /**
   * Minutes late off it: the delay carries through its turn. It ends at 13:30,
   * into XC344/345 and XB232/233 and clear of XA117/118 (13:55), so Skye
   * moves two flights, not four.
   */
  delayOut: 110,
  /** Why it is late in, as the airline's update puts it. */
  cause: "Held at origin for a late inbound crew",
} as const;

/* ------------------------------------------------------------------ state */

export type NoticeState =
  /** Skye has said nothing yet: the news has not arrived, or it is on the board and she has yet to spot it. */
  | "none"
  /** Skye is telling the user, above Ask Skye. */
  | "shown"
  /** The user put it away without acting. */
  | "dismissed"
  /** The user pressed Review (or asked Skye): Skye is on it. */
  | "running"
  /** Her plan is approved: the notice shows what it did against the baseline, and that it is logged. */
  | "approved"
  /** The user put that away. */
  | "closed";

export type DisruptionState = {
  /** When the news arrived (Date.now()), or null before it has. */
  landedAt: number | null;
  notice: NoticeState;
  /**
   * The board's figures as the news arrived, before anyone did anything about
   * it: what Skye's plan and the approved one are measured against.
   */
  baseline: BoardKpis | null;
  /** Once her plan is approved: the logged decision, and the board against the baseline then. */
  approved: { decision: OutputDecision; impact: Impact } | null;
};

let state: DisruptionState = { landedAt: null, notice: "none", baseline: null, approved: null };
const listeners = new Set<() => void>();

function set(next: DisruptionState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore. */
export const disruptionState = (): DisruptionState => state;
export function subscribeDisruption(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The news arrives: the flight is running late from now on (setRunningLate)
 * and its conflicts show on the board. Skye tells the user a moment later
 * (announceDisruption). Once only; returns whether it landed now.
 */
export function landDisruption(now = Date.now()): boolean {
  if (state.landedAt !== null) return false;
  if (!setRunningLate(DISRUPTION.stayId, DISRUPTION.delayIn, DISRUPTION.delayOut)) return false;
  set({ landedAt: now, notice: "none", baseline: boardKpis(standState()), approved: null });
  const words = disruptionNotice();
  if (words) logActivity("Flight update", "news", `${words.context} ${words.turn}`, now);
  return true;
}

/**
 * Skye has spotted the news on the board: the notice shows. Only once it has
 * landed, and only if nobody has acted on it yet; returns whether it showed.
 */
export function announceDisruption(): boolean {
  if (state.landedAt === null || state.notice !== "none") return false;
  set({ ...state, notice: "shown" });
  const words = disruptionNotice();
  if (words) logActivity("Skye", "said", `Flagged it. ${words.conflict}`);
  return true;
}

/**
 * Changes the user approved (see ./skyeReview): when they settle the
 * disruption (nothing would wait for its stand any more), the notice shows
 * what the approved plan did against the baseline, and that it is logged.
 * Returns whether they did.
 */
export function settleDisruption(decision: OutputDecision): boolean {
  const impact = impactNow();
  if (state.landedAt === null || !impact || state.approved || standHolds().length > 0) return false;
  set({ ...state, notice: "approved", approved: { decision, impact } });
  logActivity("Skye", "applied", appliedLine(impact));
  return true;
}

/** The user puts away the approved plan's result. */
export function closeDisruptionResult(): void {
  if (state.notice === "approved") set({ ...state, notice: "closed" });
}

/** The user puts the notice away; the disruption stays on the board. */
export function dismissDisruptionNotice(): void {
  if (state.notice === "shown") set({ ...state, notice: "dismissed" });
}

/**
 * The user pressed Review, or asked Skye, maybe before she spoke up: the notice
 * goes (or never shows), and Skye takes it from there.
 */
export function markDisruptionRunning(): void {
  const before = state.notice === "none" && state.landedAt !== null;
  if (!before && state.notice !== "shown" && state.notice !== "dismissed") return;
  set({ ...state, notice: "running" });
  logActivity("You", "action", "Asked Skye to review it.");
}

/* ---------------------------------------------------------------- reading */

/** The late stay, on its stand. */
const lateStay = () => occupancyById(DISRUPTION.stayId);

/** The stays a late stay's ghosts run into on its stand, soonest first, given `clashes` (the board's by default). */
export function runsInto(stayId: string, clashes: GhostClashes = ghostClashes(DEMO_DATA.occupancies, DEMO_DATA.delays)): Occupancy[] {
  const into = new Map<string, Occupancy>();
  for (const side of GHOST_SIDES) for (const other of clashes.get(ghostKey(stayId, side)) ?? []) into.set(other.id, other);
  return [...into.values()].sort((a, b) => a.start - b.start);
}

/** Who would wait for B11 (or wherever the late stay is) now, soonest first. */
export function standHolds(kpis: BoardKpis = boardKpis(standState())): GateHold[] {
  const stand = lateStay()?.rowId;
  return kpis.holds.filter((hold) => hold.standId === stand);
}

/** "XD472", "XD472/473": the late flight's own number, and its stay's. */
function lateNames(): { flight: string; stay: string } {
  const flight = OPS_FLIGHTS_BY_ID.get(DISRUPTION.flightId)?.flight ?? "the late flight";
  const stay = lateStay();
  return { flight, stay: stay ? stayName(stay) : flight };
}

const listWords = (words: readonly string[]) =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * One thing on the late stay's stand, for the notice to name: its flights,
 * its hours there, and what it is doing in the story. The late stay first, its
 * hours as they are now, then whoever would wait, soonest first.
 */
export type StandSegment = { stayId: string; name: string; times: string; purpose: string; late: boolean };

/** What the notice says: the news, why, how long its turn runs, what it runs into, and what is on its stand. */
export type DisruptionNotice = {
  title: string;
  /** The news in a line, on the notice's pill: "XD472 from LHR 1h 50m late". */
  summary: string;
  /** Why it is late, and when it is due now. */
  context: string;
  /** How its turn comes to end when it does, in the figures the chart draws. */
  turn: string;
  /** What it runs into, and the knock-on. */
  conflict: string;
  segments: readonly StandSegment[];
};

/** "held at origin…": a cause, as it reads mid-sentence. */
const midSentence = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * The notice's words, from the board as it is: null while the news has not
 * arrived. Read again on each stand change, so it follows the board.
 */
export function disruptionNotice(): DisruptionNotice | null {
  const stay = lateStay();
  const flight = OPS_FLIGHTS_BY_ID.get(DISRUPTION.flightId);
  if (state.landedAt === null || !stay || !flight) return null;
  const { flight: name } = lateNames();
  const delay = DEMO_DATA.delays.get(stay.id);
  const late = delay?.in ?? 0;
  const leaves = stay.end + (delay?.out ?? 0);
  const into = runsInto(stay.id);
  const holds = standHolds();
  const waits = holds.reduce((sum, hold) => sum + hold.minutes, 0);
  const scheduledOn = stay.start - late;
  const leaving = flightsAtStay(stay.id).find((candidate) => candidate.direction === "departure")?.flight ?? "It";
  const dueLabel = (o: Occupancy) => `${stayName(o)} (${formatUtc(o.start)})`;
  // Whoever waits only because the aircraft before them does.
  const inTurn = holds.flatMap((hold) => {
    const other = into.some((entry) => entry.id === hold.stayId) ? undefined : occupancyById(hold.stayId);
    return other ? [other] : [];
  });
  const stayTimes = (o: Occupancy) => `${formatUtc(o.start)}–${formatUtc(o.end)}`;
  return {
    title: `${name} from ${AIRPORT_NAMES[flight.routeEnd] ?? flight.routeEnd} is ${formatDelay(late)} late`,
    summary: `${name} from ${flight.routeEnd} ${formatDelay(late)} late`,
    context: `${name} was ${midSentence(DISRUPTION.cause)}. Now due on ${stay.rowId} at ${formatUtc(stay.start)}, was ${formatUtc(scheduledOn)}.`,
    turn: `${leaving} now leaves at ${formatUtc(leaves)}, was ${formatUtc(stay.end)}.`,
    // Short: who it runs into by name, the knock-on counted; each is in the table below.
    conflict:
      into.length > 0
        ? `That runs into ${listWords(into.map(dueLabel))}` +
          (inTurn.length > 0 ? `, and the knock-on holds ${inTurn.length} more` : "") +
          "." +
          (waits > 0 ? ` ${plural(holds.length, "aircraft", "aircraft")} would wait ${formatDuration(waits)} in all.` : "")
        : `That is clear of anything else on ${stay.rowId}.`,
    segments: [
      {
        stayId: stay.id,
        name: stayName(stay),
        times: `${formatUtc(stay.start)}–${formatUtc(leaves)}`,
        purpose: `Late turn, was ${formatUtc(scheduledOn)}–${formatUtc(stay.end)}`,
        late: true,
      },
      ...holds.flatMap((hold): StandSegment[] => {
        const other = occupancyById(hold.stayId);
        if (!other) return [];
        const knockOn = inTurn.some((entry) => entry.id === other.id);
        return [
          {
            stayId: other.id,
            name: stayName(other),
            times: stayTimes(other),
            purpose: `${knockOn ? "Knock-on" : "Blocked"}, would wait ${formatDuration(hold.minutes)}`,
            late: false,
          },
        ];
      }),
    ],
  };
}

/* --------------------------------------------------------------- planning */

/** What Skye proposes for a late stay's knock-on, planned against the board as it is. */
export type DisruptionPlan = {
  /** The late stay; it keeps its stand. */
  stayId: string;
  /** Each stay it runs into, onto the nearest free stand that fits, keeping its times. */
  moves: AreaMove[];
  /** Stays it runs into that no stand could take. */
  stuck: string[];
  /** For each move, the stands looked at before the one chosen, nearest first, and why each would not do. */
  considered: { occupancyId: string; standId: string; reason: string }[];
};

const overlaps = (a: Occupancy, b: Occupancy) => a.start < b.end && b.start < a.end;

/**
 * Clears a late stay's knock-on by moving what it runs into, not the late
 * aircraft itself (already on its way in, with its passengers and bags headed
 * for its stand). Each stay it runs into, soonest first, goes to the nearest
 * stand that takes its aircraft and is free at its hours: its own pier first
 * (no change for its bags), then by how far the stand's row is from its own.
 * A move must add no conflict anywhere. Stays already planned count against a
 * stand. A greedy pass under the sample rules, not an allocator.
 */
export function planDisruption(stayId: string = DISRUPTION.stayId): DisruptionPlan {
  if (!occupancyById(stayId)) return { stayId, moves: [], stuck: [], considered: [] };
  return planKnockOn(
    stayId,
    DEMO_DATA.occupancies.map((o) => ({ ...o })),
  );
}

/**
 * planDisruption on `board`, a copy of the board that may carry other moves
 * planned already (see planFixAll), which this adds its own to: each stay
 * moved has its `rowId` changed there. Every move's `fromStand` is where the
 * stay is on `board`.
 */
export function planKnockOn(stayId: string, board: Occupancy[]): DisruptionPlan {
  const rowOf = new Map(DEMO_DATA.rows.map((row, index) => [row.id, index]));
  const moves: AreaMove[] = [];
  const stuck: string[] = [];
  const considered: DisruptionPlan["considered"] = [];

  for (const into of runsInto(stayId, ghostClashes(board, DEMO_DATA.delays))) {
    const stay = board.find((o) => o.id === into.id);
    if (!stay) continue;
    const area = standArea(stay.rowId);
    const row = rowOf.get(stay.rowId) ?? 0;
    const nearest = [...SYNTHETIC_STANDS].sort(
      (a, b) =>
        Number(a.area !== area) - Number(b.area !== area) ||
        Math.abs((rowOf.get(a.code) ?? 0) - row) - Math.abs((rowOf.get(b.code) ?? 0) - row) ||
        (rowOf.get(a.code) ?? 0) - (rowOf.get(b.code) ?? 0),
    );
    const before = ghostClashes(board, DEMO_DATA.delays);
    let chosen: string | null = null;
    for (const stand of nearest) {
      if (stand.code === stay.rowId) continue;
      const why = !fitsStand(stay, stand.code)
        ? "narrowbody only"
        : closedDuring(stand.code, stay.start, stay.end)
          ? "closed"
          : board.find((other) => other.rowId === stand.code && other.id !== stay.id && overlaps(stay, other));
      if (why) {
        considered.push({
          occupancyId: stay.id,
          standId: stand.code,
          reason: typeof why === "string" ? why : `taken by ${stayName(why)}`,
        });
        continue;
      }
      // Nothing new may clash there: neither its own ghosts nor anyone else's.
      const after = ghostClashes(
        board.map((o) => (o.id === stay.id ? { ...o, rowId: stand.code } : o)),
        DEMO_DATA.delays,
      );
      if ([...after.keys()].some((key) => !before.has(key))) {
        considered.push({ occupancyId: stay.id, standId: stand.code, reason: "a late stay there would run into it" });
        continue;
      }
      chosen = stand.code;
      break;
    }
    if (!chosen) {
      stuck.push(stay.id);
      continue;
    }
    moves.push({ occupancyId: stay.id, fromStand: stay.rowId, fromStart: stay.start, standId: chosen, shiftMs: 0 });
    stay.rowId = chosen;
  }
  return { stayId, moves, stuck, considered };
}

/* ---------------------------------------------------------- talking it over */

/** "5h 45m", or "none" for nothing. */
export const formatHold = (minutes: number) => (minutes > 0 ? formatDuration(minutes) : "none");

/** How the board compares with how it was when the news arrived, for Skye and the approval. */
export type Impact = {
  gateHold: { before: number; after: number };
  conflicts: { before: number; after: number };
  /** Stand use, as whole percentage points. */
  standUse: { before: number; after: number };
  held: { before: number; after: number };
};

/** The board now against `baseline` (the board as the news arrived, by default); null before it has. */
export function impactNow(baseline: BoardKpis | null = state.baseline, now: BoardKpis = boardKpis(standState())): Impact | null {
  if (!baseline) return null;
  const percent = (share: number) => Math.round(share * 100);
  return {
    gateHold: { before: baseline.gateHoldMinutes, after: now.gateHoldMinutes },
    conflicts: { before: baseline.conflicts.length, after: now.conflicts.length },
    standUse: { before: percent(baseline.standUse), after: percent(now.standUse) },
    held: { before: baseline.holds.length, after: now.holds.length },
  };
}

/**
 * Skye's answer to "why" after proposing her plan (explain_plan): why the
 * late aircraft keeps its stand, what each move does, and what it costs, in
 * figures against the board as the news arrived.
 */
export function explainPlan(): string {
  const stay = lateStay();
  const impact = impactNow();
  if (!stay || state.landedAt === null || !impact) {
    return "There's no disruption on the board to explain: every stay is where the plan has it.";
  }
  const { stay: name } = lateNames();
  const moved = [...movedFrom].flatMap(([id, from]) => {
    const other = occupancyById(id);
    return other && other.rowId !== from ? [`${stayName(other)} moves from ${from} to ${other.rowId}`] : [];
  });
  const holdLine =
    impact.gateHold.before === impact.gateHold.after
      ? `Gate hold is ${formatHold(impact.gateHold.after)}, as it was.`
      : `Gate hold goes from ${formatHold(impact.gateHold.before)} to ${formatHold(impact.gateHold.after)}` +
        (impact.held.before > impact.held.after
          ? `: ${plural(impact.held.before - impact.held.after, "aircraft", "aircraft")} no longer wait for a stand.`
          : ".");
  const into = [...new Set([...movedFrom.keys()].flatMap((id) => occupancyById(id)?.rowId ?? []))];
  const useLine =
    impact.standUse.before === impact.standUse.after
      ? `Stand use stays at ${impact.standUse.after}%.`
      : `Stand use goes from ${impact.standUse.before}% to ${impact.standUse.after}%, using free time on ${listWords(into)}.`;
  const why =
    `${name} keeps ${stay.rowId}: it's already inbound, with its passengers and bags headed there, and moving a widebody mid-turn means a tow. ` +
    "The arrivals behind it haven't landed yet, so moving them costs nothing on the ground.";
  return [
    why,
    moved.length > 0 ? `So ${listWords(moved)}.` : "",
    holdLine,
    useLine,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Where each stay Skye's plan moved was before she moved it, so she can say later what it moved. */
const movedFrom = new Map<string, string>();

/** Notes the plan Skye is carrying out (resolve_disruption), for explainPlan. */
export function rememberPlan(plan: DisruptionPlan): void {
  for (const move of plan.moves) if (!movedFrom.has(move.occupancyId)) movedFrom.set(move.occupancyId, move.fromStand);
}

/** "XD472 from London Heathrow is running late and causing conflicts on the board": the flight, where from, what it is doing. */
function lateFlightLine(): string | null {
  const flight = OPS_FLIGHTS_BY_ID.get(DISRUPTION.flightId);
  if (!flight || !disruptionNotice()) return null;
  const from = AIRPORT_NAMES[flight.routeEnd] ?? flight.routeEnd;
  return `${flight.flight} from ${from} is running late and causing conflicts on the board`;
}

/**
 * Skye's heads-up as the news arrives, in a line: the flight, where it is
 * from and what it is doing, and her offer to look at it, nothing more, as
 * the notice has the details. Written in the chat off a call, and kept as
 * her offer.
 */
export function headsUp(): string | null {
  const line = lateFlightLine();
  return line ? `Heads-up: ${line}. Want to take a look?` : null;
}

/**
 * How Skye brings the news up on a call: steering, not a script, so she puts
 * it in her own words, as she does her hello. A quick heads-up in the
 * notice's order (the flight, where it is from, what it is doing) and an
 * offer, leaving times and figures to the notice; she is told the news
 * itself, so she can answer if asked more.
 */
export function headsUpCue(): string | null {
  const words = disruptionNotice();
  const line = lateFlightLine();
  return words && line
    ? `News just in: ${words.title}, and it now runs into other flights on the stand plan. ` +
        "Give the caller a quick heads-up in your own words, one short casual sentence, in this order: the flight number, " +
        `where it's from, then what it's doing, along the lines of "${line}". ` +
        "Skip times and figures, as they're on screen. Ask if they want to take a look, then stop."
    : null;
}

/** What the record says of the plan applied: where everything is now, against the board as the news arrived. */
function appliedLine(impact: Impact): string {
  const moved = [...movedFrom].flatMap(([id, from]) => {
    const other = occupancyById(id);
    return other && other.rowId !== from ? [`${stayName(other)} on ${other.rowId}`] : [];
  });
  const stay = lateStay();
  const kept = stay ? `${stayName(stay)} keeps ${stay.rowId}` : "";
  const carousels = maintenanceMove();
  return (
    `Applied. ${[kept, ...moved].filter(Boolean).join(", ")}.` +
    (carousels ? ` Carousel ${carousels.carousel}'s maintenance is now ${formatUtc(carousels.to.start)}–${formatUtc(carousels.to.end)}.` : "") +
    ` Gate hold ${formatHold(impact.gateHold.before)} → ${formatHold(impact.gateHold.after)}, conflicts ${impact.conflicts.before} → ${impact.conflicts.after},` +
    ` stand use ${impact.standUse.before}% → ${impact.standUse.after}%.`
  );
}

/**
 * What Skye says once her plan is approved: that it is logged, and what it
 * did against the baseline, in a line; the moves themselves are on the board.
 */
export function settledLine(): string | null {
  const approved = state.approved;
  if (!approved) return null;
  const { gateHold, conflicts } = approved.impact;
  return (
    `Approved and logged. Gate hold is down from ${formatHold(gateHold.before)} to ${formatHold(gateHold.after)}` +
    `${conflicts.after === 0 ? ", no conflicts left" : ""}.`
  );
}

/**
 * What Skye tells a teammate she has called in to approve her changes (see
 * ../operations/skyeReview), once they pick up: the news, when it is the
 * disruption's; each change in their area, by its arrival's flight, where it
 * goes and what it means for them; any carousel maintenance moved; and the
 * ask. For baggage, the changes that move a flight's bags. She greets whoever
 * is on the call (`onCall`, the teammate among them): them by name, two by
 * both names, more all at once, and with others there she says which part is
 * the teammate's. As short as it can be: the agenda and the cards on screen
 * say the rest (what doesn't touch them, where each came from, the figures).
 */
export const teammateBrief = (name: string, changes: readonly ReviewChange[], onCall: readonly string[] = [name]): string =>
  teammateBriefScript(name, changes, onCall).text;

/**
 * What Skye points at on the call's shared approval as her brief comes to it
 * (../approvals/walkThrough): the changes as a whole (`look`), a change in
 * the teammate's area (`card`), one of its stands (`stand`), what it does to
 * the bags (`bags`), the carousel maintenance she has moved (`maintenance`),
 * the changes that move none (`others`), or the decision (`ask`). Her brief
 * names only the stand a change goes to; `from` and `others` are there for a
 * longer walk-through.
 */
export type BriefPoint =
  | { kind: "look" | "ask" | "maintenance" }
  | { kind: "card" | "bags"; stayId: string }
  | { kind: "stand"; stayId: string; end: "from" | "to" }
  | { kind: "others"; stayIds: readonly string[] };

/**
 * A point in Skye's brief, `at` characters into its words, and `words`, any
 * of which, said, is where she comes to it (she puts the brief in her own
 * words, so `at` only says roughly where); none for where she starts.
 */
export type BriefBeat = BriefPoint & { at: number; words?: readonly string[] };

/** Words Skye comes to what a change does to the bags with, or, on the same pier, to its new times. */
const BAGS_WORDS = ["bags", "bag", "baggage", "carousel", "carousels"];
const TIMES_WORDS = ["now", "times", "bags"];
/** And the maintenance she has moved, and her ask. */
const MAINTENANCE_WORDS = ["maintenance", "belt"];
const ASK_WORDS = ["approve", "approval", "sign", "okay", "ok", "good"];

/** Skye's brief (teammateBrief), with where in it she comes to each thing on the shared approval. */
export type BriefScript = { text: string; beats: readonly BriefBeat[] };

/**
 * teammateBrief, with its beats: where each change, stand and what it does to
 * the bags come up. `introduced` when the user has greeted them and handed
 * over to Skye (hearCaller in ../live/callController): she goes straight to
 * the changes, with no hello and no news, as the user has given both.
 */
export function teammateBriefScript(
  name: string,
  changes: readonly ReviewChange[],
  onCall: readonly string[] = [name],
  { introduced = false }: { introduced?: boolean } = {},
): BriefScript {
  const theirs = changes.filter((change) => change.baggage);
  const firstName = (who: string) => who.split(" ")[0];
  const company = onCall.some((who) => who !== name);
  let text = "";
  const beats: BriefBeat[] = [];
  const say = (words: string) => void (text += words);
  /** A space between sentences, none before the first. */
  const gap = () => (text ? " " : "");
  const point = (where: BriefPoint, words?: readonly string[]) => void beats.push({ ...where, at: text.length, words });

  point({ kind: "look" });
  if (!introduced) {
    say(
      onCall.length <= 1
        ? `Hey ${firstName(name)}.`
        : onCall.length === 2
          ? `Hi ${listWords(onCall.map(firstName))}.`
          : "Hi everyone.",
    );
  }
  // The news in a few words: the figures are on the agenda.
  const lead = !introduced && state.landedAt !== null && lateStay() ? `${lateNames().flight} is running late` : "";
  const area = (standId: string) => (standId ? (standArea(standId) ?? standId) : "no stand");
  if (theirs.length > 0) {
    if (company) say(`${lead ? `${gap()}${lead}.` : ""}${gap()}${firstName(name)}, for you: `);
    else say(lead ? `${gap()}${lead}, so ` : gap());
    theirs.forEach((change, index) => {
      if (index > 0) say(index === theirs.length - 1 ? ". And " : ". ");
      const { stayId } = change;
      const [from, to] = [area(change.from.rowId), area(change.to.rowId)];
      // Its arrival's flight alone: "XC344", not "XC344 slash 345".
      const flight = stayLabel(stayId).split("/")[0];
      point({ kind: "card", stayId }, [flight]);
      say(`${flight} moves `);
      point({ kind: "stand", stayId, end: "to" }, change.to.rowId ? [change.to.rowId] : ["stand"]);
      say(`to ${change.to.rowId || "no stand"}`);
      const times = `${formatUtc(change.to.start)}–${formatUtc(change.to.end)}`;
      const bags = bagMove(stayId, change.from, change.to);
      say(from === to ? ", " : " and ");
      if (from === to) {
        point({ kind: "bags", stayId }, TIMES_WORDS);
        say(`now ${times}`);
      } else {
        point({ kind: "bags", stayId }, BAGS_WORDS);
        say(
          bags?.was && bags.now
            ? `its bags go from carousel ${bags.was.carousel} to ${bags.now.carousel}`
            : `its bags go to ${to} instead of ${from}`,
        );
      }
    });
    say(".");
  } else if (lead) {
    say(`${gap()}${lead}.`);
  }
  const maintenance = maintenanceMove();
  if (maintenance) {
    say(gap());
    point({ kind: "maintenance" }, MAINTENANCE_WORDS);
    say(`To make room, carousel ${maintenance.carousel}'s maintenance moves to ${formatUtc(maintenance.to.start)}–${formatUtc(maintenance.to.end)}.`);
  }
  say(gap());
  point({ kind: "ask" }, ASK_WORDS);
  say("Can you approve?");
  return { text, beats };
}

/**
 * The question a baggage lead would put before signing off on carousel
 * maintenance moved, and Skye's answer, in figures from the plan: nothing lands
 * on it in the meantime. Null when she has moved none. Her answer is a script
 * too, for her cursor: the maintenance itself, then the bags it makes room for.
 */
export type TeammateFollowUp = { question: string; answer: BriefScript };

export function teammateFollowUp(maintenance: MaintenanceMove | null = maintenanceMove()): TeammateFollowUp | null {
  if (!maintenance) return null;
  const { carousel, bags, flight, stayId, next } = maintenance;
  // One sentence each way: the times are on the maintenance card.
  const lead = `No. ${flight}'s `;
  const after = next ? `, and the next are ${next.flight}'s at ${formatUtc(next.start)}, after it's back.` : ", and nothing else is due on it after.";
  const text = `${lead}bags are off by ${formatUtc(bags.end)}${after}`;
  return {
    question: `Quick one: does anything land on carousel ${carousel} while the belt's out?`,
    answer: {
      text,
      beats: [
        { kind: "maintenance", at: 0, words: MAINTENANCE_WORDS },
        { kind: "bags", stayId, at: lead.length, words: BAGS_WORDS },
      ],
    },
  };
}

/** What a teammate is cued to ask, before approving: only that, then to wait for Skye's answer. App-authored. */
export const teammateQuestionCue = (question: string): string =>
  "Skye just asked you to approve, but you want to check one thing first. Ask her now, out loud, in your own " +
  `words, friendly and at an ordinary pace, one short question: "${question}" Then stop and wait for her answer. Don't approve yet.`;

/** Where a teammate asking comes to the end of what teammateQuestionCue asks of him. */
export const teammateQuestionEnded = (said: string): boolean => said.includes("?");

/**
 * What a teammate who answers Skye aloud (../live/teammateVoice) is cued to
 * say back to her brief (teammateBrief), straight on, as a colleague answers,
 * in one short sentence: that works, and he approves. No thanks: the user
 * thanks him next, and he says goodbye to that (teammateGoodbyeCue). With
 * what she `answered` to a question of his, that settles it first.
 * App-authored.
 */
export const teammateCue = (answered?: string): string =>
  (answered
    ? `Skye just answered your question: "${answered}" That settles it. Answer her now, out loud, in your own words, friendly and quick, `
    : "Skye just asked you to approve. Answer her now, out loud, in your own words, friendly and quick, ") +
  "in one short sentence with no pauses: that works, and it's approved for baggage. Nothing more.";

/**
 * What a teammate who stayed on for the user (stayForGoodbye in
 * ../live/callGuests) is cued to say as they approve the plan: they have just
 * thanked him, so a goodbye in a couple of words. App-authored.
 */
export const teammateGoodbyeCue = (): string =>
  "The stand allocator on the call just thanked you and approved the plan, and the call is ending. " +
  'Say goodbye now, out loud, in two or three words, like "Cheers, bye!" Nothing more.';

/** Where a teammate saying goodbye comes to the end of what teammateGoodbyeCue asks of him. */
export const teammateGoodbyeEnded = (said: string): boolean => /\b(bye|cheers|see ya|later)\b/i.test(said);

/**
 * What Skye asked him to approve, for him to know without saying it (it goes
 * as quiet facts with his cue); null when none of it is his.
 */
export function teammateContext(changes: readonly ReviewChange[]): string | null {
  const area = (standId: string) => (standId ? (standArea(standId) ?? standId) : "no stand");
  const moves = changes
    .filter((change) => change.baggage)
    .map((change) => {
      const [from, to] = [area(change.from.rowId), area(change.to.rowId)];
      return from === to
        ? `${stayLabel(change.stayId)} on new times`
        : `${stayLabel(change.stayId)}'s bags going to ${to} instead of ${from}`;
    });
  const maintenance = maintenanceMove();
  if (maintenance && moves.length > 0) {
    moves.push(`carousel ${maintenance.carousel}'s maintenance moving to ${formatUtc(maintenance.to.start)}–${formatUtc(maintenance.to.end)}`);
  }
  return moves.length > 0 ? `What Skye asked you to approve: ${listWords(moves)}.` : null;
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const countWord = (count: number) => COUNT_WORDS[count] ?? String(count);

/**
 * What a review is for, written where everyone on the call can read it,
 * without hearing Skye: the delay, when it is the disruption's, then how many
 * stand changes she proposes, then those baggage has to approve, then any
 * carousel maintenance moved. Once decided, in the past.
 */
export function reviewAgenda(
  { moves, forBaggage, maintenance }: { moves: number; forBaggage: number; maintenance: boolean },
  decided = false,
): string {
  const stay = lateStay();
  const news =
    state.landedAt !== null && stay
      ? `${lateNames().flight} ${decided ? "was" : "is"} ${formatDelay(DEMO_DATA.delays.get(stay.id)?.in ?? 0)} late. `
      : "";
  const count = `${countWord(moves)} stand change${moves === 1 ? "" : "s"} ${decided ? (moves === 1 ? "was" : "were") : moves === 1 ? "is" : "are"} proposed`;
  const baggage =
    forBaggage === 0
      ? "; none affect baggage"
      : `; ${countWord(forBaggage).toLowerCase()} ${decided ? (forBaggage === 1 ? "needed" : "needed") : forBaggage === 1 ? "requires" : "require"} baggage review`;
  return `${news}${count}${baggage}${maintenance ? ", with one carousel maintenance move" : ""}.`;
}

/**
 * Where a teammate answering aloud comes to the end of what teammateCue asks
 * of him: he has approved. He is done once his voice stops too, so the rest of
 * his sentence is heard out.
 */
export const teammateCueEnded = (said: string): boolean => /\bapprov/i.test(said);

/**
 * What Skye says once a teammate has approved aloud and someone else still
 * has to, as he hangs up: thanks. When it is the user's to approve now
 * (`yours`), that it's over to them; on a call, he stays on for the user
 * instead, and she says nothing (DisruptionNotice's briefAloud).
 */
export const handOffLine = (name: string, yours: boolean): string =>
  `Thanks, ${name.split(" ")[0]}!${yours ? " Over to you to approve." : ""}`;

/**
 * What Skye is on, pinned in the dock (SkyeTask): "XD472/473 · 1h 50m late",
 * from as she brings it up until her plan's result is put away, "XD472/473 ·
 * Cleared" meanwhile; null otherwise.
 */
export function disruptionTask(): string | null {
  const stay = lateStay();
  if (!stay) return null;
  if (state.notice === "approved") return `${lateNames().stay} · Cleared`;
  if (state.notice !== "shown" && state.notice !== "running") return null;
  return `${lateNames().stay} · ${formatDelay(DEMO_DATA.delays.get(stay.id)?.in ?? 0)} late`;
}

/** What the result's details say was applied, in a line: each stay moved, and any maintenance. */
export function appliedSummary(): string {
  const moved = [...movedFrom].flatMap(([id, from]) => {
    const other = occupancyById(id);
    return other && other.rowId !== from ? [`${stayName(other)} on ${other.rowId}`] : [];
  });
  const carousels = maintenanceMove();
  return (
    `${moved.length === 1 ? "1 stand change" : `${moved.length} stand changes`} applied: ${listWords(moved)}.` +
    (carousels ? ` Carousel ${carousels.carousel}'s maintenance is now ${formatUtc(carousels.to.start)}–${formatUtc(carousels.to.end)}.` : "")
  );
}
