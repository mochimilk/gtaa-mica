import validate from "./accommodation-validator.mjs";
import { validate as validateSchedule } from "../data-sources/prepared-validator.mjs";
import { adaptPreparedSchedule } from "../data-sources/preparedAdapter";
import type { PlanVariant, PreparedScenario } from "../data-sources/preparedTypes";
import type { OperationsDatasetInput, OpsFlight } from "../operations/dataset";
import { fingerprintJson, type CapacityProbe, type PreparedCapacity } from "./capacity";
import { gateWaiting, standHandovers } from "./handovers";
import type { BufferProfile, ReleaseAssumption } from "./profiles";

export interface AccommodationOption {
  id: string;
  kind: "direct" | "localized-repair";
  target_stand_id: string;
  target_stand_contact: boolean;
  moves: { stay_id: string; from_stand_id: string; to_stand_id: string; to_stand_contact: boolean }[];
  stand_validation_passed: true;
}
export interface PreparedAccommodation {
  schema_version: "2.0.0";
  id: string;
  source: "synthetic";
  airport_id: string;
  case_id: string;
  demand_id: string;
  plan_window: { start: string; end: string };
  snapshot_fingerprint: string;
  airport_fingerprint: string;
  demand_fingerprint: string;
  profile: {
    schema_version: "1.0.0"; id: string; max_changed_visits: 1; max_displayed_options: number;
    cases: { case_id: string; probe_id: string; start_offset_minutes: number; duration_minutes: number }[];
  };
  approved_at: string;
  received_at: string;
  request: {
    id: string; reason: "post-approval-service-request"; probe: CapacityProbe;
    start: string; end: string; stay_id: string;
    visit: PreparedScenario["visits"][number]; flights: PreparedScenario["flights"];
  };
  variants: Record<PlanVariant, {
    request_fingerprint: string;
    status: "options-found" | "no-acceptable-option-found";
    search: "direct-placement" | "single-whole-turn-relocation";
    total_options_found: number;
    options: AccommodationOption[];
    excluded_stands: { stand_id: string; reasons: string[] }[];
    blocked_stands: { stand_id: string; blocking_stay_ids: string[]; reasons: string[]; rule_paths: string[] }[];
  }>;
}

const instant = (value: string) => {
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== (value.includes(".") ? value : value.replace("Z", ".000Z"))) {
    throw new Error(`Invalid accommodation UTC instant: ${value}`);
  }
  return time;
};
const unique = (ids: readonly string[], label: string) => {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate accommodation ${label}.`);
};

export function parseAccommodation(value: unknown): PreparedAccommodation {
  if (!validate(value)) throw new Error(`Prepared accommodation is invalid: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  const request = value.request, definition = value.profile.cases.find(item => item.case_id === value.case_id);
  const start = instant(request.start), end = instant(request.end), origin = instant(value.plan_window.start);
  const visit = request.visit, [arrival, departure] = request.flights;
  unique(value.profile.cases.map(item => item.case_id), "profile case");
  if (!value.profile.id.startsWith(`${value.airport_id}:`) || !definition ||
      definition.probe_id !== request.probe.id || request.id !== value.id || request.probe.separation_minutes !== 0 ||
      start !== origin + definition.start_offset_minutes * 60_000 || end !== start + definition.duration_minutes * 60_000 ||
      start < origin || end <= start || end > instant(value.plan_window.end) ||
      instant(value.approved_at) >= instant(value.received_at) || instant(value.received_at) >= origin ||
      visit.aircraftType !== request.probe.aircraft_id || `airline:${visit.carrier}` !== request.probe.operating_airline_id ||
      arrival.direction !== "arrival" || departure.direction !== "departure" || arrival.id === departure.id ||
      arrival.flight !== visit.arrFlight || departure.flight !== visit.depFlight || visit.arrFlight === visit.depFlight ||
      arrival.visitId !== visit.turnId || departure.visitId !== visit.turnId ||
      arrival.routeEnd !== visit.origin || departure.routeEnd !== visit.destination ||
      instant(arrival.scheduled) !== start || instant(departure.scheduled) !== end) {
    throw new Error("Accommodation request has invalid profile, timing or flight links.");
  }
  for (const result of Object.values(value.variants)) {
    if ((result.status === "options-found") !== (result.total_options_found > 0) ||
        result.options.length !== result.total_options_found ||
        (result.search === "direct-placement" && !result.options.length)) throw new Error("Invalid accommodation option counts/status.");
    unique(result.options.map(option => option.id), "option");
    unique(result.options.map(option => JSON.stringify([option.kind, option.target_stand_id,
      option.moves.map(move => [move.stay_id, move.from_stand_id, move.to_stand_id])])), "option effect");
    unique([...result.excluded_stands, ...result.blocked_stands].map(item => item.stand_id), "stand assessment");
    for (const block of result.blocked_stands) unique(block.blocking_stay_ids, "blocking assignment");
  }
  return value;
}

export function validateAccommodationCapacity(evidence: PreparedAccommodation, capacity: PreparedCapacity): void {
  if (evidence.airport_id !== capacity.airport_id || evidence.case_id !== capacity.case_id ||
      evidence.demand_id !== capacity.demand_id || evidence.snapshot_fingerprint !== capacity.snapshot_fingerprint ||
      evidence.airport_fingerprint !== capacity.airport_fingerprint || evidence.demand_fingerprint !== capacity.demand_fingerprint ||
      evidence.plan_window.start !== capacity.plan_window.start || evidence.plan_window.end !== capacity.plan_window.end ||
      (["baseline", "tow-options"] as const).some(variant =>
        evidence.variants[variant].request_fingerprint !== capacity.variants[variant].request_fingerprint)) {
    throw new Error("Accommodation and capacity have different source provenance. Regenerate their evidence together.");
  }
  const probe = capacity.profile.probes.find(item => item.id === evidence.request.probe.id);
  const keys = ["id", "label", "aircraft_id", "operating_airline_id", "arrival_sector_id",
    "departure_sector_id", "default_duration_minutes", "separation_minutes"] as const;
  if (!probe || keys.some(key => probe[key] !== evidence.request.probe[key])) {
    throw new Error("Accommodation probe does not match the source-owned capacity profile.");
  }
}

export async function validateAccommodationSnapshot(value: unknown, source: unknown): Promise<PreparedAccommodation> {
  const evidence = parseAccommodation(value);
  if (!validateSchedule(source) || source.airport?.id !== evidence.airport_id || source.case_id !== evidence.case_id ||
      source.demand_id !== evidence.demand_id || source.plan_window.start !== evidence.plan_window.start ||
      source.plan_window.end !== evidence.plan_window.end || await fingerprintJson(source) !== evidence.snapshot_fingerprint) {
    throw new Error("Prepared accommodation does not match the selected schedule. Regenerate its evidence.");
  }
  for (const variant of ["baseline", "tow-options"] as const) {
    validateAccommodationDataset(evidence, adaptPreparedSchedule(source, { airportId: evidence.airport_id, caseId: source.case_id }, variant));
  }
  return evidence;
}

export function validateAccommodationDataset(value: unknown, source: OperationsDatasetInput): { id: string } {
  const evidence = parseAccommodation(value), plan = source.preparedPlan;
  if (!plan || source.capabilities?.editStands || source.airportId !== evidence.airport_id || plan.caseId !== evidence.case_id ||
      plan.demandId !== evidence.demand_id || plan.requestFingerprint !== evidence.variants[plan.variant].request_fingerprint ||
      source.domain[0] !== instant(evidence.plan_window.start) || source.domain[1] !== instant(evidence.plan_window.end)) {
    throw new Error("Accommodation evidence does not match the active read-only dataset/plan.");
  }
  const request = evidence.request, incoming = request.visit;
  if (source.timeline.visits.some(visit => visit.id === incoming.turnId) ||
      source.flights.some(flight => flight.registration === incoming.registration ||
        request.flights.some(other => other.id === flight.id || other.flight === flight.flight)) ||
      [...source.timeline.occupancies, ...source.noStandStays].some(stay => stay.id === request.stay_id)) {
    throw new Error("Accommodation request identity collides with existing traffic.");
  }
  const result = evidence.variants[plan.variant], rows = new Set(source.timeline.rows.map(row => row.id));
  const stays = new Map(source.timeline.occupancies.map(stay => [stay.id, stay]));
  const excluded = new Set(result.excluded_stands.map(item => item.stand_id));
  const blocked = new Map(result.blocked_stands.map(item => [item.stand_id, item]));
  if ([...excluded, ...blocked.keys()].some(id => !rows.has(id)) ||
      result.blocked_stands.some(block => block.blocking_stay_ids.some(id => {
        const stay = stays.get(id);
        return !stay || stay.start >= instant(request.end) || stay.end <= instant(request.start);
      }))) {
    throw new Error("Invalid accommodation stand/blocking assignment reference.");
  }
  if (standHandovers(source.timeline.occupancies, source.domain).availability === "invalid") throw new Error("Invalid accommodation reference occupancy.");
  const direct = result.search === "direct-placement";
  if (direct) unique(result.options.map(option => option.target_stand_id), "direct target");
  const partition = [...excluded, ...blocked.keys(), ...(direct ? result.options.map(option => option.target_stand_id) : [])];
  if (new Set(partition).size !== rows.size || partition.length !== rows.size || partition.some(id => !rows.has(id))) {
    throw new Error("Incomplete accommodation stand assessment.");
  }
  for (const option of result.options) {
    if (!rows.has(option.target_stand_id) || excluded.has(option.target_stand_id) ||
        (option.kind === "direct" ? !direct || option.moves.length !== 0 || blocked.has(option.target_stand_id)
          : direct || option.moves.length !== 1 ||
            blocked.get(option.target_stand_id)?.blocking_stay_ids.length !== 1 ||
            blocked.get(option.target_stand_id)?.blocking_stay_ids[0] !== option.moves[0].stay_id)) {
      throw new Error("Invalid accommodation option scope.");
    }
    for (const move of option.moves) {
      const stay = stays.get(move.stay_id), endpoints = stay && source.timeline.endpoints.get(stay.id);
      if (!stay || stay.rowId !== move.from_stand_id || !rows.has(move.to_stand_id) || move.from_stand_id === move.to_stand_id ||
          endpoints?.start.kind !== "flight" || endpoints.end.kind !== "flight" ||
          stay.start < source.domain[0] || stay.end > source.domain[1] ||
          source.timeline.occupancies.filter(item => item.visitId === stay.visitId).length !== 1 ||
          !source.flights.some(flight => flight.occupancyId === stay.id && flight.direction === "arrival" && flight.estimate === stay.start) ||
          !source.flights.some(flight => flight.occupancyId === stay.id && flight.direction === "departure" && flight.estimate === stay.end)) {
        throw new Error("Accommodation changes a protected or unknown complete stay.");
      }
    }
    const preview = buildPreview(source, evidence, option);
    if (standHandovers(preview.timeline.occupancies, source.domain).availability === "invalid") {
      throw new Error("Accommodation preview introduces overlapping stand occupancy.");
    }
  }
  return { id: evidence.profile.id };
}

function buildPreview(source: OperationsDatasetInput, evidence: PreparedAccommodation, option: AccommodationOption) {
  const request = evidence.request;
  const moves = new Map(option.moves.map(move => [move.stay_id, move.to_stand_id]));
  const timeline = structuredClone({ occupancies: source.timeline.occupancies, endpoints: source.timeline.endpoints });
  timeline.occupancies = timeline.occupancies.map(stay => ({ ...stay, rowId: moves.get(stay.id) ?? stay.rowId }));
  timeline.occupancies.push({
    id: request.stay_id, visitId: request.visit.turnId, rowId: option.target_stand_id,
    start: instant(request.start), end: instant(request.end), kind: "turn",
  });
  timeline.endpoints.set(request.stay_id, {
    start: { kind: "flight", flight: request.visit.arrFlight, origin: request.visit.origin },
    end: { kind: "flight", flight: request.visit.depFlight, destination: request.visit.destination },
  });
  const flights: OpsFlight[] = structuredClone(source.flights).map(flight => {
    const row = flight.occupancyId && moves.get(flight.occupancyId);
    return row ? { ...flight, standId: row } : flight;
  });
  flights.push(...request.flights.map(flight => ({
    ...flight, estimate: instant(flight.scheduled), occupancyId: request.stay_id, standId: option.target_stand_id,
    standStart: instant(request.start), standEnd: instant(request.end),
    registration: request.visit.registration, aircraftType: request.visit.aircraftType,
  })));
  return {
    kind: "accommodation-preview" as const, option, timeline, flights,
    domain: [source.domain[0], source.domain[1]] as const, arrivals: flights.filter(flight => flight.direction === "arrival"),
  };
}

export function previewAccommodation(source: OperationsDatasetInput, evidence: PreparedAccommodation, optionId: string) {
  validateAccommodationDataset(evidence, source);
  const option = evidence.variants[source.preparedPlan!.variant].options.find(option => option.id === optionId);
  if (!option) throw new Error(`Unknown accommodation option: ${optionId}`);
  return buildPreview(source, evidence, option);
}

export function accommodationImpact(source: OperationsDatasetInput, evidence: PreparedAccommodation, optionId: string,
  bufferProfile: BufferProfile | null, assumption: ReleaseAssumption | null) {
  const preview = previewAccommodation(source, evidence, optionId);
  const before = standHandovers(source.timeline.occupancies, source.domain);
  const after = standHandovers(preview.timeline.occupancies, source.domain);
  if (before.availability === "invalid" || after.availability === "invalid") throw new Error("Invalid accommodation buffer comparison.");
  const summarize = (buffers: typeof before) => ({
    handovers: buffers.handovers.length,
    tight: bufferProfile ? buffers.handovers.filter(item => item.minutes < bufferProfile.threshold_minutes).length : null,
    minimum: buffers.handovers.length ? Math.min(...buffers.handovers.map(item => item.minutes)) : null,
  });
  const reference = { domain: source.domain, timeline: source.timeline, arrivals: source.flights.filter(flight => flight.direction === "arrival") };
  const beforeWaiting = assumption ? gateWaiting(reference, assumption) : null;
  const afterWaiting = assumption ? gateWaiting(preview, assumption) : null;
  if (beforeWaiting?.availability === "invalid" || afterWaiting?.availability === "invalid") throw new Error("Invalid accommodation waiting comparison.");
  const beforeById = new Map(beforeWaiting?.contributions.map(item => [item.arrival.id, item.minutes]));
  const afterById = new Map(afterWaiting?.contributions.map(item => [item.arrival.id, item.minutes]));
  const commonIds = [...beforeById.keys()].filter(id => afterById.has(id));
  return {
    preview, beforeBuffers: summarize(before), afterBuffers: summarize(after), beforeWaiting, afterWaiting,
    commonArrivals: commonIds.length,
    beforeCommonMinutes: commonIds.length ? commonIds.reduce((sum, id) => sum + beforeById.get(id)!, 0) : null,
    afterCommonMinutes: commonIds.length ? commonIds.reduce((sum, id) => sum + afterById.get(id)!, 0) : null,
    incomingMinutes: afterById.get(evidence.request.flights[0].id) ?? null,
  };
}

export function accommodationOptionLabel(source: OperationsDatasetInput, option: AccommodationOption): string {
  const row = (id: string) => {
    const stand = source.timeline.rows.find(row => row.id === id);
    if (!stand) throw new Error(`Unknown accommodation stand: ${id}`);
    return stand.label;
  };
  const move = option.moves[0];
  if (!move) return `Direct fit at ${option.target_stand_contact ? "contact" : "non-contact"} stand ${row(option.target_stand_id)}`;
  const stay = source.timeline.occupancies.find(stay => stay.id === move.stay_id);
  const visit = source.timeline.visits.find(visit => visit.id === stay?.visitId);
  if (!visit) throw new Error("Unknown accommodation moved visit.");
  return `Incoming ${row(option.target_stand_id)}; reassign ${visit.label} to ${move.to_stand_contact ? "contact" : "non-contact"} ${row(move.to_stand_id)}`;
}
