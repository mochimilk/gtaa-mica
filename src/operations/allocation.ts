// Demo stand changes: moving a stay to another stand or time, swapping two
// stays, giving a stand to a stay that has none or taking one away, and
// closing a stand area for a while.
//
// These are local to the open page. Nothing is saved or sent, and a reload
// restores the fixture. A change is checked against these sample rules only:
//   1. the stay must not overlap another stay on its new stand,
//   2. the stand's sample size must take the aircraft (a widebody needs a
//      "wide" stand; see SyntheticStand.size, and an aircraft with no type
//      recorded is treated as a widebody, so it only goes where any fits),
//   3. nothing may be on a closed area's stands while it is closed, and
//   4. a stay moved in time must not overlap its own aircraft's other stays
//      (it cannot be on two stands at once).
// There are no other allocation rules behind this.
//
// The fixture's stays and flights are the shared, mutable source of truth:
// a change rewrites `occupancy.rowId` (and, moved in time, its start and
// end) and the matching flights in place, so every reader (lists, filters,
// popover, Skye's snapshot) sees it, and `version` increments so React can
// re-render. A stay with no stand is off the stands: out of
// `DEMO_DATA.occupancies`, with its flights carrying its times as
// `unplacedStay` until it is given one. The board shows it in the No stand
// lane above the stands (see ./noStandLane).
import type { Millis, Occupancy } from "../stand-timeline";
import { DEMO_DATA, formatUtc, formatUtcWithDay } from "../stand-timeline-demo/demoData";
import type { StandSize } from "../stand-timeline-demo/syntheticFixture";
import { ACTIVE_DATASET, READ_ONLY_REASON, requireStandEditing } from "./activeDataset";
import { formatDuration, NO_STAND_STAYS, OPS_FLIGHTS, type OpsFlight } from "./operationsData";

/** What dropping a stay on a stand would do. */
export type DropPlan =
  /** Nothing: it is already there. */
  | { kind: "stay"; occupancyId: string }
  /**
   * Onto free time on the stand; with `shiftMs`, that much later (or, when
   * negative, earlier) as well. Absent keeps its times.
   */
  | { kind: "move"; occupancyId: string; standId: string; shiftMs?: number }
  /** Exchanged with the one stay it overlaps there, which takes its old stand. */
  | { kind: "swap"; occupancyId: string; otherId: string }
  /** Not allowed; `blockingIds` are the stays in the way, if any. */
  | { kind: "conflict"; occupancyId: string; standId: string; reason: string; blockingIds: string[] };

export type SwapCheck = { ok: true } | { ok: false; reason: string };

/** Every stay, on a stand or not. */
const STAYS = new Map([...DEMO_DATA.occupancies, ...NO_STAND_STAYS].map((o) => [o.id, o]));
/** Stays with no stand, so off the chart; every other stay is on DEMO_DATA.occupancies. */
const OFF_BOARD = new Set(NO_STAND_STAYS.map((o) => o.id));
const STAND_SIZE = new Map(ACTIVE_DATASET.stands.map((stand) => [stand.code, stand.size]));
const STAND_AREA = new Map(ACTIVE_DATASET.stands.map((stand) => [stand.code, stand.area]));
const ORIGINAL = new Map(
  [...DEMO_DATA.occupancies, ...NO_STAND_STAYS].map((o) => [o.id, { rowId: o.rowId, start: o.start, end: o.end }]),
);
/** The chart's stays as the fixture has them, in order. */
const ORIGINAL_ON_BOARD = [...DEMO_DATA.occupancies];

/** A stay on the chart, by id; undefined for one with no stand. */
export const occupancyById = (id: string): Occupancy | undefined => (OFF_BOARD.has(id) ? undefined : STAYS.get(id));
/** A stay with no stand, by id; undefined for one on the chart. */
export const offBoardStay = (id: string): Occupancy | undefined => (OFF_BOARD.has(id) ? STAYS.get(id) : undefined);
/** Every stay with no stand now (they wait in the No stand lane; see ./noStandLane). */
export const offBoardStays = (): Occupancy[] => [...OFF_BOARD].flatMap((id) => STAYS.get(id) ?? []);
export const isStand = (standId: string) => STAND_SIZE.has(standId);
/** The area a stand belongs to, e.g. "Pier B". */
export const standArea = (standId: string) => STAND_AREA.get(standId);
/** Every stand area, in chart order. */
export const STAND_AREAS: readonly string[] = [...new Set(ACTIVE_DATASET.stands.map((stand) => stand.area))];

/* ------------------------------------------------------------------ state */

let version = 0;
const listeners = new Set<() => void>();

// The stand changes, the closure and their listeners live here, once. A hot
// update would leave some importers on the old copy (see DEMO_DATA), so a
// change here reloads the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

/** Increments on every stand change. */
export const allocationVersion = () => version;

/** For useSyncExternalStore. */
export function subscribeAllocation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The flights at a stay, whether it has a stand or not. */
export const flightsAtStay = (stayId: string): OpsFlight[] =>
  OPS_FLIGHTS.filter((flight) => flight.occupancyId === stayId || flight.unplacedStay?.stayId === stayId);

function setStand(occupancyId: string, standId: string): void {
  const occupancy = occupancyById(occupancyId);
  if (!occupancy) return;
  occupancy.rowId = standId;
  for (const flight of OPS_FLIGHTS) if (flight.occupancyId === occupancyId) flight.standId = standId;
}

/**
 * Retimes a stay and its flights: an arrival's estimate is its on-block, a
 * departure's its off-block, plus any delay out (it keeps its delay).
 */
function setTimes(occupancyId: string, start: Millis, end: Millis): void {
  const occupancy = STAYS.get(occupancyId);
  if (!occupancy) return;
  occupancy.start = start;
  occupancy.end = end;
  const lateOut = DEMO_DATA.delays.get(occupancyId)?.out ?? 0;
  for (const flight of flightsAtStay(occupancyId)) {
    if (flight.unplacedStay) {
      flight.unplacedStay = { stayId: occupancyId, start, end };
    } else {
      flight.standStart = start;
      flight.standEnd = end;
    }
    flight.estimate = flight.direction === "arrival" ? start : end + lateOut;
  }
}

/** Puts a stay with no stand onto `standId`, and so onto the chart, with its flights. */
function placeStay(stay: Occupancy, standId: string): void {
  const flights = flightsAtStay(stay.id);
  OFF_BOARD.delete(stay.id);
  stay.rowId = standId;
  DEMO_DATA.occupancies.push(stay);
  for (const flight of flights) {
    flight.occupancyId = stay.id;
    flight.standId = standId;
    flight.standStart = stay.start;
    flight.standEnd = stay.end;
    delete flight.unplacedStay;
  }
}

/** Takes a stay off its stand, and so off the chart; its flights keep its times, waiting for a stand. */
function unplaceStay(stay: Occupancy): void {
  const flights = flightsAtStay(stay.id);
  const index = DEMO_DATA.occupancies.indexOf(stay);
  if (index >= 0) DEMO_DATA.occupancies.splice(index, 1);
  OFF_BOARD.add(stay.id);
  for (const flight of flights) {
    flight.unplacedStay = { stayId: stay.id, start: stay.start, end: stay.end };
    delete flight.occupancyId;
    delete flight.standId;
    delete flight.standStart;
    delete flight.standEnd;
  }
}

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function refreshAccommodationAllocation(): void {
  if (ACTIVE_DATASET.capabilities.editStands) throw new Error("Accommodation cannot replace an editable allocation.");
  STAYS.clear();
  OFF_BOARD.clear();
  ORIGINAL.clear();
  for (const stay of [...DEMO_DATA.occupancies, ...NO_STAND_STAYS]) {
    STAYS.set(stay.id, stay);
    ORIGINAL.set(stay.id, { rowId: stay.rowId, start: stay.start, end: stay.end });
  }
  for (const stay of NO_STAND_STAYS) OFF_BOARD.add(stay.id);
  ORIGINAL_ON_BOARD.splice(0, ORIGINAL_ON_BOARD.length, ...DEMO_DATA.occupancies);
  closure = null;
  planRevision += 1;
  updatingPlan = true;
  try {
    changed();
  } finally {
    updatingPlan = false;
  }
}

/** Whether any stay is off its fixture stand or times, or an area is closed. */
export const hasStandChanges = () =>
  closure !== null ||
  [...ORIGINAL].some(([id, was]) => {
    const stay = STAYS.get(id);
    const onBoard = !OFF_BOARD.has(id);
    return (
      onBoard !== (was.rowId !== "") ||
      (onBoard && was.rowId !== stay?.rowId) ||
      was.start !== stay?.start ||
      was.end !== stay?.end
    );
  });

/** Where a stay is: its stand ("" for none, off the chart) and its times. */
export type StayPlace = { rowId: string; start: Millis; end: Millis };

/** Puts a stay on `was`'s stand (or off the chart, for none) and times, with its flights. */
function putBack(id: string, was: StayPlace): void {
  const stay = STAYS.get(id);
  if (!stay) return;
  const onBoard = !OFF_BOARD.has(id);
  if (was.rowId === "" && onBoard) unplaceStay(stay);
  else if (was.rowId !== "" && !onBoard) placeStay(stay, was.rowId);
  if (was.rowId !== "") setStand(id, was.rowId);
  setTimes(id, was.start, was.end);
}

/**
 * Puts every stay back on its fixture stand and times (and off the chart, for
 * a flight that had no stand), and reopens any closed area.
 */
export function resetStands(): void {
  requireStandEditing();
  if (!hasStandChanges()) return;
  for (const [id, was] of ORIGINAL) putBack(id, was);
  // The chart's stays in fixture order again.
  DEMO_DATA.occupancies.splice(0, DEMO_DATA.occupancies.length, ...ORIGINAL_ON_BOARD);
  closure = null;
  changed();
}

/** Every stay's place and the closure at one moment, to compare with a later one or go back to. */
export type StandState = { stays: ReadonlyMap<string, StayPlace>; closure: Closure | null };

/** Where every stay is now, and the closure in force. */
export function standState(): StandState {
  const stays = new Map<string, StayPlace>();
  for (const [id, stay] of STAYS) stays.set(id, { rowId: OFF_BOARD.has(id) ? "" : stay.rowId, start: stay.start, end: stay.end });
  return { stays, closure };
}

/** Where every stay is in the plan (its fixture stand and times, or none), with no area closed. */
export const planState = (): StandState => ({ stays: ORIGINAL, closure: null });

/* ------------------------------------------------------- the plan moving on */

/** Increments whenever the plan itself changes (a stay found to be running late), not on stand changes. */
let planRevision = 0;
/** True while the board changes because the plan did, not because anyone moved anything. */
let updatingPlan = false;

export const planVersion = () => planRevision;
/** Whether the change being announced is the plan moving on (see setRunningLate), not someone's stand change. */
export const planUpdating = () => updatingPlan;

/**
 * A stay found to be running late, as news from outside arrives: `delayIn`
 * minutes later onto its stand than scheduled, `delayOut` later off it (see
 * SyntheticStay). Its bar starts at the expected on-block, its ghosts show
 * the rest, and its flights' estimates move with it. It is a fact, not a
 * change anyone made: the plan (planState) takes it in, so Reset stands and
 * Undo keep it, and it is not listed as anyone's change (planUpdating).
 * Returns false when there is no such stay on the board.
 */
export function setRunningLate(stayId: string, delayIn: number, delayOut: number): boolean {
  requireStandEditing();
  const stay = occupancyById(stayId);
  if (!stay) return false;
  const minute = 60_000;
  const scheduledOn = stay.start - (DEMO_DATA.delays.get(stayId)?.in ?? 0);
  // Its bar is the time it is both scheduled and expected there: none would be left.
  if (scheduledOn + delayIn * minute >= stay.end) return false;
  DEMO_DATA.delays.set(stayId, {
    in: delayIn ? delayIn * minute : undefined,
    out: delayOut ? delayOut * minute : undefined,
  });
  setTimes(stayId, scheduledOn + delayIn * minute, stay.end);
  ORIGINAL.set(stayId, { rowId: stay.rowId, start: stay.start, end: stay.end });
  planRevision += 1;
  updatingPlan = true;
  try {
    changed();
  } finally {
    updatingPlan = false;
  }
  return true;
}

export const samePlace = (a: StayPlace | undefined, b: StayPlace | undefined) =>
  a?.rowId === b?.rowId && a?.start === b?.start && a?.end === b?.end;

export const sameClosure = (a: Closure | null, b: Closure | null) =>
  a?.area === b?.area && a?.from === b?.from && a?.to === b?.to;

/**
 * Puts some stays back where they were (see putBack), and the closure too
 * when `closureTo` is given (null reopens the area), all at once.
 */
export function restoreStays(places: ReadonlyMap<string, StayPlace>, closureTo?: Closure | null): void {
  requireStandEditing();
  for (const [id, was] of places) putBack(id, was);
  if (closureTo !== undefined) closure = closureTo;
  changed();
}

/* ---------------------------------------------------------------- closure */

/** A stand area out of use for a while: nothing may be on its stands then. */
export type Closure = { area: string; from: Millis; to: Millis };

/** One closure at a time; a new one replaces it. */
let closure: Closure | null = null;

/** The area closure in force, if any. */
export const currentClosure = (): Closure | null => closure;

/** Closes an area (replacing any earlier closure), or reopens it with null. */
export function setClosure(next: Closure | null): void {
  requireStandEditing();
  if (closure?.area === next?.area && closure?.from === next?.from && closure?.to === next?.to) return;
  closure = next;
  changed();
}

/** Whether a stay at these times on `standId` would fall inside the closure. */
function closedAt(standId: string, start: Millis, end: Millis): boolean {
  return !!closure && STAND_AREA.get(standId) === closure.area && start < closure.to && closure.from < end;
}

/** Whether a stay on `standId` from `start` to `end` would be inside the area closure in force. */
export const closedDuring = (standId: string, start: Millis, end: Millis): boolean => closedAt(standId, start, end);

const closedReason = (standId: string) =>
  `${standId} is closed ${formatUtcWithDay(closure?.from ?? 0)}–${formatUtcWithDay(closure?.to ?? 0)} (${STAND_AREA.get(standId)}).`;

/* ------------------------------------------------------------------ rules */

/** The aircraft type at this stay, or undefined when none is recorded. */
const recordedType = (occupancy: Occupancy) =>
  (occupancy.visitId && DEMO_DATA.turnsById.get(occupancy.visitId)?.aircraftType) || undefined;

/**
 * The sample size class of the aircraft at this stay. With no type recorded
 * it counts as wide, so it only goes on a stand that takes any aircraft.
 */
export function aircraftSize(occupancy: Occupancy): StandSize | undefined {
  const type = recordedType(occupancy);
  if (!ACTIVE_DATASET.capabilities.fixtureAnalyses) return type ? ACTIVE_DATASET.aircraftSizes[type] : undefined;
  return (type && ACTIVE_DATASET.aircraftSizes[type]) || (type ? "narrow" : "wide");
}

const aircraftType = (occupancy: Occupancy) => recordedType(occupancy) ?? "aircraft";

/** Whether the stand's sample size takes this stay's aircraft. */
export function fitsStand(occupancy: Occupancy, standId: string): boolean {
  const size = STAND_SIZE.get(standId);
  return size !== undefined && (size === "wide" || aircraftSize(occupancy) === "narrow");
}

const overlaps = (a: Occupancy, b: Occupancy) => a.start < b.end && b.start < a.end;

/** The stay as it would be `shiftMs` later; itself when not shifted. */
const shifted = (occupancy: Occupancy, shiftMs: number): Occupancy =>
  shiftMs ? { ...occupancy, start: occupancy.start + shiftMs, end: occupancy.end + shiftMs } : occupancy;

/** Stays on `standId` that `occupancy` would overlap there, apart from `ignore`. */
export function clashesOn(occupancy: Occupancy, standId: string, ignore: ReadonlySet<string> = new Set()): Occupancy[] {
  return DEMO_DATA.occupancies.filter(
    (other) =>
      other.rowId === standId && other.id !== occupancy.id && !ignore.has(other.id) && overlaps(occupancy, other),
  );
}

/** Another stay of the same aircraft these times would overlap: it cannot be on two stands at once. */
function siblingClash(occupancy: Occupancy): Occupancy | undefined {
  if (!occupancy.visitId) return undefined;
  return DEMO_DATA.occupancies.find(
    (other) => other.visitId === occupancy.visitId && other.id !== occupancy.id && overlaps(occupancy, other),
  );
}

const tooBig = (occupancy: Occupancy, standId: string) =>
  recordedType(occupancy)
    ? `${stayName(occupancy)} is a ${aircraftType(occupancy)}, a widebody, and ${standId} is a narrowbody stand.`
    : `${stayName(occupancy)} has no aircraft type recorded, so it needs a stand that takes any aircraft, and ${standId} is narrowbody only.`;

/** Whether two stays can exchange stands under the sample rules. */
export function checkSwap(aId: string, bId: string): SwapCheck {
  if (!ACTIVE_DATASET.capabilities.editStands) return { ok: false, reason: READ_ONLY_REASON };
  const a = occupancyById(aId);
  const b = occupancyById(bId);
  if (!a || !b || a === b) return { ok: false, reason: "Pick two different stays to swap." };
  if (a.rowId === b.rowId) return { ok: false, reason: `Both stays are already on ${a.rowId}.` };
  if (!fitsStand(a, b.rowId)) return { ok: false, reason: tooBig(a, b.rowId) };
  if (!fitsStand(b, a.rowId)) return { ok: false, reason: tooBig(b, a.rowId) };
  if (closedAt(b.rowId, a.start, a.end)) return { ok: false, reason: closedReason(b.rowId) };
  if (closedAt(a.rowId, b.start, b.end)) return { ok: false, reason: closedReason(a.rowId) };
  const pair = new Set([a.id, b.id]);
  const aClash = clashesOn(a, b.rowId, pair);
  if (aClash.length > 0) {
    return { ok: false, reason: `${stayName(a)} would overlap ${stayName(aClash[0])} on ${b.rowId}.` };
  }
  const bClash = clashesOn(b, a.rowId, pair);
  if (bClash.length > 0) {
    return { ok: false, reason: `${stayName(b)} would overlap ${stayName(bClash[0])} on ${a.rowId}.` };
  }
  return { ok: true };
}

/**
 * What dropping `occupancyId` on `standId`, `shiftMs` later, does: a move
 * onto free time, a swap with the single stay it lands on when the two can
 * exchange stands (only when its times are kept), or a conflict.
 */
export function planDrop(occupancyId: string, standId: string, shiftMs = 0): DropPlan {
  const occupancy = occupancyById(occupancyId);
  const conflict = (reason: string, blockingIds: string[] = []): DropPlan => ({
    kind: "conflict",
    occupancyId,
    standId,
    reason,
    blockingIds,
  });
  if (!ACTIVE_DATASET.capabilities.editStands) return conflict(READ_ONLY_REASON);
  if (!occupancy || !isStand(standId)) return conflict("That is not a stay and a stand on the chart.");
  if (occupancy.rowId === standId && shiftMs === 0) return { kind: "stay", occupancyId };
  const moved = shifted(occupancy, shiftMs);
  const clashes = clashesOn(moved, standId);
  const clashIds = clashes.map((o) => o.id);
  if (!fitsStand(occupancy, standId)) return conflict(tooBig(occupancy, standId), clashIds);
  if (closedAt(standId, moved.start, moved.end)) return conflict(closedReason(standId), clashIds);
  const sibling = shiftMs ? siblingClash(moved) : undefined;
  if (sibling) {
    return conflict(
      `${stayName(occupancy)} would be on two stands at once: it is on ${sibling.rowId} ${stayTimes(sibling)}.`,
      [sibling.id],
    );
  }
  if (clashes.length === 0) return { kind: "move", occupancyId, standId, ...(shiftMs ? { shiftMs } : {}) };
  if (clashes.length === 1 && shiftMs === 0) {
    const swap = checkSwap(occupancyId, clashes[0].id);
    if (swap.ok) return { kind: "swap", occupancyId, otherId: clashes[0].id };
    return conflict(swap.reason, clashIds);
  }
  return conflict(
    clashes.length === 1
      ? `${stayName(occupancy)} would overlap ${stayName(clashes[0])} on ${standId}.`
      : `${stayName(occupancy)} would overlap ${clashes.length} stays on ${standId}.`,
    clashIds,
  );
}

/** Carries out a move or swap plan. Returns false when there was nothing to do. */
export function applyPlan(plan: DropPlan): boolean {
  requireStandEditing();
  if (plan.kind === "move") {
    const occupancy = occupancyById(plan.occupancyId);
    if (!occupancy) return false;
    setStand(plan.occupancyId, plan.standId);
    if (plan.shiftMs) setTimes(plan.occupancyId, occupancy.start + plan.shiftMs, occupancy.end + plan.shiftMs);
  } else if (plan.kind === "swap") {
    const a = occupancyById(plan.occupancyId);
    const b = occupancyById(plan.otherId);
    if (!a || !b) return false;
    const [aStand, bStand] = [a.rowId, b.rowId];
    setStand(a.id, bStand);
    setStand(b.id, aStand);
  } else {
    return false;
  }
  changed();
  return true;
}

/* -------------------------------------------------------- closing an area */

/** One stay to move off a closed area. */
export type AreaMove = {
  occupancyId: string;
  /**
   * Where the stay was when the move was planned, so carrying it out is
   * idempotent: once it is at `standId` it is done, and a stay that has
   * moved anywhere else since is left alone.
   */
  fromStand: string;
  fromStart: Millis;
  standId: string;
  /** 0 when it keeps its times; more when it is held until a stand is free. */
  shiftMs: number;
};

export type AreaPlan = {
  moves: AreaMove[];
  /** Stays in the way that no stand could take, even held back. */
  stuck: string[];
};

/** How long a stay may be held for a free stand, tried in this order, minutes. */
const HOLD_MINUTES = [0, 15, 30, 45, 60, 90];

/**
 * Where every stay on `area` between `from` and `to` could go, so the area
 * can close then: each stay, hardest first, to the nearest stand outside the
 * area (by chart row, so it stays close to where it was) that takes its
 * aircraft and is free, keeping its times; or, when none is, held 15 minutes
 * at a time, up to 90, until one is. Stays already planned onto a stand count
 * against it. A greedy pass under the sample rules, not an allocator.
 */
export function planAreaClosure(area: string, from: Millis, to: Millis): AreaPlan {
  requireStandEditing();
  const rowOf = new Map(DEMO_DATA.rows.map((row, index) => [row.id, index]));
  const areaRows = DEMO_DATA.rows.flatMap((row, index) => (STAND_AREA.get(row.id) === area ? [index] : []));
  const [first, last] = [Math.min(...areaRows), Math.max(...areaRows)];
  const distance = (standId: string) => {
    const row = rowOf.get(standId) ?? 0;
    return row < first ? first - row : row > last ? row - last : 0;
  };
  const candidates = ACTIVE_DATASET.stands.filter((stand) => stand.area !== area)
    .map((stand) => stand.code)
    .sort((a, b) => distance(a) - distance(b) || (rowOf.get(a) ?? 0) - (rowOf.get(b) ?? 0));
  // Hardest to place first: widebodies (fewer stands take them), then the
  // longest stays, so a short narrowbody stay never takes the one stand a
  // long widebody stay needed.
  const affected = DEMO_DATA.occupancies
    .filter((o) => STAND_AREA.get(o.rowId) === area && o.start < to && from < o.end)
    .sort(
      (a, b) =>
        Number(aircraftSize(b) === "wide") - Number(aircraftSize(a) === "wide") ||
        b.end - b.start - (a.end - a.start) ||
        a.start - b.start,
    );

  const planned: Occupancy[] = [];
  const moves: AreaMove[] = [];
  const stuck: string[] = [];
  for (const occupancy of affected) {
    let placed = false;
    for (const minutes of HOLD_MINUTES) {
      const shiftMs = minutes * 60_000;
      const moved = shifted(occupancy, shiftMs);
      if (shiftMs && siblingClash(moved)) continue;
      const standId = candidates.find(
        (stand) =>
          fitsStand(occupancy, stand) &&
          clashesOn(moved, stand).length === 0 &&
          !planned.some((other) => other.rowId === stand && overlaps(moved, other)),
      );
      if (!standId) continue;
      moves.push({ occupancyId: occupancy.id, fromStand: occupancy.rowId, fromStart: occupancy.start, standId, shiftMs });
      planned.push({ ...moved, rowId: standId });
      placed = true;
      break;
    }
    if (!placed) stuck.push(occupancy.id);
  }
  return { moves, stuck };
}

/** Where a planned move stands now: done, still to do, or overtaken by another change. */
export function areaMoveState(move: AreaMove): "done" | "pending" | "moved" {
  const occupancy = occupancyById(move.occupancyId);
  if (!occupancy) return "moved";
  if (occupancy.rowId === move.standId && occupancy.start === move.fromStart + move.shiftMs) return "done";
  if (occupancy.rowId === move.fromStand && occupancy.start === move.fromStart) return "pending";
  return "moved";
}

/* ------------------------------------------- giving and taking away stands */

/** A stay with no stand, planned onto one. */
export type StandAssign = { stayId: string; standId: string };

export type AssignPlan = {
  assigns: StandAssign[];
  /** Stays no stand could take, each with why, in a sentence that names it. */
  unplaceable: { stayId: string; reason: string }[];
};

const overlapsAny = (stay: Occupancy, standId: string, planned: readonly Occupancy[]) =>
  clashesOn(stay, standId)[0] ?? planned.find((other) => other.rowId === standId && overlaps(stay, other));

/** Why `stay` cannot go on `standId` now, or null when it can. `planned` are stays already planned onto stands. */
function assignBlock(stay: Occupancy, standId: string, planned: readonly Occupancy[] = []): string | null {
  if (!isStand(standId)) return `${standId} is not a stand on the chart.`;
  if (!fitsStand(stay, standId)) return tooBig(stay, standId);
  if (closedAt(standId, stay.start, stay.end)) return closedReason(standId);
  const sibling = siblingClash(stay);
  if (sibling) return `${stayName(stay)} would be on two stands at once: it is on ${sibling.rowId} ${stayTimes(sibling)}.`;
  const clash = overlapsAny(stay, standId, planned);
  return clash ? `${stayName(stay)} would overlap ${stayName(clash)} on ${standId}.` : null;
}

/** Why no stand at all could take `stay`. */
function noFreeStand(stay: Occupancy): string {
  const when = `${formatUtc(stay.start)}–${formatUtc(stay.end)} UTC`;
  if (!recordedType(stay)) {
    return `${stayName(stay)} has no aircraft type recorded, and no stand that takes any aircraft is free ${when}.`;
  }
  return `${stayName(stay)} has no free ${aircraftSize(stay) === "wide" ? "widebody " : ""}stand ${when}.`;
}

/**
 * Stands for stays that have none: each, hardest first (widebodies, which
 * fewer stands take, then the longest stays), onto `standId` when one is
 * named, otherwise onto the first free stand in chart order that takes its
 * aircraft. A narrowbody tries the narrowbody-only stands first, leaving the
 * others for widebodies. Stays already planned count against a stand, and
 * every stay keeps its times. A greedy pass under the sample rules, not an
 * allocator. Both lists come back in the order the stays were given.
 */
export function planAssign(
  stayIds: readonly string[],
  standId?: string,
  /** Stays planned onto stands by other changes not made yet, which count against those stands too. */
  alsoPlanned: readonly Occupancy[] = [],
): AssignPlan {
  if (!ACTIVE_DATASET.capabilities.editStands) {
    return { assigns: [], unplaceable: stayIds.map(stayId => ({ stayId, reason: READ_ONLY_REASON })) };
  }
  const narrowFirst = [...ACTIVE_DATASET.stands].sort(
    (a, b) => Number(a.size !== "narrow") - Number(b.size !== "narrow"),
  );
  const hardestFirst = [...stayIds].sort((a, b) => {
    const [x, y] = [STAYS.get(a), STAYS.get(b)];
    if (!x || !y) return 0;
    return (
      Number(aircraftSize(y) === "wide") - Number(aircraftSize(x) === "wide") ||
      y.end - y.start - (x.end - x.start) ||
      x.start - y.start
    );
  });

  const planned: Occupancy[] = [...alsoPlanned];
  const assigns: StandAssign[] = [];
  const unplaceable: AssignPlan["unplaceable"] = [];
  for (const id of hardestFirst) {
    const onBoard = occupancyById(id);
    if (onBoard) {
      unplaceable.push({ stayId: id, reason: `${stayName(onBoard)} is already on ${onBoard.rowId}.` });
      continue;
    }
    const stay = offBoardStay(id);
    if (!stay) {
      unplaceable.push({ stayId: id, reason: `${id} is not a stay in the demo data.` });
      continue;
    }
    const target = standId
      ? standId
      : narrowFirst.find((stand) => assignBlock(stay, stand.code, planned) === null)?.code;
    const block = target ? assignBlock(stay, target, planned) : noFreeStand(stay);
    if (target && block === null) {
      assigns.push({ stayId: id, standId: target });
      planned.push({ ...stay, rowId: target });
    } else {
      unplaceable.push({ stayId: id, reason: block ?? noFreeStand(stay) });
    }
  }
  const asked = (entry: { stayId: string }) => stayIds.indexOf(entry.stayId);
  return {
    assigns: assigns.sort((a, b) => asked(a) - asked(b)),
    unplaceable: unplaceable.sort((a, b) => asked(a) - asked(b)),
  };
}

/** Where a planned assignment stands now: done, still to do (and still allowed), or overtaken. */
export function assignState(assign: StandAssign): "done" | "pending" | "moved" {
  const onBoard = occupancyById(assign.stayId);
  if (onBoard) return onBoard.rowId === assign.standId ? "done" : "moved";
  const stay = offBoardStay(assign.stayId);
  return stay && assignBlock(stay, assign.standId) === null ? "pending" : "moved";
}

/**
 * Gives stands to stays that have none, all at once, each checked again
 * against the board as it is now. Returns the stays it placed.
 */
export function applyAssigns(assigns: readonly StandAssign[]): string[] {
  requireStandEditing();
  const placed: string[] = [];
  for (const assign of assigns) {
    const stay = offBoardStay(assign.stayId);
    if (!stay || assignBlock(stay, assign.standId) !== null) continue;
    placeStay(stay, assign.standId);
    placed.push(assign.stayId);
  }
  if (placed.length > 0) changed();
  return placed;
}

/**
 * Takes stays off their stands, and so off the chart, all at once. Their
 * flights keep the stays' times and can be given a stand again. Returns the
 * stays it took off.
 */
export function unassignStays(stayIds: readonly string[]): string[] {
  requireStandEditing();
  const removed: string[] = [];
  for (const id of stayIds) {
    const stay = occupancyById(id);
    if (!stay) continue;
    unplaceStay(stay);
    removed.push(id);
  }
  if (removed.length > 0) changed();
  return removed;
}

/* --------------------------------------------------------------- naming */

/** The flights at a stay, e.g. "XA101/102", or its visit's when it has none. */
export function stayName(occupancy: Occupancy): string {
  const flights = flightsAtStay(occupancy.id);
  if (flights.length === 1) return flights[0].flight;
  const visit = occupancy.visitId ? DEMO_DATA.visits.find((entry) => entry.id === occupancy.visitId) : undefined;
  return visit?.label ?? occupancy.id;
}

const stayTimes = (occupancy: Occupancy) =>
  `${formatUtcWithDay(occupancy.start)}–${formatUtcWithDay(occupancy.end)}`;

/** "30m later", "1h 15m earlier". */
export function describeShift(shiftMs: number): string {
  return `${formatDuration(Math.round(Math.abs(shiftMs) / 60_000))} ${shiftMs > 0 ? "later" : "earlier"}`;
}

/** One sentence describing a plan, for Skye and for the swap button's note. */
export function describePlan(plan: DropPlan): string {
  const a = occupancyById(plan.occupancyId);
  if (!a) return "";
  switch (plan.kind) {
    case "stay":
      return `${stayName(a)} is already on ${a.rowId}.`;
    case "move": {
      const shiftMs = plan.shiftMs ?? 0;
      if (!shiftMs) return `move ${stayName(a)} (${stayTimes(a)}) from ${a.rowId} to ${plan.standId}`;
      const when = `${describeShift(shiftMs)}, to ${stayTimes(shifted(a, shiftMs))}`;
      return a.rowId === plan.standId
        ? `move ${stayName(a)} on ${a.rowId} ${when}`
        : `move ${stayName(a)} from ${a.rowId} to ${plan.standId}, ${when}`;
    }
    case "swap": {
      const b = occupancyById(plan.otherId);
      return b ? `swap ${stayName(a)} on ${a.rowId} with ${stayName(b)} on ${b.rowId}` : "";
    }
    case "conflict":
      return plan.reason;
  }
}

/* ------------------------------------------------------------ suggestion */

/** Gaps longer than this count as this long, so an empty stand is not "infinitely" better. */
const GAP_CAP_MIN = 6 * 60;

/** The shortest gap, in minutes, between consecutive stays on a stand, given where each stay is. */
function tightestGap(standId: string, standOf: (o: Occupancy) => string): number {
  const stays = DEMO_DATA.occupancies.filter((o) => standOf(o) === standId).sort((a, b) => a.start - b.start);
  let tightest = GAP_CAP_MIN;
  for (let i = 1; i < stays.length; i += 1) {
    tightest = Math.min(tightest, (stays[i].start - stays[i - 1].end) / 60_000);
  }
  return Math.round(tightest);
}

export type Suggestion = {
  plan: Extract<DropPlan, { kind: "move" } | { kind: "swap" }>;
  /** The tightest gap on the stands involved, in minutes, before and after. */
  before: number;
  after: number;
  stands: [string, string];
};

/**
 * The move or swap that most widens the tightest gap between consecutive
 * stays on the two stands involved, under the sample rules. Restricted to
 * changes of `occupancyId` when given. Null when nothing makes it wider.
 */
export function suggestBest(occupancyId?: string): Suggestion | null {
  requireStandEditing();
  const subjects = occupancyId
    ? DEMO_DATA.occupancies.filter((o) => o.id === occupancyId)
    : DEMO_DATA.occupancies;
  let best: Suggestion | null = null;
  const consider = (plan: Suggestion["plan"], moved: Map<string, string>, stands: [string, string]) => {
    const standOf = (o: Occupancy) => moved.get(o.id) ?? o.rowId;
    const before = Math.min(...stands.map((s) => tightestGap(s, (o) => o.rowId)));
    const after = Math.min(...stands.map((s) => tightestGap(s, standOf)));
    if (after <= before) return;
    // Wider wins; on a tie, a move (one stay changes) beats a swap.
    if (!best || after - before > best.after - best.before || (after - before === best.after - best.before && plan.kind === "move" && best.plan.kind === "swap")) {
      best = { plan, before, after, stands };
    }
  };
  for (const a of subjects) {
    for (const stand of ACTIVE_DATASET.stands) {
      const plan = planDrop(a.id, stand.code);
      if (plan.kind === "move") consider(plan, new Map([[a.id, stand.code]]), [a.rowId, stand.code]);
    }
    for (const b of DEMO_DATA.occupancies) {
      // Each pair once when searching everything.
      if (b.id === a.id || (!occupancyId && b.id < a.id) || !checkSwap(a.id, b.id).ok) continue;
      consider(
        { kind: "swap", occupancyId: a.id, otherId: b.id },
        new Map([
          [a.id, b.rowId],
          [b.id, a.rowId],
        ]),
        [a.rowId, b.rowId],
      );
    }
  }
  return best;
}

/** "45m" / "6h 00m+" for a capped gap. */
export const formatGap = (minutes: number) =>
  minutes >= GAP_CAP_MIN ? `over ${formatDuration(GAP_CAP_MIN)}` : formatDuration(Math.max(0, minutes));

/** A flight's stay, when it has one on the chart. */
export const stayOfFlight = (flight: OpsFlight | undefined) =>
  flight?.occupancyId ? occupancyById(flight.occupancyId) : undefined;
