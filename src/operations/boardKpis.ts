// The board's headline numbers, for the KPI strip under its chart (see
// KpiStrip.tsx). Each is worked out from where every stay is (a
// StandState), so the board as it is now and the plan (the fixture's stands
// and times; see planState) are measured alike, and the strip can say how
// far the board has come from the plan. Measured over the chart's window
// (DEMO_DOMAIN) under the sample rules: synthetic demo figures, not
// operational ones.
//
// A stand is in use from a stay's start until its aircraft is expected to
// leave: its end, plus any delay out (the ghost the chart draws after it). A
// late arrival's ghost is time the stand was planned for but stands empty,
// so it does not count. A closed area's stands are out of use while it is
// closed: that time is neither in use nor free.
import type { Millis, Occupancy } from "../stand-timeline";
import { DEMO_DATA, DEMO_DOMAIN } from "../stand-timeline-demo/demoData";
import { GHOST_SIDES, ghostClashes, ghostKey, ghostSpan } from "../stand-timeline-demo/delays";
import { ACTIVE_DATASET, requireFixtureAnalyses } from "./activeDataset";
import {
  flightsAtStay,
  occupancyById,
  offBoardStay,
  planState,
  planVersion,
  standArea,
  stayName,
  type StandState,
} from "./allocation";
import { OPS_FLIGHTS } from "./operationsData";

/** A free stretch on a stand at least this long, minutes, can take a turn: it counts as a window. */
export const MIN_WINDOW_MINUTES = 60;

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Something on the board for a while: a conflict's clash, a stay waiting for a stand. */
export type KpiSpan = { id: string; start: Millis; end: Millis; label: string; standId?: string };

export type BoardKpis = {
  /**
   * Late stays' delays that run into another stay on their stand, as the
   * Alerts list conflicts: each the ghost that clashes, soonest first.
   */
  conflicts: KpiSpan[];
  /** Flights with no stand. */
  noStand: number;
  /** Of those, the flights with no stay times yet, so nothing to place. */
  untimed: number;
  /** Stays waiting for a stand (the No stand lane), earliest first. */
  waiting: KpiSpan[];
  /** The share of open stand time in use across the window, 0–1. */
  standUse: number;
  /** The same, hour by hour across the window. */
  hourlyUse: { from: Millis; use: number }[];
  /** Free stretches on open stands of MIN_WINDOW_MINUTES or more. */
  windows: number;
  /** Their total length, minutes. */
  freeMinutes: number;
  /** Aircraft that would wait for their stand to come free (see gateHolds), soonest first. */
  holds: GateHold[];
  /** How long they would wait between them, minutes. */
  gateHoldMinutes: number;
};

/**
 * An aircraft that would wait for its stand: it is due on at `due`, but the
 * aircraft before it on the stand is still there (running late, or held up
 * itself), so it gets on `minutes` later.
 */
export type GateHold = { stayId: string; standId: string; label: string; due: Millis; minutes: number };

/**
 * Who would wait for their stand, and how long, as the stays sit in `onStands`:
 * on each stand in turn, each aircraft gets on when it is due or once the one
 * before has left, whichever is later, and stays its expected time (to its
 * end, plus any delay out). So one late departure holds the next arrival, and
 * that one, now late itself, can hold the one after: the knock-on, which a
 * conflict alone (a ghost running into the next stay) does not show.
 */
export function gateHolds(onStands: readonly Occupancy[]): GateHold[] {
  const holds: GateHold[] = [];
  const byStand = new Map<string, Occupancy[]>();
  for (const stay of onStands) byStand.set(stay.rowId, [...(byStand.get(stay.rowId) ?? []), stay]);
  for (const [standId, stays] of byStand) {
    let free = -Infinity;
    for (const stay of [...stays].sort((a, b) => a.start - b.start || a.end - b.end)) {
      const waits = Math.max(0, free - stay.start);
      const onFor = stay.end + (DEMO_DATA.delays.get(stay.id)?.out ?? 0) - stay.start;
      free = Math.max(free, stay.start + waits + onFor);
      const minutes = Math.round(waits / MINUTE);
      if (minutes > 0) holds.push({ stayId: stay.id, standId, label: stayName(stay), due: stay.start, minutes });
    }
  }
  return holds.sort((a, b) => a.due - b.due);
}

type Span = [Millis, Millis];

const total = (spans: readonly Span[]) => spans.reduce((sum, [start, end]) => sum + end - start, 0);

/** How much of `spans` falls between `from` and `to`. */
const within = (spans: readonly Span[], from: Millis, to: Millis) =>
  spans.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, to) - Math.max(start, from)), 0);

/** `spans` inside the window, merged where they overlap or meet, in order. */
function merge(spans: readonly Span[]): Span[] {
  const [from, to] = DEMO_DOMAIN;
  const clipped = spans
    .map(([start, end]): Span => [Math.max(start, from), Math.min(end, to)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const [start, end] of clipped) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Merged `spans` less merged `cut`. */
function subtract(spans: readonly Span[], cut: readonly Span[]): Span[] {
  const left: Span[] = [];
  for (const [from, to] of spans) {
    let start = from;
    for (const [cutStart, cutEnd] of cut) {
      if (cutEnd <= start || cutStart >= to) continue;
      if (cutStart > start) left.push([start, cutStart]);
      start = cutEnd;
    }
    if (start < to) left.push([start, to]);
  }
  return left;
}

/** A stay by id, on a stand or not. */
const stayAt = (id: string) => occupancyById(id) ?? offBoardStay(id);

/** The board's figures with every stay where `state` has it, and its closure. */
export function boardKpis({ stays, closure }: StandState): BoardKpis {
  requireFixtureAnalyses();
  const onStands: Occupancy[] = [];
  const waiting: KpiSpan[] = [];
  let noStand = 0;
  for (const [id, place] of stays) {
    const stay = stayAt(id);
    if (!stay) continue;
    if (place.rowId) {
      onStands.push({ ...stay, ...place });
    } else {
      waiting.push({ id, start: place.start, end: place.end, label: stayName(stay) });
      noStand += flightsAtStay(id).length;
    }
  }
  // Flights with no stay at all: the same ones however the stays sit.
  const untimed = OPS_FLIGHTS.filter((flight) => !flight.occupancyId && !flight.unplacedStay).length;

  const clashes = ghostClashes(onStands, DEMO_DATA.delays);
  const conflicts: KpiSpan[] = [];
  for (const stay of onStands) {
    for (const side of GHOST_SIDES) {
      const span = clashes.has(ghostKey(stay.id, side)) && ghostSpan(stay, DEMO_DATA.delays.get(stay.id), side);
      if (!span) continue;
      conflicts.push({ id: ghostKey(stay.id, side), start: span[0], end: span[1], label: stayName(stay), standId: stay.rowId });
    }
  }

  const [from, to] = DEMO_DOMAIN;
  const hours = Array.from({ length: Math.ceil((to - from) / HOUR) }, (_, index) => from + index * HOUR);
  const hourOpen = hours.map(() => 0);
  const hourBusy = hours.map(() => 0);
  let open = 0;
  let busy = 0;
  let windows = 0;
  let free = 0;
  for (const { code } of ACTIVE_DATASET.stands) {
    const closed = closure && standArea(code) === closure.area ? merge([[closure.from, closure.to]]) : [];
    const openSpans = subtract([[from, to]], closed);
    const busySpans = subtract(
      merge(
        onStands
          .filter((stay) => stay.rowId === code)
          .map((stay): Span => [stay.start, stay.end + (DEMO_DATA.delays.get(stay.id)?.out ?? 0)]),
      ),
      closed,
    );
    const gaps = subtract(openSpans, busySpans).filter(([start, end]) => end - start >= MIN_WINDOW_MINUTES * MINUTE);
    open += total(openSpans);
    busy += total(busySpans);
    windows += gaps.length;
    free += total(gaps);
    hours.forEach((hour, index) => {
      hourOpen[index] += within(openSpans, hour, hour + HOUR);
      hourBusy[index] += within(busySpans, hour, hour + HOUR);
    });
  }

  const bySoonest = (a: KpiSpan, b: KpiSpan) => a.start - b.start || a.end - b.end;
  const holds = gateHolds(onStands);
  return {
    conflicts: conflicts.sort(bySoonest),
    noStand: noStand + untimed,
    untimed,
    waiting: waiting.sort(bySoonest),
    standUse: open ? busy / open : 0,
    hourlyUse: hours.map((hour, index) => ({ from: hour, use: hourOpen[index] ? hourBusy[index] / hourOpen[index] : 0 })),
    windows,
    freeMinutes: Math.round(free / MINUTE),
    holds,
    gateHoldMinutes: holds.reduce((sum, hold) => sum + hold.minutes, 0),
  };
}

let plan: { version: number; kpis: BoardKpis } | undefined;

/**
 * The plan's figures: the current plan, which a stay found running late
 * changes (planVersion), so they are worked out again only then.
 */
export function planKpis(): BoardKpis {
  if (plan?.version !== planVersion()) plan = { version: planVersion(), kpis: boardKpis(planState()) };
  return plan.kpis;
}
