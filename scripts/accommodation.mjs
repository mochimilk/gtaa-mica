import Ajv from 'ajv';
import { fileURLToPath } from 'node:url';
import { compileAirport, evaluatePlan, readJson } from './airport-model.mjs';
import { fingerprint, sourceOccupancies } from './capacity-probe.mjs';
import { standCandidates, compareIds } from './stand-pressure.mjs';
import { createDemandRouteSampler, loadCatalogs } from './airport-catalogs.mjs';
import { loadScenarioProfile } from './scenario-generator.mjs';

const profilePath = fileURLToPath(new URL('../data/airports/contoso/evaluation/accommodation-profile.json', import.meta.url));
const shape = new Ajv({ allErrors: true }).compile(readJson(fileURLToPath(new URL('../data/schemas/accommodation-profile.schema.json', import.meta.url))));
export function validateAccommodationProfile(profile) {
  if (!shape(profile)) throw new Error(`Invalid accommodation profile: ${JSON.stringify(shape.errors)}`);
  if (new Set(profile.cases.map(item => item.case_id)).size !== 3) throw new Error('Accommodation profile requires each scenario exactly once.');
  return profile;
}
export const loadAccommodationProfile = () => validateAccommodationProfile(readJson(profilePath));

const asDemand = item => ({
  id: item.id, aircraft_id: item.aircraftId, operating_airline_ids: item.operatingAirlineIds,
  arrival: item.arrival, departure: item.departure, stand_kind: 'any',
  start: new Date(item.start).toISOString(), end: new Date(item.end).toISOString(),
});

export function assessAccommodation(model, fixed, incoming, movableStayIds, maxOptions = 3) {
  if (!Number.isInteger(maxOptions) || maxOptions < 1 || maxOptions > 5) throw new Error('Invalid accommodation option limit.');
  if (fixed.some(item => item.id === incoming.id) || evaluatePlan(model, fixed).length) throw new Error('Invalid approved accommodation plan or request identity.');
  const eligibility = standCandidates(model, asDemand(incoming));
  const targets = eligibility.candidate_stand_ids.map(standId => {
    const placement = { ...incoming, standId };
    const blockers = fixed.filter(item => evaluatePlan(model, [placement, item]).length);
    return { placement, blockers };
  });
  const direct = targets.filter(target => target.blockers.length === 0);
  const options = [];
  const add = (placement, moves, proposed) => {
    const findings = evaluatePlan(model, proposed);
    if (findings.length) throw new Error(`Accommodation failed independent full-plan validation: ${JSON.stringify(findings)}`);
    const content = { kind: moves.length ? 'localized-repair' : 'direct', target_stand_id: placement.standId, moves };
    options.push({ id: `accommodation:${fingerprint(content)}`, ...content, stand_validation_passed: true });
  };
  for (const { placement } of direct) add(placement, [], [...fixed, placement]);
  if (!direct.length) for (const { placement, blockers } of targets) {
    if (blockers.length !== 1 || !movableStayIds.has(blockers[0].id)) continue;
    const blocker = blockers[0];
    const remaining = fixed.filter(item => item.id !== blocker.id);
    for (const standId of standCandidates(model, asDemand(blocker)).candidate_stand_ids) {
      if (standId === blocker.standId) continue;
      const proposed = [...remaining, { ...blocker, standId }, placement];
      if (evaluatePlan(model, proposed).length) continue;
      add(placement, [{ stay_id: blocker.id, from_stand_id: blocker.standId, to_stand_id: standId }], proposed);
    }
  }
  options.sort((a, b) => compareIds(a.target_stand_id, b.target_stand_id) || compareIds(a.id, b.id));
  return {
    status: options.length ? 'options-found' : 'no-acceptable-option-found',
    search: direct.length ? 'direct-placement' : 'single-whole-turn-relocation',
    total_options_found: options.length, options: options.slice(0, maxOptions),
    excluded_stands: eligibility.excluded_stands,
    blocked_stands: targets.filter(target => target.blockers.length).map(target => {
      const findings = evaluatePlan(model, [...fixed, target.placement]);
      return {
        stand_id: target.placement.standId, blocking_stay_ids: target.blockers.map(item => item.id).sort(compareIds),
        reasons: [...new Set(findings.map(item => item.code))].sort(compareIds),
        rule_paths: [...new Set(findings.flatMap(item => item.rulePath ? [item.rulePath] : []))].sort(compareIds),
      };
    }),
  };
}

export function requestOccupancy(request) {
  const probe = request.probe;
  return {
    id: request.stay_id, aircraftId: probe.aircraft_id, operatingAirlineIds: [probe.operating_airline_id],
    arrival: { sectorId: probe.arrival_sector_id, operatingAirlineId: probe.operating_airline_id },
    departure: { sectorId: probe.departure_sector_id, operatingAirlineId: probe.operating_airline_id },
    start: Date.parse(request.start), end: Date.parse(request.end),
  };
}

export function prepareAccommodation(snapshot, raw, airport, profile, probe) {
  validateAccommodationProfile(profile);
  const definition = profile.cases.find(item => item.case_id === snapshot.case_id);
  if (!definition || probe.id !== definition.probe_id || probe.separation_minutes !== 0) throw new Error('Unknown accommodation case/probe or unsupported extra separation.');
  const origin = Date.parse(snapshot.plan_window.start), horizonEnd = Date.parse(snapshot.plan_window.end);
  const start = origin + definition.start_offset_minutes * 60_000, end = start + definition.duration_minutes * 60_000;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < origin || end <= start || end > horizonEnd) throw new Error('Accommodation request is outside the prepared horizon.');
  const airline = airport.airlines.airlines.find(item => item.id === probe.operating_airline_id);
  if (!airline?.iata) throw new Error('Late request requires a known airline with an IATA flight prefix.');
  const id = `late-request:${snapshot.case_id}`, visitId = `${id}/visit`;
  const routes = createDemandRouteSampler({ ...loadCatalogs(), airlines: airport.airlines }, airport.airport, loadScenarioProfile().route_generation);
  const originAirport = routes.sample({ seed: profile.id, key: `${id}/arrival`, airline_id: airline.id, sector_id: probe.arrival_sector_id }).airport_code;
  const destination = routes.sample({ seed: profile.id, key: `${id}/departure`, airline_id: airline.id, sector_id: probe.departure_sector_id }).airport_code;
  const carrier = airline.id.replace(/^airline:/, '');
  const arrFlight = `${airline.iata}9901`, depFlight = `${airline.iata}9902`;
  const request = {
    id, reason: 'post-approval-service-request', probe, start: new Date(start).toISOString(), end: new Date(end).toISOString(), stay_id: `${id}/stay`,
    visit: { turnId: visitId, carrier, arrFlight, depFlight, origin: originAirport, destination, registration: `SYN-LATE-${carrier}`, aircraftType: probe.aircraft_id },
    flights: [
      { id: `${id}/arrival`, visitId, direction: 'arrival', flight: arrFlight, routeEnd: originAirport, scheduled: new Date(start).toISOString() },
      { id: `${id}/departure`, visitId, direction: 'departure', flight: depFlight, routeEnd: destination, scheduled: new Date(end).toISOString() },
    ],
  };
  if (snapshot.visits.some(visit => visit.turnId === visitId || visit.registration === request.visit.registration ||
      visit.arrFlight === request.visit.arrFlight || visit.depFlight === request.visit.depFlight)) throw new Error('Late-request identity collides with existing traffic.');
  const fixed = sourceOccupancies(snapshot, raw), model = compileAirport(airport), incoming = requestOccupancy(request);
  const variants = Object.fromEntries(Object.entries(snapshot.variants).map(([variant, plan]) => {
    const movable = new Set(plan.stays.filter(stay => !stay.towIn && !stay.towOut && stay.arrivalFlightId && stay.departureFlightId &&
      Date.parse(stay.start) >= origin && Date.parse(stay.end) <= horizonEnd &&
      plan.stays.filter(other => other.visitId === stay.visitId).length === 1).map(stay => stay.id));
    return [variant, assessAccommodation(model, fixed[variant], incoming, movable, profile.max_displayed_options)];
  }));
  return {
    schema_version: '1.0.0', id, source: 'synthetic', snapshot_fingerprint: fingerprint(snapshot),
    airport_fingerprint: fingerprint(airport), demand_fingerprint: fingerprint(raw), profile,
    approved_at: new Date(origin - 24 * 3600_000).toISOString(), received_at: new Date(origin - 12 * 3600_000).toISOString(),
    request, variants,
  };
}
