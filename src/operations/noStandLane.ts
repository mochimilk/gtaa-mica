// The No stand lane: flights waiting for a stand, as bars at the top of the
// board, pinned under its time ruler so they stay in view while the stands
// scroll beneath them (the chart's pinnedRows). A stay with no stand is off
// the stands (see ./allocation), but here it is on the board all the same, at
// the times it needs a stand, so it can be seen, selected and dragged
// straight down onto a stand like any stay. A stay dragged up into the lane
// loses its stand. Either way it keeps its times.
//
// Stays that overlap in time go on rows of their own, so the lane is as tall
// as the most flights waiting at once, and one row when none are.
import type { Occupancy, TimelineRow } from "../stand-timeline";
import {
  clashesOn,
  flightsAtStay,
  occupancyById,
  offBoardStay,
  offBoardStays,
  planAssign,
  planDrop,
  stayName,
  type DropPlan,
} from "./allocation";

const ROW_PREFIX = "no-stand-";
export const NO_STAND_LABEL = "No stand";

const laneRowId = (index: number) => `${ROW_PREFIX}${index + 1}`;

/** The lane's first row, where a stay dragged off its stand is let go. */
export const FIRST_LANE_ROW = laneRowId(0);

/** Whether a row of the board is one of the lane's. */
export const isLaneRow = (rowId: string) => rowId.startsWith(ROW_PREFIX);

export type NoStandLane = {
  /** At least one, so there is always somewhere to drop a stay. */
  rows: TimelineRow[];
  /** The waiting stays, each a copy on its lane row. */
  stays: Occupancy[];
};

/**
 * The lane for `stays`: each, earliest first, on the first row where it
 * overlaps nothing. With `held`, the lane as it was keeps its rows: stays
 * still waiting stay where they were, and rows emptied stay, so nothing on the
 * board shifts while Skye's cursors work on it (see OperationsContext).
 */
export function layoutLane(stays: readonly Occupancy[], held?: NoStandLane): NoStandLane {
  const kept = new Map(held?.stays.map((stay) => [stay.id, stay.rowId]));
  const rows: Occupancy[][] = Array.from({ length: held?.rows.length ?? 0 }, () => []);
  const fits = (row: readonly Occupancy[], stay: Occupancy) =>
    row.every((other) => other.end <= stay.start || stay.end <= other.start);
  const placed: Occupancy[] = [];
  const put = (stay: Occupancy, index: number) => {
    while (rows.length <= index) rows.push([]);
    rows[index].push(stay);
    placed.push({ ...stay, rowId: laneRowId(index) });
  };
  const earliestFirst = [...stays].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const fresh: Occupancy[] = [];
  for (const stay of earliestFirst) {
    const was = kept.get(stay.id);
    if (was) put(stay, Number(was.slice(ROW_PREFIX.length)) - 1);
    else fresh.push(stay);
  }
  for (const stay of fresh) {
    const free = rows.findIndex((row) => fits(row, stay));
    put(stay, free < 0 ? rows.length : free);
  }
  const count = Math.max(1, rows.length);
  return {
    rows: Array.from({ length: count }, (_, index) => ({ id: laneRowId(index), label: NO_STAND_LABEL })),
    stays: placed,
  };
}

/** The lane for the stays waiting now. */
export const noStandLane = (held?: NoStandLane) => layoutLane(offBoardStays(), held);

/** What dropping a bar on a row of the board does. */
export type BoardDrop =
  /** A stay on a stand, onto another stand or time (or its own: "stay"); see planDrop. */
  | DropPlan
  /** A waiting stay onto a stand: it gets the stand, at its own times. */
  | { kind: "assign"; stayId: string; standId: string }
  /** A stay into the lane: it loses its stand, and keeps its times. */
  | { kind: "unassign"; stayId: string; standId: string };

/**
 * What dropping `occupancyId` on `rowId`, dragged `shiftMs` along, does on a
 * board with the No stand lane: a stay on a stand is moved or swapped as
 * planDrop has it; a waiting stay dropped on a stand gets it, and a stay
 * dropped in the lane loses its stand. Both of those keep the stay's times,
 * however far it was dragged along.
 */
export function planBoardDrop(occupancyId: string, rowId: string, shiftMs = 0): BoardDrop {
  const waiting = offBoardStay(occupancyId);
  const conflict = (reason: string, blockingIds: string[] = []): BoardDrop => ({
    kind: "conflict",
    occupancyId,
    standId: rowId,
    reason,
    blockingIds,
  });
  if (isLaneRow(rowId)) {
    if (waiting) return { kind: "stay", occupancyId };
    const stay = occupancyById(occupancyId);
    if (!stay) return conflict("That is not a stay on the chart.");
    // Given a stand again by its flight, so a stay with none stays put (as Unassign does).
    if (flightsAtStay(stay.id).length === 0) {
      return conflict(`${stayName(stay)} has no flight at it to give a stand again later, so it stays on ${stay.rowId}.`);
    }
    return { kind: "unassign", stayId: stay.id, standId: stay.rowId };
  }
  if (waiting) {
    const plan = planAssign([occupancyId], rowId);
    const assign = plan.assigns[0];
    if (assign) return { kind: "assign", stayId: occupancyId, standId: assign.standId };
    return conflict(
      plan.unplaceable[0]?.reason ?? `${stayName(waiting)} cannot go on ${rowId}.`,
      clashesOn(waiting, rowId).map((other) => other.id),
    );
  }
  return planDrop(occupancyId, rowId, shiftMs);
}

/** Whether a drop keeps the stay's times however it was dragged: anything to or from the lane. */
export const keepsTimes = (occupancyId: string, rowId: string) => isLaneRow(rowId) || !!offBoardStay(occupancyId);

/** "give XB240 stand B14", "take XA101/102 off A1": an assign or unassign, for its drop's label. */
export function describeLaneDrop(drop: Extract<BoardDrop, { kind: "assign" | "unassign" }>): string {
  const stay = occupancyById(drop.stayId) ?? offBoardStay(drop.stayId);
  const name = stay ? stayName(stay) : drop.stayId;
  return drop.kind === "assign" ? `give ${name} stand ${drop.standId}` : `take ${name} off ${drop.standId}`;
}

/** The flight a waiting stay's bar in the lane stands for, picked when the bar is; undefined for any other stay. */
export const waitingFlight = (stayId: string) => (offBoardStay(stayId) ? flightsAtStay(stayId)[0] : undefined);
