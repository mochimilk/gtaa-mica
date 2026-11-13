import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { loadAirport, readJson } from './airport-model.mjs';
import { isUtcInstant, loadDemand, validateDemand } from './demand-model.mjs';
import { deriveOccupancy } from './occupancy-model.mjs';
import { solveAirport } from './local-assignment.mjs';
import { generateScenario, loadScenarioProfile } from './scenario-generator.mjs';
import { summarizeScenario } from './scenario-report.mjs';

const airport = loadAirport();
const profile = loadScenarioProfile();
const fullDayProfile = loadScenarioProfile(fileURLToPath(new URL('../data/airports/contoso/demand/full-day-profile.json', import.meta.url)));
const ajv = new Ajv({ allErrors: true, strictRequired: false });
ajv.addFormat('date-time', isUtcInstant);
for (const name of ['raw-demand', 'linked-demand', 'occupancy', 'tow-profile', 'tow-preparation', 'local-solver-request', 'local-assignment', 'route-generation', 'scenario-profile', 'scenario', 'scenario-run']) {
  ajv.addSchema(readJson(fileURLToPath(new URL(`../data/schemas/${name}.schema.json`, import.meta.url))));
}
const shape = ajv.getSchema('urn:gtaa-mica:scenario:1.0.0');
const runShape = ajv.getSchema('urn:gtaa-mica:scenario-run:1.0.0');
const generate = (caseId = 'comfortable', input = profile, data = airport) => {
  const before = structuredClone({ input, data });
  const scenario = generateScenario(input, data, caseId);
  assert.ok(shape(scenario), ajv.errorsText(shape.errors));
  assert.deepEqual({ input, data }, before);
  assert.deepEqual(validateDemand(scenario.raw_demand, data), { errors: [], warnings: [] });
  assert.equal(scenario.raw_demand.legs.length, scenario.expected_visit_count * 2);
  assert.equal(new Set(scenario.generation_trace.map(item => item.aircraft_registration)).size, scenario.expected_visit_count);
  const sources = new Map(scenario.raw_demand.legs.map(leg => [leg.id, leg]));
  for (const item of scenario.generation_trace) {
    assert.equal(sources.get(item.arrival_leg_id).scheduled_on_block, item.scheduled_on_block);
    assert.equal(sources.get(item.departure_leg_id).scheduled_off_block, item.scheduled_off_block);
  }
  const baseline = deriveOccupancy(scenario.raw_demand, data, { planStart: input.plan_window.start, planEnd: input.plan_window.end });
  assert.equal(baseline.timing_complete, true);
  assert.equal(baseline.linked_demand.visits.length, scenario.expected_visit_count);
  assert.equal(baseline.blocked_source_leg_ids.length, 0);
  assert.equal(baseline.unresolved_segment_ids.length, 0);
  return scenario;
};
const smallProfile = () => ({
  ...structuredClone(profile),
  traffic_mix: [{ ...structuredClone(profile.traffic_mix[0]), count: 1, minimum_stay_minutes: 60, maximum_stay_minutes: 60 }],
  boundary_visits: [],
  cases: [structuredClone(profile.cases[0])],
});
const solve = (scenario, data = airport) => {
  const comparison = solveAirport(scenario.raw_demand, data, {
    planStart: scenario.plan_window.start, planEnd: scenario.plan_window.end, timeLimitSeconds: 10,
  });
  const summary = summarizeScenario(scenario, comparison, data);
  const result = { schema_version: '1.0.0', scenario, comparison, summary };
  assert.ok(runShape(result), ajv.errorsText(runShape.errors));
  return result;
};

test('full day has exactly 160 visits, 320 in-horizon legs and the requested market/pool split', () => {
  const scenario = generate('full-day', fullDayProfile);
  assert.equal(scenario.expected_visit_count, 160);
  assert.equal(scenario.raw_demand.legs.length, 320);
  assert.equal(Date.parse(scenario.plan_window.end) - Date.parse(scenario.plan_window.start), 24 * 60 * 60_000);
  assert.deepEqual(scenario.initial_state, []);
  assert.deepEqual(scenario.final_state, []);
  const markets = {};
  for (const trace of scenario.generation_trace) {
    assert.equal(trace.arrival_market_id, trace.departure_market_id);
    markets[trace.arrival_market_id] = (markets[trace.arrival_market_id] ?? 0) + 1;
  }
  assert.deepEqual(markets, { asia: 12, domestic: 136, europe: 12 });
  const totals = {};
  for (const row of scenario.traffic_allocation) totals[row.planning_group_id] = (totals[row.planning_group_id] ?? 0) + row.visit_count;
  assert.deepEqual(totals, {
    'group:alliance:oneworld': 80, 'group:alliance:skyteam': 40, 'group:alliance:star': 40,
  });
  for (const target of fullDayProfile.traffic_targets) {
    const rows = scenario.traffic_allocation.filter(row => row.target_id === target.id);
    assert.equal(rows.reduce((sum, row) => sum + row.visit_count, 0), target.count);
    assert.equal(rows.reduce((sum, row) => sum + row.stand_credit, 0), target.sector_id === 'domestic' ? 38 : 8);
  }
  assert.ok(scenario.raw_demand.legs.every(leg => {
    const time = Date.parse(leg.scheduled_on_block ?? leg.scheduled_off_block);
    return Date.parse(scenario.plan_window.start) <= time && time < Date.parse(scenario.plan_window.end);
  }));
});

test('catalog flights use unique readable IATA numbers, compatible geography and primarily US operators', () => {
  const scenario = generate('full-day', fullDayProfile);
  const catalog = readJson(fileURLToPath(new URL('../data/airports.json', import.meta.url)));
  const airports = new Map(catalog.airports.map(airport => [airport.code, airport]));
  const airlines = new Map(airport.airlines.airlines.map(airline => [airline.id, airline]));
  assert.equal(new Set(scenario.raw_demand.legs.map(leg => leg.flight_number)).size, 320);
  let us = 0;
  for (const leg of scenario.raw_demand.legs) {
    const airline = airlines.get(leg.operating_airline_id);
    assert.match(leg.flight_number, new RegExp(`^${airline.iata}[1-9][0-9]{2,3}$`));
    const code = leg.type === 'arrival' ? leg.origin_airport_id : leg.destination_airport_id;
    assert.ok(airports.has(code));
    assert.equal(airports.get(code).country === 'United States', leg.sector_id === 'domestic');
    if (airline.country === 'United States') us++;
  }
  assert.equal(us, 308);
  const source = new Map(scenario.raw_demand.legs.map(leg => [leg.id, leg]));
  for (const trace of scenario.generation_trace) {
    const arrival = source.get(trace.arrival_leg_id);
    const departure = source.get(trace.departure_leg_id);
    const market = fullDayProfile.route_generation.markets.find(market => market.id === trace.arrival_market_id);
    if (market) {
      assert.ok(market.airports.some(endpoint => endpoint.airport_code === arrival.origin_airport_id));
      assert.ok(market.airports.some(endpoint => endpoint.airport_code === departure.destination_airport_id));
      const airline = airlines.get(arrival.operating_airline_id);
      if (airline.country !== 'United States') {
        const choices = airline.hub_airports ?? catalog.airports.filter(airport => airport.country === airline.country).map(airport => airport.code);
        assert.ok(choices.includes(arrival.origin_airport_id));
        assert.ok(choices.includes(departure.destination_airport_id));
      }
    }
  }
});

test('route enrichment preserves legacy source IDs, registrations, timing and passenger draws', () => {
  const legacy = structuredClone(profile);
  delete legacy.route_generation;
  const project = scenario => scenario.raw_demand.legs.map(({ flight_number, origin_airport_id, destination_airport_id, ...rest }) => rest);
  assert.deepEqual(project(generate('constrained')), project(generate('constrained', legacy)));
  assert.equal(generate('comfortable', legacy).generator_version, 'seeded-joint-hourly-v1');
});

test('full-day allocation and endpoints are independent of catalog/profile row ordering', () => {
  const reordered = structuredClone(fullDayProfile);
  reordered.traffic_mix.reverse();
  reordered.traffic_targets.reverse();
  reordered.route_generation.markets.reverse();
  for (const market of reordered.route_generation.markets) market.airports.reverse();
  const data = structuredClone(airport);
  data.stands.stands.reverse();
  data.airlineGroups.groups.reverse();
  assert.equal(JSON.stringify(generate('full-day', reordered, data)), JSON.stringify(generate('full-day', fullDayProfile)));
});

test('closing an eligible stand changes derived shares instead of retaining hardcoded quotas', () => {
  const data = structuredClone(airport);
  data.stands.stands.find(stand => stand.code === 'R08').closed = true;
  const scenario = generate('full-day', fullDayProfile, data);
  for (const target of ['asia', 'europe']) {
    const rows = scenario.traffic_allocation.filter(row => row.target_id === target);
    assert.equal(rows.reduce((sum, row) => sum + row.stand_credit, 0), 7);
    assert.equal(rows.find(row => row.planning_group_id === 'group:alliance:oneworld').visit_count, 5);
  }
});

test('invalid traffic targets, market references and domestic/foreign endpoint mixes are explicit errors', () => {
  for (const [mutate, message] of [
    [input => { input.traffic_targets.push(input.traffic_targets[0]); }, /Duplicate traffic target/],
    [input => { input.traffic_mix[0].target_id = 'missing'; }, /Unknown traffic target/],
    [input => { input.traffic_targets[0].market_id = 'europe'; }, /Domestic traffic target/],
    [input => { input.traffic_targets[1].market_id = 'missing'; }, /Unknown route market/],
    [input => { input.traffic_mix[0].count = 1; }, /Invalid scenario profile/],
    [input => { input.traffic_targets[0].count = 200; }, /1 through 200/],
    [input => { input.route_generation.markets[0].airports[0].airport_code = 'SFO'; }, /host country/],
    [input => { input.route_generation.markets[0].airports[0].airport_code = 'XXX'; }, /Unknown market airport/],
    [input => { input.route_generation.markets[0].airports.push(input.route_generation.markets[0].airports[0]); }, /Duplicate airport/],
    [input => { input.route_generation.markets.push(input.route_generation.markets[0]); }, /Duplicate route market/],
  ]) {
    const input = structuredClone(fullDayProfile);
    mutate(input);
    assert.throws(() => generateScenario(input, airport, 'full-day'), message);
  }
  const noCountry = structuredClone(airport);
  delete noCountry.airport.country;
  assert.throws(() => generateScenario(fullDayProfile, noCountry, 'full-day'), /explicit host airport country/);
});

test('flight number collision probing stays unique at the 200-visit workload ceiling', () => {
  const input = smallProfile();
  input.traffic_mix[0].count = 200;
  const scenario = generate('comfortable', input);
  assert.equal(new Set(scenario.raw_demand.legs.map(leg => leg.flight_number)).size, 400);
});

test('native full day keeps all demand visible and reports actual congestion without fabricated assignments', () => {
  const result = solve(generate('full-day', fullDayProfile));
  assert.equal(result.summary.expectations_passed, true);
  assert.equal(result.summary.in_horizon_flight_legs, 320);
  assert.equal(result.summary.context_flight_legs, 0);
  for (const metrics of Object.values(result.summary.metrics)) {
    assert.equal(metrics.solver_status, 'optimal');
    assert.equal(metrics.assigned_visits, 149);
    assert.equal(metrics.assigned_flight_legs, 298);
    assert.equal(metrics.unassigned_visits, 11);
    assert.equal(metrics.generated_tows, 0);
    assert.equal(metrics.stand_validation_passed, true);
  }
});

test('comfortable day has exact traffic counts, short/long stays and explicit complete overnight context', () => {
  const scenario = generate();
  assert.equal(scenario.expected_visit_count, 36);
  assert.equal(scenario.raw_demand.legs.length, 72);
  assert.equal(scenario.initial_state.length, 1);
  assert.equal(scenario.final_state.length, 1);
  for (const [states, boundary] of [[scenario.initial_state, scenario.plan_window.start], [scenario.final_state, scenario.plan_window.end]]) {
    for (const state of states) {
      const arrival = scenario.raw_demand.legs.find(leg => leg.id === state.arrival_leg_id);
      const departure = scenario.raw_demand.legs.find(leg => leg.id === state.departure_leg_id);
      assert.ok(Date.parse(arrival.scheduled_on_block) <= Date.parse(boundary));
      assert.ok(Date.parse(departure.scheduled_off_block) > Date.parse(boundary));
      assert.equal(state.stand_status, 'unassigned');
      assert.equal(state.stand_id, undefined);
    }
  }
  const dwell = scenario.generation_trace.map(item => (Date.parse(item.scheduled_off_block) - Date.parse(item.scheduled_on_block)) / 60_000);
  assert.ok(dwell.some(minutes => minutes <= 100));
  assert.ok(dwell.some(minutes => minutes >= 240));
  assert.ok(scenario.raw_demand.legs.every(leg => leg.type !== 'ground-movement' && !('visit_id' in leg) && !('stand_id' in leg)));
});

test('constrained day adds only its explicit bank and preserves every comfortable source leg', () => {
  const comfortable = generate();
  const constrained = generate('constrained');
  assert.equal(constrained.expected_visit_count, 41);
  assert.equal(constrained.raw_demand.legs.length, 82);
  const sources = new Map(constrained.raw_demand.legs.map(leg => [leg.id, leg]));
  for (const leg of comfortable.raw_demand.legs) assert.deepEqual(sources.get(leg.id), leg);
  assert.notEqual(comfortable.id, constrained.id);
  assert.equal(comfortable.profile_fingerprint, constrained.profile_fingerprint);
  const bank = constrained.generation_trace.filter(item => item.timing_method === 'weighted-pressure-bank');
  assert.equal(bank.length, 5);
  assert.equal(new Set(bank.filter(item => item.key.includes(':short:')).map(item => item.scheduled_on_block)).size, 1);
});

test('fixed seed and canonical configuration ordering produce repeatable bytes', () => {
  assert.deepEqual(generate(), generate());
  const reordered = structuredClone(profile);
  reordered.traffic_mix.reverse();
  reordered.boundary_visits.reverse();
  reordered.cases.reverse();
  assert.equal(JSON.stringify(generate('constrained')), JSON.stringify(generate('constrained', reordered)));
  const changed = structuredClone(profile);
  changed.seed = 'another-repeatable-seed';
  const alternate = generate('comfortable', changed);
  assert.notEqual(alternate.id, generate().id);
  assert.notDeepEqual(alternate.raw_demand.legs, generate().raw_demand.legs);
});

test('joint arrival/departure weights and elapsed-time slots select only positive local bins', () => {
  const input = smallProfile();
  const data = structuredClone(airport);
  const pattern = data.trafficProfile['sector-patterns'].find(item => item.sector === 'domestic');
  pattern['arrival-hourly-weights'] = Array(24).fill(0);
  pattern['departure-hourly-weights'] = Array(24).fill(0);
  pattern['arrival-hourly-weights'][8] = 1;
  pattern['departure-hourly-weights'][9] = 1;
  const scenario = generate('comfortable', input, data);
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: airport.airport.time_zone, hour: '2-digit', hourCycle: 'h23' });
  assert.equal(clock.format(Date.parse(scenario.generation_trace[0].scheduled_on_block)), '08');
  assert.equal(clock.format(Date.parse(scenario.generation_trace[0].scheduled_off_block)), '09');
  pattern['departure-hourly-weights'][9] = 0;
  pattern['departure-hourly-weights'][8] = 1;
  assert.throws(() => generateScenario(input, data, 'comfortable'), /No positive weighted time slots/);
});

test('uniform weight scaling does not change generated source legs', () => {
  const data = structuredClone(airport);
  for (const pattern of data.trafficProfile['sector-patterns']) {
    pattern['arrival-hourly-weights'] = pattern['arrival-hourly-weights'].map(weight => weight * 10);
    pattern['departure-hourly-weights'] = pattern['departure-hourly-weights'].map(weight => weight * 5);
  }
  assert.deepEqual(generate('constrained', profile, data).raw_demand, generate('constrained').raw_demand);
});

test('23/25-hour dated horizons preserve explicit visit counts and full UTC timing', () => {
  for (const planWindow of [
    { start: '2026-03-08T08:00:00Z', end: '2026-03-09T07:00:00Z' },
    { start: '2026-11-01T07:00:00Z', end: '2026-11-02T08:00:00Z' },
  ]) {
    const input = { ...structuredClone(profile), plan_window: planWindow };
    const scenario = generate('comfortable', input);
    assert.equal(scenario.expected_visit_count, 36);
    assert.equal(scenario.initial_state.length, 1);
    assert.equal(scenario.final_state.length, 1);
    assert.ok(scenario.raw_demand.legs.every(leg => isUtcInstant(leg.scheduled_on_block ?? leg.scheduled_off_block)));
  }
});

test('departure exactly on the horizon end is not final aircraft presence', () => {
  const input = smallProfile();
  input.sampling_step_minutes = 60;
  const data = structuredClone(airport);
  const pattern = data.trafficProfile['sector-patterns'].find(item => item.sector === 'domestic');
  pattern['arrival-hourly-weights'] = Array(24).fill(0);
  pattern['departure-hourly-weights'] = Array(24).fill(0);
  pattern['arrival-hourly-weights'][6] = 1;
  pattern['departure-hourly-weights'][7] = 1;
  const scenario = generate('comfortable', input, data);
  assert.equal(Date.parse(scenario.generation_trace[0].scheduled_off_block), Date.parse(scenario.plan_window.end));
  assert.deepEqual(scenario.final_state, []);
});

test('invalid catalogs, PAX ranges and incompatible mix fail instead of inventing permissions', () => {
  for (const [key, value, message] of [
    ['aircraft_id', 'unknown', /Unknown scenario aircraft/],
    ['operating_airline_id', 'unknown', /Unknown scenario airline/],
    ['arrival_sector_id', 'unknown', /Unknown scenario sector/],
    ['passenger_max', 147, /seat count/],
    ['passenger_min', 147, /seat count/],
    ['departure_sector_id', 'transborder', /no compatible continuous-stay stand/],
    ['minimum_stay_minutes', 101, /Invalid scenario stay range/],
  ]) {
    const input = structuredClone(profile);
    input.traffic_mix[0][key] = value;
    assert.throws(() => generateScenario(input, airport, 'comfortable'), message);
  }
});

test('invalid profile shape, duplicate row IDs and unsupported bounded workloads are explicit', () => {
  const cases = [
    [input => { input.bogus = true; }, /Invalid scenario profile/],
    [input => { input.traffic_mix.push(input.traffic_mix[0]); }, /Duplicate/],
    [input => { input.cases.push(input.cases[0]); }, /Duplicate/],
    [input => { input.external_airport_ids.push('contoso'); }, /External route/],
    [input => { input.traffic_mix[0].count = 200; }, /1 through 200/],
    [input => { input.plan_window.end = input.plan_window.start; }, /1 through 48/],
    [input => { input.boundary_visits[0].arrival_offset_minutes = -1400; }, /linking\/context bounds/],
    [input => { input.cases[0].expectations.minimum_generated_movements = 2; }, /expectation bounds/],
  ];
  for (const [change, message] of cases) {
    const input = structuredClone(profile);
    change(input);
    assert.throws(() => generateScenario(input, airport, 'comfortable'), message);
  }
  assert.throws(() => generateScenario(profile, airport, 'unknown'), /Unknown scenario case/);
  assert.throws(() => generateScenario({ ...profile, airport_id: 'unknown' }, airport, 'comfortable'), /airport_id/);
});

test('generator does not mutate the original 16-leg validation fixture', () => {
  const before = loadDemand();
  generate();
  generate('constrained');
  assert.deepEqual(loadDemand(), before);
  assert.equal(before.legs.length, 16);
});

test('native comfortable plan covers all visits with zero elective movements', () => {
  const result = solve(generate());
  assert.equal(result.summary.expectations_passed, true);
  assert.equal(result.summary.context_flight_legs, 3);
  assert.equal(result.summary.in_horizon_flight_legs, 69);
  for (const metrics of Object.values(result.summary.metrics)) {
    assert.equal(metrics.solver_status, 'optimal');
    assert.equal(metrics.complete_assignment, true);
    assert.equal(metrics.assigned_visits, 36);
    assert.equal(metrics.assigned_flight_legs, 72);
    assert.equal(metrics.unassigned_visits, 0);
    assert.equal(metrics.generated_tows, 0);
    assert.equal(metrics.initial_state[0].status, 'on-stand');
    assert.equal(metrics.final_state[0].status, 'on-stand');
  }
});

test('native constrained plan gains exactly one visit with exactly one tow pair', () => {
  const result = solve(generate('constrained'));
  const baseline = result.summary.metrics.baseline;
  const variant = result.summary.metrics['tow-options'];
  assert.equal(result.summary.expectations_passed, true);
  assert.equal(result.summary.coverage_gain, 2);
  assert.equal(baseline.assigned_visits, 40);
  assert.equal(baseline.unassigned_visits, 1);
  assert.equal(baseline.complete_assignment, false);
  assert.equal(variant.assigned_visits, 41);
  assert.equal(variant.assigned_flight_legs, 82);
  assert.equal(variant.generated_tows, 2);
  assert.equal(variant.complete_assignment, true);
  assert.equal(variant.stand_validation_passed, true);
  assert.equal(variant.unresolved_segment_count, 0);
  assert.equal(variant.blocked_source_leg_count, 0);
});

test('stand measurements use clipped occupancy and conserve occupied plus unoccupied horizon time', () => {
  const result = solve(generate());
  const duration = (Date.parse(result.scenario.plan_window.end) - Date.parse(result.scenario.plan_window.start)) / 60_000;
  for (const metrics of Object.values(result.summary.metrics)) {
    assert.equal(metrics.contact_service_flight_legs + metrics.remote_service_flight_legs, metrics.assigned_flight_legs);
    for (const stand of metrics.stands) {
      assert.ok(Math.abs(stand.occupied_minutes + stand.unoccupied_minutes - duration) < 1e-8);
      const gapMinutes = stand.unoccupied_intervals.reduce((sum, interval) => sum + (Date.parse(interval.end) - Date.parse(interval.start)) / 60_000, 0);
      assert.ok(Math.abs(gapMinutes - stand.unoccupied_minutes) < 1e-8);
      assert.ok(stand.utilization_fraction >= 0 && stand.utilization_fraction <= 1);
    }
  }
  assert.equal(result.summary.operationally_ready, false);
  result.summary.operationally_ready = true;
  assert.equal(runShape(result), false);
});

test('known aircraft being towed across either horizon boundary are reported in transit', () => {
  for (const anchor of ['plan-start', 'plan-end']) {
    const input = smallProfile();
    input.traffic_mix = [];
    input.boundary_visits = [{
      ...structuredClone(profile.boundary_visits[0]), aircraft_id: 'B789',
      arrival_sector_id: 'international', departure_sector_id: 'international',
      passenger_min: 180, passenger_max: 269, anchor,
      arrival_offset_minutes: anchor === 'plan-start' ? -60 : -360,
      departure_offset_minutes: anchor === 'plan-start' ? 300 : 72,
    }];
    input.cases[0].pressure_banks = structuredClone(profile.cases[1].pressure_banks);
    input.cases[0].expectations = {
      baseline_complete: false, variant_complete: true, minimum_coverage_gain: 4,
      minimum_generated_movements: 4, maximum_generated_movements: 4,
    };
    const data = structuredClone(airport);
    const pattern = data.trafficProfile['sector-patterns'].find(item => item.sector === 'international');
    const hour = anchor === 'plan-start' ? 9 : 3;
    pattern['arrival-hourly-weights'] = Array(24).fill(0);
    pattern['departure-hourly-weights'] = Array(24).fill(0);
    pattern['arrival-hourly-weights'][hour] = 1;
    pattern['departure-hourly-weights'][hour + 1] = 1;
    const result = solve(generate('comfortable', input, data), data);
    assert.equal(result.summary.expectations_passed, true);
    const states = anchor === 'plan-start'
      ? result.summary.metrics['tow-options'].initial_state : result.summary.metrics['tow-options'].final_state;
    assert.equal(states[0].status, 'in-transit');
    assert.ok(result.comparison.variants['tow-options'].generated_movements.some(movement => movement.id === states[0].movement_id));
    assert.equal(states[0].stand_id, undefined);
  }
});

test('unmet expectations and unassigned boundary aircraft remain visible, never default to a stand', () => {
  const scenario = generate();
  const data = structuredClone(airport);
  for (const stand of data.stands.stands) stand.closed = true;
  const result = solve(scenario, data);
  assert.equal(result.summary.expectations_passed, false);
  assert.equal(result.summary.metrics.baseline.assigned_flight_legs, 0);
  assert.equal(result.summary.metrics.baseline.initial_state[0].status, 'unassigned');
  assert.equal(result.summary.metrics.baseline.initial_state[0].stand_id, undefined);
  const comparison = structuredClone(result.comparison);
  comparison.demand_id = 'wrong';
  assert.throws(() => summarizeScenario(scenario, comparison, data), /identity/);
  comparison.demand_id = scenario.raw_demand.id;
  comparison.preparation.baseline.plan_window.end = '2026-10-23T14:00:00Z';
  assert.throws(() => summarizeScenario(scenario, comparison, data), /identity/);
});

test('scenario schema rejects invented source stand assignments', () => {
  const scenario = generate('comfortable', smallProfile());
  scenario.initial_state.push({
    aircraft_registration: 'test', aircraft_id: 'A320', arrival_leg_id: 'a', departure_leg_id: 'd',
    evidence: 'scheduled-source-legs', stand_status: 'unassigned', stand_id: 'invented',
  });
  assert.equal(shape(scenario), false);
});

const cliPath = fileURLToPath(new URL('./generate-scenario.mjs', import.meta.url));
const cli = args => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
test('CLI generates demand without .NET, writes exclusively and keeps diagnostics off stdout', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mica-scenario-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, 'scenario.json');
  const result = cli(['--case', 'comfortable', '--output', output]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const saved = readFileSync(output, 'utf8');
  assert.ok(shape(JSON.parse(saved)), ajv.errorsText(shape.errors));
  const duplicate = cli(['--case', 'comfortable', '--output', output]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /EEXIST/);
  assert.equal(readFileSync(output, 'utf8'), saved);
  const stdout = cli(['--case', 'comfortable']);
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.ok(shape(JSON.parse(stdout.stdout)), ajv.errorsText(shape.errors));
  for (const args of [[], ['--case', 'unknown'], ['--bogus'], ['--case', 'comfortable', '--time-limit-seconds', '5']]) {
    assert.equal(cli(args).status, 1);
  }
});

test('CLI native review checks outcomes and signals expectation failures', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mica-scenario-run-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'profile.json');
  const input = smallProfile();
  writeFileSync(path, JSON.stringify(input));
  const result = cli(['--case', 'comfortable', '--profile', path, '--solve']);
  assert.equal(result.status, 3, result.stderr);
  assert.ok(runShape(JSON.parse(result.stdout)), ajv.errorsText(runShape.errors));
  assert.match(result.stderr, /Gantt are unchanged/);
  input.cases[0].expectations.minimum_coverage_gain = 2;
  writeFileSync(path, JSON.stringify(input));
  const failed = cli(['--case', 'comfortable', '--profile', path, '--solve']);
  assert.equal(failed.status, 2, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).summary.expectations_passed, false);
  assert.match(failed.stderr, /FAIL minimum-coverage-gain/);
});
