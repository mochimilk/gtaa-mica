import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import test from 'node:test';
import { loadAirport, readJson } from './airport-model.mjs';
import { isUtcInstant, loadDemand, parseUtcInstant } from './demand-model.mjs';
import { linkDemand } from './visit-linker.mjs';

const airport = loadAirport();
const seed = loadDemand();
const hour = 3_600_000;
const base = Date.parse('2026-10-21T00:00:00Z');
const at = hours => new Date(base + hours * hour).toISOString();
const window = hours => ({ planStart: at(0), planEnd: at(hours) });
const fullDay = { planStart: '2026-10-21T14:00:00Z', planEnd: '2026-10-22T14:00:00Z' };
const demand = legs => ({ ...structuredClone(seed), legs });
const flight = (type, id, hours, extra = {}) => {
  const source = seed.legs.find(leg => leg.type === type);
  return {
    ...structuredClone(source), id, aircraft_registration: 'SYN-LINK001',
    [type === 'arrival' ? 'scheduled_on_block' : 'scheduled_off_block']: at(hours), ...extra,
  };
};
const movement = (extra = {}) => ({
  ...structuredClone(seed.legs.find(leg => leg.type === 'ground-movement')), ...extra,
});
const schemaJson = name => readJson(fileURLToPath(new URL(`../data/schemas/${name}.schema.json`, import.meta.url)));
const ajv = new Ajv({ allErrors: true, strictRequired: false });
ajv.addFormat('date-time', isUtcInstant);
ajv.addSchema(schemaJson('raw-demand'));
const shape = ajv.compile(schemaJson('linked-demand'));

function verifyPackage(result) {
  assert.ok(shape(result), ajv.errorsText(shape.errors));
  const sources = new Map(result.source_legs.map(leg => [leg.id, leg]));
  const used = new Set();
  const visits = new Map(result.visits.map(visit => [visit.id, visit]));
  assert.equal(visits.size, result.visits.length);
  for (const visit of result.visits) {
    for (const type of ['arrival', 'departure']) {
      const id = visit[`${type}_leg_id`];
      if (id === undefined) continue;
      assert.equal(sources.get(id)?.type, type);
      assert.equal(sources.get(id).aircraft_registration, visit.aircraft_registration);
      assert.equal(sources.get(id).aircraft_id, visit.aircraft_id);
      assert.equal(used.has(id), false, `${id} used by more than one visit`);
      assert.equal(result.unresolved_connection_leg_ids.includes(id), false);
      used.add(id);
    }
  }
  for (const requirement of result.tow_requirements) {
    assert.ok(visits.has(requirement.visit_id));
    const type = requirement.type === 'tow-out' ? 'arrival' : 'departure';
    assert.equal(visits.get(requirement.visit_id)[`${type}_leg_id`], requirement.source_leg_id);
  }
  for (const id of result.context_leg_ids) assert.ok(sources.has(id));
  for (const id of result.ground_movement_leg_ids) assert.equal(sources.get(id)?.type, 'ground-movement');
  assert.equal(result.ground_movements.length, result.ground_movement_leg_ids.length);
  for (const movement of result.ground_movements) {
    const source = sources.get(movement.source_leg_id);
    assert.equal(source?.type, 'ground-movement');
    assert.equal(movement.aircraft_registration, source.aircraft_registration);
    assert.equal(movement.origin_stand_id, source.origin_stand_id);
    assert.equal(movement.destination_stand_id, source.destination_stand_id);
    assert.ok(Date.parse(movement.scheduled_on_block) > Date.parse(movement.scheduled_off_block));
    for (const field of ['scheduled_off_block', 'scheduled_on_block']) {
      if (source[field] !== undefined) assert.equal(movement[field], source[field]);
    }
    if (movement.visit_id !== undefined) assert.ok(visits.has(movement.visit_id));
  }
  for (const match of result.movement_matches) {
    assert.ok(visits.has(match.visit_id));
    assert.ok(sources.has(match.source_leg_id));
    const movement = result.ground_movements.find(item => item.source_leg_id === match.movement_leg_id);
    assert.equal(movement?.status, 'associated');
    assert.equal(movement.visit_id, match.visit_id);
    assert.equal(result.tow_requirements.some(item => item.source_leg_id === match.source_leg_id), false);
  }
  for (const finding of result.findings) for (const id of finding.leg_ids) assert.ok(sources.has(id));
}

test('24-hour seed produces four connections, two single-leg visits and provisional requirements', () => {
  const result = linkDemand(seed, airport, fullDay);
  verifyPackage(result);
  assert.equal(result.connection_search_radius_ms, 24 * hour);
  assert.deepEqual(result.context_window, { start: '2026-10-20T14:00:00.000Z', end: '2026-10-23T14:00:00.000Z' });
  assert.equal(result.visits.length, 6);
  assert.equal(result.visits.filter(visit => visit.status === 'connected').length, 4);
  assert.equal(result.tow_requirements.length, 2);
  assert.equal(result.source_legs.length, 16);
  assert.equal(result.ground_movement_leg_ids.length, 3);
  assert.deepEqual(result.unresolved_connection_leg_ids, [
    'contoso:ambiguous:arrival', 'contoso:ambiguous:departure-a', 'contoso:ambiguous:departure-b',
  ]);
  assert.equal(result.findings.filter(finding => finding.severity === 'error').length, 1);
  assert.equal(result.findings.filter(finding => finding.code === 'movement-time-unresolved').length, 0);
  assert.equal(result.ground_movements.filter(movement => movement.timing_source !== 'supplied').length, 2);
  assert.equal(result.tow_requirements.find(item => item.type === 'tow-out').earliest_off_block, '2026-10-21T17:45:00.000Z');
  assert.equal(result.tow_requirements.find(item => item.type === 'tow-in').latest_on_block, '2026-10-21T17:15:00.000Z');
});

test('search radius is the plan duration, not feed extent or a fixed 24-hour constant', () => {
  const input = demand([flight('arrival', 'a', 1), flight('departure', 'd', 13)]);
  const short = linkDemand(input, airport, window(8));
  const long = linkDemand(input, airport, window(24));
  verifyPackage(short);
  verifyPackage(long);
  assert.equal(short.connection_search_radius_ms, 8 * hour);
  assert.equal(short.visits[0].status, 'arrival-only');
  assert.equal(short.tow_requirements.length, 1);
  assert.equal(long.visits[0].status, 'connected');
  assert.equal(long.tow_requirements.length, 0);
  assert.deepEqual(short.context_window, { start: at(-8), end: at(16) });
});

test('8-hour and 24-hour searches include exact limits before and after visible legs', async t => {
  for (const radius of [8, 24]) {
    for (const direction of ['before', 'after']) {
      for (const extra of [0, 1]) {
        await t.test(`${radius} hours ${direction}, extra ${extra}ms`, () => {
          const arrivalTime = direction === 'before' ? 1 - radius : radius - 1;
          const departureTime = direction === 'before' ? 1 : 2 * radius - 1;
          const arrival = flight('arrival', 'a', arrivalTime);
          const departure = flight('departure', 'd', departureTime);
          if (direction === 'before') arrival.scheduled_on_block = new Date(Date.parse(arrival.scheduled_on_block) - extra).toISOString();
          else departure.scheduled_off_block = new Date(Date.parse(departure.scheduled_off_block) + extra).toISOString();
          const result = linkDemand(demand([arrival, departure]), airport, window(radius));
          verifyPackage(result);
          assert.equal(result.visits.length, 1);
          assert.equal(result.visits[0].status, extra ? direction === 'before' ? 'departure-only' : 'arrival-only' : 'connected');
          assert.equal(result.tow_requirements.length, extra);
        });
      }
    }
  }
});

test('plan is half-open but partners outside it are used as context', () => {
  const result = linkDemand(demand([
    flight('arrival', 'a', -8), flight('departure', 'd', 0),
    flight('arrival', 'excluded-at-end', 8, { aircraft_registration: 'SYN-END' }),
  ]), airport, window(8));
  verifyPackage(result);
  assert.equal(result.visits.length, 1);
  assert.equal(result.visits[0].arrival_leg_id, 'a');
  assert.equal(result.visits[0].departure_leg_id, 'd');
  assert.ok(result.context_leg_ids.includes('excluded-at-end'));
  assert.equal(result.tow_requirements.length, 0);
  const fullWidth = linkDemand(demand([flight('arrival', 'a', 0), flight('departure', 'd', 8)]), airport, window(8));
  assert.equal(fullWidth.visits[0].status, 'connected');
});

test('same aircraft can make multiple visits without connecting across an intervening flight', () => {
  const result = linkDemand(demand([
    flight('arrival', 'a1', 1), flight('departure', 'd1', 2),
    flight('arrival', 'a2', 3), flight('departure', 'd2', 4),
  ]), airport, window(8));
  verifyPackage(result);
  assert.deepEqual(result.visits.map(visit => [visit.arrival_leg_id, visit.departure_leg_id]), [['a1', 'd1'], ['a2', 'd2']]);
});

test('repeated arrivals or departures are unresolved, not guessed into visits or tows', async t => {
  for (const types of [
    ['arrival', 'departure', 'departure'], ['arrival', 'arrival', 'departure'],
    ['arrival', 'arrival'], ['departure', 'departure'],
  ]) {
    await t.test(types.join(','), () => {
      const result = linkDemand(demand(types.map((type, index) => flight(type, `leg-${index}`, index + 1))), airport, window(8));
      verifyPackage(result);
      assert.equal(result.visits.length, 0);
      assert.equal(result.tow_requirements.length, 0);
      assert.equal(result.unresolved_connection_leg_ids.length, types.length);
      assert.ok(result.findings.some(finding => finding.severity === 'error'));
    });
  }
});

test('an ambiguous sequence does not erase a later independent, unambiguous visit', () => {
  const result = linkDemand(demand([
    flight('arrival', 'a1', 1), flight('departure', 'd1', 2), flight('departure', 'd2', 3),
    flight('arrival', 'a2', 4), flight('departure', 'd3', 5),
  ]), airport, window(8));
  verifyPackage(result);
  assert.equal(result.visits.length, 1);
  assert.equal(result.visits[0].arrival_leg_id, 'a2');
  assert.equal(result.visits[0].departure_leg_id, 'd3');
  assert.equal(result.unresolved_connection_leg_ids.length, 3);
});

test('events at the same instant are unresolved regardless of input order or ID sort', () => {
  const input = demand([flight('arrival', 'z', 1), flight('departure', 'a', 1), flight('departure', 'later', 2)]);
  const result = linkDemand(input, airport, window(8));
  verifyPackage(result);
  assert.equal(result.visits.length, 0);
  assert.equal(result.tow_requirements.length, 0);
  assert.equal(result.unresolved_connection_leg_ids.length, 3);
  input.legs.reverse();
  assert.deepEqual(linkDemand(input, airport, window(8)), result);
});

test('candidate counts respect the radius even when other opposite legs exist outside it', () => {
  const result = linkDemand(demand([
    flight('arrival', 'old-arrival', -7), flight('arrival', 'a', 1), flight('departure', 'd', 2),
  ]), airport, window(8));
  verifyPackage(result);
  assert.equal(result.visits.length, 1);
  assert.equal(result.visits[0].arrival_leg_id, 'a');
  assert.equal(result.visits[0].departure_leg_id, 'd');
  assert.equal(result.unresolved_connection_leg_ids.length, 0);
});

test('a dense ambiguous run is reported without duplicating legs or choosing a pairing', () => {
  const legs = [];
  for (let index = 0; index < 500; index++) {
    legs.push(flight('arrival', `a-${index}`, 1 + index / 1000));
    legs.push(flight('departure', `d-${index}`, 3 + index / 1000));
  }
  const result = linkDemand(demand(legs), airport, window(8));
  verifyPackage(result);
  assert.equal(result.visits.length, 0);
  assert.equal(result.unresolved_connection_leg_ids.length, 1000);
});

test('matching is by registration, not airline, sector, model alone or flight number', () => {
  const arrival = flight('arrival', 'a', 1);
  const departure = flight('departure', 'd', 2, { operating_airline_id: 'airline:ACA', sector_id: 'transborder' });
  const input = demand([arrival, departure]);
  const result = linkDemand(input, airport, window(8));
  assert.equal(result.visits[0].status, 'connected');
  assert.deepEqual(result.source_legs, [arrival, departure]);
  departure.aircraft_registration = 'SYN-DIFFERENT';
  const separate = linkDemand(input, airport, window(8));
  assert.equal(separate.visits.length, 2);
  assert.equal(separate.tow_requirements.length, 2);
  verifyPackage(separate);
});

test('handling windows use aircraft policy and do not create automatic long-stay tows', () => {
  const result = linkDemand(seed, airport, fullDay);
  const normal = result.visits.find(visit => visit.arrival_leg_id === 'contoso:normal:arrival');
  const large = result.visits.find(visit => visit.arrival_leg_id === 'contoso:long-e:arrival');
  assert.equal(normal.arrival_window.minimum_minutes, 45);
  assert.equal(normal.departure_window.minimum_minutes, 45);
  assert.ok(Date.parse(normal.arrival_window.end) > Date.parse(normal.departure_window.start));
  assert.equal(large.arrival_window.minimum_minutes, 60);
  assert.equal(large.departure_window.minimum_minutes, 60);
  assert.equal(result.tow_requirements.some(item => item.visit_id === large.id), false);
  const data = structuredClone(airport);
  data.operatingPolicy['minimum-leg-windows'][0]['departure-minutes'] = 30;
  const changed = linkDemand(demand([flight('departure', 'd', 2)]), data, window(8));
  assert.equal(changed.tow_requirements[0].latest_on_block, at(1.5));
});

test('midnight and daylight-saving changes use elapsed UTC search time', () => {
  const result = linkDemand(seed, airport, fullDay);
  assert.ok(result.visits.some(visit => visit.arrival_leg_id === 'contoso:midnight:arrival' && visit.departure_leg_id === 'contoso:midnight:departure'));
  const arrival = flight('arrival', 'a', 1, { scheduled_on_block: '2026-11-01T08:30:00Z' });
  const departure = flight('departure', 'd', 2, { scheduled_off_block: '2026-11-01T09:30:00Z' });
  const fallback = linkDemand(demand([arrival, departure]), airport, { planStart: '2026-11-01T08:00:00Z', planEnd: '2026-11-01T10:00:00Z' });
  assert.equal(fallback.connection_search_radius_ms, 2 * hour);
  assert.equal(fallback.visits[0].status, 'connected');
});

test('source values and IDs are preserved; derived output is deterministic and input-independent', () => {
  const input = structuredClone(seed);
  const before = structuredClone(input);
  const result = linkDemand(input, airport, fullDay);
  assert.deepEqual(input, before);
  input.legs.reverse();
  assert.deepEqual(linkDemand(input, airport, fullDay), result);
  result.source_legs[0].aircraft_registration = 'changed-output';
  assert.deepEqual(input.legs.find(leg => leg.id === result.source_legs[0].id), before.legs.find(leg => leg.id === result.source_legs[0].id));
  const modified = structuredClone(before);
  modified.legs.find(leg => leg.id === 'contoso:normal:arrival').passenger_count++;
  assert.deepEqual(linkDemand(modified, airport, fullDay).visits.map(visit => visit.id), linkDemand(before, airport, fullDay).visits.map(visit => visit.id));
});

test('derived IDs encode source delimiters instead of allowing composite-ID collisions', () => {
  const result = linkDemand(demand([
    flight('arrival', 'a/b', 1), flight('departure', 'c', 2),
    flight('arrival', 'a', 1, { aircraft_registration: 'SYN-OTHER' }),
    flight('departure', 'b/c', 2, { aircraft_registration: 'SYN-OTHER' }),
  ]), airport, window(8));
  verifyPackage(result);
  assert.equal(new Set(result.visits.map(visit => visit.id)).size, 2);
  assert.ok(result.visits.some(visit => visit.id === 'visit:a%2Fb/c'));
  assert.ok(result.visits.some(visit => visit.id === 'visit:a/b%2Fc'));
});

test('raw ground records are preserved while normalized movements cover unmatched-leg tows', () => {
  for (const type of ['arrival', 'departure']) {
    const input = demand([
      flight(type, 'flight', 1),
      movement({ id: 'ground', aircraft_registration: 'SYN-LINK001',
        scheduled_off_block: at(type === 'arrival' ? 2 : 0), scheduled_on_block: at(type === 'arrival' ? 2.25 : 0.25) }),
    ]);
    const result = linkDemand(input, airport, window(8));
    verifyPackage(result);
    assert.equal(result.visits.length, 1);
    assert.equal(result.tow_requirements.length, 0);
    assert.deepEqual(result.source_legs.find(leg => leg.id === 'ground'), input.legs[1]);
    assert.equal(result.movement_matches.length, 1);
    assert.equal(result.findings.length, 0);
  }
  const connected = linkDemand(demand([
    flight('arrival', 'a', 1), flight('departure', 'd', 4),
    movement({ aircraft_registration: 'SYN-LINK001', scheduled_off_block: at(2), scheduled_on_block: at(2.25) }),
  ]), airport, window(8));
  verifyPackage(connected);
  assert.equal(connected.visits[0].status, 'connected');
  assert.equal(connected.tow_requirements.length, 0);
  assert.equal(connected.ground_movements[0].status, 'associated');
  assert.equal(connected.findings.length, 0);
  const single = movement({ id: 'anchor', scheduled_off_block: at(1) });
  delete single.scheduled_on_block;
  const result = linkDemand(demand([single]), airport, window(8));
  assert.equal(result.visits.length, 0);
  assert.equal(result.findings.length, 0);
  assert.equal(result.ground_movements[0].timing_source, 'inferred-on-block');
  assert.equal(result.ground_movements[0].scheduled_on_block, at(1.2));
  assert.deepEqual(result.source_legs[0], single);
});

test('a ground movement crossing the context boundary is retained even if both endpoints are outside', () => {
  const ground = movement({ scheduled_off_block: at(-9), scheduled_on_block: at(17) });
  const result = linkDemand(demand([ground]), airport, window(8));
  verifyPackage(result);
  assert.deepEqual(result.ground_movement_leg_ids, [ground.id]);
});

test('empty or outside-context inputs do not invent visits, but preserve all source records', () => {
  const empty = linkDemand(demand([]), airport, window(8));
  verifyPackage(empty);
  assert.deepEqual(empty.visits, []);
  assert.deepEqual(empty.findings, []);
  const input = demand([flight('arrival', 'a', -9), flight('departure', 'd', 17), flight('departure', 'at-context-end', 16)]);
  const result = linkDemand(input, airport, window(8));
  assert.equal(result.context_leg_ids.length, 0);
  assert.equal(result.source_legs.length, 3);
  assert.equal(result.visits.length, 0);
});

test('invalid input, unknown policy and unsupported ranges fail rather than falling back', () => {
  for (const options of [
    undefined, {}, { planStart: at(0) }, { planStart: at(1), planEnd: at(0) },
    { planStart: at(0), planEnd: at(0) },
    { planStart: '2026-02-29T00:00:00Z', planEnd: at(8) },
    { planStart: 123, planEnd: at(8) },
    { planStart: '0000-01-01T00:00:00Z', planEnd: '0000-01-02T00:00:00Z' },
    { planStart: '9999-12-30T00:00:00Z', planEnd: '9999-12-31T23:59:59Z' },
  ]) assert.throws(() => linkDemand(seed, airport, options));
  const invalid = demand([flight('arrival', 'a', 1)]);
  invalid.legs[0].aircraft_id = 'unknown';
  assert.throws(() => linkDemand(invalid, airport, window(8)), /Cannot link invalid demand/);
  const data = structuredClone(airport);
  delete data.operatingPolicy;
  assert.throws(() => linkDemand(demand([flight('arrival', 'a', 1)]), data, window(8)), /policy is not configured/);
  assert.equal(parseUtcInstant('2026-10-21T00:00:00Z'), base);
  assert.throws(() => parseUtcInstant('2026-10-21T00:00:00-07:00'), /UTC timestamp/);
});

test('linked schema rejects missing fields and success-shaped fabricated tow bounds', () => {
  const result = linkDemand(seed, airport, fullDay);
  const missing = structuredClone(result);
  delete missing.connection_search_radius_ms;
  assert.equal(shape(missing), false);
  const contradictory = structuredClone(result);
  contradictory.tow_requirements[0].status = 'scheduled';
  assert.equal(shape(contradictory), false);
  const unknown = structuredClone(result);
  unknown.visits[0].stand_id = 'assigned';
  assert.equal(shape(unknown), false);
});

test('CLI writes reviewable JSON, signals ambiguity and refuses overwrites', () => {
  const cli = fileURLToPath(new URL('./link-demand.mjs', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'gtaa-linking-'));
  const range = ['--plan-start', fullDay.planStart, '--plan-end', fullDay.planEnd];
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' });
  try {
    const first = run(...range);
    assert.equal(first.status, 2, first.stderr);
    verifyPackage(JSON.parse(first.stdout));
    assert.match(first.stderr, /NEEDS REVIEW: 6 visits, 2 provisional tow requirements, 3 unresolved flight legs/);
    const output = join(directory, 'linked.json');
    const written = run(...range, '--output', output);
    assert.equal(written.status, 2, written.stderr);
    assert.equal(written.stdout, '');
    const bytes = readFileSync(output, 'utf8');
    verifyPackage(JSON.parse(bytes));
    assert.equal(run(...range, '--output', output).status, 1);
    assert.equal(readFileSync(output, 'utf8'), bytes);
    const input = join(directory, 'empty.json');
    writeFileSync(input, JSON.stringify(demand([])));
    const clean = run(...range, '--demand', input);
    assert.equal(clean.status, 0, clean.stderr);
    verifyPackage(JSON.parse(clean.stdout));
    assert.equal(run().status, 1);
    assert.equal(run('--unknown').status, 1);
    assert.equal(run(...range, '--demand', join(directory, 'missing.json')).status, 1);
    assert.equal(run(...range, '--airport', join(directory, 'missing-airport.json')).status, 1);
    assert.equal(run(...range, '--plan-end', fullDay.planStart).status, 1);
    assert.equal(run(...range, '--output', join(directory, 'missing-directory', 'linked.json')).status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
