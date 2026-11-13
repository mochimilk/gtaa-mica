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
import { compileAssignmentRequest, runAssignmentRequest, solveAirport, validateAssignmentResult } from './local-assignment.mjs';
import { loadTowProfile, prepareTows } from './tow-preparation.mjs';

const airport = loadAirport();
const seed = loadDemand();
const profile = loadTowProfile();
const base = Date.parse('2026-10-21T00:00:00Z');
const at = minutes => new Date(base + minutes * 60_000).toISOString();
const options = { planStart: at(0), planEnd: at(480), timeLimitSeconds: 5 };
const sid = id => `t1:stand:${id}`;
const fixtureAirport = () => {
  const data = structuredClone(airport);
  for (const stand of data.stands.stands) {
    stand.closed = !['101', '103', 'R02'].includes(stand.code);
    stand['close-conditions'] = [];
    stand['restriction-conditions'] = [];
    if (stand.closed) continue;
    stand['aircraft-groups'] = ['C'];
    stand['airline-groups'] = ['group:alliance:star'];
    stand['arrival-sector-group'] = stand['departure-sector-group'] =
      stand.code === 'R02' ? 'international-general' : 'domestic-general';
  }
  return data;
};
const flight = (type, id, minutes, registration) => ({
  ...structuredClone(seed.legs.find(leg => leg.type === type)),
  id, aircraft_registration: registration, sector_id: 'domestic',
  [type === 'arrival' ? 'scheduled_on_block' : 'scheduled_off_block']: at(minutes),
});
const turn = (id, arrival, departure) => [flight('arrival', `${id}:a`, arrival, id), flight('departure', `${id}:d`, departure, id)];
const snapshot = legs => ({ ...structuredClone(seed), legs });
const congestion = () => [...turn('long', 0, 360), ...turn('s1', 120, 180), ...turn('s2', 120, 180)];
const ajv = new Ajv({ allErrors: true, strictRequired: false });
ajv.addFormat('date-time', isUtcInstant);
for (const name of ['raw-demand', 'linked-demand', 'occupancy', 'tow-profile', 'tow-preparation', 'local-solver-request', 'local-assignment']) {
  ajv.addSchema(readJson(fileURLToPath(new URL(`../data/schemas/${name}.schema.json`, import.meta.url))));
}
const shape = ajv.getSchema('urn:gtaa-mica:local-assignment:1.0.0');
const run = (legs, data = fixtureAirport(), policy = profile, range = options) => {
  const raw = snapshot(legs);
  const before = structuredClone({ raw, data, policy });
  const result = solveAirport(raw, data, range, policy);
  assert.ok(shape(result), ajv.errorsText(shape.errors));
  assert.deepEqual({ raw, data, policy }, before);
  assert.equal(result.operationally_ready, false);
  return result;
};
const compiledFor = (legs, data = fixtureAirport(), variant = 'baseline') => {
  const preparation = prepareTows(snapshot(legs), data, options, profile);
  return compileAssignmentRequest(preparation, data, variant, 5);
};

test('native local CP-SAT compares baseline with an atomic tow alternative', () => {
  const result = run(congestion());
  const baseline = result.variants.baseline;
  const variant = result.variants['tow-options'];
  assert.equal(baseline.status, 'optimal');
  assert.equal(baseline.covered_flight_count, 4);
  assert.equal(baseline.generated_movement_count, 0);
  assert.equal(variant.status, 'optimal');
  assert.equal(variant.covered_flight_count, 6);
  assert.equal(variant.unassigned_group_ids.length, 0);
  assert.equal(variant.generated_movement_count, 2);
  assert.equal(variant.assignments.filter(item => item.demand.visit_id.includes('long')).length, 3);
  assert.equal(variant.generated_movements.length, 2);
  for (const movement of variant.generated_movements) {
    assert.notEqual(movement.origin_stand_id, movement.destination_stand_id);
    const from = variant.assignments.find(item => item.demand_id === movement.from_demand_id);
    const to = variant.assignments.find(item => item.demand_id === movement.to_demand_id);
    assert.equal(movement.scheduled_off_block, from.demand.end);
    assert.equal(movement.scheduled_on_block, to.demand.start);
  }
  assert.equal(variant.stand_validation.passed, true);
  assert.deepEqual(variant.stand_validation.findings, []);
});

test('one uninterrupted stay cannot hop stands between independently feasible time slices', () => {
  const data = fixtureAirport();
  // Restrict the short stays to different stands by their per-leg sector.
  data.stands.stands.find(stand => stand.code === '103')['arrival-sector-group'] = 'domestic-transborder';
  data.stands.stands.find(stand => stand.code === '103')['departure-sector-group'] = 'domestic-transborder';
  const prepared = prepareTows(snapshot([...turn('a', 0, 60), ...turn('b', 60, 120), ...turn('continuous', 0, 120)]), data, options, profile);
  const rows = prepared.baseline_analysis.demands;
  rows.find(row => row.aircraft_registration === 'a').stand_id = sid('101');
  rows.find(row => row.aircraft_registration === 'b').stand_id = sid('103');
  const compiled = compileAssignmentRequest(prepared, data, 'baseline', 5);
  const result = validateAssignmentResult(compiled, runAssignmentRequest(compiled), data);
  assert.equal(result.covered_flight_count, 4);
  assert.equal(result.unassigned_group_ids.length, 1);
});

test('occupancy-dependent closures compile from authored rules and constrain actual search', () => {
  const data = fixtureAirport();
  data.stands.stands.find(stand => stand.code === '101')['close-conditions'] = [{
    stand: sid('103'), category: 'fit', description: 'Any neighbor occupancy closes 101.',
  }];
  const result = run([...turn('a', 0, 60), ...turn('b', 0, 60)], data);
  assert.equal(result.variants.baseline.covered_flight_count, 2);
  assert.ok(result.variants.baseline.conflict_evidence.some(item => item.reasons.includes('conditional-closure')));
  assert.ok(result.variants.baseline.conflict_evidence.some(item => item.rule_paths.length));
});

test('conditional restrictions inspect aircraft and per-leg sector filters', () => {
  const data = fixtureAirport();
  data.stands.stands.find(stand => stand.code === '101')['restriction-conditions'] = [{
    stand: sid('103'), category: 'fit', description: 'Neighbor restricts target to a larger model.',
    'arrival-sector-group': 'domestic-general', 'aircraft-groups': ['C'], allow: { 'aircraft-groups': ['E'] },
  }];
  const result = run([...turn('a', 0, 60), ...turn('b', 0, 60)], data);
  assert.equal(result.variants.baseline.covered_flight_count, 2);
  assert.ok(result.variants.baseline.conflict_evidence.some(item => item.reasons.includes('conditional-restriction')));
  data.stands.stands.find(stand => stand.code === '101')['restriction-conditions'][0]['arrival-sector-group'] = 'international-general';
  assert.equal(run([...turn('a', 0, 60), ...turn('b', 0, 60)], data).variants.baseline.covered_flight_count, 4);
});

test('adjacency can veto a tow that relaxed pressure preparation recommended', () => {
  const data = fixtureAirport();
  data.stands.stands.find(stand => stand.code === 'R02')['close-conditions'] = [{
    stand: sid('101'), category: 'fit', description: 'Parking conflicts with contact occupancy.',
  }];
  const result = run(congestion(), data);
  assert.equal(result.preparation.selection.generated_movement_count, 2);
  assert.equal(result.variants['tow-options'].covered_flight_count, 4);
  assert.equal(result.variants['tow-options'].generated_movement_count, 0);
  assert.equal(result.variants['tow-options'].assignments.some(item => item.demand.timing_basis === 'proposed'), false);
});

test('solver prefers no additional tow when it achieves equal flight coverage', () => {
  const data = fixtureAirport();
  const compiled = compiledFor(congestion(), data, 'tow-options');
  const short = compiled.request.groups.find(group => group.options[0].demand_ids.some(id => id.includes('s2')));
  compiled.request.groups = compiled.request.groups.filter(group => group !== short);
  const removed = new Set(short.options.flatMap(option => option.demand_ids));
  const removedCandidates = new Set(compiled.request.candidates.filter(candidate => removed.has(candidate.demand_id)).map(candidate => candidate.id));
  compiled.request.candidates = compiled.request.candidates.filter(candidate => !removedCandidates.has(candidate.id));
  compiled.request.conflicts = compiled.request.conflicts.filter(pair => !removedCandidates.has(pair.first_candidate_id) && !removedCandidates.has(pair.second_candidate_id));
  const result = validateAssignmentResult(compiled, runAssignmentRequest(compiled), data);
  assert.equal(result.covered_flight_count, 4);
  assert.equal(result.generated_movement_count, 0);
});

test('broad parking eligibility never permits a generated tow from a stand back to itself', () => {
  const data = fixtureAirport();
  const preparation = prepareTows(snapshot(congestion()), data, options, { ...profile, parking_stand_kind: 'any' });
  const compiled = compileAssignmentRequest(preparation, data, 'tow-options', 5);
  assert.ok(compiled.conflict_evidence.some(pair => pair.reasons.includes('tow-requires-different-stands')));
  const result = validateAssignmentResult(compiled, runAssignmentRequest(compiled), data);
  assert.equal(result.generated_movement_count, 2);
  assert.ok(result.generated_movements.every(movement => movement.origin_stand_id !== movement.destination_stand_id));
});

test('provided movement chains keep all fixed segments with segment-level identity and pinned stands', () => {
  const data = fixtureAirport();
  const legs = [...turn('given', 0, 360), {
    id: 'supplied', type: 'ground-movement', aircraft_id: 'A320', aircraft_registration: 'given',
    operating_airline_id: 'airline:UAL', origin_stand_id: sid('101'), destination_stand_id: sid('103'),
    scheduled_off_block: at(60), scheduled_on_block: at(72),
  }];
  const result = run(legs, data);
  const assignments = result.variants.baseline.assignments;
  assert.equal(assignments.length, 2);
  assert.equal(new Set(assignments.map(item => item.demand_id)).size, 2);
  assert.equal(new Set(assignments.map(item => item.demand.visit_id)).size, 1);
  assert.deepEqual(assignments.map(item => item.stand_id).sort(), [sid('101'), sid('103')]);
  assert.equal(result.variants.baseline.generated_movement_count, 0);
  assert.equal(result.preparation.baseline.linked_demand.ground_movements[0].source_leg_id, 'supplied');
});

test('conflicting mandatory supplied occupancy is infeasible, not silently dropped', () => {
  const data = fixtureAirport();
  const legs = ['a', 'b'].flatMap(id => [...turn(id, 0, 360), {
    id: `tow:${id}`, type: 'ground-movement', aircraft_id: 'A320', aircraft_registration: id,
    operating_airline_id: 'airline:UAL', origin_stand_id: sid('101'), destination_stand_id: sid('103'),
    scheduled_off_block: at(60), scheduled_on_block: at(72),
  }]);
  const result = run(legs, data);
  assert.equal(result.variants.baseline.status, 'infeasible');
  assert.equal(result.variants.baseline.disposition, 'no-solution');
  assert.equal(result.variants.baseline.stand_validation.passed, false);
  assert.deepEqual(result.variants.baseline.assignments, []);
});

test('half-open touching stays share the same stand without artificial buffers', () => {
  const data = fixtureAirport();
  data.stands.stands.find(stand => stand.code === '103').closed = true;
  const result = run([...turn('a', 0, 60), ...turn('b', 60, 120)], data);
  assert.equal(result.variants.baseline.covered_flight_count, 4);
});

test('unresolved single-leg and unknown parking never become fixed solver requests', () => {
  const result = run(structuredClone(seed.legs), airport, profile, {
    planStart: '2026-10-21T14:00:00Z', planEnd: '2026-10-22T14:00:00Z', timeLimitSeconds: 5,
  });
  for (const plan of Object.values(result.variants)) {
    assert.equal(plan.excluded_segment_ids.length, 8);
    assert.equal(plan.covered_flight_count, 6);
    assert.equal(plan.unassigned_group_ids.length, 1);
    assert.ok(plan.assignments.every(item => item.demand.timing_basis === 'fixed'));
  }
  assert.equal(result.preparation.baseline.blocked_source_leg_ids.length, 3);
});

test('empty demand has an optimal empty local result, never operational-ready', () => {
  const result = run([]);
  assert.equal(result.variants.baseline.status, 'optimal');
  assert.equal(result.variants.baseline.covered_flight_count, 0);
  assert.equal(result.variants.baseline.disposition, 'stand-rules-validated');
});

test('compilation and native selection are repeatable and insensitive to input ordering', () => {
  const first = run(congestion());
  const second = run(congestion().reverse());
  assert.deepEqual(first, second);
  const data = fixtureAirport();
  data.stands.stands.reverse();
  assert.deepEqual(run(congestion(), data), first);
});

test('independent validation rejects altered identity, fabricated placement and partial options', () => {
  const data = fixtureAirport();
  const compiled = compiledFor(congestion(), data, 'tow-options');
  const result = runAssignmentRequest(compiled);
  const changed = structuredClone(result);
  changed.request_id = 'wrong';
  assert.throws(() => validateAssignmentResult(compiled, changed, data), /identity/);
  const duplicate = structuredClone(result);
  duplicate.assignments.push(duplicate.assignments[0]);
  assert.throws(() => validateAssignmentResult(compiled, duplicate, data), /duplicate placement/);
  const partial = structuredClone(result);
  partial.assignments = partial.assignments.filter(item => !item.demand_id.endsWith('/parking'));
  assert.throws(() => validateAssignmentResult(compiled, partial, data), /partial visit/);
  const altered = structuredClone(result);
  altered.assignments[0].stand_id = 'unknown';
  assert.throws(() => validateAssignmentResult(compiled, altered, data), /invalid or duplicate/);
  const fakeCount = structuredClone(result);
  fakeCount.covered_flight_count++;
  assert.throws(() => validateAssignmentResult(compiled, fakeCount, data), /coverage evidence/);
});

test('changed airport rules fail independent post-solver validation', () => {
  const data = fixtureAirport();
  const compiled = compiledFor(turn('a', 0, 60), data);
  const result = runAssignmentRequest(compiled);
  data.stands.stands.find(stand => stand.id === result.assignments[0].stand_id).closed = true;
  assert.throws(() => validateAssignmentResult(compiled, result, data), /Independent stand validation failed/);
});

const hostPath = fileURLToPath(new URL('../components/Planning.Solver/src/Planning.Solver.Cli/bin/Debug/net10.0/Planning.Solver.Cli.dll', import.meta.url));
test('native host rejects malformed and inconsistent JSON requests', () => {
  const good = compiledFor(turn('a', 0, 60)).request;
  const missing = structuredClone(good);
  delete missing.groups[0].mandatory;
  for (const value of [
    '{invalid', JSON.stringify({ ...good, bogus: true }), JSON.stringify(missing),
    JSON.stringify({ ...good, time_limit_seconds: 0 }),
    JSON.stringify({ ...good, conflicts: [{ first_candidate_id: 'unknown', second_candidate_id: 'unknown2' }] }),
    JSON.stringify({ ...good, candidates: [...good.candidates, good.candidates[0]] }),
  ]) {
    const result = spawnSync('dotnet', [hostPath], { input: value, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Local solver input\/execution error/);
  }
});

test('time limits and unknown variants reject rather than silently falling back', () => {
  const preparation = prepareTows(snapshot([]), airport, options, profile);
  for (const limit of [0, -1, NaN, Infinity, 301]) {
    assert.throws(() => compileAssignmentRequest(preparation, airport, 'baseline', limit), /time limit/);
  }
  assert.throws(() => compileAssignmentRequest(preparation, airport, 'unknown'), /Unknown assignment variant/);
});

const cliPath = fileURLToPath(new URL('./solve-airport.mjs', import.meta.url));
const cli = args => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
test('CLI writes a review package, keeps stdout clean and never overwrites', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mica-local-solver-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'demand.json');
  const output = join(directory, 'result.json');
  writeFileSync(input, JSON.stringify(snapshot(turn('normal', 0, 60))));
  const args = ['--plan-start', at(0), '--plan-end', at(480), '--demand', input, '--output', output];
  const result = cli(args);
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stdout, '');
  const saved = readFileSync(output, 'utf8');
  assert.ok(shape(JSON.parse(saved)), ajv.errorsText(shape.errors));
  assert.match(result.stderr, /No Gantt changes/);
  const duplicate = cli(args);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /EEXIST/);
  assert.equal(readFileSync(output, 'utf8'), saved);
  for (const bad of [['--bogus'], ['--time-limit-seconds', '0'], ['--demand', join(directory, 'missing.json')]]) {
    assert.equal(cli(bad).status, 1);
  }
});
