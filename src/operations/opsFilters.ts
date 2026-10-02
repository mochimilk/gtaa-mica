// App-owned Views + Filters model and matching predicates over the synthetic
// demo data. Only supported fixture fields are used (carrier, stand area,
// aircraft type, explicit flight/tow endpoints, open synthetic alerts);
// nothing here invents status, conflicts or a live clock.
//
// Semantics:
// - One view at a time (radio). "all" applies no view restriction.
// - Filters: OR within a dimension, AND across dimensions.
// - An empty dimension means "no restriction" (all values pass).
import { DEMO_DATA } from "../stand-timeline-demo/demoData";
import {
  OPS_ALERTS,
  OPS_FLIGHTS,
  OPS_FLIGHTS_BY_ID,
  type OpsAlert,
  type OpsFlight,
} from "./operationsData";

export type ViewKey = "all" | "attention" | "arrivals" | "departures" | "tows";

export const VIEWS: { value: ViewKey; label: string; hint: string }[] = [
  { value: "all", label: "All activity", hint: "Everything in the demo window" },
  { value: "attention", label: "Needs attention", hint: "Visits or flights with open alerts" },
  { value: "arrivals", label: "Arrivals", hint: "Stays that start with an arrival flight" },
  { value: "departures", label: "Departures", hint: "Stays that end with a departure flight" },
  { value: "tows", label: "Tows", hint: "Stays with an explicit tow-in or tow-out" },
];

export type FilterDim = "carrier" | "area" | "type";
export type OpsFilters = Record<FilterDim, string[]>;

export const EMPTY_FILTERS: OpsFilters = { carrier: [], area: [], type: [] };

/** Labels for values that aren't fixture codes. */
export const UNASSIGNED_AREA = "Unassigned";
export const UNKNOWN_TYPE = "Not recorded";

/* ------------------------------------------------------------- facts */

const areaByStand = new Map(DEMO_DATA.rows.map((r) => [r.id, r.group ?? ""]));
const carrierOfFlight = (f: OpsFlight) =>
  (f.visitId && DEMO_DATA.turnsById.get(f.visitId)?.carrier) || f.flight.slice(0, 2);
const areaOfFlight = (f: OpsFlight) =>
  f.standId ? areaByStand.get(f.standId) ?? UNASSIGNED_AREA : UNASSIGNED_AREA;
const typeOfFlight = (f: OpsFlight) => f.aircraftType ?? UNKNOWN_TYPE;

/** Visits with at least one explicit tow endpoint. */
const TOW_VISITS = new Set(
  DEMO_DATA.occupancies
    .filter((o) => {
      const ep = DEMO_DATA.endpoints.get(o.id);
      return ep && (ep.start.kind === "tow" || ep.end.kind === "tow");
    })
    .map((o) => o.visitId)
    .filter((v): v is string => !!v),
);

/* ------------------------------------------------- option lists (sorted) */

const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));

export const FILTER_OPTIONS: Record<FilterDim, string[]> = {
  carrier: uniq(OPS_FLIGHTS.map(carrierOfFlight)),
  // Stand areas in chart row order, then the explicit no-stand option.
  area: [...new Set(DEMO_DATA.rows.map((r) => r.group ?? ""))].filter(Boolean).concat(UNASSIGNED_AREA),
  type: uniq(OPS_FLIGHTS.map(typeOfFlight)),
};

export const FILTER_LABELS: Record<FilterDim, string> = {
  carrier: "Carrier",
  area: "Stand area",
  type: "Aircraft type",
};

/* ------------------------------------------------------------ predicates */

const passes = (set: string[], value: string) => set.length === 0 || set.includes(value);

/** Visits/flights referenced by currently open (unacknowledged) alerts. */
function openAlertScope(acknowledged: ReadonlySet<string>) {
  const flights = new Set<string>();
  const visits = new Set<string>();
  for (const a of OPS_ALERTS) {
    if (acknowledged.has(a.id)) continue;
    flights.add(a.flightId);
    const visit = OPS_FLIGHTS_BY_ID.get(a.flightId)?.visitId;
    if (visit) visits.add(visit);
  }
  return { flights, visits };
}

export interface OpsMatcher {
  /** True when any view or filter restricts the data. */
  active: boolean;
  occupancy: (occupancyId: string) => boolean;
  flight: (f: OpsFlight) => boolean;
  alert: (a: OpsAlert) => boolean;
}

export function makeMatcher(
  view: ViewKey,
  filters: OpsFilters,
  acknowledged: ReadonlySet<string>,
): OpsMatcher {
  const active =
    view !== "all" || filters.carrier.length + filters.area.length + filters.type.length > 0;
  const scope = openAlertScope(acknowledged);
  const occById = new Map(DEMO_DATA.occupancies.map((o) => [o.id, o]));

  const occupancy = (id: string) => {
    if (!active) return true;
    const o = occById.get(id);
    const turn = o?.visitId ? DEMO_DATA.turnsById.get(o.visitId) : undefined;
    const ep = DEMO_DATA.endpoints.get(id);
    if (!o || !turn || !ep) return false;
    const inView =
      view === "all" ||
      (view === "attention" && scope.visits.has(turn.turnId)) ||
      (view === "arrivals" && ep.start.kind === "flight") ||
      (view === "departures" && ep.end.kind === "flight") ||
      (view === "tows" && (ep.start.kind === "tow" || ep.end.kind === "tow"));
    return (
      inView &&
      passes(filters.carrier, turn.carrier) &&
      passes(filters.area, areaByStand.get(o.rowId) ?? "") &&
      passes(filters.type, turn.aircraftType)
    );
  };

  const flightPassesFilters = (f: OpsFlight) =>
    passes(filters.carrier, carrierOfFlight(f)) &&
    passes(filters.area, areaOfFlight(f)) &&
    passes(filters.type, typeOfFlight(f));

  const flight = (f: OpsFlight) => {
    if (!active) return true;
    const inView =
      view === "all" ||
      (view === "attention" &&
        (scope.flights.has(f.id) || (!!f.visitId && scope.visits.has(f.visitId)))) ||
      (view === "arrivals" && f.direction === "arrival") ||
      (view === "departures" && f.direction === "departure") ||
      (view === "tows" && !!f.visitId && TOW_VISITS.has(f.visitId));
    return inView && flightPassesFilters(f);
  };

  // Alerts follow the filter dimensions but not the view, so acknowledged
  // alerts stay reachable (and reopenable) under "Needs attention".
  const alert = (a: OpsAlert) => {
    const f = OPS_FLIGHTS_BY_ID.get(a.flightId);
    return !f || flightPassesFilters(f);
  };

  return { active, occupancy, flight, alert };
}
