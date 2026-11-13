import type { Occupancy } from "../stand-timeline";
import { stayKind, type DemoTimelineData, type StayEndpoints, type StayPosition } from "../stand-timeline-demo/adapter";
import { createOperationsDataset, type OpsFlight } from "../operations/dataset";
import { validate } from "./prepared-validator.mjs";
import type { PlanVariant, PreparedScenario } from "./preparedTypes";

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`Invalid prepared UTC instant: ${value}`);
  }
  return parsed;
}

function index<T>(items: readonly T[], id: (item: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const key = id(item);
    if (result.has(key)) throw new Error(`Duplicate prepared identifier: ${key}`);
    result.set(key, item);
  }
  return result;
}

export function adaptPreparedSchedule(
  value: unknown,
  expected: { airportId: string; caseId: string },
  variant: PlanVariant,
) {
  if (!validate(value)) throw new Error(`Invalid prepared schedule: ${JSON.stringify(validate.errors)}`);
  const snapshot: PreparedScenario = value;
  if (snapshot.airport?.id !== expected.airportId || snapshot.case_id !== expected.caseId) {
    throw new Error("Prepared schedule airport or scenario identity does not match the selected source.");
  }
  new Intl.DateTimeFormat("en", { timeZone: snapshot.airport.time_zone });
  const plan = snapshot.variants[variant];
  if (!plan) throw new Error(`Unknown prepared plan: ${variant}`);
  const domain = [instant(snapshot.plan_window.start), instant(snapshot.plan_window.end)] as const;
  const rows = index(snapshot.rows, row => row.id);
  const visits = index(snapshot.visits, visit => visit.turnId);
  const sourceFlights = index(snapshot.flights, flight => flight.id);
  const stays = index(plan.stays, stay => stay.id);
  const endpoints = new Map<string, StayEndpoints>();
  const stayPosition = new Map<string, StayPosition>();
  const occupancies: Occupancy[] = [];
  const noStandStays: Occupancy[] = [];
  const flightStay = new Map<string, string>();
  const byVisit = new Map<string, typeof plan.stays>();
  const flightsByVisit = new Map<string, typeof snapshot.flights>();
  let towIns = 0;
  let towOuts = 0;
  for (const flight of sourceFlights.values()) {
    if (!visits.has(flight.visitId)) throw new Error(`Unknown prepared flight visit: ${flight.id}`);
    instant(flight.scheduled);
    const siblings = flightsByVisit.get(flight.visitId) ?? [];
    siblings.push(flight);
    flightsByVisit.set(flight.visitId, siblings);
  }
  for (const stay of stays.values()) {
    if (!rows.has(stay.rowId) || !visits.has(stay.visitId) || instant(stay.start) >= instant(stay.end)) {
      throw new Error(`Invalid prepared stay reference or interval: ${stay.id}`);
    }
    if ((stay.arrivalFlightId && stay.towIn) || (stay.departureFlightId && stay.towOut)) {
      throw new Error(`Conflicting prepared endpoint: ${stay.id}`);
    }
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
    for (const [position, stay] of siblings.entries()) {
      const previous = siblings[position - 1];
      if (previous && (instant(previous.end) >= instant(stay.start) || !previous.towOut || !stay.towIn)) {
        throw new Error(`Invalid prepared tow chain: ${visitId}`);
      }
      stayPosition.set(stay.id, { index: position, count: siblings.length });
      occupancies.push({
        id: stay.id, visitId, rowId: stay.rowId, start: instant(stay.start), end: instant(stay.end),
        kind: stayKind(position, siblings.length),
      });
    }
  }
  const unplacedByVisit = new Map<string, Occupancy>();
  for (const visit of visits.values()) {
    const flights = flightsByVisit.get(visit.turnId) ?? [];
    const arrival = flights.find(flight => flight.direction === "arrival");
    const departure = flights.find(flight => flight.direction === "departure");
    if (flights.length !== 2 || !arrival || !departure || arrival.flight !== visit.arrFlight ||
        departure.flight !== visit.depFlight || arrival.routeEnd !== visit.origin || departure.routeEnd !== visit.destination) {
      throw new Error(`Prepared visit does not have its exact source flight pair: ${visit.turnId}`);
    }
    if (byVisit.has(visit.turnId)) {
      const chain = byVisit.get(visit.turnId)!;
      if (!flightStay.has(arrival.id) || !flightStay.has(departure.id) ||
          chain[0].arrivalFlightId !== arrival.id || chain.at(-1)?.departureFlightId !== departure.id ||
          chain.some((stay, position) => stay.towIn !== (position > 0) || stay.towOut !== (position < chain.length - 1))) {
        throw new Error(`Partial prepared visit assignment: ${visit.turnId}`);
      }
    } else {
      const stay = {
        id: `unassigned:${visit.turnId}`, visitId: visit.turnId, rowId: "",
        start: instant(arrival.scheduled), end: instant(departure.scheduled), kind: "turn",
      };
      noStandStays.push(stay);
      unplacedByVisit.set(visit.turnId, stay);
      endpoints.set(stay.id, {
        start: { kind: "flight", flight: arrival.flight, origin: arrival.routeEnd },
        end: { kind: "flight", flight: departure.flight, destination: departure.routeEnd },
      });
      stayPosition.set(stay.id, { index: 0, count: 1 });
    }
  }
  for (const row of rows.values()) {
    const ordered = occupancies.filter(stay => stay.rowId === row.id).sort((a, b) => a.start - b.start);
    if (ordered.some((stay, position) => position > 0 && stay.start < ordered[position - 1].end)) {
      throw new Error(`Overlapping prepared assignments on stand ${row.id}.`);
    }
  }
  if (flightStay.size !== plan.covered_flight_count ||
      towIns !== plan.generated_movement_count || towOuts !== towIns) {
    throw new Error("Prepared coverage or tow counts do not match the displayed assignments.");
  }
  const flights: OpsFlight[] = snapshot.flights.map(flight => {
    const visit = visits.get(flight.visitId)!;
    const occupancyId = flightStay.get(flight.id);
    const stay = occupancyId ? stays.get(occupancyId) : undefined;
    const waiting = unplacedByVisit.get(flight.visitId);
    return {
      id: flight.id, direction: flight.direction, flight: flight.flight, routeEnd: flight.routeEnd,
      estimate: instant(flight.scheduled), visitId: flight.visitId,
      registration: visit.registration, aircraftType: visit.aircraftType,
      ...(stay ? {
        occupancyId: stay.id, standId: stay.rowId, standStart: instant(stay.start), standEnd: instant(stay.end),
      } : {}),
      ...(waiting ? { unplacedStay: { stayId: waiting.id, start: waiting.start, end: waiting.end } } : {}),
    };
  });
  const timeline: DemoTimelineData = {
    rows: snapshot.rows,
    visits: snapshot.visits.map(visit => ({ id: visit.turnId, label: `${visit.arrFlight}/${visit.depFlight}` })),
    turnsById: new Map(snapshot.visits.map(visit => [visit.turnId, { ...visit, stays: [] }])),
    occupancies, endpoints, stayPosition, delays: new Map(),
  };
  return createOperationsDataset({
    id: `${snapshot.demand_id}/${variant}`, airportId: snapshot.airport.id,
    label: `${snapshot.airport.name} - ${snapshot.case_id.charAt(0).toUpperCase() + snapshot.case_id.slice(1).replaceAll("-", " ")} - ${variant === "baseline" ? "Baseline" : "Tow options"}`,
    date: snapshot.plan_window.start.slice(0, 10), domain, timeline, flights, noStandStays,
    stands: snapshot.rows.map(row => ({ code: row.id, area: row.group ?? "" })),
    aircraftMakers: {}, aircraftSizes: {},
    capabilities: { editStands: false, fixtureAnalyses: false },
    preparedPlan: { caseId: snapshot.case_id, demandId: snapshot.demand_id, variant, requestFingerprint: plan.request_fingerprint },
    summary: `${plan.covered_flight_count}/${snapshot.flights.length} flight legs assigned; ${plan.generated_movement_count} generated tows; ${plan.solver_status}. Scheduled UTC, including context legs. Read-only synthetic plan, not operational certification.`,
  });
}
