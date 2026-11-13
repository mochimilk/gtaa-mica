import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadAirport } from './airport-model.mjs';
import { loadCatalogs } from './airport-catalogs.mjs';
import { validateDemand } from './demand-model.mjs';
import { solveAirport } from './local-assignment.mjs';
import { generateScenario, loadScenarioProfile } from './scenario-generator.mjs';
import { summarizeScenario } from './scenario-report.mjs';
import { loadTowProfile } from './tow-preparation.mjs';

const airport = loadAirport(fileURLToPath(new URL('../data/airports/gtaa/airport.json', import.meta.url)));
const profile = loadScenarioProfile(fileURLToPath(new URL('../data/airports/gtaa/demand/scenario-profile.json', import.meta.url)));
const towProfile = loadTowProfile(fileURLToPath(new URL('../data/airports/gtaa/demand/tow-profile.json', import.meta.url)));
const generate = input => generateScenario(input ?? profile, airport, 'full-day');

test('GTAA profile generates the approved local day, 160 visits and exact sector/market quotas', () => {
  const before = structuredClone({ airport, profile });
  const scenario = generate();
  assert.deepEqual({ airport, profile }, before);
  assert.equal(scenario.expected_visit_count, 160);
  assert.equal(scenario.raw_demand.legs.length, 320);
  assert.deepEqual(validateDemand(scenario.raw_demand, airport), { errors: [], warnings: [] });
  assert.equal(scenario.timing_complete, true);
  assert.deepEqual(scenario.initial_state, []);
  assert.deepEqual(scenario.final_state, []);
  const clock = new Intl.DateTimeFormat('en-CA', {
    timeZone: airport.airport.time_zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  });
  assert.equal(clock.format(Date.parse(scenario.plan_window.start)), '2026-10-28, 00');
  assert.equal(clock.format(Date.parse(scenario.plan_window.end)), '2026-10-29, 00');
  assert.equal(Date.parse(scenario.plan_window.end) - Date.parse(scenario.plan_window.start), 24 * 60 * 60_000);
  const totals = {};
  for (const trace of scenario.generation_trace) {
    assert.equal(trace.arrival_market_id, trace.departure_market_id);
    totals[trace.arrival_market_id] = (totals[trace.arrival_market_id] ?? 0) + 1;
  }
  assert.deepEqual(totals, { asia: 16, domestic: 64, europe: 16, us: 64 });
  for (const target of profile.traffic_targets) {
    const allocation = scenario.traffic_allocation.filter(row => row.target_id === target.id);
    assert.equal(allocation.reduce((sum, row) => sum + row.visit_count, 0), target.count);
    assert.ok(allocation.every(row => row.stand_credit > 0));
    assert.equal(scenario.raw_demand.legs.filter(leg => leg.type === 'arrival' && leg.sector_id === target.sector_id).length,
      target.sector_id === 'international' ? 32 : 64);
  }
});

test('GTAA routes retain Canadian domestic, US transborder and non-US international geography', () => {
  const scenario = generate();
  const airports = new Map(loadCatalogs().airports.airports.map(item => [item.code, item]));
  const aircraft = new Map(airport.aircraft.aircraft.map(item => [item.id, item]));
  assert.equal(new Set(scenario.raw_demand.legs.map(leg => leg.flight_number)).size, 320);
  assert.equal(new Set(scenario.generation_trace.map(row => row.aircraft_registration)).size, 160);
  for (const leg of scenario.raw_demand.legs) {
    const code = leg.type === 'arrival' ? leg.origin_airport_id : leg.destination_airport_id;
    assert.notEqual(code, 'YYZ');
    const endpoint = airports.get(code);
    assert.ok(endpoint);
    if (leg.sector_id === 'domestic') assert.equal(endpoint.country, 'Canada');
    else if (leg.sector_id === 'transborder') assert.equal(endpoint.country, 'United States');
    else assert.ok(!['Canada', 'United States'].includes(endpoint.country));
    assert.ok(leg.aircraft_id.startsWith('gtaa:aircraft:'));
    assert.ok(!/A350-800|EMB175-E2|B777-9/.test(leg.aircraft_id));
    assert.ok(leg.passenger_count <= aircraft.get(leg.aircraft_id).seats);
    const time = Date.parse(leg.scheduled_on_block ?? leg.scheduled_off_block);
    assert.ok(Date.parse(profile.plan_window.start) <= time && time < Date.parse(profile.plan_window.end));
  }
});

test('GTAA seeded generation is stable when configuration collections are reordered', () => {
  const reordered = structuredClone(profile);
  reordered.traffic_mix.reverse();
  reordered.traffic_targets.reverse();
  reordered.route_generation.markets.reverse();
  for (const market of reordered.route_generation.markets) market.airports.reverse();
  assert.deepEqual(generate(reordered), generate());
});

test('native GTAA full day assigns all 160 visits without elective tows and validates both plans', () => {
  const scenario = generate();
  assert.equal(towProfile.maximum_generated_movements, 0);
  const comparison = solveAirport(scenario.raw_demand, airport, {
    planStart: scenario.plan_window.start, planEnd: scenario.plan_window.end, timeLimitSeconds: 30,
  }, towProfile);
  const summary = summarizeScenario(scenario, comparison, airport);
  assert.equal(summary.expectations_passed, true);
  for (const metrics of Object.values(summary.metrics)) {
    assert.equal(metrics.solver_status, 'optimal');
    assert.equal(metrics.assigned_visits, 160);
    assert.equal(metrics.assigned_flight_legs, 320);
    assert.equal(metrics.unassigned_visits, 0);
    assert.equal(metrics.generated_tows, 0);
    assert.equal(metrics.stand_validation_passed, true);
  }
});
