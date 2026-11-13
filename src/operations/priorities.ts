// What can be done about an open alert, for Skye's briefing: the one change
// that clears it under the sample rules, if there is one.
//   - A conflict (a late stay running into another on its stand) is cleared
//     by moving one of the stays it involves to a free stand, the stays run
//     into first (the late one keeps its stand and its delay), nearest stands
//     (same area) first, where the move clears it and adds no conflict.
//   - A flight with no stand gets the first free stand that takes it (see
//     planAssign).
// A suggestion for a person to accept, not an allocator.
import { DEMO_DATA } from "../stand-timeline-demo/demoData";
import { ghostClashes, ghostKey } from "../stand-timeline-demo/delays";
import { ACTIVE_DATASET } from "./activeDataset";
import type { Occupancy } from "../stand-timeline";
import {
  closedDuring,
  fitsStand,
  flightsAtStay,
  occupancyById,
  planAssign,
  planDrop,
  standArea,
  type AreaMove,
  type StandAssign,
} from "./allocation";
import type { OpsAlert } from "./boardAlerts";
import { planDisruption, planKnockOn } from "./disruption";
import { OPS_FLIGHTS_BY_ID } from "./operationsData";
import { requireFixtureAnalyses } from "./activeDataset";

export type AlertFix =
  /** Move a stay (named by one of its flights) to another stand, keeping its times. */
  | { kind: "move"; stayId: string; flightId: string; fromStand: string; standId: string }
  /**
   * Move every stay a late stay runs into (its knock-on, see planKnockOn),
   * when no one move clears it; the late stay, named by its flight, keeps
   * its stand.
   */
  | { kind: "knock_on"; stayId: string; flightId: string; moves: AreaMove[] }
  /** Give a flight with no stand its first free stand. */
  | { kind: "assign"; stayId: string; flightId: string; standId: string };

/** The conflicts there would be with `stayId` on `standId` instead of where it is. */
const clashesWithMove = (stayId: string, standId: string) =>
  ghostClashes(
    DEMO_DATA.occupancies.map((o) => (o.id === stayId ? { ...o, rowId: standId } : o)),
    DEMO_DATA.delays,
  );

function conflictFix(alert: OpsAlert): AlertFix | null {
  const conflict = alert.conflict;
  if (!conflict) return null;
  const before = ghostClashes(DEMO_DATA.occupancies, DEMO_DATA.delays).size;
  const key = ghostKey(conflict.stayId, conflict.side);
  const moveOne = (stayId: string): AlertFix | null => {
    const stay = occupancyById(stayId);
    const flight = flightsAtStay(stayId)[0];
    if (!stay || !flight) return null;
    const area = standArea(stay.rowId);
    const nearestFirst = [...ACTIVE_DATASET.stands].sort((a, b) => Number(a.area !== area) - Number(b.area !== area));
    for (const stand of nearestFirst) {
      if (stand.code === stay.rowId || planDrop(stayId, stand.code).kind !== "move") continue;
      const after = clashesWithMove(stayId, stand.code);
      if (!after.has(key) && after.size < before) {
        return { kind: "move", stayId, flightId: flight.id, fromStand: stay.rowId, standId: stand.code };
      }
    }
    return null;
  };
  // What it runs into, one at a time; then all of it, the late aircraft
  // keeping its stand; and the late aircraft only when nothing else clears it.
  for (const stayId of conflict.intoIds) {
    const fix = moveOne(stayId);
    if (fix) return fix;
  }
  const late = flightsAtStay(conflict.stayId);
  if (conflict.intoIds.length > 1 && late.length > 0) {
    const knockOn = planDisruption(conflict.stayId);
    if (knockOn.stuck.length === 0 && knockOn.moves.length > 0) {
      const flight = late.find((entry) => entry.direction === (conflict.side === "start" ? "arrival" : "departure")) ?? late[0];
      return { kind: "knock_on", stayId: conflict.stayId, flightId: flight.id, moves: knockOn.moves };
    }
  }
  return moveOne(conflict.stayId);
}

/** Everything "fix it all" will do, planned against the board as it is, before anything moves. */
export type FixAllPlan = {
  /** Conflicts cleared by moving a stay (to another stand, keeping its times), in the order planned. */
  moves: AreaMove[];
  /** Flights with no stand given one. */
  assigns: StandAssign[];
  /** Open alerts this cannot clear, each with why, in a sentence that names it. */
  left: { alertId: string; reason: string }[];
  /** How many of the conflicts the moves clear. */
  conflictsCleared: number;
};

const overlapsOn = (stay: Occupancy, standId: string, board: readonly Occupancy[]) =>
  board.some((other) => other.rowId === standId && other.id !== stay.id && stay.start < other.end && other.start < stay.end);

/**
 * Every fix at once, for "fix all the alerts" (`scope` "all") or "fix all
 * the conflicts" ("conflicts"): each conflict, most pressing first, cleared
 * by moving one of its stays to a nearby free stand on a copy of the board
 * that carries the moves planned before it (so no two fixes take the same
 * time on a stand, and none adds a conflict); then, for "all", every flight
 * with no stand given the first free stand around those moves. Nothing on
 * the board changes here.
 */
export function planFixAll(alerts: readonly OpsAlert[], scope: "all" | "conflicts"): FixAllPlan {
  requireFixtureAnalyses();
  const board: Occupancy[] = DEMO_DATA.occupancies.map((o) => ({ ...o }));
  const byId = new Map(board.map((o) => [o.id, o]));
  const moved = new Map<string, AreaMove>();
  const left: FixAllPlan["left"] = [];
  let conflictsCleared = 0;

  /** Plans `stayId` onto `standId` on the board copy. */
  const plan = (stayId: string, standId: string) => {
    const stay = byId.get(stayId);
    if (!stay) return;
    const live = occupancyById(stayId);
    const from = moved.get(stayId) ?? { occupancyId: stayId, fromStand: live?.rowId ?? stay.rowId, fromStart: stay.start, standId, shiftMs: 0 };
    moved.set(stayId, { ...from, standId });
    stay.rowId = standId;
  };

  for (const alert of alerts) {
    if (alert.kind !== "conflict" || !alert.conflict) continue;
    const key = ghostKey(alert.conflict.stayId, alert.conflict.side);
    const now = ghostClashes(board, DEMO_DATA.delays);
    // Cleared already, by an earlier fix.
    if (!now.has(key)) continue;
    /** One stay moved to the nearest free stand that clears the conflict on its own. */
    const moveOne = (stayId: string): boolean => {
      const stay = byId.get(stayId);
      if (!stay) return false;
      const area = standArea(stay.rowId);
      const nearestFirst = [...ACTIVE_DATASET.stands].sort((a, b) => Number(a.area !== area) - Number(b.area !== area));
      for (const stand of nearestFirst) {
        if (
          stand.code === stay.rowId ||
          !fitsStand(stay, stand.code) ||
          closedDuring(stand.code, stay.start, stay.end) ||
          overlapsOn(stay, stand.code, board)
        ) {
          continue;
        }
        const after = ghostClashes(
          board.map((o) => (o.id === stayId ? { ...o, rowId: stand.code } : o)),
          DEMO_DATA.delays,
        );
        if (after.has(key) || after.size >= now.size) continue;
        plan(stayId, stand.code);
        return true;
      }
      return false;
    };
    /**
     * A late stay running into several: each of them moved (the knock-on;
     * see planKnockOn), so the late aircraft can still keep its stand.
     */
    const moveAllInto = (): boolean => {
      const trial = board.map((o) => ({ ...o }));
      const knockOn = planKnockOn(alert.conflict!.stayId, trial);
      const after = ghostClashes(trial, DEMO_DATA.delays);
      if (knockOn.stuck.length > 0 || knockOn.moves.length === 0 || after.has(key) || after.size >= now.size) return false;
      for (const move of knockOn.moves) plan(move.occupancyId, move.standId);
      return true;
    };
    // What it runs into first, one at a time, then all of them, and the late aircraft only when nothing else clears it.
    const fixed =
      alert.conflict.intoIds.some(moveOne) ||
      (alert.conflict.intoIds.length > 1 && moveAllInto()) ||
      moveOne(alert.conflict.stayId);
    if (fixed) conflictsCleared += 1;
    else left.push({ alertId: alert.id, reason: `The ${alert.conflict.standId} conflict has no free stand that clears it.` });
  }

  const assigns: StandAssign[] = [];
  if (scope === "all") {
    const waiting = alerts.flatMap((alert) => (alert.kind === "no_stand" ? (OPS_FLIGHTS_BY_ID.get(alert.flightId) ?? []) : []));
    for (const flight of waiting) {
      if (!flight.unplacedStay) {
        left.push({ alertId: `ALERT-${flight.id}`, reason: `${flight.flight} has no stay times yet, so it can't be placed.` });
      }
    }
    const stayIds = [...new Set(waiting.flatMap((flight) => flight.unplacedStay?.stayId ?? []))];
    const plan = planAssign(
      stayIds,
      undefined,
      board.filter((o) => moved.has(o.id)),
    );
    assigns.push(...plan.assigns);
    for (const entry of plan.unplaceable) {
      const flight = flightsAtStay(entry.stayId)[0];
      left.push({ alertId: flight ? `ALERT-${flight.id}` : entry.stayId, reason: entry.reason });
    }
  }
  return { moves: [...moved.values()], assigns, left, conflictsCleared };
}

/**
 * Whether any of `moves` takes a late stay off its stand. Fix it all moves
 * what a late stay runs into first, and the late stay itself only when
 * nothing else clears it, so this is what decides whether Skye can say the
 * late aircraft kept their stands.
 */
export function movesLateStay(moves: readonly { occupancyId: string }[]): boolean {
  return moves.some((move) => {
    const delay = DEMO_DATA.delays.get(move.occupancyId);
    return !!(delay?.in || delay?.out);
  });
}

/** The change that clears `alert`, or null when there is none (or it is only a notice). */
export function fixFor(alert: OpsAlert): AlertFix | null {
  requireFixtureAnalyses();
  if (alert.kind === "conflict") return conflictFix(alert);
  if (alert.kind !== "no_stand") return null;
  const flight = OPS_FLIGHTS_BY_ID.get(alert.flightId);
  const stay = flight?.unplacedStay;
  if (!flight || !stay) return null;
  const assign = planAssign([stay.stayId]).assigns[0];
  return assign ? { kind: "assign", stayId: stay.stayId, flightId: flight.id, standId: assign.standId } : null;
}
