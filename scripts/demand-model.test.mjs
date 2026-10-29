import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileAirport, getMinimumLegWindow, loadAirport } from './airport-model.mjs';
import { loadDemand, validateDemand } from './demand-model.mjs';

const airport = loadAirport();
const seed = loadDemand();
const fixture = () => structuredClone(seed);
const check = value => validateDemand(value, airport);
const leg = (demand, id) => demand.legs.find(item => item.id === `contoso:${id}`);

test('fixed Contoso seed validates and contains all three raw leg types', () => {
  assert.deepEqual(check(seed), { errors: [], warnings: [] });
  assert.equal(seed.synthetic, true);
  assert.equal(seed.legs.length, 16);
  assert.deepEqual(['arrival', 'departure', 'ground-movement'].map(type =>
    seed.legs.filter(item => item.type === type).length), [6, 7, 3]);
  assert.deepEqual(loadDemand(), seed);
  for (const item of seed.legs) {
    for (const derived of ['visit_id', 'stand_id', 'actual_on_block', 'actual_off_block']) {
      assert.equal(Object.hasOwn(item, derived), false);
    }
  }
});

test('validation is independent of ordering and does not infer, link or mutate input', () => {
  const demand = fixture();
  const before = structuredClone(demand);
  const airportBefore = structuredClone(airport);
  assert.deepEqual(check(demand), { errors: [], warnings: [] });
  assert.deepEqual(demand, before);
  assert.deepEqual(airport, airportBefore);
  demand.legs.reverse();
  assert.deepEqual(check(demand), { errors: [], warnings: [] });
  for (const id of ['movement:off-block-only', 'movement:on-block-only']) {
    assert.deepEqual(leg(demand, id), leg(before, id));
  }
});

test('IDs and the local airport are configurable rather than hardcoded to Contoso', () => {
  const data = structuredClone(airport);
  data.airport.id = 'other:airport';
  for (const name of ['stands', 'gates', 'buildings', 'trafficProfile', 'operatingPolicy']) {
    data[name].airport_id = data.airport.id;
  }
  const demand = fixture();
  demand.airport_id = data.airport.id;
  for (const item of demand.legs) {
    for (const field of ['origin_airport_id', 'destination_airport_id']) {
      if (item[field] === 'contoso') item[field] = data.airport.id;
    }
  }
  assert.deepEqual(validateDemand(demand, data), { errors: [], warnings: [] });
});

test('empty snapshots, unknown PAX and zero PAX are valid and distinct', () => {
  const demand = fixture();
  assert.equal(leg(demand, 'unmatched:arrival').passenger_count, 0);
  assert.equal(leg(demand, 'unmatched:departure').passenger_count, null);
  demand.legs = [];
  assert.deepEqual(check(demand), { errors: [], warnings: [] });
  demand.synthetic = false;
  assert.deepEqual(check(demand), { errors: [], warnings: [] });
});

test('documented normal and long-stay cases have exact configured handling boundaries', () => {
  const model = compileAirport(airport);
  const expected = [
    ['normal', '2026-10-21T15:45:00.000Z', '2026-10-21T15:15:00.000Z', -30],
    ['long-c', '2026-10-21T17:45:00.000Z', '2026-10-21T21:15:00.000Z', 210],
    ['long-e', '2026-10-21T17:00:00.000Z', '2026-10-21T22:00:00.000Z', 300],
  ];
  for (const [name, arrivalEnd, departureStart, gapMinutes] of expected) {
    const arrival = leg(seed, `${name}:arrival`);
    const departure = leg(seed, `${name}:departure`);
    assert.equal(arrival.aircraft_registration, departure.aircraft_registration);
    const arrivalWindow = getMinimumLegWindow(model, arrival.aircraft_id, 'arrival', Date.parse(arrival.scheduled_on_block));
    const departureWindow = getMinimumLegWindow(model, departure.aircraft_id, 'departure', Date.parse(departure.scheduled_off_block));
    assert.equal(new Date(arrivalWindow.end).toISOString(), arrivalEnd);
    assert.equal(new Date(departureWindow.start).toISOString(), departureStart);
    assert.equal((departureWindow.start - arrivalWindow.end) / 60_000, gapMinutes);
  }
  assert.notEqual(leg(seed, 'long-c:arrival').sector_id, leg(seed, 'long-c:departure').sector_id);
});

test('midnight case crosses the airport-local date despite sharing a UTC date', () => {
  const arrival = leg(seed, 'midnight:arrival');
  const departure = leg(seed, 'midnight:departure');
  assert.equal(arrival.aircraft_registration, departure.aircraft_registration);
  assert.equal(arrival.scheduled_on_block.slice(0, 10), departure.scheduled_off_block.slice(0, 10));
  const formatter = new Intl.DateTimeFormat('en', { timeZone: airport.airport.time_zone, day: '2-digit' });
  assert.equal(formatter.format(new Date(arrival.scheduled_on_block)), '21');
  assert.equal(formatter.format(new Date(departure.scheduled_off_block)), '22');
  assert.equal((Date.parse(departure.scheduled_off_block) - Date.parse(arrival.scheduled_on_block)) / 60_000, 120);
});

test('unmatched and ambiguous examples remain raw, without fabricated connection decisions', () => {
  for (const id of ['unmatched:arrival', 'unmatched:departure']) {
    const item = leg(seed, id);
    assert.equal(seed.legs.filter(other => other.aircraft_registration === item.aircraft_registration).length, 1);
  }
  const arrival = leg(seed, 'ambiguous:arrival');
  const candidates = seed.legs.filter(item => item.aircraft_registration === arrival.aircraft_registration && item.type === 'departure');
  assert.deepEqual(candidates.map(item => item.id), ['contoso:ambiguous:departure-a', 'contoso:ambiguous:departure-b']);
  assert.deepEqual(check(seed), { errors: [], warnings: [] });
});

test('ground examples retain explicit duration and either single time anchor', () => {
  const both = leg(seed, 'movement:both-times');
  assert.equal((Date.parse(both.scheduled_on_block) - Date.parse(both.scheduled_off_block)) / 60_000, 15);
  assert.equal(Object.hasOwn(leg(seed, 'movement:off-block-only'), 'scheduled_on_block'), false);
  assert.equal(Object.hasOwn(leg(seed, 'movement:on-block-only'), 'scheduled_off_block'), false);
});

const invalid = [
  ['wrong version', data => { data.schema_version = '2.0.0'; }, /schema_version/],
  ['wrong airport', data => { data.airport_id = 'elsewhere'; }, /airport_id/],
  ['unknown snapshot field', data => { data.seed = 42; }, /additional properties.*seed/],
  ['unknown leg field', data => { data.legs[0].actual_on_block = '2026-10-21T15:00:00Z'; }, /actual_on_block/],
  ['prelinked visit', data => { data.legs[0].visit_id = 'visit'; }, /visit_id/],
  ['preassigned flight', data => { data.legs[0].stand_id = 't1:stand:101'; }, /stand_id/],
  ['duplicate leg ID', data => { data.legs[1].id = data.legs[0].id; }, /duplicate leg ID/],
  ['unknown type', data => { data.legs[0].type = 'turn'; }, /type/],
  ['numeric ID', data => { data.legs[0].id = 123; }, /id/],
  ['blank registration', data => { data.legs[0].aircraft_registration = ' '; }, /aircraft_registration/],
  ['unknown aircraft', data => { data.legs[0].aircraft_id = 'unknown'; }, /aircraft_id: unknown reference/],
  ['case-sensitive model', data => { data.legs[0].aircraft_id = 'a320'; }, /aircraft_id: unknown reference/],
  ['unknown airline', data => { data.legs[0].operating_airline_id = 'unknown'; }, /operating_airline_id: unknown reference/],
  ['unknown sector', data => { data.legs[0].sector_id = 'unknown'; }, /sector_id: unknown reference/],
  ['arrival at wrong airport', data => { data.legs[0].destination_airport_id = 'airport:SFO'; }, /arrival must end/],
  ['departure at wrong airport', data => { data.legs[1].origin_airport_id = 'airport:SFO'; }, /departure must start/],
  ['conflicting models for one registration', data => { data.legs[1].aircraft_id = 'B738'; }, /conflicting aircraft models/],
  ['negative PAX', data => { data.legs[0].passenger_count = -1; }, /passenger_count/],
  ['fractional PAX', data => { data.legs[0].passenger_count = 1.5; }, /passenger_count/],
  ['string PAX', data => { data.legs[0].passenger_count = 'unknown'; }, /passenger_count/],
  ['unsafe PAX integer', data => { data.legs[0].passenger_count = Number.MAX_SAFE_INTEGER + 1; }, /passenger_count/],
  ['departure timestamp on arrival', data => { data.legs[0].scheduled_off_block = '2026-10-21T16:00:00Z'; }, /scheduled_off_block/],
  ['arrival timestamp on departure', data => { data.legs[1].scheduled_on_block = '2026-10-21T15:00:00Z'; }, /scheduled_on_block/],
  ['flight stand endpoint', data => { data.legs[0].origin_stand_id = 't1:stand:101'; }, /origin_stand_id/],
  ['ground movement without time', data => {
    const item = leg(data, 'movement:both-times');
    delete item.scheduled_off_block;
    delete item.scheduled_on_block;
  }, /scheduled_(off|on)_block/],
  ['ground flight metadata', data => { leg(data, 'movement:both-times').sector_id = 'domestic'; }, /sector_id/],
  ['unknown movement origin', data => { leg(data, 'movement:both-times').origin_stand_id = 'unknown'; }, /origin_stand_id: unknown reference/],
  ['unknown movement destination', data => { leg(data, 'movement:both-times').destination_stand_id = 'unknown'; }, /destination_stand_id: unknown reference/],
  ['same movement endpoints', data => {
    const item = leg(data, 'movement:both-times');
    item.destination_stand_id = item.origin_stand_id;
  }, /different origin and destination/],
  ['zero movement duration', data => {
    const item = leg(data, 'movement:both-times');
    item.scheduled_on_block = item.scheduled_off_block;
  }, /later than/],
  ['negative movement duration', data => { leg(data, 'movement:both-times').scheduled_on_block = '2026-10-21T18:59:00Z'; }, /later than/],
];

test('invalid shapes, references and movement intervals are rejected explicitly', async t => {
  for (const [name, change, message] of invalid) {
    await t.test(name, () => {
      const demand = fixture();
      change(demand);
      assert.match(check(demand).errors.join('\n'), message);
    });
  }
});

test('required fields cannot be omitted from any leg type', async t => {
  const common = ['id', 'type', 'aircraft_id', 'aircraft_registration', 'operating_airline_id'];
  const flight = ['flight_number', 'sector_id', 'origin_airport_id', 'destination_airport_id', 'passenger_count'];
  for (const [id, fields] of [
    ['normal:arrival', [...common, ...flight, 'scheduled_on_block']],
    ['normal:departure', [...common, ...flight, 'scheduled_off_block']],
    ['movement:both-times', [...common, 'origin_stand_id', 'destination_stand_id']],
  ]) {
    for (const field of fields) {
      await t.test(`${id} requires ${field}`, () => {
        const demand = fixture();
        delete leg(demand, id)[field];
        assert.ok(check(demand).errors.length);
      });
    }
  }
});

test('timestamps require real UTC dates with whole seconds or exact milliseconds', async t => {
  for (const value of [
    '2026-02-29T15:00:00Z', '2026-04-31T15:00:00Z', '2026-13-01T15:00:00Z',
    '2026-10-21T24:00:00Z', '2026-10-21T15:00:60Z', '2026-10-21T15:00:00',
    '2026-10-21T08:00:00-07:00', '2026-10-21', '2026-10-21T15:00:00.1234Z',
    1792594800000, null,
  ]) {
    await t.test(String(value), () => {
      const demand = fixture();
      demand.legs[0].scheduled_on_block = value;
      assert.ok(check(demand).errors.length);
    });
  }
  for (const value of ['2028-02-29T15:00:00Z', '2026-10-21T15:00:00.123Z']) {
    const demand = fixture();
    demand.legs[0].scheduled_on_block = value;
    assert.deepEqual(check(demand), { errors: [], warnings: [] });
  }
});

test('malformed root input and invalid airport configuration are reported, not ignored', () => {
  for (const value of [null, [], {}, { ...seed, legs: null }]) assert.ok(check(value).errors.length);
  const data = structuredClone(airport);
  data.stands.stands[0].gate_ids = ['missing'];
  assert.match(validateDemand(seed, data).errors.join('\n'), /airport:.*unknown reference/);
});

test('documentation leg examples validate against the same contract', () => {
  const text = readFileSync(fileURLToPath(new URL('../docs/raw-demand.md', import.meta.url)), 'utf8');
  const examples = [...text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
  assert.equal(examples.length, 2);
  for (const [, json] of examples) {
    const demand = fixture();
    demand.legs = [JSON.parse(json)];
    assert.deepEqual(check(demand), { errors: [], warnings: [] });
  }
});

test('CLI validates from another working directory and fails explicitly on bad inputs', () => {
  const cli = fileURLToPath(new URL('./validate-demand.mjs', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'gtaa-demand-'));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' });
  try {
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /16 legs \(6 arrival, 7 departure, 3 ground movement\)/);
    assert.match(success.stdout, /no visit linking/);
    const input = join(directory, 'input.json');
    writeFileSync(input, JSON.stringify(seed));
    assert.equal(run(input).status, 0);
    writeFileSync(input, '{"legs":');
    assert.match(run(input).stderr, /Cannot read JSON/);
    assert.equal(run(input).status, 1);
    writeFileSync(input, JSON.stringify({ ...seed, airport_id: 'wrong' }));
    assert.match(run(input).stderr, /Demand validation failed/);
    assert.equal(run(input).status, 1);
    assert.equal(run(join(directory, 'missing.json')).status, 1);
    const tooMany = run('one', 'two', 'three');
    assert.equal(tooMany.status, 1);
    assert.match(tooMany.stderr, /Usage:/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
