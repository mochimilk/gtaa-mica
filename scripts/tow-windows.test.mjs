import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileAirport, evaluatePlan, readJson } from './airport-model.mjs';
import { loadFrozenScenarioSources } from './prepare-capacity.mjs';
import { assessOneWayTow, prepareTowWindows } from './tow-windows.mjs';
import { sourceOccupancies } from './capacity-probe.mjs';
import { calculateOneWayTowRange, calculateTowStartRanges, mergeTowRanges } from '../src/demo/tow-window-ranges.mjs';

const { airport, sources } = loadFrozenScenarioSources();
const path = relative => fileURLToPath(new URL(relative, import.meta.url));
const minute = 60_000;

function relocationFixture() {
  const data = structuredClone(airport);
  data.aircraftGroups['aircraft-groups'] = [
    { id: 'test:small', 'aircraft-ids': ['B738'] }, { id: 'test:wide', 'aircraft-ids': ['B789'] },
  ];
  data.sectorGroups['sector-groups'] = [
    { id: 'test:all', sectors: data.sectors.sectors.map(item => item.id) },
    { id: 'test:domestic', sectors: ['domestic'] }, { id: 'test:parking', sectors: [] },
  ];
  const template = data.stands.stands.find(stand => stand.configuration_status === 'ready');
  data.stands.stands = ['multi', 'single', 'neighbor', 'parking'].map(id => ({
    ...structuredClone(template), id, code: id, gate_ids: [], configuration_status: 'ready', closed: false,
    'aircraft-groups': id === 'neighbor' ? ['test:wide'] : ['test:small', 'test:wide'],
    'airline-groups': data.airlineGroups.groups.map(item => item.id),
    'arrival-sector-group': id === 'single' ? 'test:domestic' : 'test:all',
    'departure-sector-group': id === 'parking' ? 'test:parking' : id === 'single' ? 'test:domestic' : 'test:all',
    'close-conditions': [], 'restriction-conditions': [],
  }));
  const source = {
    id: 'source', standId: 'multi', aircraftId: 'B738', operatingAirlineIds: ['airline:AAL'], start: 0, end: 120 * minute,
    arrival: { sectorId: 'international', operatingAirlineId: 'airline:AAL' },
    departure: { sectorId: 'domestic', operatingAirlineId: 'airline:AAL' },
  };
  return { data, source };
}

const relocatedPlan = (fixed, source, destination, start, travel) => [
  ...fixed.filter(item => item !== source), { ...source, end: start, departure: undefined },
  { ...source, id: `${source.id}/tow-destination`, standId: destination, start: start + travel, arrival: undefined },
];

test('one-way windows subtract one movement only and preserve exact fits and millisecond boundaries', () => {
  assert.deepEqual(calculateOneWayTowRange(45 * minute, 75 * minute, 12), [45 * minute, 63 * minute]);
  assert.deepEqual(calculateOneWayTowRange(45 * minute, 57 * minute, 12), [45 * minute, 45 * minute]);
  assert.equal(calculateOneWayTowRange(45 * minute, 57 * minute - 1, 12), null);
  for (const args of [[NaN, 0, 12], [0, 100, 0], [0, 100, -1], [0, 100, 0.0000001]]) {
    assert.throws(() => calculateOneWayTowRange(...args), /tow window/);
  }
  assert.deepEqual(mergeTowRanges([[5, 9], [0, 5], [12, 12], [13, 20]]), [[0, 9], [12, 20]]);
  assert.throws(() => mergeTowRanges([[2, 1]]), /Invalid/);
});

test('a single movement releases a multi-sector stand and checks only the destination departure sector', () => {
  const { data, source } = relocationFixture(), model = compileAirport(data);
  const destinations = assessOneWayTow(model, [source], source, 45, 45);
  assert.deepEqual(destinations, [{ stand_id: 'single', earliest_start: 45 * minute, latest_start: 63 * minute }]);
  assert.equal(calculateTowStartRanges(45 * minute, 75 * minute, 12, 60), null);
  for (const start of [45, 54, 63]) assert.deepEqual(evaluatePlan(model, relocatedPlan([source], source, 'single', start * minute, 12 * minute)), []);
  source.arrival.sectorId = 'domestic';
  assert.deepEqual(assessOneWayTow(model, [source], source, 45, 45), destinations);
  assert.throws(() => assessOneWayTow(model, [source, { ...source, id: 'overlap' }], source, 45, 45), /fixed complete visit/);
  assert.throws(() => assessOneWayTow(model, [source], source, 0, 45), /handling policies/);
  assert.throws(() => assessOneWayTow(model, [source], source, 0.0000001, 45), /millisecond/);
});

test('destination occupancy truncates or eliminates a window, allows touching endpoints and does not use a parking-only stand', () => {
  const { data, source } = relocationFixture(), model = compileAirport(data);
  const busy = { id: 'busy', standId: 'single', aircraftId: 'B738', operatingAirlineIds: ['airline:AAL'], start: 0, end: 60 * minute };
  assert.deepEqual(assessOneWayTow(model, [source, busy], source, 45, 45),
    [{ stand_id: 'single', earliest_start: 48 * minute, latest_start: 63 * minute }]);
  busy.end = 75 * minute;
  assert.deepEqual(assessOneWayTow(model, [source, busy], source, 45, 45),
    [{ stand_id: 'single', earliest_start: 63 * minute, latest_start: 63 * minute }]);
  busy.end++;
  assert.deepEqual(assessOneWayTow(model, [source, busy], source, 45, 45), []);
  busy.start = 120 * minute; busy.end = 180 * minute;
  assert.equal(assessOneWayTow(model, [source, busy], source, 45, 45)[0].earliest_start, 45 * minute);
});

test('adjacency restrictions in either direction and static aircraft/airline/sector permissions constrain destinations', () => {
  for (const reverse of [false, true]) {
    const { data, source } = relocationFixture();
    data.stands.stands.find(stand => stand.id === (reverse ? 'neighbor' : 'single'))['close-conditions'] = [
      { stand: reverse ? 'single' : 'neighbor', category: 'fit', description: 'Test adjacency restriction.' },
    ];
    const model = compileAirport(data);
    const neighbor = { id: 'neighbor-stay', standId: 'neighbor', aircraftId: 'B789', operatingAirlineIds: ['airline:AAL'], start: 0, end: 70 * minute };
    const fixed = [source, neighbor], frozen = JSON.stringify(fixed);
    assert.deepEqual(assessOneWayTow(model, fixed, source, 45, 45),
      [{ stand_id: 'single', earliest_start: 58 * minute, latest_start: 63 * minute }]);
    assert.ok(evaluatePlan(model, relocatedPlan(fixed, source, 'single', 58 * minute - 1, 12 * minute)).length);
    assert.deepEqual(evaluatePlan(model, relocatedPlan(fixed, source, 'single', 58 * minute, 12 * minute)), []);
    assert.equal(JSON.stringify(fixed), frozen);
  }
  for (const change of [
    stand => { stand['aircraft-groups'] = ['test:wide']; },
    stand => { stand['airline-groups'] = []; },
    stand => { stand['departure-sector-group'] = 'test:parking'; },
  ]) {
    const { data, source } = relocationFixture();
    change(data.stands.stands.find(stand => stand.id === 'single'));
    assert.deepEqual(assessOneWayTow(compileAirport(data), [source], source, 45, 45), []);
  }
});

test('tow start ranges preserve inclusive exact fits, reject one millisecond short and couple both movements', () => {
  const minute = 60_000, start = Date.parse('2026-10-24T00:00:00Z');
  const exact = calculateTowStartRanges(start, start + 84 * minute, 12, 60);
  assert.deepEqual(exact, { out: [start, start], back: [start + 72 * minute, start + 72 * minute] });
  assert.equal(calculateTowStartRanges(start, start + 84 * minute - 1, 12, 60), null);
  const ranges = calculateTowStartRanges(start, start + 120 * minute, 12, 60);
  assert.deepEqual(ranges, { out: [start, start + 36 * minute], back: [start + 72 * minute, start + 108 * minute] });
  for (const args of [[NaN, start, 12, 60], [start, start, 0, 60], [start, start, 12, -1], [start, start, 0.0000001, 0]]) {
    assert.throws(() => calculateTowStartRanges(...args), /tow window|Tow window/);
  }
});

test('every prepared handling assessment reproduces using linked aircraft-size rules without changing plans or demand', () => {
  for (const { snapshot, raw } of sources) {
    const frozen = JSON.stringify({ snapshot, raw, airport });
    const result = prepareTowWindows(snapshot, raw, airport);
    assert.deepEqual(result, readJson(path(`../src/demo/prepared/${snapshot.case_id}.tow-windows.json`)));
    assert.equal(result.visits.length, snapshot.visits.length);
    assert.equal(result.default_tow_minutes, 12);
    assert.equal(result.movement_kind, 'one-way-relocation');
    for (const item of result.visits) {
      const visit = snapshot.visits.find(visit => visit.turnId === item.visit_id);
      const code = airport.aircraft.aircraft.find(item => item.id === visit.aircraftType)['ICAO-code'];
      const policy = airport.operatingPolicy['minimum-leg-windows'].find(item => item['aircraft-size-codes'].includes(code));
      assert.equal(item.arrival_handling_minutes, policy['arrival-minutes']);
      assert.equal(item.departure_handling_minutes, policy['departure-minutes']);
    }
    const model = compileAirport(airport), fixed = sourceOccupancies(snapshot, raw);
    for (const item of result.visits) for (const variant of ['baseline', 'tow-options']) {
      const assessment = item.variants[variant], source = fixed[variant].find(stay => stay.id === assessment.source_stay_id);
      for (const destination of assessment.destinations) {
        assert.ok(source);
        for (const start of [destination.earliest_start, Math.floor((destination.earliest_start + destination.latest_start) / 2), destination.latest_start]) {
          assert.ok(start - source.start >= item.arrival_handling_minutes * minute);
          assert.ok(source.end - start - 12 * minute >= item.departure_handling_minutes * minute);
          assert.deepEqual(evaluatePlan(model, relocatedPlan(fixed[variant], source, destination.stand_id, start, 12 * minute)), []);
        }
      }
    }
    assert.equal(JSON.stringify({ snapshot, raw, airport }), frozen);
  }
});

test('tow policy preparation accepts another airport identity, timezone and configured policies', () => {
  const { snapshot, raw } = sources[0], alternative = structuredClone(airport), demand = structuredClone(raw);
  alternative.airport.id = 'portable-airport-test';
  alternative.airport.name = 'Portable Airport Test';
  alternative.airport.time_zone = 'America/New_York';
  for (const key of ['operatingPolicy', 'trafficProfile', 'stands', 'gates', 'buildings']) alternative[key].airport_id = alternative.airport.id;
  alternative.operatingPolicy['default-tow-minutes'] = 20;
  demand.airport_id = alternative.airport.id;
  for (const leg of demand.legs) {
    if (leg.type === 'arrival') leg.destination_airport_id = alternative.airport.id;
    if (leg.type === 'departure') leg.origin_airport_id = alternative.airport.id;
  }
  const evidence = prepareTowWindows(snapshot, demand, alternative);
  assert.equal(evidence.airport.id, alternative.airport.id);
  assert.equal(evidence.airport.name, alternative.airport.name);
  assert.equal(evidence.default_tow_minutes, 20);
  assert.equal(evidence.movement_kind, 'one-way-relocation');
  delete alternative.operatingPolicy['default-tow-minutes'];
  assert.throws(() => prepareTowWindows(snapshot, demand, alternative), /travel|policies/);
});
