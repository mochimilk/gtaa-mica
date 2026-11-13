import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { compileAirport, evaluatePlan, readJson } from './airport-model.mjs';
import { formatUtcInstant, isUtcInstant, parseUtcInstant } from './demand-model.mjs';
import { compareIds, standCandidates } from './stand-pressure.mjs';

const schemaPath = name => fileURLToPath(new URL(`../data/schemas/${name}.schema.json`, import.meta.url));
const ajv = new Ajv({ allErrors: true });
ajv.addFormat('date-time', isUtcInstant);
ajv.addSchema(readJson(schemaPath('capacity-profile')));
const profileShape = ajv.getSchema('urn:gtaa-mica:capacity-profile:1.0.0');
const snapshotShape = ajv.compile(readJson(schemaPath('demo-scenario')));
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function loadCapacityProfile(path = fileURLToPath(new URL('../data/airports/contoso/evaluation/capacity-profile.json', import.meta.url))) {
  return validateCapacityProfile(readJson(path));
}

export function validateCapacityProfile(profile) {
  if (!profileShape(profile)) throw new Error(`Invalid capacity profile: ${ajv.errorsText(profileShape.errors)}`);
  const ids = new Set(profile.probes.map(probe => probe.id));
  if (ids.size !== profile.probes.length || !ids.has(profile.default_probe_id)) throw new Error('Capacity profile requires unique probe IDs and a known default.');
  return profile;
}

export function sourceOccupancies(snapshot, raw) {
  if (!snapshotShape(snapshot)) throw new Error(`Invalid capacity source snapshot: ${ajv.errorsText(snapshotShape.errors)}`);
  if (raw?.id !== snapshot.demand_id || !Array.isArray(raw.legs) || raw.legs.length !== snapshot.flights.length) throw new Error('Capacity source demand does not match the frozen snapshot.');
  const legs = new Map(raw.legs.map(leg => [leg.id, leg]));
  if (legs.size !== raw.legs.length) throw new Error('Duplicate capacity source flight.');
  const visits = new Map(snapshot.visits.map(visit => [visit.turnId, visit]));
  if (visits.size !== snapshot.visits.length) throw new Error('Duplicate capacity source visit.');
  const sources = new Map();
  for (const flight of snapshot.flights) {
    const leg = legs.get(flight.id), visit = visits.get(flight.visitId);
    if (!leg || !visit || sources.has(flight.id) || leg.type !== flight.direction ||
        leg.flight_number !== flight.flight ||
        (leg.scheduled_on_block ?? leg.scheduled_off_block) !== flight.scheduled ||
        (leg.type === 'arrival' ? leg.origin_airport_id : leg.destination_airport_id) !== flight.routeEnd ||
        leg.aircraft_id !== visit.aircraftType || leg.aircraft_registration !== visit.registration ||
        leg.operating_airline_id !== `airline:${visit.carrier}`) {
      throw new Error(`Capacity source flight does not match the frozen snapshot: ${flight.id}`);
    }
    sources.set(flight.id, { flight, leg });
  }
  return Object.fromEntries(Object.entries(snapshot.variants).map(([variant, plan]) => [variant, plan.stays.map(stay => {
    const visit = visits.get(stay.visitId);
    if (!visit) throw new Error(`Unknown capacity source visit: ${stay.visitId}`);
    const endpoint = (id, direction, time, tow) => {
      if (!id) return undefined;
      const source = sources.get(id);
      if (!source || source.flight.visitId !== stay.visitId || source.leg.type !== direction ||
          source.flight.scheduled !== time || tow) throw new Error(`Invalid capacity source endpoint: ${id}`);
      return { sectorId: source.leg.sector_id, operatingAirlineId: source.leg.operating_airline_id };
    };
    return {
      id: stay.id, standId: stay.rowId, aircraftId: visit.aircraftType,
      start: parseUtcInstant(stay.start), end: parseUtcInstant(stay.end),
      operatingAirlineIds: [`airline:${visit.carrier}`],
      arrival: endpoint(stay.arrivalFlightId, 'arrival', stay.start, stay.towIn),
      departure: endpoint(stay.departureFlightId, 'departure', stay.end, stay.towOut),
    };
  })]));
}

export function calculateCapacityWindows(model, occupancies, probe, horizon) {
  const [start, end] = horizon;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) throw new Error('Capacity horizon must be a positive UTC interval.');
  if (!Number.isInteger(probe.separation_minutes) || probe.separation_minutes < 0 || probe.separation_minutes > 120) throw new Error('Invalid capacity separation.');
  if (!model.aircraft.has(probe.aircraft_id) || !model.airlines.has(probe.operating_airline_id) ||
      !model.sectors.has(probe.arrival_sector_id) || !model.sectors.has(probe.departure_sector_id)) throw new Error('Unknown capacity probe catalog reference.');
  const findings = evaluatePlan(model, occupancies);
  if (findings.length) throw new Error(`Cannot assess capacity of an invalid fixed plan: ${JSON.stringify(findings)}`);
  const id = `capacity-probe:${probe.id}`;
  if (occupancies.some(item => item.id === id)) throw new Error(`Capacity probe ID collides with an assignment: ${id}`);
  const demand = {
    id, aircraft_id: probe.aircraft_id, operating_airline_ids: [probe.operating_airline_id],
    arrival: { sectorId: probe.arrival_sector_id, operatingAirlineId: probe.operating_airline_id },
    departure: { sectorId: probe.departure_sector_id, operatingAirlineId: probe.operating_airline_id },
    start: formatUtcInstant(start), end: formatUtcInstant(end), stand_kind: 'any',
  };
  const eligibility = standCandidates(model, demand);
  const rows = eligibility.candidate_stand_ids.map(standId => {
    const target = {
      id, standId, aircraftId: probe.aircraft_id, operatingAirlineIds: demand.operating_airline_ids,
      arrival: demand.arrival, departure: demand.departure,
    };
    const blocks = occupancies.flatMap(existing => {
      const reasons = evaluatePlan(model, [{ ...target, start: existing.start, end: existing.end }, existing]);
      if (!reasons.length) return [];
      const separation = existing.standId === standId ? probe.separation_minutes * 60_000 : 0;
      const left = Math.max(start, existing.start - separation), right = Math.min(end, existing.end + separation);
      if (left >= right) return [];
      return [{
        start: left, end: right, assignment_ids: [existing.id],
        reasons: [...new Set(reasons.map(reason => reason.code))].sort(compareIds),
        rule_paths: [...new Set(reasons.flatMap(reason => reason.rulePath ? [reason.rulePath] : []))].sort(compareIds),
      }];
    }).sort((a, b) => a.start - b.start || a.end - b.end || compareIds(a.assignment_ids[0], b.assignment_ids[0]));
    const merged = [];
    for (const block of blocks) {
      const previous = merged.at(-1);
      if (previous && block.start <= previous.end) {
        previous.end = Math.max(previous.end, block.end);
        for (const key of ['assignment_ids', 'reasons', 'rule_paths']) previous[key] = [...new Set([...previous[key], ...block[key]])].sort(compareIds);
      } else merged.push({ ...block });
    }
    const windows = [];
    let cursor = start;
    for (const [index, block] of merged.entries()) {
      if (cursor < block.start) windows.push({ start: formatUtcInstant(cursor), end: formatUtcInstant(block.start), before: index ? index - 1 : null, after: index });
      cursor = block.end;
    }
    if (cursor < end) windows.push({ start: formatUtcInstant(cursor), end: formatUtcInstant(end), before: merged.length ? merged.length - 1 : null, after: null });
    return { stand_id: standId, windows, blocks: merged.map(block => ({ ...block, start: formatUtcInstant(block.start), end: formatUtcInstant(block.end) })) };
  });
  return { rows, excluded_stands: eligibility.excluded_stands };
}

export function prepareCapacitySnapshot(snapshot, raw, airport, profile) {
  validateCapacityProfile(profile);
  const occupancies = sourceOccupancies(snapshot, raw);
  const stands = new Set(airport.stands.stands.map(stand => stand.id));
  if (snapshot.airport?.id !== airport.airport.id || !profile.id.startsWith(`${airport.airport.id}:`) ||
      snapshot.rows.length !== stands.size || new Set(snapshot.rows.map(row => row.id)).size !== stands.size ||
      snapshot.rows.some(row => !stands.has(row.id))) {
    throw new Error('Capacity airport/profile/stand identity does not match the selected schedule.');
  }
  const model = compileAirport(airport);
  const horizon = [parseUtcInstant(snapshot.plan_window.start), parseUtcInstant(snapshot.plan_window.end)];
  return {
    schema_version: '1.0.0', metric_id: profile.metric_id, metric_version: profile.metric_version,
    airport_id: airport.airport.id, case_id: snapshot.case_id, demand_id: snapshot.demand_id,
    snapshot_fingerprint: fingerprint(snapshot), airport_fingerprint: fingerprint(airport), demand_fingerprint: fingerprint(raw),
    plan_window: snapshot.plan_window, profile,
    variants: Object.fromEntries(Object.entries(occupancies).map(([variant, items]) => [variant, {
      request_fingerprint: snapshot.variants[variant].request_fingerprint,
      probes: profile.probes.map(probe => ({ id: probe.id, ...calculateCapacityWindows(model, items, probe, horizon) })),
    }])),
  };
}
