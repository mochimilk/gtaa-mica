import validate from "./tow-windows-validator.mjs";
import { fingerprintJson, type PreparedCapacity } from "./capacity-evaluation";
import { calculateOneWayTowRange, mergeTowRanges } from "./tow-window-ranges.mjs";
import type { PreparedScenario } from "./dataset";
import type { PlanVariant } from "./preferences";

export interface TowDestination {
  stand_id: string; earliest_start: number; latest_start: number;
}

export interface PreparedTowWindows {
  schema_version: "2.0.0"; source: "synthetic"; movement_kind: "one-way-relocation"; stand_validation_passed: true;
  airport: { id: string; name: string };
  snapshot_fingerprint: string; airport_fingerprint: string; demand_fingerprint: string;
  default_tow_minutes: number;
  visits: {
    visit_id: string; arrival_flight_id: string; departure_flight_id: string;
    arrival_handling_minutes: number; departure_handling_minutes: number;
    variants: Record<PlanVariant, { source_stay_id: string | null; destinations: TowDestination[] }>;
  }[];
}

export async function validateTowWindows(value: unknown, snapshot: PreparedScenario, capacity: PreparedCapacity): Promise<PreparedTowWindows> {
  if (!validate(value)) throw new Error(`Invalid tow-window evidence: ${validate.errors?.map(item => `${item.instancePath} ${item.message}`).join("; ")}`);
  if (value.snapshot_fingerprint !== await fingerprintJson(snapshot) || value.airport.id !== capacity.airport_id ||
      value.airport_fingerprint !== capacity.airport_fingerprint || value.demand_fingerprint !== capacity.demand_fingerprint) {
    throw new Error("Tow windows do not match the frozen airport/demand/plan sources. Run npm run prepare:tow-windows.");
  }
  if (value.visits.length !== snapshot.visits.length || new Set(value.visits.map(item => item.visit_id)).size !== value.visits.length) {
    throw new Error("Tow-window assessments must cover every source visit exactly once.");
  }
  for (const item of value.visits) {
    const visit = snapshot.visits.find(visit => visit.turnId === item.visit_id);
    const arrival = snapshot.flights.find(flight => flight.id === item.arrival_flight_id);
    const departure = snapshot.flights.find(flight => flight.id === item.departure_flight_id);
    if (!visit || !arrival || !departure || arrival.direction !== "arrival" || departure.direction !== "departure" ||
        arrival.visitId !== visit.turnId || departure.visitId !== visit.turnId) throw new Error("Invalid tow-window flight/visit links.");
    const range = calculateOneWayTowRange(Date.parse(arrival.scheduled) + item.arrival_handling_minutes * 60_000,
      Date.parse(departure.scheduled) - item.departure_handling_minutes * 60_000, value.default_tow_minutes);
    for (const variant of ["baseline", "tow-options"] as const) {
      const stays = snapshot.variants[variant].stays.filter(stay => stay.visitId === item.visit_id);
      const stay = stays.length === 1 && !stays[0].towIn && !stays[0].towOut &&
        stays[0].arrivalFlightId && stays[0].departureFlightId ? stays[0] : null;
      const assessment = item.variants[variant];
      if (assessment.source_stay_id !== (stay?.id ?? null) || (!stay && assessment.destinations.length)) {
        throw new Error("Tow-window source must be an assigned complete single-stay visit without existing movements.");
      }
      const seen = new Set<string>();
      for (const destination of assessment.destinations) {
        if (!stay || !range || seen.has(destination.stand_id) || destination.stand_id === stay.rowId ||
            !snapshot.rows.some(row => row.id === destination.stand_id) ||
            !Number.isSafeInteger(destination.earliest_start) || !Number.isSafeInteger(destination.latest_start) ||
            destination.earliest_start < range[0] || destination.latest_start > range[1] ||
            destination.latest_start < destination.earliest_start) throw new Error("Invalid tow-window destination or handling bounds.");
        seen.add(destination.stand_id);
      }
    }
  }
  return value;
}

export function evaluateTowWindows(snapshot: PreparedScenario, evidence: PreparedTowWindows, variant: PlanVariant) {
  return evidence.visits.map(item => {
    const visit = snapshot.visits.find(visit => visit.turnId === item.visit_id);
    const arrival = snapshot.flights.find(flight => flight.id === item.arrival_flight_id);
    const departure = snapshot.flights.find(flight => flight.id === item.departure_flight_id);
    if (!visit || !arrival || !departure) throw new Error("Missing tow-window source links.");
    const handlingRange = calculateOneWayTowRange(Date.parse(arrival.scheduled) + item.arrival_handling_minutes * 60_000,
      Date.parse(departure.scheduled) - item.departure_handling_minutes * 60_000, evidence.default_tow_minutes);
    const stays = snapshot.variants[variant].stays.filter(stay => stay.visitId === item.visit_id);
    const stay = stays[0], destinations = item.variants[variant].destinations.map(destination => {
      const row = snapshot.rows.find(row => row.id === destination.stand_id);
      if (!row) throw new Error("Missing tow destination chart row.");
      return { ...destination, label: row.label };
    });
    const status = !stay ? "Unassigned: no chart occupancy"
      : stays.length !== 1 || stay.towIn || stay.towOut ? "Existing movement chain: no retiming assessed"
        : !stay.arrivalFlightId || !stay.departureFlightId ? "Incomplete service boundaries: not assessed"
          : !handlingRange ? "Insufficient time for handling and one movement"
            : !destinations.length ? "No compatible destination available through departure"
              : "Destination-checked one-way tow window available";
    return {
      id: item.visit_id, visit, policy: item, handlingRange, destinations,
      ranges: mergeTowRanges(destinations.map(destination => [destination.earliest_start, destination.latest_start])),
      rowId: stay?.rowId ?? null, stayId: stay?.id ?? null, stayEnd: stay ? Date.parse(stay.end) : null,
      available: status === "Destination-checked one-way tow window available", status,
    };
  });
}
export type TowAssessment = ReturnType<typeof evaluateTowWindows>[number];

export function towWindowSegments(assessments: TowAssessment[], horizon: readonly [number, number]) {
  if (!horizon.every(Number.isSafeInteger) || horizon[1] <= horizon[0]) throw new Error("Invalid tow-window display horizon.");
  return assessments.flatMap(assessment => {
    if (!assessment.available || !assessment.rowId || !assessment.stayId) return [];
    return assessment.ranges.flatMap((range, index) => {
      const earliest = Math.max(range[0], horizon[0]), latest = Math.min(range[1], horizon[1] - 1);
      return latest < earliest ? [] : [{ id: `${assessment.id}/${index}`, assessment, earliest, latest }];
    });
  });
}
export type TowWindowSegment = ReturnType<typeof towWindowSegments>[number];
