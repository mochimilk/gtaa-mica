// App-owned operations dataset for the left panel. Derived from the same
// synthetic fixture as the chart, plus explicit synthetic unassigned flights
// that have no stand, and so wait in the chart's No stand lane until given
// one. Not real operations data.
import type { Millis, Occupancy } from "../stand-timeline";
import { utcAt } from "../stand-timeline-demo/adapter";
import { DEMO_DATA } from "../stand-timeline-demo/demoData";
import { SYNTHETIC_DATE } from "../stand-timeline-demo/syntheticFixture";

export type FlightDirection = "arrival" | "departure";

/** A stay that has no stand: when it needs one (UTC), and which stay it is. */
export interface UnplacedStay {
  stayId: string;
  start: Millis;
  end: Millis;
}

export interface OpsFlight {
  /** Stable ID: `${visitId}-ARR` / `${visitId}-DEP`, or `U..` when unassigned. */
  id: string;
  direction: FlightDirection;
  flight: string;
  /** Displayed route endpoint: origin for arrivals, destination for departures. */
  routeEnd: string;
  /**
   * Synthetic estimate (UTC). For assigned flights it is the stay's on-block
   * (arrival) or off-block (departure) time from the fixture; a departure
   * running late leaves its delay later (see StayDelay).
   */
  estimate: Millis;
  registration?: string;
  aircraftType?: string;
  visitId?: string;
  /** The chart occupancy where this flight endpoint occurs; absent when unassigned. */
  occupancyId?: string;
  standId?: string;
  /** When the stay this endpoint belongs to starts and ends on its stand (UTC); absent when unassigned. */
  standStart?: Millis;
  standEnd?: Millis;
  /**
   * While the flight has no stand: the stay it needs one for, off the chart.
   * Absent when it has a stand, and when the demo data has no stay times for
   * it, so there is nothing to place.
   */
  unplacedStay?: UnplacedStay;
}

/*
 * Assigned flights: one per actual flight endpoint on a chart stay (see the
 * adapter's `endpoints`). Visits with no flight endpoint (the X02 parking
 * example) contribute no list rows.
 */
function assignedFlights(): OpsFlight[] {
  const out: OpsFlight[] = [];
  for (const o of DEMO_DATA.occupancies) {
    const ep = DEMO_DATA.endpoints.get(o.id);
    const turn = o.visitId ? DEMO_DATA.turnsById.get(o.visitId) : undefined;
    if (!ep || !turn) continue;
    const common = {
      registration: turn.registration,
      aircraftType: turn.aircraftType,
      visitId: turn.turnId,
      occupancyId: o.id,
      standId: o.rowId,
      standStart: o.start,
      standEnd: o.end,
    };
    if (ep.start.kind === "flight") {
      out.push({
        ...common,
        id: `${turn.turnId}-ARR`,
        direction: "arrival",
        flight: ep.start.flight,
        routeEnd: ep.start.origin,
        estimate: o.start,
      });
    }
    if (ep.end.kind === "flight") {
      out.push({
        ...common,
        id: `${turn.turnId}-DEP`,
        direction: "departure",
        flight: ep.end.flight,
        routeEnd: ep.end.destination,
        estimate: o.end + (DEMO_DATA.delays.get(o.id)?.out ?? 0),
      });
    }
  }
  return out;
}

const at = (hhmm: string) => utcAt(SYNTHETIC_DATE, hhmm);

/** The synthetic on-block and off-block (UTC) a no-stand flight needs a stand for. */
const needsStand = (id: string, onBlock: string, offBlock: string): UnplacedStay => ({
  stayId: `${id}-1`,
  start: at(onBlock),
  end: at(offBlock),
});

/**
 * Explicit synthetic flights with no stand: listed in the panel, and drawn in
 * the chart's No stand lane until given a stand. Each one's stay times are synthetic,
 * chosen for the demo: an arrival's start at its estimate, a departure's end
 * at it. XB241 has none yet (its inbound is not known), so it cannot be
 * placed.
 */
const UNASSIGNED_FLIGHTS: OpsFlight[] = [
  { id: "U01", direction: "arrival", flight: "XB240", routeEnd: "LAX", estimate: at("09:45"), registration: "C-SYBG", aircraftType: "B738", unplacedStay: needsStand("U01", "09:45", "11:10") },
  { id: "U02", direction: "arrival", flight: "XA130", routeEnd: "BOS", estimate: at("11:20"), unplacedStay: needsStand("U02", "11:20", "12:35") },
  { id: "U03", direction: "arrival", flight: "XD480", routeEnd: "LHR", estimate: at("14:05"), registration: "C-SYDF", aircraftType: "B789", unplacedStay: needsStand("U03", "14:05", "16:50") },
  { id: "U04", direction: "departure", flight: "XC350", routeEnd: "SFO", estimate: at("10:30"), aircraftType: "A321", unplacedStay: needsStand("U04", "09:10", "10:30") },
  { id: "U05", direction: "departure", flight: "XB241", routeEnd: "SEA", estimate: at("16:10") },
];

/**
 * The stays of the no-stand flights that have stay times, off the chart until
 * given a stand (see ./allocation). Each is a one-flight visit of its own, so
 * once on a stand its bar is labelled, coloured and checked like any other.
 */
export const NO_STAND_STAYS: Occupancy[] = UNASSIGNED_FLIGHTS.flatMap((f): Occupancy[] => {
  const stay = f.unplacedStay;
  if (!stay) return [];
  const arrival = f.direction === "arrival";
  DEMO_DATA.turnsById.set(f.id, {
    turnId: f.id,
    carrier: f.flight.slice(0, 2),
    arrFlight: arrival ? f.flight : "",
    depFlight: arrival ? "" : f.flight,
    origin: arrival ? f.routeEnd : "",
    destination: arrival ? "" : f.routeEnd,
    registration: f.registration ?? "",
    aircraftType: f.aircraftType ?? "",
    stays: [],
  });
  DEMO_DATA.visits.push({ id: f.id, label: f.flight });
  DEMO_DATA.endpoints.set(stay.stayId, {
    start: arrival ? { kind: "flight", flight: f.flight, origin: f.routeEnd } : { kind: "none" },
    end: arrival ? { kind: "none" } : { kind: "flight", flight: f.flight, destination: f.routeEnd },
  });
  DEMO_DATA.stayPosition.set(stay.stayId, { index: 0, count: 1 });
  f.visitId = f.id;
  return [{ id: stay.stayId, visitId: f.id, rowId: "", start: stay.start, end: stay.end, kind: "turn" }];
});

const byEstimate = (a: OpsFlight, b: OpsFlight) =>
  a.estimate - b.estimate || a.flight.localeCompare(b.flight);

export const OPS_FLIGHTS: OpsFlight[] = [...assignedFlights(), ...UNASSIGNED_FLIGHTS];

// The flights are shared, mutable state (stand changes rewrite them in place),
// and loading this module registers the no-stand visits on DEMO_DATA. A hot
// update would do that twice and split the flights into two copies, so a
// change here reloads the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
export const OPS_FLIGHTS_BY_ID = new Map(OPS_FLIGHTS.map((f) => [f.id, f]));
export const ARRIVALS = OPS_FLIGHTS.filter((f) => f.direction === "arrival").sort(byEstimate);
export const DEPARTURES = OPS_FLIGHTS.filter((f) => f.direction === "departure").sort(byEstimate);

/** Minutes the flight's stay occupies its stand, or null when it has no stand. */
export function standMinutes(flight: OpsFlight): number | null {
  if (flight.standStart === undefined || flight.standEnd === undefined) return null;
  return Math.round((flight.standEnd - flight.standStart) / 60_000);
}

/** "3h 05m" / "45m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
