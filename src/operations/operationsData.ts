// App-owned operations dataset for the left panel. Derived from the same
// synthetic fixture as the chart, plus explicit synthetic unassigned flights
// that have no stand and therefore no chart occupancy. Not real operations data.
import type { Millis } from "../stand-timeline";
import { utcAt } from "../stand-timeline-demo/adapter";
import { DEMO_DATA } from "../stand-timeline-demo/demoData";
import { SYNTHETIC_DATE } from "../stand-timeline-demo/syntheticFixture";

export type FlightDirection = "arrival" | "departure";

export interface OpsFlight {
  /** Stable ID: `${visitId}-ARR` / `${visitId}-DEP`, or `U..` when unassigned. */
  id: string;
  direction: FlightDirection;
  flight: string;
  /** Displayed route endpoint: origin for arrivals, destination for departures. */
  routeEnd: string;
  /**
   * Synthetic estimate (UTC). For assigned flights it is the stay's on-block
   * (arrival) or off-block (departure) time from the fixture.
   */
  estimate: Millis;
  registration?: string;
  aircraftType?: string;
  visitId?: string;
  /** The chart occupancy where this flight endpoint occurs; absent when unassigned. */
  occupancyId?: string;
  standId?: string;
}

export type AlertSeverity = "warning" | "info";

export interface OpsAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  flightId: string;
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
        estimate: o.end,
      });
    }
  }
  return out;
}

const at = (hhmm: string) => utcAt(SYNTHETIC_DATE, hhmm);

/** Explicit synthetic flights with no stand: listed in the panel, never drawn on the chart. */
const UNASSIGNED_FLIGHTS: OpsFlight[] = [
  { id: "U01", direction: "arrival", flight: "XB240", routeEnd: "LAX", estimate: at("09:45"), registration: "C-SYBG", aircraftType: "B738" },
  { id: "U02", direction: "arrival", flight: "XA130", routeEnd: "BOS", estimate: at("11:20") },
  { id: "U03", direction: "arrival", flight: "XD480", routeEnd: "LHR", estimate: at("14:05"), registration: "C-SYDF", aircraftType: "B789" },
  { id: "U04", direction: "departure", flight: "XC350", routeEnd: "SFO", estimate: at("10:30"), aircraftType: "A321" },
  { id: "U05", direction: "departure", flight: "XB241", routeEnd: "SEA", estimate: at("16:10") },
];

const byEstimate = (a: OpsFlight, b: OpsFlight) =>
  a.estimate - b.estimate || a.flight.localeCompare(b.flight);

export const OPS_FLIGHTS: OpsFlight[] = [...assignedFlights(), ...UNASSIGNED_FLIGHTS];
export const OPS_FLIGHTS_BY_ID = new Map(OPS_FLIGHTS.map((f) => [f.id, f]));
export const ARRIVALS = OPS_FLIGHTS.filter((f) => f.direction === "arrival").sort(byEstimate);
export const DEPARTURES = OPS_FLIGHTS.filter((f) => f.direction === "departure").sort(byEstimate);

/*
 * Synthetic demo alerts. Each states a fact present in the synthetic data
 * (no stand, explicit tows, outside the visible window); none is an
 * allocation rule or a real operational alert.
 */
export const OPS_ALERTS: OpsAlert[] = [
  ...UNASSIGNED_FLIGHTS.map(
    (f): OpsAlert => ({
      id: `ALERT-${f.id}`,
      severity: "warning",
      title: `${f.flight} has no stand`,
      detail: `Unassigned ${f.direction} in the synthetic data, so it is not on the chart.`,
      flightId: f.id,
    }),
  ),
  {
    id: "ALERT-T09-TOWS",
    severity: "info",
    title: "XD452/453 is towed twice",
    detail: "Synthetic visit across B11, R1 and A3 with explicit tow-out/tow-in.",
    flightId: "T09-ARR",
  },
  {
    id: "ALERT-T12-WINDOW",
    severity: "info",
    title: "XC335 departs after 17:00 UTC",
    detail: "Its stay continues past the visible synthetic window.",
    flightId: "T12-DEP",
  },
];

/** Active alert count per flight, for list row issue markers. */
export function alertsForFlight(flightId: string, acknowledged: ReadonlySet<string>) {
  return OPS_ALERTS.filter((a) => a.flightId === flightId && !acknowledged.has(a.id));
}
