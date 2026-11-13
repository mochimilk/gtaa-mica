import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileAirport, evaluatePlan, loadAirport, readJson } from './airport-model.mjs';
import { fingerprint, prepareCapacitySnapshot, sourceOccupancies } from './capacity-probe.mjs';
import { generateScenario, loadScenarioProfile } from './scenario-generator.mjs';
import { atlasDayParameters, loadAtlasProfile, prepareCapacityAtlas, replayAtlasDay, validateAtlasProfile } from './capacity-atlas.mjs';

const airport = loadAirport(fileURLToPath(new URL('../data/airports/contoso/airport.json', import.meta.url)));
const snapshot = readJson(new URL('../src/data-sources/prepared/contoso/full-day.json', import.meta.url));
const capacity = readJson(new URL('../src/data-sources/prepared/contoso/full-day.capacity.json', import.meta.url));
const prepared = readJson(new URL('../src/data-sources/prepared/contoso/full-day.atlas.json', import.meta.url));
const profile = loadAtlasProfile(new URL('../data/airports/contoso/evaluation/capacity-atlas-profile.json', import.meta.url));
const scenario = loadScenarioProfile(new URL('../data/airports/contoso/demand/full-day-profile.json', import.meta.url));
const raw = generateScenario(scenario, airport, 'full-day').raw_demand;
const origin = Date.parse(snapshot.plan_window.start);
const minute = 60_000;

test('Atlas CLI requires every source explicitly', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./prepare-atlas.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /explicit --airport/);
});

test('Atlas profiles reject calendar overflow, inverted ranges and unsupported values', () => {
  for (const bad of [null, {}, { ...profile, schema_version: '2' }, { ...profile, hidden: true },
    { ...profile, start_date: '2026-02-30' }, { ...profile, day_count: 0 }, { ...profile, day_count: 32 },
    { ...profile, planned_shift_minutes: [10, -10] }, { ...profile, outcome_shift_minutes: [-121, 0] },
    { ...profile, planned_scale_basis_points: [0, 10000] }]) assert.throws(() => validateAtlasProfile(bad), /atlas/i);
});

test('seeded parameters are reproducible and timing transforms compose without changing identities', () => {
  const parameters = atlasDayParameters(profile, profile.start_date);
  assert.deepEqual(parameters, prepared.days[0].parameters);
  assert.deepEqual(atlasDayParameters(profile, profile.start_date), parameters);
  const items = [{ id: 'one', standId: 'A', start: origin + 10 * minute, end: origin + 20 * minute }];
  const changed = { planned_shift_minutes: -2, planned_scale_basis_points: 10500,
    outcome_shift_minutes: 3, outcome_scale_basis_points: 10200 };
  assert.deepEqual(replayAtlasDay(items, origin, changed), [{ ...items[0], start: origin + 8.5 * minute, end: origin + 19 * minute }]);
  assert.deepEqual(replayAtlasDay(items, origin, changed, true), [{
    ...items[0], start: origin + Math.round(8.5 * minute * 1.02) + 3 * minute,
    end: origin + Math.round(19 * minute * 1.02) + 3 * minute,
  }]);
  assert.equal(items[0].start, origin + 10 * minute);
});

test('fresh Atlas reproduces exactly and every replay preserves the fixed plan and authoritative feasibility', () => {
  const before = fingerprint([snapshot, raw, airport, capacity, profile]);
  assert.deepEqual(prepareCapacityAtlas(snapshot, raw, airport, capacity, profile), prepared);
  const model = compileAirport(airport), fixed = sourceOccupancies(snapshot, raw);
  for (const day of prepared.days) for (const [variant, phases] of Object.entries(day.variants)) {
    for (const [phase, probes] of Object.entries(phases)) {
      const replay = replayAtlasDay(fixed[variant], origin, day.parameters, phase === 'end_of_day');
      assert.deepEqual(replay.map(({ id, standId }) => [id, standId]), snapshot.variants[variant].stays.map(stay => [stay.id, stay.rowId]));
      assert.deepEqual(evaluatePlan(model, replay), [], `${day.date}/${variant}/${phase}`);
      for (const probe of probes) {
        const definition = capacity.profile.probes.find(item => item.id === probe.id);
        const duration = definition.default_duration_minutes * minute;
        for (const row of probe.rows) for (const [left, right] of row.windows) {
          if (left + duration > right) continue;
          for (const offset of new Set([left, right - duration])) {
            const extra = {
              id: 'atlas-test', standId: row.stand_id, start: origin + offset, end: origin + offset + duration,
              aircraftId: definition.aircraft_id, operatingAirlineIds: [definition.operating_airline_id],
              arrival: { sectorId: definition.arrival_sector_id, operatingAirlineId: definition.operating_airline_id },
              departure: { sectorId: definition.departure_sector_id, operatingAirlineId: definition.operating_airline_id },
            };
            assert.deepEqual(evaluatePlan(model, [...replay, extra]), [], `${day.date}/${variant}/${phase}/${probe.id}/${row.stand_id}`);
          }
        }
      }
    }
  }
  assert.equal(fingerprint([snapshot, raw, airport, capacity, profile]), before);
});

test('Atlas rejects stale capacity content, source identities and either request', () => {
  const short = { ...profile, day_count: 1 };
  for (const mutate of [
    value => { value.airport_id = 'other'; }, value => { value.case_id = 'other'; },
    value => { value.demand_id += ':stale'; }, value => { value.airport_fingerprint = '0'.repeat(64); },
    value => { value.variants.baseline.request_fingerprint = '0'.repeat(64); },
    value => { value.variants['tow-options'].request_fingerprint = '0'.repeat(64); },
    value => { value.variants.baseline.probes[0].rows.pop(); },
  ]) {
    const changed = structuredClone(capacity); mutate(changed);
    assert.throws(() => prepareCapacityAtlas(snapshot, raw, airport, changed, short), /authoritative/);
  }
  assert.throws(() => prepareCapacityAtlas(snapshot, raw, airport, capacity, { ...short, id: 'other:atlas' }), /authoritative/);
  const changed = structuredClone(snapshot);
  changed.case_id = 'other';
  assert.throws(() => prepareCapacityAtlas(changed, raw, airport, capacity, short));
});

test('Atlas preparation is not hardcoded to Contoso airport identity', () => {
  const otherAirport = structuredClone(airport), otherSnapshot = structuredClone(snapshot), otherRaw = structuredClone(raw);
  otherAirport.airport.id = 'example';
  for (const document of Object.values(otherAirport)) {
    if (document && typeof document === 'object' && Object.hasOwn(document, 'airport_id')) document.airport_id = 'example';
  }
  otherSnapshot.airport.id = 'example';
  otherRaw.airport_id = 'example';
  const otherCapacity = prepareCapacitySnapshot(otherSnapshot, otherRaw, otherAirport, { ...capacity.profile, id: 'example:capacity' });
  const result = prepareCapacityAtlas(otherSnapshot, otherRaw, otherAirport, otherCapacity, { ...profile, id: 'example:atlas', day_count: 1 });
  assert.equal(result.airport_id, 'example');
  assert.equal(result.days.length, 1);
});
