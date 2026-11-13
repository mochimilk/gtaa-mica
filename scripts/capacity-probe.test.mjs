import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAirport, evaluatePlan, loadAirport, readJson } from './airport-model.mjs';
import { calculateCapacityWindows, loadCapacityProfile, prepareCapacitySnapshot, validateCapacityProfile } from './capacity-probe.mjs';
import { generateScenario, loadScenarioProfile } from './scenario-generator.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const minute = 60_000;
const epoch = Date.parse('2026-10-24T00:00:00Z');
const time = value => epoch + value * minute;
const iso = value => new Date(time(value)).toISOString();
const probe = {
  id: 'test', label: 'Test', aircraft_id: 'S', operating_airline_id: 'airline:ONE',
  arrival_sector_id: 'domestic', departure_sector_id: 'domestic',
  default_duration_minutes: 75, separation_minutes: 0,
};
function fixture() {
  return {
    airport: { id: 'test', datasets: { stands: 'stands.json', gates: 'gates.json', buildings: 'buildings.json' } },
    stands: { schema_version: '2.0.0', airport_id: 'test', stands: ['A', 'B', 'C'].map(id => ({
      id, code: id, name: id, coordinates: [-122, 47], contact: true, closed: false, gate_ids: [], configuration_status: 'ready',
      'arrival-sector-group': 'both', 'departure-sector-group': 'both',
      'aircraft-groups': ['small', 'large'], 'airline-groups': ['all'],
      'close-conditions': [], 'restriction-conditions': [],
    })) },
    gates: { airport_id: 'test', gates: [] },
    buildings: { airport_id: 'test', buildings: [] },
    aircraft: { aircraft: [{ id: 'S' }, { id: 'L' }] },
    aircraftGroups: { 'aircraft-groups': [{ id: 'small', 'aircraft-ids': ['S'] }, { id: 'large', 'aircraft-ids': ['L'] }] },
    sectors: { sectors: [{ id: 'domestic' }, { id: 'international' }] },
    sectorGroups: { 'sector-groups': [{ id: 'both', sectors: ['domestic', 'international'] }, { id: 'domestic-only', sectors: ['domestic'] }] },
    airlines: { airlines: [{ id: 'airline:ONE', name: 'One', country: 'Test' }, { id: 'airline:TWO', name: 'Two', country: 'Test' }] },
    airlineGroups: { groups: [{ id: 'all', name: 'All', airlines: ['airline:ONE'] }, { id: 'other', name: 'Other', airlines: ['airline:TWO'] }] },
  };
}
const occupancy = (id, standId, start, end, extra = {}) => ({
  id, standId, start: time(start), end: time(end), aircraftId: 'S', operatingAirlineIds: ['airline:ONE'],
  arrival: { sectorId: 'domestic', operatingAirlineId: 'airline:ONE' },
  departure: { sectorId: 'domestic', operatingAirlineId: 'airline:ONE' }, ...extra,
});
const condition = stand => ({ stand, category: 'fit', description: 'Test adjacency constraint' });
const run = (data, items = [], input = probe) => calculateCapacityWindows(compileAirport(data), items, input, [time(0), time(240)]);
const ranges = row => row.windows.map(window => [window.start, window.end]);

test('capacity preparation requires explicit source arguments instead of airport defaults', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./prepare-capacity.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /explicit --airport/);
});

test('capacity profiles are versioned, strict and require unique known defaults', () => {
  const profile = loadCapacityProfile();
  assert.equal(profile.metric_id, 'airport-single-turn-capacity');
  for (const change of [
    null, {}, { ...profile, metric_version: '2' }, { ...profile, default_probe_id: 'unknown' },
    { ...profile, probes: [probe, probe] }, { ...profile, hiddenWeight: 1 },
    ...[-1, NaN, 121, 0.5].map(separation_minutes => ({ ...profile, probes: [{ ...profile.probes[0], separation_minutes }] })),
  ]) assert.throws(() => validateCapacityProfile(change), /capacity|Capacity/);
});

test('empty eligible stands include the entire horizon, including both boundary opportunities', () => {
  const result = run(fixture());
  assert.equal(result.rows.length, 3);
  for (const row of result.rows) {
    assert.deepEqual(ranges(row), [[iso(0), iso(240)]]);
    assert.deepEqual(row.blocks, []);
    assert.equal(row.windows[0].before, null);
    assert.equal(row.windows[0].after, null);
  }
});

test('same-stand gaps include horizon edges and exact release/arrival boundaries', () => {
  const result = run(fixture(), [occupancy('first', 'A', 60, 120)]);
  const row = result.rows.find(row => row.stand_id === 'A');
  assert.deepEqual(ranges(row), [[iso(0), iso(60)], [iso(120), iso(240)]]);
  assert.deepEqual(row.windows.map(window => [window.before, window.after]), [[null, 0], [0, null]]);
  assert.deepEqual(row.blocks[0].assignment_ids, ['first']);
  assert.deepEqual(row.blocks[0].reasons, ['stand-overlap']);
});

test('static aircraft, operator, sector and closure permissions use the existing rule evaluator', () => {
  const data = fixture();
  data.stands.stands[0]['aircraft-groups'] = ['large'];
  data.stands.stands[1]['airline-groups'] = ['other'];
  data.stands.stands[2]['arrival-sector-group'] = 'domestic-only';
  const result = run(data, [], { ...probe, arrival_sector_id: 'international' });
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.excluded_stands.map(row => [row.stand_id, row.reasons]), [
    ['A', ['aircraft-not-allowed']], ['B', ['arrival-airline-not-allowed', 'departure-airline-not-allowed', 'occupancy-airline-not-allowed']],
    ['C', ['arrival-sector-not-allowed']],
  ]);
  const closed = fixture();
  closed.stands.stands[0].closed = true;
  closed.stands.stands[1].configuration_status = 'geometry-only';
  assert.deepEqual(run(closed).rows.map(row => row.stand_id), ['C']);
});

test('an existing neighbor can close the probe stand for its actual occupied interval', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [condition('B')];
  const row = run(data, [occupancy('neighbor', 'B', 60, 120)]).rows.find(row => row.stand_id === 'A');
  assert.deepEqual(ranges(row), [[iso(0), iso(60)], [iso(120), iso(240)]]);
  assert.deepEqual(row.blocks[0].rule_paths, ['stands/A/close-conditions/0']);
  assert.deepEqual(row.blocks[0].reasons, ['conditional-closure']);
});

test('a probe cannot close an already assigned neighbor: adjacency is checked in both directions', () => {
  const data = fixture();
  data.stands.stands[1]['close-conditions'] = [condition('A')];
  const row = run(data, [occupancy('protected-neighbor', 'B', 60, 120)]).rows.find(row => row.stand_id === 'A');
  assert.deepEqual(ranges(row), [[iso(0), iso(60)], [iso(120), iso(240)]]);
  assert.deepEqual(row.blocks[0].rule_paths, ['stands/B/close-conditions/0']);
});

test('conditional aircraft and sector restrictions use trigger filters and explicit allow sets', () => {
  const data = fixture();
  data.stands.stands[0]['restriction-conditions'] = [{
    ...condition('B'), 'aircraft-groups': ['large'], allow: { 'aircraft-groups': ['small'], 'arrival-sector-groups': ['domestic-only'] },
  }];
  const existing = [occupancy('wide-neighbor', 'B', 60, 120, { aircraftId: 'L' })];
  assert.deepEqual(ranges(run(data, existing).rows[0]), [[iso(0), iso(240)]]);
  const denied = run(data, existing, { ...probe, arrival_sector_id: 'international' }).rows[0];
  assert.deepEqual(ranges(denied), [[iso(0), iso(60)], [iso(120), iso(240)]]);
  assert.deepEqual(denied.blocks[0].reasons, ['conditional-restriction']);
});

test('overlapping and touching neighbor blocks form one union without manufacturing free time', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [condition('B'), condition('C')];
  const row = run(data, [occupancy('b', 'B', 10, 30), occupancy('c', 'C', 20, 40)]).rows[0];
  assert.deepEqual(ranges(row), [[iso(0), iso(10)], [iso(40), iso(240)]]);
  assert.deepEqual(row.blocks[0].assignment_ids, ['b', 'c']);
  assert.deepEqual(ranges(run(data, [occupancy('b', 'B', 10, 20), occupancy('c', 'C', 20, 30)]).rows[0]), [[iso(0), iso(10)], [iso(30), iso(240)]]);
});

test('context occupancy and configurable same-stand separation are clipped, not dropped or applied to unrelated stands', () => {
  const row = run(fixture(), [occupancy('context', 'A', -10, -2), occupancy('late', 'A', 220, 250)], { ...probe, separation_minutes: 5 }).rows[0];
  assert.deepEqual(ranges(row), [[iso(3), iso(215)]]);
  assert.equal(row.blocks[0].start, iso(0));
  assert.equal(row.blocks[1].end, iso(240));
});

test('invalid fixed plans, catalog references, horizon and probe collisions fail explicitly', () => {
  assert.throws(() => run(fixture(), [occupancy('a', 'A', 0, 10), occupancy('b', 'A', 5, 15)]), /invalid fixed plan/);
  assert.throws(() => run(fixture(), [], { ...probe, aircraft_id: 'unknown' }), /catalog/);
  assert.throws(() => run(fixture(), [], { ...probe, separation_minutes: -1 }), /separation/);
  assert.throws(() => run(fixture(), [occupancy('capacity-probe:test', 'A', 0, 10)]), /collides/);
  assert.throws(() => calculateCapacityWindows(compileAirport(fixture()), [], probe, [0, 0]), /horizon/);
});

test('individual opportunities are not jointly feasible slots', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [condition('B')];
  const model = compileAirport(data);
  assert.equal(calculateCapacityWindows(model, [], probe, [time(0), time(240)]).rows.length, 3);
  assert.ok(evaluatePlan(model, [occupancy('extra-a', 'A', 0, 75), occupancy('extra-b', 'B', 0, 75)]).some(finding => finding.code === 'conditional-closure'));
});

test('all frozen sidecars reproduce without solving, preserve inputs and replay feasible ranges against authoritative rules', () => {
  const airport = loadAirport(), profile = loadCapacityProfile();
  const full = loadScenarioProfile(new URL('../data/airports/contoso/demand/full-day-profile.json', import.meta.url));
  const model = compileAirport(airport);
  for (const caseId of ['full-day']) {
    const snapshot = readJson(new URL(`../src/data-sources/prepared/contoso/${caseId}.json`, import.meta.url));
    const raw = generateScenario(full, airport, caseId).raw_demand;
    assert.throws(() => prepareCapacitySnapshot(null, raw, airport, profile), /Invalid capacity source snapshot/);
    const before = JSON.stringify([snapshot, raw, airport, profile]);
    const prepared = prepareCapacitySnapshot(snapshot, raw, airport, profile);
    assert.deepEqual(prepared, readJson(new URL(`../src/data-sources/prepared/contoso/${caseId}.capacity.json`, import.meta.url)));
    assert.equal(JSON.stringify([snapshot, raw, airport, profile]), before);
    const legs = new Map(raw.legs.map(leg => [leg.id, leg]));
    const visits = new Map(snapshot.visits.map(visit => [visit.turnId, visit]));
    for (const [variant, plan] of Object.entries(prepared.variants)) {
      const source = snapshot.variants[variant].stays.map(stay => ({
        id: stay.id, standId: stay.rowId, aircraftId: visits.get(stay.visitId).aircraftType,
        start: Date.parse(stay.start), end: Date.parse(stay.end), operatingAirlineIds: [`airline:${visits.get(stay.visitId).carrier}`],
        ...(stay.arrivalFlightId ? { arrival: { sectorId: legs.get(stay.arrivalFlightId).sector_id, operatingAirlineId: legs.get(stay.arrivalFlightId).operating_airline_id } } : {}),
        ...(stay.departureFlightId ? { departure: { sectorId: legs.get(stay.departureFlightId).sector_id, operatingAirlineId: legs.get(stay.departureFlightId).operating_airline_id } } : {}),
      }));
      for (const result of plan.probes) {
        const input = profile.probes.find(probe => probe.id === result.id), duration = input.default_duration_minutes * minute;
        for (const row of result.rows) {
          for (const window of row.windows) {
            const earliest = Date.parse(window.start), latest = Date.parse(window.end) - duration;
            if (latest < earliest) continue;
            for (const start of new Set([earliest, latest, Math.floor((earliest + latest) / 2)])) {
              const extra = {
                id: 'replay', standId: row.stand_id, aircraftId: input.aircraft_id, start, end: start + duration,
                operatingAirlineIds: [input.operating_airline_id],
                arrival: { sectorId: input.arrival_sector_id, operatingAirlineId: input.operating_airline_id },
                departure: { sectorId: input.departure_sector_id, operatingAirlineId: input.operating_airline_id },
              };
              assert.deepEqual(evaluatePlan(model, [...source, extra]), [], `${caseId}/${variant}/${result.id}/${row.stand_id}`);
            }
          }
        }
      }
    }
    const changed = structuredClone(raw);
    changed.legs[0].sector_id = 'unknown';
    assert.throws(() => prepareCapacitySnapshot(snapshot, changed, airport, profile), /sector|catalog/);
    changed.legs[0].flight_number = 'WRONG';
    assert.throws(() => prepareCapacitySnapshot(snapshot, changed, airport, profile), /source flight/);
    assert.throws(() => prepareCapacitySnapshot({ ...snapshot, airport: { ...snapshot.airport, id: 'gtaa' } }, raw, airport, profile), /identity/);
    assert.throws(() => prepareCapacitySnapshot(snapshot, raw, airport, { ...profile, id: 'gtaa:capacity' }), /identity/);
  }
});
