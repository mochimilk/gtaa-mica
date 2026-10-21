import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileAirport, evaluatePlan, loadAirport, validateAirport } from './airport-model.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stand = (id, extra = {}) => ({
  id, name: id, code: id, coordinates: [-122, 47], contact: true, gate_ids: [],
  'arrival-sector-group': 'both', 'departure-sector-group': 'both',
  'aircraft-groups': ['small', 'large'], closed: false,
  'close-conditions': [], 'restriction-conditions': [], configuration_status: 'ready',
  ...extra,
});
const fixture = () => ({
  airport: { id: 'test', datasets: { stands: 'stands.json', gates: 'gates.json', buildings: 'buildings.json' } },
  stands: { schema_version: '1.0.0', airport_id: 'test', stands: [stand('A'), stand('B'), stand('C')] },
  gates: { airport_id: 'test', gates: [{ id: 'G', building_id: 'terminal', level_id: 'level' }] },
  buildings: { airport_id: 'test', buildings: [{ id: 'terminal', levels: [{ id: 'level' }] }] },
  aircraft: { aircraft: [{ id: 'S' }, { id: 'L' }] },
  aircraftGroups: { 'aircraft-groups': [
    { id: 'small', 'aircraft-ids': ['S'] },
    { id: 'small-alias', 'aircraft-ids': ['S'] },
    { id: 'large', 'aircraft-ids': ['L'] },
  ] },
  sectors: { sectors: [{ id: 'domestic' }, { id: 'international' }] },
  sectorGroups: { 'sector-groups': [
    { id: 'domestic-general', sectors: ['domestic'] },
    { id: 'international-general', sectors: ['international'] },
    { id: 'both', sectors: ['domestic', 'international'] },
  ] },
});
const occupancy = (id, standId, extra = {}) => ({
  id, standId, aircraftId: 'S', start: 0, end: 10,
  arrival: { sectorId: 'domestic' }, departure: { sectorId: 'domestic' }, ...extra,
});
const closure = (trigger = 'B', filters = {}) => ({
  stand: trigger, category: 'fit', description: 'Neighbor occupancy closes the stand.', ...filters,
});
const restriction = (allow, filters = {}) => ({ ...closure('B', filters), allow });
const run = (data, items) => evaluatePlan(compileAirport(data), items);
const targetFindings = findings => findings.filter(f => f.assignmentIds.includes('target'));

test('current Contoso configuration validates without warnings', () => {
  assert.deepEqual(validateAirport(loadAirport()), { errors: [], warnings: [] });
});

test('schema rejects authoring mistakes', async t => {
  const cases = [
    ['numeric ID', data => { data.stands.stands[0].id = 1; }],
    ['whitespace ID', data => { data.stands.stands[0].id = ' '; }],
    ['unknown field', data => { data.stands.stands[0]['aircraft-group'] = ['small']; }],
    ['duplicate allowed group', data => { data.stands.stands[0]['aircraft-groups'] = ['small', 'small']; }],
    ['missing ready permission', data => { delete data.stands.stands[0]['arrival-sector-group']; }],
    ['bad coordinate', data => { data.stands.stands[0].coordinates = [-181, 47]; }],
    ['unsupported version', data => { data.stands.schema_version = '2.0.0'; }],
    ['missing category', data => { const c = closure(); delete c.category; data.stands.stands[0]['close-conditions'] = [c]; }],
    ['empty trigger list', data => { data.stands.stands[0]['close-conditions'] = [closure('B', { 'aircraft-groups': [] })]; }],
    ['missing allow', data => { data.stands.stands[0]['restriction-conditions'] = [closure()]; }],
    ['empty allow object', data => { data.stands.stands[0]['restriction-conditions'] = [restriction({})]; }],
    ['null allow dimension', data => { data.stands.stands[0]['restriction-conditions'] = [restriction({ 'aircraft-groups': null })]; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const data = fixture();
    mutate(data);
    assert.ok(validateAirport(data).errors.length > 0);
    assert.throws(() => compileAirport(data), /Invalid airport configuration/);
  });
});

test('reference validation rejects broken relationships', async t => {
  const cases = [
    ['duplicate stand', data => data.stands.stands.push(stand('A'))],
    ['duplicate aircraft', data => data.aircraft.aircraft.push({ id: 'S' })],
    ['unknown base aircraft group', data => { data.stands.stands[0]['aircraft-groups'] = ['unknown']; }],
    ['unknown base sector group', data => { data.stands.stands[0]['departure-sector-group'] = 'unknown'; }],
    ['unknown trigger stand', data => { data.stands.stands[0]['close-conditions'] = [closure('missing')]; }],
    ['self-trigger', data => { data.stands.stands[0]['close-conditions'] = [closure('A')]; }],
    ['unknown trigger sector', data => { data.stands.stands[0]['close-conditions'] = [closure('B', { 'arrival-sector-group': 'missing' })]; }],
    ['unknown allow group', data => { data.stands.stands[0]['restriction-conditions'] = [restriction({ 'arrival-sector-groups': ['missing'] })]; }],
    ['unknown aircraft member', data => { data.aircraftGroups['aircraft-groups'][0]['aircraft-ids'].push('unknown'); }],
    ['unknown sector member', data => { data.sectorGroups['sector-groups'][0].sectors.push('unknown'); }],
    ['unknown gate', data => { data.stands.stands[0].gate_ids = ['missing']; }],
    ['unknown building', data => { data.stands.stands[0].associated_building_id = 'missing'; }],
    ['unknown gate level', data => { data.gates.gates[0].level_id = 'missing'; }],
    ['airport mismatch', data => { data.stands.airport_id = 'another-airport'; }],
    ['false readiness', data => { data.airport.planning_ready = true; data.stands.stands[0].configuration_status = 'geometry-only'; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const data = fixture();
    mutate(data);
    assert.ok(validateAirport(data).errors.length > 0);
  });
});

test('derived gate and bidirectional condition indexes do not mutate configuration', () => {
  const data = fixture();
  data.stands.stands[0].gate_ids = ['G'];
  data.stands.stands[0]['close-conditions'] = [closure()];
  data.gates.gates[0].stand_ids = [];
  const before = structuredClone(data);
  const model = compileAirport(data);
  assert.deepEqual(model.gatesToStands.get('G'), ['A']);
  assert.equal(model.conditionsByStand.get('A')[0], model.conditionsByStand.get('B')[0]);
  assert.equal(model.conditionsByStand.get('B')[0].targetStandId, 'A');
  assert.deepEqual(data, before);
  assert.match(model.warnings[0], /legacy inverse/);
});

test('overlapping custom groups are valid; repeated members produce an explicit warning', () => {
  const data = fixture();
  assert.deepEqual(validateAirport(data).warnings, []);
  data.aircraftGroups['aircraft-groups'][0]['aircraft-ids'].push('S');
  const model = compileAirport(data);
  assert.equal(model.aircraftGroups.get('small').size, 1);
  assert.match(model.warnings[0], /duplicate members/);
});

test('target permissions apply only to present legs; parking has neither leg', () => {
  const data = fixture();
  data.stands.stands[0]['arrival-sector-group'] = 'domestic-general';
  data.stands.stands[0]['departure-sector-group'] = 'international-general';
  assert.deepEqual(run(data, [occupancy('target', 'A', { arrival: undefined, departure: { sectorId: 'international' } })]), []);
  assert.deepEqual(run(data, [occupancy('target', 'A', { departure: undefined })]), []);
  assert.deepEqual(run(data, [occupancy('target', 'A', { arrival: undefined, departure: undefined })]), []);
  assert.deepEqual(run(data, [occupancy('target', 'A')]).map(f => f.code), ['departure-sector-not-allowed']);
});

test('an unconditional closure and aircraft compatibility are enforced', () => {
  const data = fixture();
  data.stands.stands[0].closed = true;
  assert.equal(run(data, [occupancy('target', 'A')])[0].code, 'stand-closed');
  data.stands.stands[0].closed = false;
  data.stands.stands[0]['aircraft-groups'] = ['large'];
  assert.equal(run(data, [occupancy('target', 'A')])[0].code, 'aircraft-not-allowed');
});

test('occupancy-only closure is inactive without a neighbor and ignores aircraft size', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [closure()];
  assert.deepEqual(run(data, [occupancy('target', 'A')]), []);
  for (const aircraftId of ['S', 'L']) {
    const findings = run(data, [occupancy('target', 'A'), occupancy('trigger', 'B', { aircraftId })]);
    assert.equal(findings[0].code, 'conditional-closure');
    assert.deepEqual(findings[0].triggerAssignmentIds, ['trigger']);
    assert.equal(findings[0].category, 'fit');
  }
});

test('all trigger dimensions match the same occupancy with AND', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [closure('B', {
    'aircraft-groups': ['large'], 'arrival-sector-group': 'international-general',
    'departure-sector-group': 'domestic-general',
  })];
  const target = occupancy('target', 'A');
  assert.equal(targetFindings(run(data, [
    target, occupancy('trigger', 'B', { aircraftId: 'L', arrival: { sectorId: 'international' } }),
  ]))[0].code, 'conditional-closure');
  assert.deepEqual(targetFindings(run(data, [
    target, occupancy('large-domestic', 'B', { aircraftId: 'L', start: 0, end: 5 }),
    occupancy('small-international', 'B', { arrival: { sectorId: 'international' }, start: 5, end: 10 }),
  ])), []);
});

test('missing trigger leg cannot match its supplied sector filter', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [closure('B', { 'departure-sector-group': 'international-general' })];
  const trigger = occupancy('trigger', 'B', { departure: undefined });
  assert.deepEqual(run(data, [occupancy('target', 'A'), trigger]), []);
});

test('trigger legs are independent of the target leg type; separate closures mean OR', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [
    closure('B', { 'arrival-sector-group': 'international-general' }),
    closure('B', { 'departure-sector-group': 'international-general' }),
  ];
  const target = occupancy('target', 'A', { departure: undefined });
  const trigger = occupancy('trigger', 'B', { arrival: undefined, departure: { sectorId: 'international' } });
  assert.equal(run(data, [target, trigger])[0].code, 'conditional-closure');
});

test('omitted and null trigger filters are equivalent wildcards', () => {
  const data = fixture();
  const items = [occupancy('target', 'A'), occupancy('trigger', 'B', { arrival: undefined, departure: undefined })];
  data.stands.stands[0]['close-conditions'] = [closure()];
  const omitted = run(data, items);
  data.stands.stands[0]['close-conditions'] = [closure('B', {
    'aircraft-groups': null, 'arrival-sector-group': null, 'departure-sector-group': null,
  })];
  assert.deepEqual(run(data, items), omitted);
});

test('half-open windows use any overlap, no implicit buffer and no midnight rollover', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [closure()];
  for (const [start, end, active] of [[10, 20, false], [-10, 0, false], [9, 20, true], [-1, 1, true], [2, 3, true]]) {
    assert.equal(run(data, [occupancy('target', 'A'), occupancy('trigger', 'B', { start, end })]).length > 0, active);
  }
});

test('same-stand overlap is forbidden but touching windows are allowed', () => {
  assert.equal(run(fixture(), [occupancy('one', 'A'), occupancy('two', 'A')])[0].code, 'stand-overlap');
  assert.deepEqual(run(fixture(), [occupancy('one', 'A'), occupancy('two', 'A', { start: 10, end: 20 })]), []);
});

test('active restrictions intersect base permissions without requiring matching group IDs', () => {
  const data = fixture();
  data.stands.stands[0]['aircraft-groups'] = ['small'];
  data.stands.stands[0]['restriction-conditions'] = [restriction({ 'aircraft-groups': ['small-alias'] })];
  assert.deepEqual(run(data, [occupancy('target', 'A'), occupancy('trigger', 'B')]), []);
  data.stands.stands[0]['restriction-conditions'] = [restriction({ 'aircraft-groups': ['large'] })];
  assert.ok(run(data, [occupancy('target', 'A', { aircraftId: 'L' }), occupancy('trigger', 'B')]).some(f => f.code === 'aircraft-not-allowed'));
});

test('multiple active restrictions intersect; omitted dimensions do not change permissions', () => {
  const data = fixture();
  data.stands.stands[0]['restriction-conditions'] = [
    restriction({ 'aircraft-groups': ['small'] }),
    restriction({ 'arrival-sector-groups': ['domestic-general'] }),
  ];
  assert.deepEqual(run(data, [occupancy('target', 'A'), occupancy('trigger', 'B')]), []);
  const denied = run(data, [
    occupancy('target', 'A', { aircraftId: 'L', arrival: { sectorId: 'international' } }),
    occupancy('trigger', 'B'),
  ]);
  assert.equal(denied.filter(f => f.code === 'conditional-restriction').length, 2);
  assert.deepEqual(run(data, [occupancy('target', 'A', { aircraftId: 'L', arrival: { sectorId: 'international' } })]), []);
});

test('empty allow lists deny only their dimension and only present legs', () => {
  const data = fixture();
  data.stands.stands[0]['restriction-conditions'] = [restriction({ 'arrival-sector-groups': [] })];
  const trigger = occupancy('trigger', 'B');
  assert.equal(run(data, [occupancy('target', 'A'), trigger])[0].code, 'conditional-restriction');
  assert.deepEqual(run(data, [occupancy('target', 'A', { arrival: undefined }), trigger]), []);
  data.stands.stands[0]['restriction-conditions'] = [restriction({ 'aircraft-groups': [] })];
  assert.equal(run(data, [occupancy('target', 'A'), trigger])[0].code, 'conditional-restriction');
});

test('closure takes precedence over restrictions', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [closure()];
  data.stands.stands[0]['restriction-conditions'] = [restriction({ 'aircraft-groups': [] })];
  assert.deepEqual(run(data, [occupancy('target', 'A'), occupancy('trigger', 'B')]).map(f => f.code), ['conditional-closure']);
});

test('stand, assignment and rule ordering do not change prohibited combinations', () => {
  const data = fixture();
  data.stands.stands[0]['close-conditions'] = [closure('B'), closure('C')];
  const items = [occupancy('target', 'A'), occupancy('b', 'B'), occupancy('c', 'C')];
  const summary = findings => findings.map(f => `${f.code}:${[...f.assignmentIds].sort()}:${f.triggerAssignmentIds?.join(',')}`).sort();
  const expected = summary(run(data, items));
  data.stands.stands.reverse();
  data.stands.stands.find(s => s.id === 'A')['close-conditions'].reverse();
  assert.deepEqual(summary(run(data, [...items].reverse())), expected);
});

test('invalid occupancy input is rejected instead of becoming an unrestricted match', async t => {
  for (const [name, extra] of [
    ['aircraft', { aircraftId: 'missing' }], ['stand', { standId: 'missing' }],
    ['unknown sector', { arrival: { sectorId: 'missing' } }], ['missing sector', { departure: {} }],
    ['null leg', { arrival: null }], ['empty interval', { end: 0 }],
    ['negative interval', { end: -1 }], ['nonfinite interval', { end: NaN }],
  ]) await t.test(name, () => assert.throws(() => run(fixture(), [occupancy('target', 'A', extra)])));
  assert.throws(() => run(fixture(), [occupancy('target', 'A'), occupancy('target', 'B')]), /duplicate/);
  const data = fixture();
  data.stands.stands[0].configuration_status = 'geometry-only';
  assert.throws(() => run(data, [occupancy('target', 'A')]), /not configured/);
});

test('Contoso contact closures free the remote alternatives without cascading closed states', () => {
  const model = compileAirport(loadAirport());
  const at = (code, aircraftId = 'B738') => occupancy(code, `t1:stand:${code}`, { aircraftId });
  for (const [largeStand, contacts, remotes] of [
    ['102', ['101', '103'], ['H01', 'H03']],
    ['112', ['111', '113'], ['H04', 'H02']],
  ]) {
    const large = at(largeStand, 'B789');
    assert.equal(evaluatePlan(model, [large, ...contacts.map(code => at(code))]).filter(f => f.code === 'conditional-closure').length, 2);
    assert.deepEqual(evaluatePlan(model, [large, ...remotes.map(code => at(code))]), []);
  }
  for (const [contact, remote] of [['101', 'H01'], ['103', 'H03'], ['111', 'H04']]) {
    assert.equal(evaluatePlan(model, [at(contact), at(remote)])[0].code, 'conditional-closure');
  }
  assert.deepEqual(evaluatePlan(model, [at('113'), at('H02')]), []);
  assert.deepEqual(model.gatesToStands.get('t1:gate:A14'), ['t1:stand:H02']);
  for (const code of ['107', '220']) assert.ok(evaluatePlan(model, [at(code, 'B789')]).some(f => f.code === 'aircraft-not-allowed'));
});

test('every documented JSON configuration example validates', () => {
  const document = readFileSync(join(root, 'docs', 'stand-rules.md'), 'utf8');
  const examples = [...document.matchAll(/<!-- example: (stand|closure|restriction)(?: ([^\s]+))? -->\s*```json\r?\n([\s\S]*?)```/g)];
  assert.ok(examples.length >= 8, 'Expected worked configuration examples');
  assert.equal(examples.length, [...document.matchAll(/```json\r?\n/g)].length, 'Every JSON example must be checked');
  for (const [, kind, targetId, json] of examples) {
    const data = loadAirport();
    const value = JSON.parse(json);
    if (kind === 'stand') {
      const index = data.stands.stands.findIndex(s => s.id === value.id);
      assert.ok(index >= 0, `Unknown example stand ${value.id}`);
      data.stands.stands[index] = value;
    } else {
      const target = data.stands.stands.find(s => s.id === targetId);
      assert.ok(target, `Unknown example target ${targetId}`);
      target[kind === 'closure' ? 'close-conditions' : 'restriction-conditions'] = Array.isArray(value) ? value : [value];
    }
    assert.deepEqual(validateAirport(data).errors, [], `Invalid ${kind} example for ${targetId ?? value.id}`);
  }
});

test('CLI fails explicitly for missing or malformed input and succeeds for Contoso', () => {
  const cli = join(root, 'scripts', 'validate-airport.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'mica-airport-test-'));
  try {
    const good = spawnSync(process.execPath, [cli], { cwd: directory, encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /46 stands, 43 gates/);
    const missing = spawnSync(process.execPath, [cli, join(directory, 'missing.json')], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Cannot read JSON.*missing.json/);
    const bad = join(directory, 'malformed.json');
    writeFileSync(bad, '{ invalid JSON');
    const malformed = spawnSync(process.execPath, [cli, bad], { encoding: 'utf8' });
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /Cannot read JSON.*malformed.json/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
