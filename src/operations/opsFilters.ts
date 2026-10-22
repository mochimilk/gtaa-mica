// App-owned Views + Filters model and matching predicates over the synthetic
// demo data. Only supported fixture fields are used (carrier, stand area,
// aircraft type, explicit flight/tow endpoints, open synthetic alerts);
// nothing here invents status, conflicts or a live clock.
//
// Semantics:
// - One view at a time (radio). "all" applies no view restriction.
// - Filters: OR within a dimension, AND across dimensions.
// - An empty dimension means "no restriction" (all values pass).
import type { DemoDataset } from "../demo/dataset";
import type { OpsAlert, OpsFlight } from "./operationsData";

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

const typeOfFlight = (f: OpsFlight) => f.aircraftType ?? UNKNOWN_TYPE;
function factsFor(dataset: DemoDataset) {
  const areaByStand = new Map(dataset.timeline.rows.map(row => [row.id, row.group ?? ""]));
  const carrierOfFlight = (flight: OpsFlight) =>
    flight.carrier || (flight.visitId && dataset.timeline.turnsById.get(flight.visitId)?.carrier) || flight.flight.slice(0, 2);
  const areaOfFlight = (flight: OpsFlight) =>
    flight.standId ? areaByStand.get(flight.standId) ?? UNASSIGNED_AREA : UNASSIGNED_AREA;
  const towVisits = new Set(dataset.timeline.occupancies.filter(occupancy => {
    const endpoints = dataset.timeline.endpoints.get(occupancy.id);
    return endpoints && (endpoints.start.kind === "tow" || endpoints.end.kind === "tow");
  }).flatMap(occupancy => occupancy.visitId ? [occupancy.visitId] : []));
  return { areaByStand, carrierOfFlight, areaOfFlight, towVisits };
}

/* ------------------------------------------------- option lists (sorted) */

const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));

export function makeFilterOptions(dataset: DemoDataset): Record<FilterDim, string[]> {
  const { carrierOfFlight } = factsFor(dataset);
  return {
    carrier: uniq(dataset.flights.map(carrierOfFlight)),
    area: [...new Set(dataset.timeline.rows.map(row => row.group ?? ""))].filter(Boolean).concat(UNASSIGNED_AREA),
    type: uniq(dataset.flights.map(typeOfFlight)),
  };
}

export const FILTER_LABELS: Record<FilterDim, string> = {
  carrier: "Carrier",
  area: "Stand area",
  type: "Aircraft type",
};

/* ------------------------------------------------------------ predicates */

const passes = (set: string[], value: string) => set.length === 0 || set.includes(value);

/** Visits/flights referenced by currently open (unacknowledged) alerts. */
function openAlertScope(acknowledged: ReadonlySet<string>, dataset: DemoDataset) {
  const flights = new Set<string>();
  const visits = new Set<string>();
  for (const a of dataset.alerts) {
    if (acknowledged.has(a.id)) continue;
    flights.add(a.flightId);
    const visit = dataset.flightsById.get(a.flightId)?.visitId;
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
  dataset: DemoDataset,
  view: ViewKey,
  filters: OpsFilters,
  acknowledged: ReadonlySet<string>,
): OpsMatcher {
  const active =
    view !== "all" || filters.carrier.length + filters.area.length + filters.type.length > 0;
  const { timeline: DEMO_DATA } = dataset;
  const { areaByStand, carrierOfFlight, areaOfFlight, towVisits } = factsFor(dataset);
  const scope = openAlertScope(acknowledged, dataset);
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
      (view === "tows" && !!f.visitId && towVisits.has(f.visitId));
    return inView && flightPassesFilters(f);
  };

  // Alerts follow the filter dimensions but not the view, so acknowledged
  // alerts stay reachable (and reopenable) under "Needs attention".
  const alert = (a: OpsAlert) => {
    const f = dataset.flightsById.get(a.flightId);
    return !f || flightPassesFilters(f);
  };

  return { active, occupancy, flight, alert };
}
