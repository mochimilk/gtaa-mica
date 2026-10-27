import validate from "./accommodation-validator.mjs";
import { fingerprintJson, type CapacityProbe, type PreparedCapacity } from "./capacity-evaluation";
import { calculateStandBuffers, DEFAULT_BUFFER_PROFILE } from "./buffer-evaluation";
import { calculateWaiting, DEFAULT_GATE_WAIT_PROFILE, type ReleaseDelayAssumption } from "./gate-wait-evaluation";
import { adaptScenarioPlan } from "./prepared-adapter";
import type { DemoDataset, PreparedFlight, PreparedScenario, PreparedStay } from "./dataset";
import type { PlanVariant, ScenarioId } from "./preferences";

export interface AccommodationOption {
  id: string;
  kind: "direct" | "localized-repair";
  target_stand_id: string;
  moves: { stay_id: string; from_stand_id: string; to_stand_id: string }[];
  stand_validation_passed: true;
}
export interface PreparedAccommodation {
  schema_version: "1.0.0"; id: string; source: "synthetic";
  snapshot_fingerprint: string; airport_fingerprint: string; demand_fingerprint: string;
  profile: {
    schema_version: "1.0.0"; id: string; max_changed_visits: 1; max_displayed_options: number;
    cases: { case_id: ScenarioId; probe_id: string; start_offset_minutes: number; duration_minutes: number }[];
  };
  approved_at: string; received_at: string;
  request: {
    id: string; reason: "post-approval-service-request"; probe: CapacityProbe;
    start: string; end: string; stay_id: string;
    visit: PreparedScenario["visits"][number]; flights: PreparedFlight[];
  };
  variants: Record<PlanVariant, {
    status: "options-found" | "no-acceptable-option-found";
    search: "direct-placement" | "single-whole-turn-relocation";
    total_options_found: number; options: AccommodationOption[];
    excluded_stands: { stand_id: string; reasons: string[] }[];
    blocked_stands: { stand_id: string; blocking_stay_ids: string[]; reasons: string[]; rule_paths: string[] }[];
  }>;
}

export async function validateAccommodation(value: unknown, snapshot: PreparedScenario, capacity: PreparedCapacity): Promise<PreparedAccommodation> {
  if (!validate(value)) throw new Error(`Prepared accommodation is invalid: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  if (value.snapshot_fingerprint !== await fingerprintJson(snapshot) || value.airport_fingerprint !== capacity.airport_fingerprint ||
      value.demand_fingerprint !== capacity.demand_fingerprint) throw new Error("Accommodation does not match approved sources. Run npm run prepare:accommodation.");
  const request = value.request, definition = value.profile.cases.find(item => item.case_id === snapshot.case_id);
  const start = Date.parse(request.start), end = Date.parse(request.end), origin = Date.parse(snapshot.plan_window.start);
  const probe = capacity.profile.probes.find(item => item.id === request.probe.id);
  const visit = request.visit, [arrival, departure] = request.flights;
  for (const time of [request.start, request.end, value.approved_at, value.received_at, ...request.flights.map(flight => flight.scheduled)]) {
    const canonical = time.includes(".") ? time : time.replace("Z", ".000Z");
    if (!Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== canonical) throw new Error("Invalid accommodation UTC instant.");
  }
  if (new Set(value.profile.cases.map(item => item.case_id)).size !== 3 || !definition ||
      request.id !== value.id || definition.probe_id !== request.probe.id || JSON.stringify(probe) !== JSON.stringify(request.probe) ||
      request.probe.separation_minutes !== 0 || start !== origin + definition.start_offset_minutes * 60_000 ||
      end !== start + definition.duration_minutes * 60_000 || end > Date.parse(snapshot.plan_window.end) ||
      Date.parse(value.approved_at) >= Date.parse(value.received_at) || Date.parse(value.received_at) >= start ||
      visit.aircraftType !== request.probe.aircraft_id || `airline:${visit.carrier}` !== request.probe.operating_airline_id ||
      arrival.direction !== "arrival" || departure.direction !== "departure" || arrival.id === departure.id ||
      arrival.flight !== visit.arrFlight || departure.flight !== visit.depFlight || visit.arrFlight === visit.depFlight ||
      arrival.visitId !== visit.turnId || departure.visitId !== visit.turnId ||
      arrival.routeEnd !== visit.origin || departure.routeEnd !== visit.destination || arrival.scheduled !== request.start || departure.scheduled !== request.end ||
      snapshot.visits.some(item => item.turnId === visit.turnId || item.registration === visit.registration) ||
      snapshot.flights.some(item => request.flights.some(flight => flight.id === item.id || flight.flight === item.flight)) ||
      Object.values(snapshot.variants).some(plan => plan.stays.some(stay => stay.id === request.stay_id))) {
    throw new Error("Accommodation request has invalid source links, timing or identity.");
  }
  const rows = new Set(snapshot.rows.map(row => row.id));
  for (const variant of ["baseline", "tow-options"] as const) {
    const result = value.variants[variant], plan = snapshot.variants[variant];
    if ((result.status === "options-found") !== (result.total_options_found > 0) ||
        result.options.length !== Math.min(value.profile.max_displayed_options, result.total_options_found) ||
        new Set(result.options.map(option => option.id)).size !== result.options.length) throw new Error("Invalid accommodation option counts or status.");
    const excluded = new Set(result.excluded_stands.map(item => item.stand_id));
    const blocked = new Set(result.blocked_stands.map(item => item.stand_id));
    if (excluded.size !== result.excluded_stands.length || blocked.size !== result.blocked_stands.length ||
        [...excluded, ...blocked].some(id => !rows.has(id)) || [...blocked].some(id => excluded.has(id)) ||
        result.blocked_stands.some(item => new Set(item.blocking_stay_ids).size !== item.blocking_stay_ids.length ||
          item.blocking_stay_ids.some(id => !plan.stays.some(stay => stay.id === id)))) throw new Error("Invalid accommodation blocking evidence.");
    for (const option of result.options) {
      if (!rows.has(option.target_stand_id) || excluded.has(option.target_stand_id) ||
          (option.kind === "direct" ? option.moves.length !== 0 || result.search !== "direct-placement" || blocked.has(option.target_stand_id)
            : option.moves.length !== 1 || result.search !== "single-whole-turn-relocation" ||
              !result.blocked_stands.some(item => item.stand_id === option.target_stand_id && item.blocking_stay_ids.length === 1 && item.blocking_stay_ids[0] === option.moves[0].stay_id))) {
        throw new Error("Invalid accommodation option scope.");
      }
      for (const move of option.moves) {
        const stay = plan.stays.find(item => item.id === move.stay_id);
        if (!stay || stay.rowId !== move.from_stand_id || !rows.has(move.to_stand_id) || move.from_stand_id === move.to_stand_id ||
            stay.towIn || stay.towOut || !stay.arrivalFlightId || !stay.departureFlightId ||
            Date.parse(stay.start) < origin || Date.parse(stay.end) > Date.parse(snapshot.plan_window.end) ||
            plan.stays.filter(item => item.visitId === stay.visitId).length !== 1) throw new Error("Accommodation changes a protected or unknown stay.");
      }
      const view = accommodationView(snapshot, value, variant, option.id);
      if (standBuffers(view.plan.stays, snapshot).overlaps.length) throw new Error("Accommodation introduces overlapping stand occupancy.");
      adaptScenarioPlan(view.scenario, variant, view.plan, "Validation only");
    }
  }
  return value;
}

export function accommodationView(snapshot: PreparedScenario, evidence: PreparedAccommodation, variant: PlanVariant, optionId: string) {
  const option = evidence.variants[variant].options.find(item => item.id === optionId);
  if (!option) throw new Error(`Unknown accommodation option: ${optionId}`);
  const { request } = evidence, base = snapshot.variants[variant];
  const stays: PreparedStay[] = base.stays.map(stay => {
    const move = option.moves.find(item => item.stay_id === stay.id);
    return move ? { ...stay, rowId: move.to_stand_id } : { ...stay };
  });
  stays.push({
    id: request.stay_id, visitId: request.visit.turnId, rowId: option.target_stand_id, start: request.start, end: request.end,
    arrivalFlightId: request.flights[0].id, departureFlightId: request.flights[1].id, towIn: false, towOut: false,
  });
  return {
    option,
    scenario: {
      schema_version: snapshot.schema_version, case_id: snapshot.case_id, demand_id: snapshot.demand_id,
      plan_window: snapshot.plan_window, rows: snapshot.rows,
      visits: [...snapshot.visits, request.visit], flights: [...snapshot.flights, ...request.flights],
    },
    plan: { stays, covered_flight_count: base.covered_flight_count + 2, generated_movement_count: base.generated_movement_count },
  };
}

function standBuffers(stays: PreparedStay[], snapshot: Pick<PreparedScenario, "plan_window">) {
  return calculateStandBuffers(stays.map(stay => ({ ...stay, start: Date.parse(stay.start), end: Date.parse(stay.end) })),
    [Date.parse(snapshot.plan_window.start), Date.parse(snapshot.plan_window.end)]);
}

export function accommodationImpact(snapshot: PreparedScenario, evidence: PreparedAccommodation, variant: PlanVariant, optionId: string, assumption: ReleaseDelayAssumption) {
  const view = accommodationView(snapshot, evidence, variant, optionId), base = snapshot.variants[variant];
  const beforeBuffers = standBuffers(base.stays, snapshot), afterBuffers = standBuffers(view.plan.stays, snapshot);
  const beforeWaiting = calculateWaiting(snapshot, base, beforeBuffers, assumption);
  const afterWaiting = calculateWaiting(view.scenario, view.plan, afterBuffers, assumption);
  const afterById = new Map(afterWaiting.contributions.map(item => [item.arrival_id, item]));
  const common = beforeWaiting.contributions.flatMap(item => {
    const following = afterById.get(item.arrival_id);
    return following ? [{ before: item.estimated_wait_minutes, after: following.estimated_wait_minutes }] : [];
  });
  return {
    view, beforeBuffers, afterBuffers, beforeWaiting, afterWaiting,
    bufferProfile: DEFAULT_BUFFER_PROFILE,
    commonExistingArrivals: common.length,
    beforeCommonWait: common.length ? common.reduce((sum, item) => sum + item.before, 0) : null,
    afterCommonWait: common.length ? common.reduce((sum, item) => sum + item.after, 0) : null,
    incomingWait: afterById.get(evidence.request.flights[0].id)?.estimated_wait_minutes ?? null,
    assignedVisits: new Set(base.stays.map(stay => stay.visitId)).size,
    assumptionProfile: DEFAULT_GATE_WAIT_PROFILE,
  };
}

export function acceptAccommodation(dataset: DemoDataset, optionId: string): DemoDataset {
  const prepared = dataset.prepared;
  if (!prepared?.accommodation) throw new Error("No validated accommodation request is available.");
  const view = accommodationView(prepared.snapshot, prepared.accommodation, prepared.variant, optionId);
  const adapted = adaptScenarioPlan(view.scenario, prepared.variant, view.plan,
    `${view.plan.covered_flight_count}/${view.scenario.flights.length} represented legs assigned. Session-only accommodation; stand-rule validated offline, not a new solver run or operational authorization.`);
  return { ...adapted, id: `${dataset.id}/${optionId}`, label: `${dataset.label} · Session accommodation` };
}
