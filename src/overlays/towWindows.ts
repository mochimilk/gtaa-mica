import validate from "./tow-windows-validator.mjs";
import { validate as validateSchedule } from "../data-sources/prepared-validator.mjs";
import type { PlanVariant, PreparedScenario } from "../data-sources/preparedTypes";
import type { OperationsDatasetInput } from "../operations/dataset";
import { fingerprintJson } from "./capacity";
import { calculateOneWayTowRange, mergeTowRanges } from "./tow-window-ranges.mjs";

export interface TowBlocker {
  assignment_id: string;
  release: number;
  reasons: string[];
  rule_paths: string[];
}
export interface TowDestination {
  stand_id: string;
  earliest_start: number;
  latest_start: number;
  blockers: TowBlocker[];
}
export interface TowExclusion {
  stand_id: string;
  assignment_ids: string[];
  reasons: string[];
  rule_paths: string[];
}
export interface TowVisitEvidence {
  visit_id: string;
  arrival_flight_id: string;
  departure_flight_id: string;
  arrival_handling_minutes: number;
  departure_handling_minutes: number;
  variants: Record<PlanVariant, {
    source_stay_id: string | null;
    destinations: TowDestination[];
    exclusions: TowExclusion[];
  }>;
}
export interface PreparedTowWindows {
  schema_version: "3.0.0";
  source: "synthetic";
  movement_kind: "one-way-relocation";
  stand_validation_passed: true;
  airport: { id: string; name: string };
  case_id: string;
  demand_id: string;
  plan_window: { start: string; end: string };
  variants: Record<PlanVariant, { request_fingerprint: string }>;
  snapshot_fingerprint: string;
  airport_fingerprint: string;
  demand_fingerprint: string;
  default_tow_minutes: number;
  visits: TowVisitEvidence[];
}

const instant = (value: string) => {
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== (value.includes(".") ? value : value.replace("Z", ".000Z"))) {
    throw new Error(`Invalid tow-window UTC instant: ${value}`);
  }
  return time;
};
const unique = (ids: readonly string[], label: string) => {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate tow-window ${label}.`);
};

export function parseTowWindows(value: unknown): PreparedTowWindows {
  if (!validate(value)) throw new Error(`Prepared tow windows are invalid: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  if (instant(value.plan_window.start) >= instant(value.plan_window.end)) throw new Error("Invalid tow-window horizon.");
  calculateOneWayTowRange(0, 0, value.default_tow_minutes);
  unique(value.visits.map(visit => visit.visit_id), "visit");
  for (const visit of value.visits) {
    if (![visit.arrival_handling_minutes, visit.departure_handling_minutes].every(minutes => Number.isSafeInteger(minutes * 60_000))) {
      throw new Error("Tow-window handling requires millisecond precision.");
    }
    for (const plan of Object.values(visit.variants)) {
      unique([...plan.destinations, ...plan.exclusions].map(item => item.stand_id), "destination assessment");
      if (plan.source_stay_id === null && (plan.destinations.length || plan.exclusions.length)) throw new Error("Unassessed tow visit has destination evidence.");
      for (const destination of plan.destinations) {
        if (![destination.earliest_start, destination.latest_start].every(Number.isSafeInteger) ||
            destination.earliest_start > destination.latest_start) throw new Error("Invalid inclusive tow-window range.");
        unique(destination.blockers.map(item => item.assignment_id), "blocker");
        if (destination.blockers.some(item => !Number.isSafeInteger(item.release))) throw new Error("Invalid tow-window release time.");
      }
    }
  }
  return value;
}

interface SourceView {
  visits: readonly string[];
  stands: readonly string[];
  flights: { id: string; visitId?: string; direction: string; time: number; stayId?: string }[];
  stays: { id: string; visitId: string; rowId: string; start: number; end: number; complete: boolean }[];
}

function validateAssessments(evidence: PreparedTowWindows, variant: PlanVariant, source: SourceView) {
  const visits = new Set(source.visits), stands = new Set(source.stands);
  const flights = new Map(source.flights.map(flight => [flight.id, flight]));
  const stays = new Map(source.stays.map(stay => [stay.id, stay]));
  if (evidence.visits.length !== visits.size) throw new Error("Incomplete tow-window visit assessment.");
  const travel = evidence.default_tow_minutes * 60_000;
  for (const item of evidence.visits) {
    const arrival = flights.get(item.arrival_flight_id), departure = flights.get(item.departure_flight_id);
    if (!visits.has(item.visit_id) || arrival?.visitId !== item.visit_id || departure?.visitId !== item.visit_id ||
        arrival.direction !== "arrival" || departure.direction !== "departure") throw new Error("Invalid tow-window flight/visit reference.");
    const siblings = source.stays.filter(stay => stay.visitId === item.visit_id);
    const stay = siblings.length === 1 && siblings[0].complete ? siblings[0] : null;
    const assessment = item.variants[variant];
    if (assessment.source_stay_id !== (stay?.id ?? null)) throw new Error("Tow-window source is not the exact complete single stay.");
    if (!stay) continue;
    if (arrival.stayId !== stay.id || departure.stayId !== stay.id || arrival.time !== stay.start || departure.time !== stay.end) {
      throw new Error("Tow-window source flight boundaries do not match its stay.");
    }
    const range = calculateOneWayTowRange(stay.start + item.arrival_handling_minutes * 60_000,
      stay.end - item.departure_handling_minutes * 60_000, evidence.default_tow_minutes);
    if (!range) {
      if (assessment.destinations.length || assessment.exclusions.length) throw new Error("Tow windows violate handling/travel limits.");
      continue;
    }
    const assessed = [...assessment.destinations, ...assessment.exclusions];
    if (assessed.length !== stands.size - 1 || assessed.some(row => row.stand_id === stay.rowId || !stands.has(row.stand_id))) {
      throw new Error("Incomplete or invalid tow-window stand assessment.");
    }
    const blockerStay = (id: string) => {
      const blocking = stays.get(id);
      if (!blocking || id === stay.id || blocking.end <= range[0] + travel || blocking.start >= stay.end) {
        throw new Error("Invalid tow-window blocking assignment reference.");
      }
      return blocking;
    };
    for (const destination of assessment.destinations) {
      for (const blocker of destination.blockers) {
        if (blockerStay(blocker.assignment_id).end !== blocker.release) throw new Error("Tow-window blocker release does not match the fixed plan.");
      }
      const earliest = Math.max(range[0], ...destination.blockers.map(blocker => blocker.release - travel));
      if (destination.earliest_start !== earliest || destination.latest_start !== range[1]) {
        throw new Error("Tow windows violate handling/travel or destination blocking limits.");
      }
    }
    for (const exclusion of assessment.exclusions) {
      const releases = exclusion.assignment_ids.map(id => blockerStay(id).end - travel);
      if (releases.length && Math.max(...releases) <= range[1]) throw new Error("Tow-window exclusion does not block the full start range.");
    }
  }
}

function snapshotView(snapshot: PreparedScenario, variant: PlanVariant): SourceView {
  const stays = snapshot.variants[variant].stays;
  return {
    visits: snapshot.visits.map(visit => visit.turnId), stands: snapshot.rows.map(row => row.id),
    flights: snapshot.flights.map(flight => ({
      ...flight, time: instant(flight.scheduled),
      stayId: stays.find(stay => stay.arrivalFlightId === flight.id || stay.departureFlightId === flight.id)?.id,
    })),
    stays: stays.map(stay => ({
      ...stay, start: instant(stay.start), end: instant(stay.end),
      complete: !!stay.arrivalFlightId && !!stay.departureFlightId && !stay.towIn && !stay.towOut,
    })),
  };
}

export async function validateTowWindowsSnapshot(value: unknown, source: unknown): Promise<PreparedTowWindows> {
  const evidence = parseTowWindows(value);
  if (!validateSchedule(source) || source.airport?.id !== evidence.airport.id || source.case_id !== evidence.case_id ||
      source.demand_id !== evidence.demand_id || source.plan_window.start !== evidence.plan_window.start ||
      source.plan_window.end !== evidence.plan_window.end || await fingerprintJson(source) !== evidence.snapshot_fingerprint) {
    throw new Error("Prepared tow windows do not match the selected schedule. Regenerate their evidence.");
  }
  for (const variant of ["baseline", "tow-options"] as const) {
    if (source.variants[variant].request_fingerprint !== evidence.variants[variant].request_fingerprint) {
      throw new Error("Tow-window request fingerprint does not match the selected plan.");
    }
    validateAssessments(evidence, variant, snapshotView(source, variant));
  }
  return evidence;
}

export function validateTowWindowsDataset(value: unknown, source: OperationsDatasetInput): { id: string } {
  const evidence = parseTowWindows(value), plan = source.preparedPlan;
  if (!plan || source.capabilities?.editStands || source.airportId !== evidence.airport.id ||
      plan.caseId !== evidence.case_id || plan.demandId !== evidence.demand_id ||
      plan.requestFingerprint !== evidence.variants[plan.variant].request_fingerprint ||
      source.domain[0] !== instant(evidence.plan_window.start) || source.domain[1] !== instant(evidence.plan_window.end)) {
    throw new Error("Tow-window evidence does not match the active read-only dataset/plan.");
  }
  validateAssessments(evidence, plan.variant, {
    visits: source.timeline.visits.map(visit => visit.id), stands: source.timeline.rows.map(row => row.id),
    flights: source.flights.map(flight => ({ ...flight, time: flight.estimate, stayId: flight.occupancyId })),
    stays: source.timeline.occupancies.map(stay => {
      if (!stay.visitId) throw new Error("Tow-window assigned stays require an exact visit reference.");
      return {
        ...stay, visitId: stay.visitId, complete: source.timeline.endpoints.get(stay.id)?.start.kind === "flight" &&
          source.timeline.endpoints.get(stay.id)?.end.kind === "flight",
      };
    }),
  });
  return { id: `${evidence.airport.id}:one-way-tow-windows:${evidence.schema_version}` };
}

export const TOW_STATUSES = {
  available: "Destination-checked one-way tow window",
  unassigned: "Unassigned visit; no current stand to release",
  "existing-chain": "Existing movement chain; not assessed as a new one-way relocation",
  incomplete: "Incomplete flight boundaries; not assessed",
  "insufficient-time": "Insufficient time for arrival handling, one tow and departure handling",
  "no-destination": "No compatible destination available through departure",
} as const;
export interface TowAssessment {
  id: string;
  label: string;
  stayId: string | null;
  stayEnd: number | null;
  status: keyof typeof TOW_STATUSES;
  policy: TowVisitEvidence;
  destinations: TowDestination[];
  exclusions: TowExclusion[];
}

export function evaluateTowWindows(evidence: PreparedTowWindows, dataset: OperationsDatasetInput): TowAssessment[] {
  validateTowWindowsDataset(evidence, dataset);
  const variant = dataset.preparedPlan!.variant;
  return evidence.visits.map(policy => {
    const stays = dataset.timeline.occupancies.filter(stay => stay.visitId === policy.visit_id);
    const item = policy.variants[variant], stay = stays.find(stay => stay.id === item.source_stay_id);
    const range = stay ? calculateOneWayTowRange(stay.start + policy.arrival_handling_minutes * 60_000,
      stay.end - policy.departure_handling_minutes * 60_000, evidence.default_tow_minutes) : null;
    const arrival = dataset.flights.find(flight => flight.id === policy.arrival_flight_id)!;
    const departure = dataset.flights.find(flight => flight.id === policy.departure_flight_id)!;
    return {
      id: policy.visit_id, label: `${arrival.flight}/${departure.flight}`, stayId: item.source_stay_id,
      stayEnd: stay?.end ?? null, policy, destinations: item.destinations, exclusions: item.exclusions,
      status: !stays.length ? "unassigned" : stays.length > 1 ? "existing-chain" : !stay ? "incomplete" :
        !range ? "insufficient-time" : item.destinations.length ? "available" : "no-destination",
    };
  });
}

export function towWindowSegments(assessments: readonly TowAssessment[], horizon: readonly [number, number]) {
  if (!horizon.every(Number.isSafeInteger) || horizon[0] >= horizon[1]) throw new Error("Invalid tow-window display horizon.");
  return assessments.filter(item => item.status === "available" && item.stayId !== null).flatMap(assessment =>
    mergeTowRanges(assessment.destinations.map(item => [item.earliest_start, item.latest_start]))
      .map(([start, end], index) => ({
        id: `${assessment.id}:${index}`, assessment, earliest: Math.max(start, horizon[0]), latest: Math.min(end, horizon[1] - 1),
      })).filter(segment => segment.earliest <= segment.latest));
}
