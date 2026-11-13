import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { loadAirport, readJson } from './airport-model.mjs';
import { isUtcInstant, loadDemand } from './demand-model.mjs';
import { deriveOccupancy } from './occupancy-model.mjs';

const airport = loadAirport();
const seed = loadDemand();
const base = Date.parse('2026-10-21T00:00:00Z');
const at = minutes => new Date(base + minutes * 60_000).toISOString();
const options = { planStart: at(0), planEnd: at(480) };
const stand = id => `t1:stand:${id}`;
const flight = (type, id, minutes, registration = 'SYN-OCC001', aircraft = 'A320') => ({
  ...structuredClone(seed.legs.find(leg => leg.type === type)),
  id, aircraft_registration: registration, aircraft_id: aircraft,
  [type === 'arrival' ? 'scheduled_on_block' : 'scheduled_off_block']: at(minutes),
});
const movement = (id, origin, destination, off, on, registration = 'SYN-OCC001') => ({
  id, type: 'ground-movement', aircraft_registration: registration, aircraft_id: 'A320',
  operating_airline_id: 'airline:UAL', origin_stand_id: stand(origin), destination_stand_id: stand(destination),
  ...(off === undefined ? {} : { scheduled_off_block: at(off) }),
  ...(on === undefined ? {} : { scheduled_on_block: at(on) }),
});
const ajv = new Ajv({ allErrors: true, strictRequired: false });
ajv.addFormat('date-time', isUtcInstant);
const schema = name => readJson(fileURLToPath(new URL(`../data/schemas/${name}.schema.json`, import.meta.url)));
ajv.addSchema(schema('raw-demand'));
ajv.addSchema(schema('linked-demand'));
const shape = ajv.compile(schema('occupancy'));
const run = (legs, window = options, data = airport) => {
  const input = { ...structuredClone(seed), legs };
  const before = structuredClone(input);
  const result = deriveOccupancy(input, data, window);
  assert.ok(shape(result), ajv.errorsText(shape.errors));
  assert.deepEqual(input, before);
  const sources = new Map(result.linked_demand.source_legs.map(leg => [leg.id, leg]));
  for (const segment of result.segments) {
    for (const id of segment.source_leg_ids) assert.ok(sources.has(id));
    assert.equal(segment.start.kind === 'unknown' || segment.end.kind === 'unknown', segment.timing_status === 'open');
    if (segment.timing_status === 'fixed') assert.ok(Date.parse(segment.start.time) < Date.parse(segment.end.time));
    if (segment.start.kind === 'fixed') assert.match(segment.start.event, /^(arrival|movement)-on-block$/);
    if (segment.end.kind === 'fixed') assert.match(segment.end.event, /^(departure|movement)-off-block$/);
    if (segment.arrival_leg_id) {
      assert.equal(segment.start.event, 'arrival-on-block');
      assert.equal(segment.start.source_leg_id, segment.arrival_leg_id);
      assert.equal(sources.get(segment.arrival_leg_id).type, 'arrival');
    }
    if (segment.departure_leg_id) {
      assert.equal(segment.end.event, 'departure-off-block');
      assert.equal(segment.end.source_leg_id, segment.departure_leg_id);
      assert.equal(sources.get(segment.departure_leg_id).type, 'departure');
    }
    for (const boundary of [segment.start, segment.end]) {
      if (boundary.kind === 'unknown') assert.deepEqual(boundary, { kind: 'unknown' });
      else assert.ok(segment.source_leg_ids.includes(boundary.source_leg_id));
      if (boundary.kind === 'flexible') {
        assert.equal(Object.hasOwn(boundary, 'time'), false);
        assert.ok(result.linked_demand.tow_requirements.some(item => item.id === boundary.tow_requirement_id));
      }
    }
  }
  assert.deepEqual(result.unresolved_segment_ids, result.segments.filter(item => item.timing_status !== 'fixed').map(item => item.id));
  for (const id of result.blocked_source_leg_ids) assert.ok(sources.has(id));
  for (const finding of result.findings) {
    for (const id of finding.leg_ids) assert.ok(sources.has(id));
    for (const id of finding.segment_ids) assert.ok(result.segments.some(item => item.id === id));
  }
  return result;
};
const chronological = result => result.segments.slice().sort((a, b) => Date.parse(a.start.time) - Date.parse(b.start.time));
const connected = () => [flight('arrival', 'a', 60), flight('departure', 'd', 360)];
const chain = () => [movement('m1', '101', 'R01', 120), movement('m2', 'R01', '103', 240)];

test('fixed seed derives four fixed, two flexible and six open segments without inventing edges', () => {
  const result = run(structuredClone(seed.legs), { planStart: '2026-10-21T14:00:00Z', planEnd: '2026-10-22T14:00:00Z' });
  assert.equal(result.segments.length, 12);
  for (const [status, count] of [['fixed', 4], ['flexible', 2], ['open', 6]]) {
    assert.equal(result.segments.filter(item => item.timing_status === status).length, count);
  }
  assert.equal(result.unresolved_segment_ids.length, 8);
  assert.deepEqual(result.blocked_source_leg_ids, result.linked_demand.unresolved_connection_leg_ids.slice().sort());
  assert.equal(result.blocked_source_leg_ids.length, 3);
  assert.equal(result.timing_complete, false);
  assert.equal(result.findings.filter(item => item.severity === 'error').length, 1);
});

test('a connected visit remains one fixed interval, including overlapping handling windows', () => {
  const result = run([flight('arrival', 'a', 60), flight('departure', 'd', 120)]);
  assert.equal(result.segments.length, 1);
  const segment = result.segments[0];
  assert.equal(segment.start.time, at(60));
  assert.equal(segment.end.time, at(120));
  assert.equal(segment.arrival_leg_id, 'a');
  assert.equal(segment.departure_leg_id, 'd');
  assert.equal(Object.hasOwn(segment, 'stand_id'), false);
  assert.equal(result.timing_complete, true);
  assert.deepEqual(result.findings, []);
});

test('a movement chain partitions service and parking, excludes travel and limits flight scope', () => {
  const arrival = flight('arrival', 'a', 60);
  const departure = { ...flight('departure', 'd', 360), sector_id: seed.legs.find(leg => leg.id === 'contoso:long-c:departure').sector_id };
  const result = run([arrival, departure, ...chain()]);
  const segments = chronological(result);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map(item => [item.start.time, item.end.time, item.stand_id]), [
    [at(60), at(120), stand('101')], [at(132), at(240), stand('R01')], [at(252), at(360), stand('103')],
  ]);
  assert.deepEqual(segments.map(item => [item.arrival_leg_id, item.departure_leg_id]), [['a', undefined], [undefined, undefined], [undefined, 'd']]);
  assert.deepEqual(segments[1].source_leg_ids, ['m1', 'm2']);
  assert.equal(result.linked_demand.source_legs.find(item => item.id === 'd').sector_id, departure.sector_id);
  assert.equal(segments.reduce((total, item) => total + Date.parse(item.end.time) - Date.parse(item.start.time), 0), (300 - 24) * 60_000);
  assert.equal(result.timing_complete, true);
});

test('arrival/departure-only handling bounds are not chosen tow event times', async t => {
  for (const [aircraft, minutes] of [['A320', 45], ['B789', 60]]) {
    await t.test(aircraft, () => {
      const arrival = run([flight('arrival', 'a', 60, 'SYN-OCC001', aircraft)]).segments[0];
      assert.equal(arrival.start.time, at(60));
      assert.equal(arrival.end.kind, 'flexible');
      assert.equal(arrival.end.earliest, at(60 + minutes));
      assert.equal(arrival.end.event, 'pending-tow-out');
      const departure = run([flight('departure', 'd', 360, 'SYN-OCC001', aircraft)]).segments[0];
      assert.equal(departure.start.kind, 'flexible');
      assert.equal(departure.start.latest, at(360 - minutes));
      assert.equal(departure.start.event, 'pending-tow-in');
      assert.equal(departure.end.time, at(360));
    });
  }
});

test('matched single-leg chains retain the open opposite parking edge and do not create duplicate tows', () => {
  for (const type of ['arrival', 'departure']) {
    const result = run([flight(type, type, type === 'arrival' ? 60 : 360), ...chain()]);
    assert.equal(result.segments.length, 3);
    assert.equal(result.linked_demand.tow_requirements.length, 0);
    assert.equal(result.linked_demand.movement_matches.length, 1);
    assert.equal(result.segments.filter(item => item.timing_status === 'open').length, 1);
    const open = result.segments.find(item => item.timing_status === 'open');
    assert.equal(open[type === 'arrival' ? 'end' : 'start'].kind, 'unknown');
    assert.equal(result.segments.filter(item => item.arrival_leg_id || item.departure_leg_id).length, 1);
    assert.equal(result.timing_complete, false);
  }
});

test('standalone ground chains preserve unknown edges and fixed intermediate parking', () => {
  const result = run(chain());
  assert.equal(result.segments.length, 3);
  const first = result.segments.find(item => item.start.kind === 'unknown');
  const last = result.segments.find(item => item.end.kind === 'unknown');
  const middle = result.segments.find(item => item.timing_status === 'fixed');
  assert.equal(first.end.time, at(120));
  assert.equal(first.stand_id, stand('101'));
  assert.equal(last.start.time, at(252));
  assert.equal(last.stand_id, stand('103'));
  assert.deepEqual([middle.start.time, middle.end.time, middle.stand_id], [at(132), at(240), stand('R01')]);
  assert.ok(result.segments.every(item => item.visit_id === undefined));
});

test('touching movements omit zero-duration parking without creating a travel occupancy', () => {
  const result = run([...connected(), movement('m1', '101', 'R01', 120), movement('m2', 'R01', '103', 132)]);
  assert.equal(result.segments.length, 2);
  assert.ok(result.segments.every(item => item.stand_id !== stand('R01')));
  assert.equal(result.timing_complete, true);
});

test('known movement endpoints remain unchanged and single anchors use the configured duration', () => {
  const legs = [movement('m1', '101', 'R01', 120, 135), movement('m2', 'R01', '103', undefined, 240)];
  const result = run(legs);
  const middle = result.segments.find(item => item.timing_status === 'fixed');
  assert.deepEqual([middle.start.time, middle.end.time], [at(135), at(228)]);
  assert.deepEqual(result.linked_demand.source_legs, legs);
  assert.equal(result.linked_demand.ground_movements[0].timing_source, 'supplied');
  assert.equal(result.linked_demand.ground_movements[1].timing_source, 'inferred-off-block');
});

test('unclipped intervals retain outside-plan flight context instead of using display edges', () => {
  const result = run([flight('arrival', 'a', -30), flight('departure', 'd', 60)]);
  assert.deepEqual([result.segments[0].start.time, result.segments[0].end.time], [at(-30), at(60)]);
});

test('elapsed boundaries survive midnight and daylight-saving transitions', () => {
  const arrival = flight('arrival', 'a', 60);
  const departure = flight('departure', 'd', 120);
  arrival.scheduled_on_block = '2026-11-01T08:30:00.123Z';
  departure.scheduled_off_block = '2026-11-01T10:30:00.123Z';
  const result = run([arrival, departure], { planStart: '2026-11-01T00:00:00Z', planEnd: '2026-11-02T00:00:00Z' });
  assert.equal(Date.parse(result.segments[0].end.time) - Date.parse(result.segments[0].start.time), 120 * 60_000);
  const midnight = run([flight('arrival', 'a', -30), flight('departure', 'd', 60)]);
  assert.equal(midnight.segments[0].start.time, '2026-10-20T23:30:00.000Z');
});

test('conflicting movement chains block their visit instead of generating an optimistic full-stay interval', async t => {
  for (const movements of [
    [movement('early', '101', 'R01', 100)],
    [movement('late', '101', 'R01', 310)],
    [movement('m1', '101', 'R01', 120), movement('m2', '103', 'R03', 240)],
    [movement('m1', '101', 'R01', 120, 180), movement('m2', 'R01', '103', 150, 200)],
  ]) {
    await t.test(movements.map(item => item.id).join(','), () => {
      const result = run([...connected(), ...movements]);
      assert.deepEqual(result.segments, []);
      assert.ok(result.blocked_source_leg_ids.includes('a'));
      assert.ok(result.blocked_source_leg_ids.includes('d'));
      assert.ok(result.findings.some(item => item.code === 'occupancy-visit-blocked'));
      assert.equal(result.timing_complete, false);
    });
  }
});

test('blocked provisional tow requirements never become freely schedulable segments', () => {
  for (const legs of [
    [flight('arrival', 'a', 60), movement('m', '101', 'R01', 80)],
    [flight('departure', 'd', 360), movement('m', '101', 'R01', 330)],
  ]) {
    const result = run(legs);
    assert.equal(result.linked_demand.tow_requirements.length, 1);
    assert.deepEqual(result.linked_demand.tow_requirements[0].blocked_by_ground_leg_ids, ['m']);
    assert.deepEqual(result.segments, []);
    assert.ok(result.blocked_source_leg_ids.includes('m'));
  }
});

test('ambiguous flights produce no ordinary segments but preserve an independent valid visit', () => {
  const result = run([
    flight('arrival', 'a', 60), flight('departure', 'd1', 180), flight('departure', 'd2', 240),
    ...connected().map(leg => ({ ...leg, id: `valid:${leg.id}`, aircraft_registration: 'SYN-OCC002' })),
  ]);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].aircraft_registration, 'SYN-OCC002');
  assert.deepEqual(result.blocked_source_leg_ids, ['a', 'd1', 'd2']);
});

test('an unassociated review movement cannot disappear behind a later connected full-stay segment', () => {
  const result = run([
    flight('arrival', 'a1', 10), flight('departure', 'd1', 80), flight('departure', 'd2', 120),
    flight('arrival', 'a2', 240), flight('departure', 'd3', 420),
    movement('m', '101', 'R01', 300),
  ]);
  assert.ok(result.linked_demand.visits.some(item => item.arrival_leg_id === 'a2'));
  assert.equal(result.linked_demand.ground_movements[0].status, 'needs-review');
  assert.deepEqual(result.segments, []);
  assert.ok(result.blocked_source_leg_ids.includes('a2'));
  assert.ok(result.blocked_source_leg_ids.includes('d3'));
});

test('invalid standalone movements do not become parking segments', () => {
  const result = run([movement('m1', '101', 'R01', 120, 180), movement('m2', 'R01', '103', 150, 200)]);
  assert.deepEqual(result.segments, []);
  assert.deepEqual(result.blocked_source_leg_ids, ['m1', 'm2']);
  assert.equal(result.timing_complete, false);
});

test('valid standalone movements on either side of review activity remain separate open chains', () => {
  const result = run([
    movement('before', '101', 'R01', 60),
    movement('bad1', 'R01', '103', 100, 200),
    movement('bad2', '103', 'R03', 120, 132),
    movement('after', 'R03', '104', 240),
  ]);
  assert.deepEqual(result.blocked_source_leg_ids, ['bad1', 'bad2']);
  assert.equal(result.segments.length, 4);
  assert.ok(result.segments.every(item => item.timing_status === 'open'));
  assert.ok(result.segments.every(item => item.source_leg_ids.length === 1));
  assert.deepEqual([...new Set(result.segments.flatMap(item => item.source_leg_ids))].sort(), ['after', 'before']);
});

test('standalone chains split across intervening flights instead of joining unrelated parking', () => {
  const result = run([
    movement('before', '101', 'R01', 20), flight('departure', 'd', 120),
    flight('arrival', 'a', 240), movement('after', '103', 'R03', 300),
  ]);
  assert.equal(result.segments.length, 4);
  assert.ok(result.segments.every(item => item.source_leg_ids.length <= 2));
  assert.equal(result.segments.some(item => item.source_leg_ids.includes('before') && item.source_leg_ids.includes('after')), false);
});

test('source escaping prevents ID collisions, order is deterministic and IDs survive timing updates', () => {
  const legs = [
    flight('arrival', 'a:/%arrival', 60), flight('departure', 'd:/%departure', 360),
    ...chain(),
  ];
  const result = run(legs);
  assert.deepEqual(run(legs.slice().reverse()), result);
  assert.ok(result.segments.some(item => item.id.includes('%')));
  const shifted = legs.map(leg => ({
    ...leg,
    ...(leg.scheduled_on_block ? { scheduled_on_block: new Date(Date.parse(leg.scheduled_on_block) + 60_000).toISOString() } : {}),
    ...(leg.scheduled_off_block ? { scheduled_off_block: new Date(Date.parse(leg.scheduled_off_block) + 60_000).toISOString() } : {}),
  }));
  assert.deepEqual(run(shifted).segments.map(item => item.id), result.segments.map(item => item.id));
  assert.equal(new Set(result.segments.map(item => item.id)).size, result.segments.length);
});

test('empty demand is timing complete; invalid input and missing policy fail explicitly', () => {
  assert.equal(run([]).timing_complete, true);
  assert.throws(() => run(connected(), { planStart: at(10), planEnd: at(0) }), /plan/i);
  assert.throws(() => run([{ ...flight('arrival', 'a', 60), bogus: true }]), /bogus|additional/);
  const data = structuredClone(airport);
  delete data.operatingPolicy['default-tow-minutes'];
  assert.throws(() => run(chain(), options, data), /Default tow duration policy is not configured/);
});

test('schema rejects fabricated unknown times and flexible timestamps or wrong bound directions', () => {
  const open = run(chain());
  open.segments.find(item => item.start.kind === 'unknown').start.time = at(0);
  assert.equal(shape(open), false);
  const flexible = run([flight('arrival', 'a', 60)]);
  flexible.segments[0].end.time = at(105);
  assert.equal(shape(flexible), false);
  delete flexible.segments[0].end.time;
  flexible.segments[0].end.latest = flexible.segments[0].end.earliest;
  delete flexible.segments[0].end.earliest;
  assert.equal(shape(flexible), false);
});

test('schema enforces boundary direction, timing status and at least one known event', () => {
  const fixed = run(connected());
  fixed.segments[0].timing_status = 'open';
  assert.equal(shape(fixed), false);
  fixed.segments[0].timing_status = 'fixed';
  fixed.segments[0].start.event = 'departure-off-block';
  assert.equal(shape(fixed), false);
  const open = run(chain());
  const segment = open.segments.find(item => item.start.kind === 'unknown');
  segment.end = { kind: 'unknown' };
  assert.equal(shape(open), false);
});

const cliPath = fileURLToPath(new URL('./derive-occupancy.mjs', import.meta.url));
const cli = args => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 30_000 });
const windowArgs = ['--plan-start', options.planStart, '--plan-end', options.planEnd];
test('CLI distinguishes fixed timing, unresolved boundaries and blocking errors and never overwrites', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mica-occupancy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'demand.json');
  const output = join(directory, 'occupancy.json');
  for (const [legs, exit] of [
    [connected(), 0],
    [[flight('arrival', 'a', 60)], 3],
    [[flight('arrival', 'a', 60), flight('departure', 'd1', 180), flight('departure', 'd2', 240)], 2],
  ]) {
    writeFileSync(input, JSON.stringify({ ...seed, legs }));
    const processResult = cli([...windowArgs, '--demand', input]);
    assert.equal(processResult.status, exit, processResult.stderr);
    assert.ok(shape(JSON.parse(processResult.stdout)), ajv.errorsText(shape.errors));
    assert.match(processResult.stderr, /No solver run/);
  }
  writeFileSync(input, JSON.stringify({ ...seed, legs: connected() }));
  const saved = cli([...windowArgs, '--demand', input, '--output', output]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.stdout, '');
  const original = readFileSync(output, 'utf8');
  const duplicate = cli([...windowArgs, '--demand', input, '--output', output]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /EEXIST/);
  assert.equal(readFileSync(output, 'utf8'), original);
});

test('CLI rejects missing ranges, unknown arguments, missing files and invalid output destinations', () => {
  for (const args of [
    [], [...windowArgs, '--bogus'], [...windowArgs, '--demand', join(tmpdir(), 'mica-missing-demand-file.json')],
    [...windowArgs, '--output', join(tmpdir(), 'mica-missing-output-directory', 'occupancy.json')],
  ]) {
    const result = cli(args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage:/);
  }
});
