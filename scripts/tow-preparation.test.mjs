import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv from 'ajv';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAirport, evaluatePlan, loadAirport, readJson } from './airport-model.mjs';
import { isUtcInstant, loadDemand } from './demand-model.mjs';
import { deriveOccupancy } from './occupancy-model.mjs';
import { analyzeStandPressure, buildStandDemand, standCandidates } from './stand-pressure.mjs';
import { loadTowProfile, prepareTows } from './tow-preparation.mjs';

const airport = loadAirport();
const seed = loadDemand();
const policy = loadTowProfile();
const base = Date.parse('2026-10-21T00:00:00Z');
const at = minutes => new Date(base + minutes * 60_000).toISOString();
const options = { planStart: at(0), planEnd: at(480) };
const window = { start: options.planStart, end: options.planEnd };
const sid = id => `t1:stand:${id}`;
const smallAirport = () => {
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
const flight = (type, id, minutes, registration = id) => ({
  ...structuredClone(seed.legs.find(leg => leg.type === type)),
  id, aircraft_registration: registration, sector_id: 'domestic',
  [type === 'arrival' ? 'scheduled_on_block' : 'scheduled_off_block']: at(minutes),
});
const turn = (id, arrival, departure) => [
  flight('arrival', `${id}:a`, arrival, id), flight('departure', `${id}:d`, departure, id),
];
const movement = (id, off, on) => ({
  id, type: 'ground-movement', aircraft_registration: 'long', aircraft_id: 'A320',
  operating_airline_id: 'airline:UAL', origin_stand_id: sid('101'), destination_stand_id: sid('R02'),
  scheduled_off_block: at(off), scheduled_on_block: at(on),
});
const row = (id, extra = {}) => ({
  id, aircraft_id: 'A320', aircraft_registration: id, source_segment_id: `source:${id}`,
  start: at(0), end: at(60), operating_airline_ids: ['airline:UAL'],
  arrival: { sectorId: 'domestic', operatingAirlineId: 'airline:UAL' },
  departure: { sectorId: 'domestic', operatingAirlineId: 'airline:UAL' },
  role: 'service', timing_basis: 'fixed', stand_kind: 'any', ...extra,
});
const ajv = new Ajv({ allErrors: true, strictRequired: false });
ajv.addFormat('date-time', isUtcInstant);
for (const name of ['raw-demand', 'linked-demand', 'occupancy', 'tow-profile']) {
  ajv.addSchema(readJson(fileURLToPath(new URL(`../data/schemas/${name}.schema.json`, import.meta.url))));
}
const shape = ajv.compile(readJson(fileURLToPath(new URL('../data/schemas/tow-preparation.schema.json', import.meta.url))));
const run = (legs, data = smallAirport(), profile = policy, range = options) => {
  const input = { ...structuredClone(seed), legs };
  const before = structuredClone({ input, data, profile });
  const result = prepareTows(input, data, range, profile);
  assert.ok(shape(result), ajv.errorsText(shape.errors));
  assert.deepEqual({ input, data, profile }, before);
  assert.equal(result.solver_ready, false);
  assert.deepEqual(result.baseline, deriveOccupancy(input, data, range));
  assert.equal(result.selection.generated_movement_count, result.selection.selected_proposal_ids.length * 2);
  const segmentIds = new Set(result.baseline.segments.map(segment => segment.id));
  const proposalIds = new Set(result.proposals.map(proposal => proposal.id));
  for (const id of result.selection.selected_proposal_ids) assert.ok(proposalIds.has(id));
  for (const proposal of result.proposals) {
    assert.ok(result.baseline_analysis.demands.some(demand => demand.id === proposal.baseline_demand_id));
    assert.ok(proposal.parking_minutes >= profile.minimum_parking_minutes);
    const demandIds = new Set(proposal.demands.map(demand => demand.id));
    for (const demand of proposal.demands) assert.ok(segmentIds.has(demand.source_segment_id));
    for (const leg of proposal.movements) {
      assert.ok(demandIds.has(leg.from_demand_id));
      assert.ok(demandIds.has(leg.to_demand_id));
      assert.equal(Date.parse(leg.scheduled_on_block) - Date.parse(leg.scheduled_off_block), data.operatingPolicy['default-tow-minutes'] * 60_000);
    }
  }
  for (const step of result.selection.steps) {
    assert.ok(step.after_shortfall_ms < step.before_shortfall_ms);
    assert.ok(step.net_benefit_minutes > 0);
    assert.ok(step.net_benefit_minutes >= profile.minimum_net_benefit_minutes);
  }
  return result;
};
const congestion = () => [...turn('long', 0, 360), ...turn('short1', 120, 180), ...turn('short2', 120, 180)];

test('static candidates apply aircraft, flight sectors, operators and closure permissions', () => {
  const model = compileAirport(smallAirport());
  assert.deepEqual(standCandidates(model, row('a')).candidate_stand_ids, [sid('101'), sid('103')]);
  assert.deepEqual(standCandidates(model, row('a', { aircraft_id: 'B789' })).candidate_stand_ids, []);
  assert.deepEqual(standCandidates(model, row('a', { departure: { sectorId: 'transborder', operatingAirlineId: 'airline:UAL' } })).candidate_stand_ids, []);
  const parking = row('p', { arrival: undefined, departure: undefined, role: 'parking', stand_kind: 'non-contact' });
  assert.deepEqual(standCandidates(model, parking).candidate_stand_ids, [sid('R02')]);
  const denied = standCandidates(model, { ...parking, operating_airline_ids: ['airline:AAL'] });
  assert.equal(denied.candidate_stand_ids.length, 0);
  assert.ok(denied.excluded_stands.find(item => item.stand_id === sid('R02')).reasons.includes('occupancy-airline-not-allowed'));
});

test('pinned and unconfigured stands are not silently treated as available alternatives', () => {
  const data = smallAirport();
  const model = compileAirport(data);
  assert.deepEqual(standCandidates(model, row('a', { stand_id: sid('101') })).candidate_stand_ids, [sid('101')]);
  model.stands.get(sid('101')).configuration_status = 'draft';
  assert.equal(standCandidates(model, row('a', { stand_id: sid('101') })).candidate_stand_ids.length, 0);
});

test('parking operators are enforced by the fixed-plan evaluator, without changing legacy optional-field behavior', () => {
  const model = compileAirport(smallAirport());
  const parking = { id: 'p', standId: sid('R02'), aircraftId: 'A320', start: 0, end: 10 };
  assert.deepEqual(evaluatePlan(model, [parking]), []);
  assert.deepEqual(evaluatePlan(model, [{ ...parking, operatingAirlineIds: ['airline:UAL'] }]), []);
  assert.deepEqual(evaluatePlan(model, [{ ...parking, operatingAirlineIds: ['airline:AAL'] }]).map(item => item.code), ['occupancy-airline-not-allowed']);
  assert.throws(() => evaluatePlan(model, [{ ...parking, operatingAirlineIds: [] }]), /operating airline/);
});

test('matching detects three simultaneous demands sharing only two stands', () => {
  const result = analyzeStandPressure(compileAirport(smallAirport()), [row('a'), row('b'), row('c')], window);
  assert.equal(result.shortfall_minutes, 60);
  assert.equal(result.pressure_slices.length, 1);
  assert.equal(result.pressure_slices[0].shortfall, 1);
  assert.deepEqual(result.pressure_slices[0].constrained_pool_demand_ids, ['a', 'b', 'c']);
  assert.deepEqual(result.pressure_slices[0].constrained_pool_stand_ids, [sid('101'), sid('103')]);
});

test('matching identifies the deficient subset, not unrelated spare capacity', () => {
  const result = analyzeStandPressure(compileAirport(smallAirport()), [
    row('a', { stand_id: sid('101') }), row('b', { stand_id: sid('101') }), row('c', { stand_id: sid('103') }),
  ], window);
  assert.deepEqual(result.pressure_slices[0].constrained_pool_demand_ids, ['a', 'b']);
  assert.deepEqual(result.pressure_slices[0].constrained_pool_stand_ids, [sid('101')]);
});

test('matching uses augmenting paths rather than greedy assignments that strand scarce demand', () => {
  const result = analyzeStandPressure(compileAirport(smallAirport()), [row('flexible'), row('scarce', { stand_id: sid('101') })], window);
  assert.equal(result.total_shortfall_ms, 0);
  assert.equal(result.scarcity_order[0], 'scarce');
});

test('event boundaries are half-open and detect a one-millisecond shortage', () => {
  const model = compileAirport(smallAirport());
  const a = row('a', { stand_id: sid('101'), end: at(60) });
  const b = row('b', { stand_id: sid('101'), start: at(60), end: at(120) });
  assert.equal(analyzeStandPressure(model, [a, b], window).total_shortfall_ms, 0);
  b.start = new Date(Date.parse(b.start) - 1).toISOString();
  assert.equal(analyzeStandPressure(model, [a, b], window).total_shortfall_ms, 1);
});

test('analysis clips known intervals for measurement, never creates an unknown parking boundary', () => {
  const result = analyzeStandPressure(compileAirport(smallAirport()), [
    row('a', { start: at(-60), end: at(60), stand_id: sid('101') }),
    row('b', { start: at(-60), end: at(60), stand_id: sid('101') }),
  ], window);
  assert.equal(result.shortfall_minutes, 60);
  assert.equal(result.demands[0].start, at(-60));
  assert.equal(result.pressure_slices[0].start, at(0));
});

test('conditional closures are explicitly a relaxation rather than certified independent capacity', () => {
  const data = smallAirport();
  data.stands.stands.find(stand => stand.code === '101')['close-conditions'] = [{
    category: 'fit', description: 'Mutually exclusive neighboring use.', stand: sid('103'),
  }];
  const model = compileAirport(data);
  const result = analyzeStandPressure(model, [row('a', { stand_id: sid('101') }), row('b', { stand_id: sid('103') })], window);
  assert.equal(result.total_shortfall_ms, 0);
  assert.ok(result.limitations.some(item => item.includes('Conditional')));
  assert.ok(evaluatePlan(model, [
    { id: 'a', standId: sid('101'), aircraftId: 'A320', start: 0, end: 1 },
    { id: 'b', standId: sid('103'), aircraftId: 'A320', start: 0, end: 1 },
  ]).some(item => item.code === 'conditional-closure'));
});

test('minimum-service rows are labeled lower bounds; open parking remains excluded', () => {
  const result = run(structuredClone(seed.legs), airport, policy, {
    planStart: '2026-10-21T14:00:00Z', planEnd: '2026-10-22T14:00:00Z',
  });
  assert.equal(result.excluded_segment_ids.length, 6);
  assert.equal(result.baseline_analysis.demands.filter(item => item.timing_basis === 'minimum-service').length, 2);
  assert.equal(result.baseline_analysis.demands.length, 6);
  assert.ok(result.findings.some(item => item.code === 'partial-pressure-analysis'));
  assert.equal(result.baseline.blocked_source_leg_ids.length, 3);
  assert.equal(result.proposals[0].unassignable_demand_ids.length, 0);
  assert.ok(result.proposals[1].unassignable_demand_ids.some(id => id.endsWith('/departure')));
});

test('capacity repair selects one useful pair and retains the original baseline', () => {
  const result = run(congestion());
  assert.equal(result.baseline_analysis.shortfall_minutes, 60);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.selection.selected_proposal_ids.length, 1);
  assert.equal(result.selection.generated_movement_count, 2);
  assert.equal(result.selection.analysis.total_shortfall_ms, 0);
  const proposal = result.proposals[0];
  assert.equal(proposal.estimated_relief_minutes, 60);
  assert.equal(proposal.net_benefit_minutes, 30);
  assert.equal(proposal.parking_minutes, 246);
  assert.equal(proposal.movements[0].scheduled_off_block, at(45));
  assert.equal(proposal.movements[1].scheduled_on_block, at(315));
  assert.equal(proposal.demands[1].arrival, undefined);
  assert.equal(proposal.demands[1].departure, undefined);
  assert.deepEqual(proposal.competing_demand_ids.length, 2);
  assert.equal(result.baseline.linked_demand.ground_movements.length, 0);
});

test('long windows and peak weights alone never justify towing without an observed shortage', () => {
  const result = run(turn('long', 0, 360));
  assert.equal(result.proposals.length, 1);
  assert.equal(result.selection.selected_proposal_ids.length, 0);
  assert.equal(result.proposals[0].estimated_relief_minutes, 0);
  assert.equal(result.proposals[0].peak_exposure, 0);
  assert.equal(result.selection.rejected[0].reason, 'no-marginal-shortfall-relief');
});

test('marginal re-evaluation avoids selecting redundant initially profitable proposals', () => {
  const result = run([...turn('long1', 0, 360), ...turn('long2', 0, 360), ...turn('short', 120, 180)]);
  assert.equal(result.proposals.filter(proposal => proposal.net_benefit_minutes > 0).length, 2);
  assert.equal(result.selection.selected_proposal_ids.length, 1);
  assert.equal(result.selection.analysis.total_shortfall_ms, 0);
  assert.equal(result.selection.rejected[0].reason, 'no-marginal-shortfall-relief');
  assert.ok(result.selection.rejected[0].estimated_relief_minutes <= 0);
});

test('movement cost, benefit threshold and movement budget are independently adjustable', () => {
  assert.equal(run(congestion(), smallAirport(), { ...policy, movement_penalty_minutes: 31 }).selection.generated_movement_count, 0);
  assert.equal(run(congestion(), smallAirport(), { ...policy, minimum_net_benefit_minutes: 31 }).selection.generated_movement_count, 0);
  assert.equal(run(congestion(), smallAirport(), { ...policy, minimum_net_benefit_minutes: 30 }).selection.generated_movement_count, 2);
  const budget = run(congestion(), smallAirport(), { ...policy, maximum_generated_movements: 1 });
  assert.equal(budget.selection.generated_movement_count, 0);
  assert.equal(budget.selection.rejected[0].reason, 'movement-budget');
  assert.equal(run(congestion(), smallAirport(), { ...policy, maximum_generated_movements: 0 }).selection.generated_movement_count, 0);
});

test('remote parking capacity and aircraft compatibility can veto an otherwise useful split', () => {
  const data = smallAirport();
  data.stands.stands.find(stand => stand.code === 'R02').closed = true;
  const result = run(congestion(), data);
  assert.equal(result.selection.generated_movement_count, 0);
  assert.ok(result.proposals[0].unassignable_demand_ids[0].endsWith('/parking'));
  assert.equal(result.selection.rejected[0].reason, 'no-compatible-alternative-stand');
});

test('60-minute remote parking threshold is exact and excludes both travel intervals', () => {
  assert.equal(run(turn('boundary', 0, 174)).proposals[0].parking_minutes, 60);
  const legs = turn('boundary', 0, 174);
  legs[1].scheduled_off_block = new Date(Date.parse(legs[1].scheduled_off_block) - 1).toISOString();
  const result = run(legs);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.visit_assessments[0].reason, 'insufficient-parking-window');
  assert.equal(run(turn('boundary', 0, 174), smallAirport(), { ...policy, minimum_parking_minutes: 61 }).proposals.length, 0);
});

test('large-aircraft handling and airport tow duration, not class-C constants, determine timing', () => {
  const data = smallAirport();
  data.operatingPolicy['default-tow-minutes'] = 7;
  const result = run(turn('large', 0, 360).map(leg => ({ ...leg, aircraft_id: 'B789' })), data);
  assert.equal(result.proposals[0].movements[0].scheduled_off_block, at(60));
  assert.equal(result.proposals[0].movements[1].scheduled_on_block, at(300));
  assert.equal(result.proposals[0].parking_minutes, 226);
});

test('supplied movements, blocked sources and single-leg unknown extents are preserved', () => {
  const supplied = run([...turn('long', 0, 360), movement('given', 100, 115)]);
  assert.equal(supplied.proposals.length, 0);
  assert.equal(supplied.visit_assessments[0].reason, 'preserve-supplied-movements');
  const conflict = run([...turn('long', 0, 360), movement('bad', 20, 32)]);
  assert.equal(conflict.proposals.length, 0);
  assert.equal(conflict.visit_assessments[0].reason, 'blocked-source');
  const single = run([flight('arrival', 'a', 0)]);
  assert.equal(single.proposals.length, 0);
  assert.equal(single.baseline_analysis.demands[0].end, at(45));
  assert.equal(single.baseline.segments[0].end.kind, 'flexible');
});

test('missing traffic patterns fail when used, and uniformly scaling weights preserves ranking', () => {
  const data = smallAirport();
  const original = run(congestion(), data);
  for (const pattern of data.trafficProfile['sector-patterns']) {
    for (const field of ['arrival-hourly-weights', 'departure-hourly-weights']) pattern[field] = pattern[field].map(value => value * 10);
  }
  const scaled = run(congestion(), data);
  assert.ok(Math.abs(scaled.proposals[0].peak_exposure - original.proposals[0].peak_exposure) < 1e-9);
  delete data.trafficProfile;
  assert.throws(() => run(congestion(), data), /No traffic pattern configured/);
});

test('separate service scopes allow a sector/operator transition without assigning both flight rules to parking', () => {
  const data = smallAirport();
  const departureStand = data.stands.stands.find(stand => stand.code === '103');
  departureStand['airline-groups'] = ['group:alliance:oneworld'];
  departureStand['departure-sector-group'] = 'transborder-general';
  data.stands.stands.find(stand => stand.code === 'R02')['airline-groups'] = ['group:alliance:star', 'group:alliance:oneworld'];
  const legs = turn('handoff', 0, 360);
  legs[1].sector_id = 'transborder';
  legs[1].operating_airline_id = 'airline:AAL';
  const result = run(legs, data);
  assert.equal(result.baseline_analysis.demands[0].candidate_stand_ids.length, 0);
  assert.equal(result.selection.generated_movement_count, 2);
  assert.equal(result.selection.analysis.shortfall_minutes, 0);
  const [arrival, parking, departure] = result.proposals[0].demands;
  assert.deepEqual(arrival.operating_airline_ids, ['airline:UAL']);
  assert.deepEqual(departure.operating_airline_ids, ['airline:AAL']);
  assert.deepEqual(parking.operating_airline_ids, ['airline:AAL', 'airline:UAL']);
  assert.equal(result.proposals[0].rationale, 'repair-incompatible-continuous-stay');
});

test('peak exposure uses elapsed UTC time across repeated airport-local hours', () => {
  const data = smallAirport();
  for (const pattern of data.trafficProfile['sector-patterns']) {
    for (const field of ['arrival-hourly-weights', 'departure-hourly-weights']) {
      pattern[field] = Array(24).fill(1);
      pattern[field][1] = 2;
    }
  }
  const shift = Date.parse('2026-11-01T06:30:00Z') - base;
  const legs = congestion().map(leg => ({
    ...leg,
    ...(leg.scheduled_on_block ? { scheduled_on_block: new Date(Date.parse(leg.scheduled_on_block) + shift).toISOString() } : {}),
    ...(leg.scheduled_off_block ? { scheduled_off_block: new Date(Date.parse(leg.scheduled_off_block) + shift).toISOString() } : {}),
  }));
  const result = run(legs, data, policy, { planStart: new Date(base + shift).toISOString(), planEnd: new Date(base + shift + 480 * 60_000).toISOString() });
  assert.equal(result.proposals[0].estimated_relief_minutes, 60);
  assert.ok(Math.abs(result.proposals[0].peak_exposure - 60 * 24 * 2 / 25) < 1e-8);
});

test('slice-by-slice feasibility never claims a continuous stand assignment', () => {
  const result = analyzeStandPressure(compileAirport(smallAirport()), [
    row('first', { stand_id: sid('101') }),
    row('second', { start: at(60), end: at(120), stand_id: sid('103') }),
    row('continuous', { end: at(120) }),
  ], window);
  assert.equal(result.total_shortfall_ms, 0);
  assert.ok(result.limitations.some(item => item.includes('continuous stand assignment')));
});

test('deterministic IDs, matching and selection do not depend on input order', () => {
  const legs = [...turn('long1:/%', 0, 360), ...turn('long2', 0, 360), ...turn('short', 120, 180)];
  assert.deepEqual(run(legs), run(legs.slice().reverse()));
  const data = smallAirport();
  data.stands.stands.reverse();
  assert.deepEqual(run(legs), run(legs, data));
});

test('empty demand, bad profiles and missing duration policies are explicit', () => {
  assert.deepEqual(run([]).selection.selected_proposal_ids, []);
  for (const changes of [
    { minimum_parking_minutes: 0 }, { movement_penalty_minutes: -1 }, { maximum_generated_movements: 0.5 },
    { minimum_net_benefit_minutes: -1 }, { bogus: true }, { method: 'unknown' },
  ]) assert.throws(() => run([], smallAirport(), { ...policy, ...changes }), /Invalid tow profile/);
  const data = smallAirport();
  delete data.operatingPolicy['default-tow-minutes'];
  assert.throws(() => run([], data), /requires configured default-tow-minutes/);
});

test('pressure rejects duplicate rows, invalid times and missing operators', () => {
  const model = compileAirport(smallAirport());
  assert.throws(() => analyzeStandPressure(model, [row('a'), row('a')], window), /Duplicate/);
  assert.throws(() => standCandidates(model, row('a', { end: at(0) })), /Invalid stand-demand window/);
  assert.throws(() => standCandidates(model, row('a', { start: 'yesterday' })), /UTC/);
  assert.throws(() => standCandidates(model, row('a', { operating_airline_ids: [] })), /requires operating airlines/);
  assert.throws(() => standCandidates(model, row('a', { stand_id: 'unknown' })), /Unknown fixed stand/);
});

test('schema rejects operational-ready claims and malformed proposal timing records', () => {
  const result = run(congestion());
  result.solver_ready = true;
  assert.equal(shape(result), false);
  result.solver_ready = false;
  delete result.proposals[0].movements[0].scheduled_on_block;
  assert.equal(shape(result), false);
});

const cliPath = fileURLToPath(new URL('./prepare-tows.mjs', import.meta.url));
const cli = args => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 30_000 });
const windowArgs = ['--plan-start', options.planStart, '--plan-end', options.planEnd];
test('CLI distinguishes review/errors, supports profiles and refuses overwrite', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mica-tows-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'demand.json');
  const profile = join(directory, 'profile.json');
  const output = join(directory, 'review.json');
  writeFileSync(input, JSON.stringify({ ...seed, legs: turn('long', 0, 360) }));
  writeFileSync(profile, JSON.stringify({ ...policy, maximum_generated_movements: 0 }));
  const result = cli([...windowArgs, '--demand', input, '--profile', profile, '--output', output]);
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stdout, '');
  const saved = readFileSync(output, 'utf8');
  assert.ok(shape(JSON.parse(saved)), ajv.errorsText(shape.errors));
  const duplicate = cli([...windowArgs, '--demand', input, '--output', output]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /EEXIST/);
  assert.equal(readFileSync(output, 'utf8'), saved);
  const seeded = cli(['--plan-start', '2026-10-21T14:00:00Z', '--plan-end', '2026-10-22T14:00:00Z']);
  assert.equal(seeded.status, 2, seeded.stderr);
  assert.ok(shape(JSON.parse(seeded.stdout)), ajv.errorsText(shape.errors));
  for (const args of [[], [...windowArgs, '--bogus'], [...windowArgs, '--profile', join(directory, 'missing.json')]]) {
    assert.equal(cli(args).status, 1);
  }
});
