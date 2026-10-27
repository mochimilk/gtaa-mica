import { stayKind } from "../stand-timeline-demo/adapter";
import type { StayEndpoints, StayPosition } from "../stand-timeline-demo/adapter";
import type { Occupancy } from "../stand-timeline";
import type { OpsAlert, OpsFlight } from "../operations/operationsData";
import type { DemoDataset, PreparedScenario, PreparedPlan } from "./dataset";
import type { PlanVariant } from "./preferences";
import { SCENARIO_LABELS } from "./preferences";

const instant = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid prepared UTC instant: ${value}`);
  }
  return Date.parse(value);
};
function indexById<T extends { id: string }>(items: T[], label: string) {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`Duplicate prepared ${label}: ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

export function adaptPreparedScenario(snapshot: PreparedScenario, variant: PlanVariant): DemoDataset {
  const plan = snapshot.variants[variant];
  return {
    ...adaptScenarioPlan(snapshot, variant, plan,
      `${plan.covered_flight_count}/${snapshot.flights.length} represented flight legs assigned · ${plan.generated_movement_count} generated tow movements · ${plan.solver_status}. Scheduled context included; not operationally certified.`),
    prepared: { snapshot, variant },
  };
}

export function adaptScenarioPlan(
  snapshot: Omit<PreparedScenario, "variants">, variant: PlanVariant,
  plan: Pick<PreparedPlan, "stays" | "covered_flight_count" | "generated_movement_count">, subtitle: string,
): DemoDataset {
  const start = instant(snapshot.plan_window.start);
  const end = instant(snapshot.plan_window.end);
  if (start >= end) throw new Error("Prepared plan window must be positive.");
  const rows = indexById(snapshot.rows, "stand");
  const visits = new Map(snapshot.visits.map(visit => [visit.turnId, visit]));
  if (visits.size !== snapshot.visits.length) throw new Error("Duplicate prepared visits.");
  const sourceFlights = indexById(snapshot.flights, "flight");
  const stays = indexById(plan.stays, "stay");
  const endpoints = new Map<string, StayEndpoints>();
  const stayPosition = new Map<string, StayPosition>();
  const occupancies: Occupancy[] = [];
  const flightStay = new Map<string, string>();
  const byVisit = new Map<string, typeof plan.stays>();
  let towIns = 0;
  let towOuts = 0;
  for (const stay of stays.values()) {
    if (!rows.has(stay.rowId) || !visits.has(stay.visitId)) throw new Error(`Unknown prepared stay reference: ${stay.id}`);
    if (instant(stay.start) >= instant(stay.end)) throw new Error(`Invalid prepared stay interval: ${stay.id}`);
    if ((stay.arrivalFlightId && stay.towIn) || (stay.departureFlightId && stay.towOut)) throw new Error(`Conflicting prepared endpoint: ${stay.id}`);
    const arrival = stay.arrivalFlightId ? sourceFlights.get(stay.arrivalFlightId) : undefined;
    const departure = stay.departureFlightId ? sourceFlights.get(stay.departureFlightId) : undefined;
    for (const [id, flight, direction, time] of [
      [stay.arrivalFlightId, arrival, "arrival", stay.start],
      [stay.departureFlightId, departure, "departure", stay.end],
    ] as const) {
      if (!id) continue;
      if (!flight || flight.direction !== direction || flight.visitId !== stay.visitId ||
          instant(flight.scheduled) !== instant(time) || flightStay.has(id)) {
        throw new Error(`Invalid prepared flight endpoint: ${id}`);
      }
      flightStay.set(id, stay.id);
    }
    endpoints.set(stay.id, {
      start: arrival ? { kind: "flight", flight: arrival.flight, origin: arrival.routeEnd } : { kind: stay.towIn ? "tow" : "none" },
      end: departure ? { kind: "flight", flight: departure.flight, destination: departure.routeEnd } : { kind: stay.towOut ? "tow" : "none" },
    });
    towIns += Number(stay.towIn);
    towOuts += Number(stay.towOut);
    const siblings = byVisit.get(stay.visitId) ?? [];
    siblings.push(stay);
    byVisit.set(stay.visitId, siblings);
  }
  for (const [visitId, siblings] of byVisit) {
    siblings.sort((a, b) => instant(a.start) - instant(b.start));
    for (const [index, stay] of siblings.entries()) {
      const previous = siblings[index - 1];
      if (previous && (instant(previous.end) >= instant(stay.start) || !previous.towOut || !stay.towIn)) {
        throw new Error(`Invalid prepared tow chain: ${visitId}`);
      }
      stayPosition.set(stay.id, { index, count: siblings.length });
      occupancies.push({
        id: stay.id, visitId, rowId: stay.rowId, start: instant(stay.start), end: instant(stay.end),
        kind: stayKind(index, siblings.length),
      });
    }
  }
  const flights: OpsFlight[] = snapshot.flights.map(flight => {
    const visit = visits.get(flight.visitId);
    if (!visit) throw new Error(`Unknown prepared flight visit: ${flight.id}`);
    const occupancyId = flightStay.get(flight.id);
    if (byVisit.has(flight.visitId) && !occupancyId) throw new Error(`Partial prepared visit assignment: ${flight.visitId}`);
    return {
      id: flight.id, visitId: flight.visitId, direction: flight.direction, flight: flight.flight,
      routeEnd: flight.routeEnd, estimate: instant(flight.scheduled), carrier: visit.carrier,
      registration: visit.registration, aircraftType: visit.aircraftType,
      occupancyId, standId: occupancyId ? stays.get(occupancyId)?.rowId : undefined,
    };
  });
  if (flightStay.size !== plan.covered_flight_count || towIns !== plan.generated_movement_count || towOuts !== towIns) {
    throw new Error("Prepared plan coverage or tow counts do not match displayed assignments.");
  }
  const alerts: OpsAlert[] = flights.filter(flight => !flight.occupancyId).map(flight => ({
    id: `unassigned:${flight.id}`, severity: "warning", title: `${flight.flight} has no stand`,
    detail: `Unassigned ${flight.direction} in this prepared synthetic plan.`, flightId: flight.id,
  }));
  const byTime = (a: OpsFlight, b: OpsFlight) => a.estimate - b.estimate || a.flight.localeCompare(b.flight);
  return {
    id: `${snapshot.demand_id}/${variant}`, label: `Contoso · ${SCENARIO_LABELS[snapshot.case_id]} · ${variant === "baseline" ? "Baseline" : "Tow options"}`,
    date: snapshot.plan_window.start.slice(0, 10), timeBasis: "scheduled",
    subtitle,
    domain: [start, end], timeline: {
      rows: snapshot.rows, visits: snapshot.visits.map(visit => ({ id: visit.turnId, label: `${visit.arrFlight}/${visit.depFlight}` })),
      turnsById: visits, occupancies, endpoints, stayPosition,
    },
    flights, flightsById: new Map(flights.map(flight => [flight.id, flight])),
    arrivals: flights.filter(flight => flight.direction === "arrival").sort(byTime),
    departures: flights.filter(flight => flight.direction === "departure").sort(byTime), alerts,
  };
}
