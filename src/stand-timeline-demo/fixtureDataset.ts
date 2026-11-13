import { createOperationsDataset, type OpsFlight, type UnplacedStay } from "../operations/dataset";
import { adaptSyntheticDay, utcAt, type DemoTimelineData } from "./adapter";
import {
  AIRCRAFT_MAKER,
  AIRCRAFT_SIZE,
  SYNTHETIC_DATE,
  SYNTHETIC_STANDS,
  SYNTHETIC_TURNS,
  SYNTHETIC_WINDOW,
} from "./syntheticFixture";

function assignedFlights(data: DemoTimelineData): OpsFlight[] {
  const out: OpsFlight[] = [];
  for (const o of data.occupancies) {
    const ep = data.endpoints.get(o.id);
    const turn = o.visitId ? data.turnsById.get(o.visitId) : undefined;
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
        estimate: o.end + (data.delays.get(o.id)?.out ?? 0),
      });
    }
  }
  return out;
}

export function createFixtureDataset() {
  const timeline = adaptSyntheticDay(SYNTHETIC_DATE, SYNTHETIC_STANDS, SYNTHETIC_TURNS);
  const at = (hhmm: string) => utcAt(SYNTHETIC_DATE, hhmm);
  const needsStand = (id: string, onBlock: string, offBlock: string): UnplacedStay => ({
    stayId: `${id}-1`,
    start: at(onBlock),
    end: at(offBlock),
  });
  const unassigned: OpsFlight[] = [
    { id: "U01", direction: "arrival", flight: "XB240", routeEnd: "LAX", estimate: at("09:45"), registration: "C-SYBG", aircraftType: "B738", unplacedStay: needsStand("U01", "09:45", "11:10") },
    { id: "U02", direction: "arrival", flight: "XA130", routeEnd: "BOS", estimate: at("11:20"), unplacedStay: needsStand("U02", "11:20", "12:35") },
    { id: "U03", direction: "arrival", flight: "XD480", routeEnd: "LHR", estimate: at("14:05"), registration: "C-SYDF", aircraftType: "B789", unplacedStay: needsStand("U03", "14:05", "16:50") },
    { id: "U04", direction: "departure", flight: "XC350", routeEnd: "SFO", estimate: at("10:30"), aircraftType: "A321", unplacedStay: needsStand("U04", "09:10", "10:30") },
    { id: "U05", direction: "departure", flight: "XB241", routeEnd: "SEA", estimate: at("16:10") },
  ];
  const noStandStays = unassigned.flatMap((flight) => {
    const stay = flight.unplacedStay;
    if (!stay) return [];
    const arrival = flight.direction === "arrival";
    timeline.turnsById.set(flight.id, {
      turnId: flight.id,
      carrier: flight.flight.slice(0, 2),
      arrFlight: arrival ? flight.flight : "",
      depFlight: arrival ? "" : flight.flight,
      origin: arrival ? flight.routeEnd : "",
      destination: arrival ? "" : flight.routeEnd,
      registration: flight.registration ?? "",
      aircraftType: flight.aircraftType ?? "",
      stays: [],
    });
    timeline.visits.push({ id: flight.id, label: flight.flight });
    timeline.endpoints.set(stay.stayId, {
      start: arrival ? { kind: "flight", flight: flight.flight, origin: flight.routeEnd } : { kind: "none" },
      end: arrival ? { kind: "none" } : { kind: "flight", flight: flight.flight, destination: flight.routeEnd },
    });
    timeline.stayPosition.set(stay.stayId, { index: 0, count: 1 });
    flight.visitId = flight.id;
    return [{ id: stay.stayId, visitId: flight.id, rowId: "", start: stay.start, end: stay.end, kind: "turn" }];
  });
  return createOperationsDataset({
    id: "fixture",
    label: "Original fixture",
    airportId: "norvara",
    date: SYNTHETIC_DATE,
    domain: [at(SYNTHETIC_WINDOW.from), at(SYNTHETIC_WINDOW.to)],
    stands: SYNTHETIC_STANDS,
    aircraftSizes: AIRCRAFT_SIZE,
    aircraftMakers: AIRCRAFT_MAKER,
    timeline,
    flights: [...assignedFlights(timeline), ...unassigned],
    noStandStays,
    capabilities: { editStands: true, fixtureAnalyses: true },
  });
}
