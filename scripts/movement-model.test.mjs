import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv from 'ajv';
import { fileURLToPath } from 'node:url';
import { compileAirport, loadAirport, readJson, validateAirport } from './airport-model.mjs';
import { isUtcInstant, loadDemand } from './demand-model.mjs';
import { normalizeGroundMovement } from './movement-model.mjs';
import { linkDemand } from './visit-linker.mjs';

const airport = loadAirport();
const model = compileAirport(airport);
const seed = loadDemand();
const base = Date.parse('2026-10-21T00:00:00Z');
const at = minutes => new Date(base + minutes * 60_000).toISOString();
const options = { planStart: at(0), planEnd: at(480) };
const stand = id => `t1:stand:${id}`;
const flight = (type, id, minutes) => ({
  ...structuredClone(seed.legs.find(leg => leg.type === type)),
  id, aircraft_registration: 'SYN-MOVE001',
  [type === 'arrival' ? 'scheduled_on_block' : 'scheduled_off_block']: at(minutes),
});
const movement = (id, origin, destination, off, on) => ({
  id, type: 'ground-movement', aircraft_registration: 'SYN-MOVE001', aircraft_id: 'A320',
  operating_airline_id: 'airline:UAL', origin_stand_id: stand(origin), destination_stand_id: stand(destination),
  ...(off === undefined ? {} : { scheduled_off_block: at(off) }),
  ...(on === undefined ? {} : { scheduled_on_block: at(on) }),
});
const ajv = new Ajv({ allErrors: true, strictRequired: false });
ajv.addFormat('date-time', isUtcInstant);
ajv.addSchema(readJson(fileURLToPath(new URL('../data/schemas/raw-demand.schema.json', import.meta.url))));
const shape = ajv.compile(readJson(fileURLToPath(new URL('../data/schemas/linked-demand.schema.json', import.meta.url))));
const run = (legs, data = airport) => {
  const input = { ...structuredClone(seed), legs };
  const before = structuredClone(input);
  const result = linkDemand(input, data, options);
  assert.ok(shape(result), ajv.errorsText(shape.errors));
  assert.deepEqual(input, before);
  return result;
};
const errors = result => result.findings.filter(finding => finding.severity === 'error').map(finding => finding.code);

test('Contoso infers exactly 12 minutes in either direction and preserves supplied 15 minutes', () => {
  assert.equal(model.defaultTowMinutes, 12);
  const off = normalizeGroundMovement(movement('off', '101', 'R01', 60), model);
  assert.equal(off.scheduled_on_block, at(72));
  assert.equal(off.timing_source, 'inferred-on-block');
  assert.equal(off.inferred_duration_minutes, 12);
  const on = normalizeGroundMovement(movement('on', 'R01', '103', undefined, 120), model);
  assert.equal(on.scheduled_off_block, at(108));
  assert.equal(on.timing_source, 'inferred-off-block');
  const supplied = normalizeGroundMovement(movement('both', '101', 'R01', 60, 75), model);
  assert.equal(supplied.scheduled_off_block, at(60));
  assert.equal(supplied.scheduled_on_block, at(75));
  assert.equal(supplied.timing_source, 'supplied');
  assert.equal(Object.hasOwn(supplied, 'inferred_duration_minutes'), false);
});

test('duration is configurable; missing policy never silently defaults', () => {
  const data = structuredClone(airport);
  data.operatingPolicy['default-tow-minutes'] = 7;
  const custom = run([movement('m', '101', 'R01', 60)], data);
  assert.equal(custom.ground_movements[0].scheduled_on_block, at(67));
  delete data.operatingPolicy['default-tow-minutes'];
  assert.throws(() => run([movement('m', '101', 'R01', 60)], data), /Default tow duration policy is not configured/);
  assert.equal(run([movement('m', '101', 'R01', 60, 75)], data).ground_movements[0].timing_source, 'supplied');
});

test('invalid tow policies reject nonpositive, fractional, nonnumeric and unsafe durations', async t => {
  for (const value of [0, -1, 0.5, '12', null, 1e308]) {
    await t.test(String(value), () => {
      const data = structuredClone(airport);
      data.operatingPolicy['default-tow-minutes'] = value;
      assert.match(validateAirport(data).errors.join('\n'), /default-tow-minutes/);
    });
  }
});

test('normalization preserves millisecond anchors across midnight and daylight-saving changes', () => {
  const crossing = normalizeGroundMovement(movement('m', '101', 'R01', -6), model);
  assert.equal(crossing.scheduled_off_block, '2026-10-20T23:54:00.000Z');
  assert.equal(crossing.scheduled_on_block, at(6));
  const anchor = movement('dst', '101', 'R01', 60);
  anchor.scheduled_off_block = '2026-11-01T08:54:00.123Z';
  const inferred = normalizeGroundMovement(anchor, model);
  assert.equal(inferred.scheduled_off_block, anchor.scheduled_off_block);
  assert.equal(inferred.scheduled_on_block, '2026-11-01T09:06:00.123Z');
});

test('normalization explicitly rejects missing anchors, reversed intervals and date overflow', () => {
  assert.throws(() => normalizeGroundMovement(flight('arrival', 'a', 60), model), /ground-movement leg/);
  assert.throws(() => normalizeGroundMovement(movement('m', '101', 'R01'), model), /no time anchor/);
  assert.throws(() => normalizeGroundMovement(movement('m', '101', 'R01', 60, 60), model), /positive duration/);
  for (const field of ['scheduled_off_block', 'scheduled_on_block']) {
    const leg = movement('m', '101', 'R01');
    leg[field] = field === 'scheduled_off_block' ? '9999-12-31T23:59:00Z' : '0000-01-01T00:01:00Z';
    assert.throws(() => normalizeGroundMovement(leg, model), /supported four-digit/);
  }
});

test('inference occurs before context filtering so an outside anchor can cross the boundary', () => {
  const result = run([
    movement('before', '101', 'R01', -486),
    { ...movement('after', '101', 'R01', undefined, 966), aircraft_registration: 'SYN-MOVE002' },
  ]);
  assert.equal(result.ground_movements.length, 2);
  assert.deepEqual(result.context_leg_ids, ['after', 'before']);
  assert.equal(result.ground_movements.find(item => item.source_leg_id === 'before').scheduled_on_block, at(-474));
  assert.equal(result.ground_movements.find(item => item.source_leg_id === 'after').scheduled_off_block, at(954));
});

test('a valid explicit tow-out replaces the provisional request at the exact arrival cutoff', () => {
  const result = run([flight('arrival', 'a', 60), movement('out', '101', 'R01', 105)]);
  assert.deepEqual(errors(result), []);
  assert.equal(result.tow_requirements.length, 0);
  assert.deepEqual(result.movement_matches, [{
    visit_id: result.visits[0].id, source_leg_id: 'a', type: 'tow-out', movement_leg_id: 'out',
  }]);
  assert.equal(result.ground_movements[0].status, 'associated');
});

test('a valid explicit tow-in replaces the provisional request at the exact departure cutoff', () => {
  const result = run([flight('departure', 'd', 240), movement('in', 'R01', '101', undefined, 195)]);
  assert.deepEqual(errors(result), []);
  assert.equal(result.tow_requirements.length, 0);
  assert.equal(result.movement_matches[0].type, 'tow-in');
  assert.equal(result.ground_movements[0].scheduled_off_block, at(183));
});

test('handling conflicts of one millisecond remain explicit and block duplicate tow inference', () => {
  for (const type of ['arrival', 'departure']) {
    const item = movement('bad', '101', 'R01', type === 'arrival' ? 105 : 183, type === 'arrival' ? 117 : 195);
    const field = type === 'arrival' ? 'scheduled_off_block' : 'scheduled_on_block';
    item[field] = new Date(Date.parse(item[field]) + (type === 'arrival' ? -1 : 1)).toISOString();
    const result = run([flight(type, 'f', type === 'arrival' ? 60 : 240), item]);
    assert.ok(errors(result).includes(`${type}-handling-conflict`));
    assert.equal(result.ground_movements[0].status, 'needs-review');
    assert.equal(result.movement_matches.length, 0);
    assert.deepEqual(result.tow_requirements[0].blocked_by_ground_leg_ids, ['bad']);
    assert.equal(result.ground_movements[0][field], item[field]);
  }
});

test('larger aircraft use 60-minute handling limits during reconciliation', () => {
  for (const type of ['arrival', 'departure']) {
    const source = { ...flight(type, 'f', type === 'arrival' ? 60 : 300), aircraft_id: 'B789' };
    const valid = { ...movement('m', '101', 'R01', type === 'arrival' ? 120 : 228, type === 'arrival' ? 132 : 240), aircraft_id: 'B789' };
    const accepted = run([source, valid]);
    assert.deepEqual(errors(accepted), []);
    assert.equal(accepted.movement_matches.length, 1);
    const invalid = structuredClone(valid);
    invalid[type === 'arrival' ? 'scheduled_off_block' : 'scheduled_on_block'] = at(type === 'arrival' ? 119 : 241);
    const rejected = run([source, invalid]);
    assert.ok(errors(rejected).includes(`${type}-handling-conflict`));
  }
});

test('multiple movements form a continuous chain inside a connected visit', () => {
  const result = run([
    flight('arrival', 'a', 60), flight('departure', 'd', 300),
    movement('out', '101', 'R01', 105), movement('in', 'R01', '103', 243, 255),
  ]);
  assert.deepEqual(errors(result), []);
  assert.equal(result.visits[0].status, 'connected');
  assert.ok(result.ground_movements.every(item => item.status === 'associated' && item.visit_id === result.visits[0].id));
  assert.equal(result.tow_requirements.length, 0);
  assert.equal(result.movement_matches.length, 0);
});

test('the first outbound and last inbound chain movements cover single-leg requirements', () => {
  for (const type of ['arrival', 'departure']) {
    const result = run([
      flight(type, 'f', type === 'arrival' ? 60 : 300),
      movement('first', '101', 'R01', 105), movement('last', 'R01', '103', 240),
    ]);
    assert.deepEqual(errors(result), []);
    assert.equal(result.movement_matches[0].movement_leg_id, type === 'arrival' ? 'first' : 'last');
    assert.equal(result.tow_requirements.length, 0);
  }
});

test('stand discontinuity and overlapping moves mark the chain for review', () => {
  const discontinuous = run([
    flight('arrival', 'a', 60),
    movement('first', '101', 'R01', 105), movement('second', 'R02', '103', 240),
  ]);
  assert.ok(errors(discontinuous).includes('ground-stand-discontinuity'));
  assert.ok(discontinuous.ground_movements.every(item => item.status === 'needs-review'));
  assert.equal(discontinuous.movement_matches.length, 0);
  assert.deepEqual(discontinuous.tow_requirements[0].blocked_by_ground_leg_ids, ['first', 'second']);
  const overlapping = run([
    flight('arrival', 'a', 60), flight('departure', 'd', 300),
    movement('long', '101', 'R01', 110, 270),
    movement('short-one', 'R01', '103', 120, 130), movement('short-two', '103', 'R03', 150, 160),
  ]);
  const finding = overlapping.findings.find(item => item.code === 'overlapping-ground-movements');
  assert.deepEqual(finding.leg_ids, ['long', 'short-one', 'short-two']);
  assert.ok(overlapping.ground_movements.every(item => item.status === 'needs-review'));
  assert.ok(errors(overlapping).includes('departure-handling-conflict'));
});

test('touching movements do not overlap and standalone chains still check endpoint continuity', () => {
  const joined = run([movement('one', '101', 'R01', 60), movement('two', 'R01', '103', 72)]);
  assert.deepEqual(errors(joined), []);
  assert.ok(joined.ground_movements.every(item => item.status === 'standalone'));
  const broken = run([movement('one', '101', 'R01', 60), movement('two', 'R02', '103', 72)]);
  assert.ok(errors(broken).includes('ground-stand-discontinuity'));
});

test('a real flight cycle breaks ground stand continuity between visits', () => {
  const result = run([
    flight('arrival', 'a1', 60), flight('departure', 'd1', 180),
    flight('arrival', 'a2', 240), flight('departure', 'd2', 420),
    movement('first', '101', 'R01', 105), movement('second', 'R02', '103', 285),
  ]);
  assert.deepEqual(errors(result), []);
  assert.notEqual(result.ground_movements[0].visit_id, result.ground_movements[1].visit_id);
});

test('movement timing can retain a context-only flight visit when its ground leg is visible', () => {
  for (const type of ['arrival', 'departure']) {
    const result = run([
      flight(type, 'f', type === 'arrival' ? -60 : 540),
      movement('visible', '101', 'R01', type === 'arrival' ? 30 : 450),
    ]);
    assert.deepEqual(errors(result), []);
    assert.equal(result.visits.length, 1);
    assert.equal(result.movement_matches.length, 1);
    assert.equal(result.tow_requirements.length, 0);
  }
});

test('unrelated ground movements do not suppress a legitimate unmatched requirement', () => {
  for (const time of [0, 600]) {
    const result = run([flight('arrival', 'a', 60), movement('unrelated', '101', 'R01', time)]);
    assert.deepEqual(errors(result), []);
    assert.equal(result.ground_movements[0].status, 'standalone');
    assert.equal(result.tow_requirements.length, 1);
    assert.equal(result.movement_matches.length, 0);
    assert.equal(Object.hasOwn(result.tow_requirements[0], 'blocked_by_ground_leg_ids'), false);
  }
});

test('ground moves across flight events or after departure are never guessed into a visit', () => {
  for (const [off, on] of [[150, 270], [200, 212]]) {
    const result = run([
      flight('arrival', 'a1', 60), flight('departure', 'd1', 180),
      flight('arrival', 'a2', 240), flight('departure', 'd2', 420),
      movement('bad', '101', 'R01', off, on),
    ]);
    assert.equal(result.ground_movements[0].status, 'needs-review');
    assert.equal(Object.hasOwn(result.ground_movements[0], 'visit_id'), false);
    assert.ok(errors(result).some(code => code === 'ground-movement-crosses-flight-event' || code === 'ground-movement-after-flight-departure'));
  }
});

test('ambiguous flight identities keep ground association unresolved', () => {
  const result = run([
    flight('arrival', 'a', 60), flight('departure', 'd1', 180), flight('departure', 'd2', 240),
    movement('m', '101', 'R01', 105),
  ]);
  assert.equal(result.visits.length, 0);
  assert.equal(result.ground_movements[0].status, 'needs-review');
  assert.ok(errors(result).includes('ambiguous-movement-visit'));
  assert.equal(result.movement_matches.length, 0);
  const tied = [
    flight('arrival', 'a', 60), flight('departure', 'd', 60),
    movement('m', '101', 'R01', 60, 72),
  ];
  assert.deepEqual(run(tied), run([...tied].reverse()));
});

test('normalized output is deterministic and independent from source and airport objects', () => {
  const source = [flight('arrival', 'a', 60), movement('m', '101', 'R01', 105)];
  const before = structuredClone(airport);
  const first = run(source);
  assert.deepEqual(run([...source].reverse()), first);
  first.ground_movements[0].scheduled_on_block = at(999);
  assert.equal(Object.hasOwn(source[1], 'scheduled_on_block'), false);
  assert.deepEqual(airport, before);
});

test('package schema requires normalization provenance and valid association metadata', () => {
  const result = run([flight('arrival', 'a', 60), movement('m', '101', 'R01', 105)]);
  for (const change of [
    value => { delete value.ground_movements; },
    value => { delete value.movement_matches; },
    value => { delete value.ground_movements[0].inferred_duration_minutes; },
    value => { delete value.ground_movements[0].visit_id; },
    value => { value.ground_movements[0].status = 'standalone'; },
  ]) {
    const changed = structuredClone(result);
    change(changed);
    assert.equal(shape(changed), false);
  }
});
