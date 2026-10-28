// Scenario 1, disruption resolution (see docs/disruption-demo.md): a late
// arrival, caught as the news comes in. XD472/473, a B789 on B11, is found
// running 1h 50m late. Its turn then runs into the two arrivals behind it on
// B11, and the knock-on would hold four aircraft off their stand. Skye says
// so (DisruptionNotice, above Ask Skye), and on Run weighs it across the plan
// and moves what the late aircraft runs into (resolve_disruption), keeping the
// late aircraft where it is.
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
import { boardKpis, type BoardKpis, type GateHold } from "./boardKpis";
import {
  closedDuring,
  fitsStand,
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
  /** Minutes late off it: the turn keeps its length, so the whole delay carries through. */
  delayOut: 110,
  /** Why, as the airline's update puts it. */
  cause: "Held at origin for a late inbound crew",
} as const;

/* ------------------------------------------------------------------ state */

export type NoticeState =
  /** Nothing has happened yet. */
  | "none"
  /** Skye is telling the user, above Ask Skye. */
  | "shown"
  /** The user put it away without acting. */
  | "dismissed"
  /** The user pressed Run: Skye is on it. */
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
 * The news arrives: the flight is running late from now on (setRunningLate),
 * its conflicts show on the board, and the notice shows. Once only; returns
 * whether it landed now.
 */
export function landDisruption(now = Date.now()): boolean {
  if (state.landedAt !== null) return false;
  if (!setRunningLate(DISRUPTION.stayId, DISRUPTION.delayIn, DISRUPTION.delayOut)) return false;
  set({ landedAt: now, notice: "shown", baseline: boardKpis(standState()), approved: null });
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

/** The user pressed Run: the notice goes, and Skye takes it from there. */
export function markDisruptionRunning(): void {
  if (state.notice === "shown" || state.notice === "dismissed") set({ ...state, notice: "running" });
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

/** What the notice says: the news, why, what it runs into, and what is needed. */
export type DisruptionNotice = {
  title: string;
  /** Why it is late, and when it is due now. */
  context: string;
  /** What it runs into, and the knock-on. */
  conflict: string;
  /** What has to happen, by when. */
  action: string;
};

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
  const first = into[0];
  return {
    title: `${name} from ${AIRPORT_NAMES[flight.routeEnd] ?? flight.routeEnd} is ${formatDelay(late)} late`,
    context: `${DISRUPTION.cause}. Now due on ${stay.rowId} at ${formatUtc(stay.start)}, was ${formatUtc(stay.start - late)}.`,
    conflict:
      into.length > 0
        ? `Its turn now runs to ${formatUtc(leaves)}, into ${listWords(into.map((other) => `${stayName(other)} (${formatUtc(other.start)})`))}.` +
          (waits > 0 ? ` The knock-on holds ${plural(holds.length, "arrival")} for ${formatDuration(waits)} in all.` : "")
        : `Its turn now runs to ${formatUtc(leaves)}, clear of anything else on ${stay.rowId}.`,
    action: first
      ? `Re-plan ${stay.rowId} before ${stayName(first).split("/")[0]} is due at ${formatUtc(first.start)}.`
      : "Nothing to re-plan: the stand is clear behind it.",
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

/** What Skye says as the news arrives: the notice, said, and her offer to work it. */
export function headsUp(): string | null {
  const words = disruptionNotice();
  return words ? `Heads-up: ${words.title}. ${words.conflict} Want me to work it?` : null;
}

/** What Skye says once her plan is approved: what it did against the baseline, and that it is logged. */
export function settledLine(): string | null {
  const approved = state.approved;
  if (!approved) return null;
  const { gateHold, conflicts } = approved.impact;
  const moved = [...movedFrom].flatMap(([id]) => {
    const stay = occupancyById(id);
    return stay ? [`${stayName(stay)} on ${stay.rowId}`] : [];
  });
  return (
    `That's approved and logged. Gate hold is down from ${formatHold(gateHold.before)} to ${formatHold(gateHold.after)}` +
    `${conflicts.after === 0 ? ", with no conflicts left" : ""}.` +
    (moved.length > 0 ? ` ${listWords(moved)}, and ${lateNames().stay} keeps ${lateStay()?.rowId ?? "its stand"}.` : "")
  );
}

/**
 * What Skye tells a teammate she has called in to approve her changes (see
 * ../operations/skyeReview), once they pick up: the news, when it is the
 * disruption's; each change in their area and what it means for them; what
 * else moved that does not touch them; and the ask. For baggage, the changes
 * that move a flight's bags.
 */
export function teammateBrief(name: string, changes: readonly ReviewChange[]): string {
  const theirs = changes.filter((change) => change.baggage);
  const parts = [`${name.split(" ")[0]}, it's Skye.`];
  const stay = lateStay();
  if (state.landedAt !== null && stay) {
    parts.push(`${lateNames().flight} is ${formatDelay(DEMO_DATA.delays.get(stay.id)?.in ?? 0)} late on ${stay.rowId}, so I've re-planned the arrivals behind it.`);
  }
  const area = (standId: string) => (standId ? (standArea(standId) ?? standId) : "no stand");
  const lines = theirs.map((change) => {
    const [from, to] = [area(change.from.rowId), area(change.to.rowId)];
    const where = change.from.rowId && change.to.rowId ? `from ${change.from.rowId} to ${change.to.rowId}` : `to ${change.to.rowId || "no stand"}`;
    return from === to
      ? `${stayLabel(change.stayId)} moves ${where}, now ${formatUtc(change.to.start)}–${formatUtc(change.to.end)}`
      : `${stayLabel(change.stayId)} moves ${where}, ${formatUtc(change.to.start)}–${formatUtc(change.to.end)}, so its bags go to ${to} instead of ${from}`;
  });
  if (lines.length > 0) parts.push(`For you: ${listWords(lines)}.`);
  const others = changes.length - theirs.length;
  if (others > 0) parts.push(`${others === 1 ? "The other move stays" : `The other ${others} moves stay`} on the same pier, so nothing changes for bags there.`);
  parts.push("Can you approve?");
  return parts.join(" ");
}

/** "XD472/473 · 1h 50m late": the late stay, on Skye's tag as she looks at it. */
export function lateTag(): string {
  const stay = lateStay();
  const late = stay ? (DEMO_DATA.delays.get(stay.id)?.in ?? 0) : 0;
  return `${lateNames().stay} · ${formatDelay(late)} late`;
}
