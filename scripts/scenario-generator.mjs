import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileAirport, getHourlyDistribution, readJson } from './airport-model.mjs';
import { formatUtcInstant, isUtcInstant, parseUtcInstant, validateDemand } from './demand-model.mjs';
import { deriveOccupancy } from './occupancy-model.mjs';
import { compareIds, standCandidates } from './stand-pressure.mjs';
import { createDemandRouteSampler, loadCatalogs } from './airport-catalogs.mjs';
import { allocateTraffic } from './traffic-allocation.mjs';

const ajv = new Ajv({ allErrors: true, strictRequired: false });
ajv.addFormat('date-time', isUtcInstant);
for (const name of ['raw-demand', 'linked-demand', 'route-generation', 'scenario-profile']) {
  ajv.addSchema(readJson(fileURLToPath(new URL(`../data/schemas/${name}.schema.json`, import.meta.url))));
}
const shape = ajv.getSchema('urn:gtaa-mica:scenario-profile:1.0.0');
const digest = text => createHash('sha256').update(text).digest('hex');
const sorted = rows => rows.slice().sort((a, b) => compareIds(a.id, b.id));
const minute = 60_000;
export const loadScenarioProfile = (path = fileURLToPath(new URL('../data/airports/contoso/demand/scenario-profile.json', import.meta.url))) => readJson(path);

export function randomStream(seed, key) {
  let state = Number.parseInt(digest(JSON.stringify([seed, key])).slice(0, 8), 16);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
const integer = (random, min, max) => min + Math.floor(random() * (max - min + 1));

export function generateScenario(profile, airport, caseId) {
  if (!shape(profile)) throw new Error(`Invalid scenario profile: ${ajv.errorsText(shape.errors)}`);
  const model = compileAirport(airport);
  if (profile.airport_id !== airport.airport.id) throw new Error('Scenario airport_id must match the airport manifest');
  const routes = profile.route_generation
    ? createDemandRouteSampler({ ...loadCatalogs(), airlines: airport.airlines }, airport.airport, profile.route_generation)
    : undefined;
  if (!routes && profile.traffic_targets?.some(target => target.market_id !== undefined)) {
    throw new Error('Traffic market targets require catalog route generation');
  }
  const ids = new Set();
  const unique = (rows, label) => {
    for (const row of rows) {
      const id = `${label}:${row.id}`;
      if (ids.has(id)) throw new Error(`Duplicate scenario configuration ID: ${id}`);
      ids.add(id);
    }
  };
  unique(profile.traffic_mix, 'mix');
  unique(profile.boundary_visits, 'boundary');
  unique(profile.cases, 'case');
  for (const item of profile.cases) unique(item.pressure_banks, `bank:${item.id}`);
  const selectedCase = profile.cases.find(item => item.id === caseId);
  if (!selectedCase) throw new Error(`Unknown scenario case: ${caseId}`);
  const start = parseUtcInstant(profile.plan_window.start);
  const end = parseUtcInstant(profile.plan_window.end);
  const duration = end - start;
  if (duration < 60 * minute || duration > 2880 * minute || start % minute || end % minute) {
    throw new Error('Scenario window must span 1 through 48 elapsed hours and use whole-minute boundaries');
  }
  if (profile.external_airport_ids?.includes(profile.airport_id)) throw new Error('External route airports cannot equal the scenario airport');
  const traffic = allocateTraffic(profile, airport, model);
  const count = traffic.rows.reduce((sum, row) => sum + row.count, 0) + profile.boundary_visits.length +
    selectedCase.pressure_banks.reduce((sum, row) => sum + row.long_count + row.short_count, 0);
  if (!count || count > 200) throw new Error('Prototype scenarios require 1 through 200 visits');
  if (selectedCase.expectations.minimum_generated_movements > selectedCase.expectations.maximum_generated_movements) {
    throw new Error('Scenario movement expectation bounds are reversed');
  }
  const canonicalProfile = structuredClone({
    ...profile, traffic_mix: sorted(profile.traffic_mix), boundary_visits: sorted(profile.boundary_visits),
    cases: sorted(profile.cases).map(item => ({ ...item, pressure_banks: sorted(item.pressure_banks) })),
    ...(profile.traffic_targets ? { traffic_targets: sorted(profile.traffic_targets) } : {}),
    ...(profile.route_generation ? { route_generation: {
      markets: sorted(profile.route_generation.markets).map(market => ({
        ...market, airports: market.airports.slice().sort((a, b) => compareIds(a.airport_code, b.airport_code)),
      })),
    } } : {}),
  });
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: model.timeZone, hour: '2-digit', hourCycle: 'h23' });
  const hourAt = time => Number(clock.formatToParts(time).find(part => part.type === 'hour').value);
  const legs = [];
  const trace = [];
  const registrations = new Set();
  const flightNumbers = new Map();
  const flightPrefixes = new Map(airport.airlines.airlines.map(airline => [airline.id, airline.iata]));
  const flightNumber = (airlineId, legId) => {
    const prefix = flightPrefixes.get(airlineId);
    if (!flightNumbers.has(airlineId)) flightNumbers.set(airlineId, new Set());
    const used = flightNumbers.get(airlineId);
    const initial = Number.parseInt(digest(JSON.stringify([profile.seed, legId, 'flight-number'])).slice(0, 8), 16);
    for (let probe = 0; probe < 9900; probe++) {
      const number = 100 + (initial + probe) % 9900;
      if (!used.has(number)) {
        used.add(number);
        return `${prefix}${number}`;
      }
    }
    throw new Error(`Synthetic flight-number range exhausted for ${airlineId}`);
  };
  const checkRow = row => {
    const aircraft = airport.aircraft.aircraft.find(item => item.id === row.aircraft_id);
    if (!aircraft) throw new Error(`Unknown scenario aircraft: ${row.aircraft_id}`);
    if (!model.airlines.has(row.operating_airline_id)) throw new Error(`Unknown scenario airline: ${row.operating_airline_id}`);
    if (!model.sectors.has(row.arrival_sector_id) || !model.sectors.has(row.departure_sector_id)) throw new Error(`Unknown scenario sector: ${row.id}`);
    if (!Number.isSafeInteger(aircraft.seats) || row.passenger_min > row.passenger_max || row.passenger_max > aircraft.seats) {
      throw new Error(`Scenario PAX range must fit a known seat count: ${row.id}`);
    }
    const candidates = standCandidates(model, {
      id: 'scenario-eligibility', aircraft_id: row.aircraft_id, operating_airline_ids: [row.operating_airline_id],
      arrival: { sectorId: row.arrival_sector_id, operatingAirlineId: row.operating_airline_id },
      departure: { sectorId: row.departure_sector_id, operatingAirlineId: row.operating_airline_id },
      start: profile.plan_window.start, end: profile.plan_window.end, stand_kind: 'any',
    });
    if (!candidates.candidate_stand_ids.length) throw new Error(`Scenario mix has no compatible continuous-stay stand: ${row.id}`);
    routes?.validateRow(row.operating_airline_id, row.arrival_sector_id, row.market_id);
    routes?.validateRow(row.operating_airline_id, row.departure_sector_id, row.market_id);
    return [
      getHourlyDistribution(model, row.arrival_sector_id, 'arrival'),
      getHourlyDistribution(model, row.departure_sector_id, 'departure'),
    ];
  };
  const sampleTime = (row, random, minimum, maximum, stay, distributions) => {
    const choices = [];
    let total = 0;
    for (let time = start; time <= maximum; time += profile.sampling_step_minutes * minute) {
      if (time < minimum) continue;
      const weight = distributions[0][hourAt(time)] * distributions[1][hourAt(time + stay)];
      total += weight;
      choices.push({ time, cumulative: total });
    }
    if (!Number.isFinite(total) || total <= 0) throw new Error(`No positive weighted time slots for scenario row: ${row.id}`);
    const target = random() * total;
    return choices.find(choice => choice.cumulative > target).time;
  };
  const addVisit = (row, key, arrival, departure, timingMethod) => {
    if (departure <= arrival || departure - arrival > duration || arrival >= end || departure <= start ||
        arrival < start - duration || departure >= end + duration) {
      throw new Error(`Scenario visit does not fit the plan-duration linking/context bounds: ${key}`);
    }
    const random = randomStream(profile.seed, `${key}:attributes`);
    const identity = `scenario-leg:${encodeURIComponent(profile.id)}/${encodeURIComponent(key)}`;
    const registration = `SYN-${digest(JSON.stringify([profile.seed, profile.id, key])).slice(0, 12).toUpperCase()}`;
    if (registrations.has(registration)) throw new Error(`Synthetic registration collision: ${registration}`);
    registrations.add(registration);
    // Retain the legacy draw so catalog enrichment does not resample existing PAX.
    const legacyRoute = profile.external_airport_ids
      ? profile.external_airport_ids[integer(random, 0, profile.external_airport_ids.length - 1)] : undefined;
    const common = { aircraft_id: row.aircraft_id, aircraft_registration: registration, operating_airline_id: row.operating_airline_id };
    const arrivalId = `${identity}/arrival`;
    const departureId = `${identity}/departure`;
    const endpoint = (key, sector) => routes?.sample({
      seed: profile.seed, key, airline_id: row.operating_airline_id, sector_id: sector, market_id: row.market_id,
    });
    const origin = endpoint(arrivalId, row.arrival_sector_id);
    const destination = endpoint(departureId, row.departure_sector_id);
    legs.push({
      ...common, id: arrivalId, type: 'arrival',
      flight_number: routes ? flightNumber(row.operating_airline_id, arrivalId) : `SYN-${digest(arrivalId).slice(0, 10).toUpperCase()}`,
      sector_id: row.arrival_sector_id, origin_airport_id: origin?.airport_code ?? legacyRoute, destination_airport_id: profile.airport_id,
      passenger_count: integer(random, row.passenger_min, row.passenger_max), scheduled_on_block: formatUtcInstant(arrival),
    }, {
      ...common, id: departureId, type: 'departure',
      flight_number: routes ? flightNumber(row.operating_airline_id, departureId) : `SYN-${digest(departureId).slice(0, 10).toUpperCase()}`,
      sector_id: row.departure_sector_id, origin_airport_id: profile.airport_id, destination_airport_id: destination?.airport_code ?? legacyRoute,
      passenger_count: integer(random, row.passenger_min, row.passenger_max), scheduled_off_block: formatUtcInstant(departure),
    });
    trace.push({
      key, aircraft_registration: registration, aircraft_id: row.aircraft_id,
      arrival_leg_id: arrivalId, departure_leg_id: departureId, timing_method: timingMethod,
      scheduled_on_block: formatUtcInstant(arrival), scheduled_off_block: formatUtcInstant(departure),
      ...(routes ? { arrival_market_id: origin.market_id, departure_market_id: destination.market_id } : {}),
    });
  };
  for (const row of sorted(traffic.rows)) {
    const distributions = checkRow(row);
    if (row.minimum_stay_minutes > row.maximum_stay_minutes || row.maximum_stay_minutes * minute > duration) {
      throw new Error(`Invalid scenario stay range: ${row.id}`);
    }
    for (let index = 0; index < row.count; index++) {
      const key = `mix:${row.id}:${index + 1}`;
      const random = randomStream(profile.seed, key);
      const stay = integer(random, row.minimum_stay_minutes, row.maximum_stay_minutes) * minute;
      const arrival = sampleTime(row, random, start, end - stay - (row.target_id ? minute : 0), stay, distributions);
      addVisit(row, key, arrival, arrival + stay, 'joint-hourly-weighted');
    }
  }
  for (const row of sorted(profile.boundary_visits)) {
    checkRow(row);
    const anchor = row.anchor === 'plan-start' ? start : end;
    addVisit(row, `boundary:${row.id}`, anchor + row.arrival_offset_minutes * minute,
      anchor + row.departure_offset_minutes * minute, 'explicit-boundary-context');
  }
  for (const row of sorted(selectedCase.pressure_banks)) {
    const distributions = checkRow(row);
    if (row.short_stay_minutes > row.long_lag_minutes) throw new Error(`Short pressure bank must fit the long stay: ${row.id}`);
    const random = randomStream(profile.seed, `bank:${row.id}`);
    const anchor = sampleTime(row, random, start + row.long_lead_minutes * minute,
      end - row.long_lag_minutes * minute, row.short_stay_minutes * minute, distributions);
    for (let index = 0; index < row.long_count; index++) {
      addVisit(row, `bank:${row.id}:long:${index + 1}`, anchor - row.long_lead_minutes * minute,
        anchor + row.long_lag_minutes * minute, 'weighted-pressure-bank');
    }
    for (let index = 0; index < row.short_count; index++) {
      addVisit(row, `bank:${row.id}:short:${index + 1}`, anchor, anchor + row.short_stay_minutes * minute, 'weighted-pressure-bank');
    }
  }
  legs.sort((a, b) => compareIds(a.id, b.id));
  trace.sort((a, b) => compareIds(a.key, b.key));
  const fingerprint = digest(JSON.stringify(canonicalProfile));
  const snapshotFingerprint = digest(JSON.stringify({ profile_fingerprint: fingerprint, case_id: caseId, legs }));
  const raw = {
    schema_version: '1.0.0', id: `scenario:${encodeURIComponent(profile.id)}/${encodeURIComponent(caseId)}/${snapshotFingerprint}`,
    airport_id: profile.airport_id, synthetic: true,
    description: `Closed synthetic feed for ${caseId}; includes surrounding scheduled legs, no assignments or actuals.`, legs,
  };
  const validation = validateDemand(raw, airport);
  if (validation.errors.length) throw new Error(`Generated demand is invalid:\n${validation.errors.join('\n')}`);
  const occupancy = deriveOccupancy(raw, airport, { planStart: profile.plan_window.start, planEnd: profile.plan_window.end });
  if (!occupancy.timing_complete || occupancy.linked_demand.visits.length !== count ||
      occupancy.linked_demand.visits.some(visit => visit.status !== 'connected')) {
    throw new Error('Generated scenario did not produce the exact complete connected-visit set');
  }
  const presenceAt = time => trace.filter(item => parseUtcInstant(item.scheduled_on_block) <= time && time < parseUtcInstant(item.scheduled_off_block))
    .map(item => ({
      aircraft_registration: item.aircraft_registration, aircraft_id: item.aircraft_id,
      arrival_leg_id: item.arrival_leg_id, departure_leg_id: item.departure_leg_id,
      evidence: 'scheduled-source-legs', stand_status: 'unassigned',
    }));
  return {
    schema_version: '1.0.0', generator_version: routes || profile.traffic_targets ? 'catalog-stand-share-v2' : 'seeded-joint-hourly-v1',
    ...(routes ? { routing_warnings: routes.warnings } : {}),
    ...(profile.traffic_targets ? { traffic_allocation: traffic.allocation } : {}),
    id: raw.id, profile: canonicalProfile, case_id: caseId, profile_fingerprint: fingerprint,
    plan_window: { ...profile.plan_window }, raw_demand: raw,
    expected_visit_count: count, generation_trace: trace,
    initial_state: presenceAt(start), final_state: presenceAt(end),
    timing_complete: true,
    limitations: [
      'Closed synthetic feed with unique aircraft per visit; not a live-feed completeness guarantee or fleet rotation model.',
      'Boundary presence is backed by scheduled context legs. Stands are unassigned until solving; no unknown parking boundary is filled.',
      'Joint arrival/departure hourly weights shape synthetic timing, not exact marginal counts, observed volumes or stand capacity.',
      'The deliberate pressure bank is a configured stress case, not evidence of real congestion.',
      ...(routes ? ['Catalog market weights are illustrative, not measured market rankings, verified airline service, fleet range or operating rights.'] : []),
    ],
  };
}
