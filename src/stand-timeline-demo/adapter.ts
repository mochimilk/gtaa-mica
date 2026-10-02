// App-owned adapter: maps the app's sample shapes to chart-neutral types.
import type { Millis, Occupancy, TimelineRow, Visit } from "../stand-timeline";
import type { SyntheticStand, SyntheticStay, SyntheticTurn } from "./syntheticFixture";

const DAY = 86_400_000;

export function utcAt(date: string, hhmm: string, dayOffset = 0): Millis {
  return Date.parse(`${date}T${hhmm}:00Z`) + dayOffset * DAY;
}

function stayTimes(date: string, s: SyntheticStay): [Millis, Millis] {
  const start = utcAt(date, s.onBlock, s.dayOffset);
  let end = utcAt(date, s.offBlock, s.dayOffset);
  if (end <= start) end += DAY; // crosses midnight
  return [start, end];
}

export function stayKind(index: number, count: number): string {
  if (count === 1) return "turn";
  if (index === 0) return "arr";
  return index === count - 1 ? "dep" : "hold";
}

export interface DemoTimelineData {
  rows: TimelineRow[];
  visits: Visit[];
  occupancies: Occupancy[];
  turnsById: Map<string, SyntheticTurn>;
  /** Position of each occupancy within its visit's stays, in time order. */
  stayPosition: Map<string, StayPosition>;
  /** Actual start/end events (flight, tow or none) at each occupancy. */
  endpoints: Map<string, StayEndpoints>;
}

export interface StayPosition {
  index: number;
  count: number;
}

/** What begins a stay: an arrival flight, a tow-in, or nothing recorded. */
export type StayStart =
  | { kind: "flight"; flight: string; origin: string }
  | { kind: "tow" }
  | { kind: "none" };

/** What ends a stay: a departure flight, a tow-out, or nothing recorded. */
export type StayEnd =
  | { kind: "flight"; flight: string; destination: string }
  | { kind: "tow" }
  | { kind: "none" };

/**
 * Actual endpoints of one stay. Visit-level flights may still appear in a
 * stay's description, but only `kind: "flight"` shows a flight on the bar,
 * and only `kind: "tow"` shows a tow.
 */
export interface StayEndpoints {
  start: StayStart;
  end: StayEnd;
}

/**
 * Explicit fixture events win. Defaults: the visit's first stay starts with
 * its arrival flight, its last stay ends with its departure flight, every
 * other side is "none". Tows are never defaulted or inferred.
 */
function stayEndpoints(t: SyntheticTurn, s: SyntheticStay, i: number): StayEndpoints {
  const startEvent = s.start ?? (i === 0 ? "flight" : "none");
  const endEvent = s.end ?? (i === t.stays.length - 1 ? "flight" : "none");
  return {
    start:
      startEvent === "flight"
        ? { kind: "flight", flight: t.arrFlight, origin: t.origin }
        : { kind: startEvent },
    end:
      endEvent === "flight"
        ? { kind: "flight", flight: t.depFlight, destination: t.destination }
        : { kind: endEvent },
  };
}

export function adaptSyntheticDay(
  date: string,
  stands: SyntheticStand[],
  turns: SyntheticTurn[],
): DemoTimelineData {
  const rows = stands.map((s) => ({ id: s.code, label: s.code, group: s.area }));
  const visits = turns.map((t) => ({
    id: t.turnId,
    label: `${t.arrFlight}/${t.depFlight.slice(t.carrier.length)}`,
  }));
  const stayPosition = new Map<string, StayPosition>();
  const endpoints = new Map<string, StayEndpoints>();
  const occupancies = turns.flatMap((t) =>
    t.stays.map((s, i): Occupancy => {
      const [start, end] = stayTimes(date, s);
      stayPosition.set(`${t.turnId}-${i + 1}`, { index: i, count: t.stays.length });
      endpoints.set(`${t.turnId}-${i + 1}`, stayEndpoints(t, s, i));
      return {
        id: `${t.turnId}-${i + 1}`,
        visitId: t.turnId,
        rowId: s.stand,
        start,
        end,
        kind: stayKind(i, t.stays.length),
      };
    }),
  );
  return {
    rows,
    visits,
    occupancies,
    turnsById: new Map(turns.map((t) => [t.turnId, t])),
    stayPosition,
    endpoints,
  };
}
