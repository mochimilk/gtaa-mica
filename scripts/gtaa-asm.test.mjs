import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildASMDatasets, normalizeASM } from './gtaa-asm.mjs';
import { compileAirport, evaluatePlan, loadAirport, readJson, validateAirport } from './airport-model.mjs';

const manifest = fileURLToPath(new URL('../data/airports/gtaa/airport.json', import.meta.url));
const data = loadAirport(manifest);
const evidence = readJson(resolve(dirname(manifest), data.airport.datasets.source_evidence));
const rules = readJson(resolve(dirname(manifest), data.airport.datasets.asm_rules));
const aircraft = type => `gtaa:aircraft:${type}`;
const table = id => rules.tables.find(table => table.stand_id === id);
const fixture = () => {
  const result = structuredClone(data);
  delete result.operatingPolicy;
  const sectorGroup = result.sectorGroups['sector-groups'][0];
  const airlineGroup = result.airlineGroups.groups.find(group => group.airlines.length);
  for (const stand of result.stands.stands) Object.assign(stand, {
    configuration_status: 'ready', contact: true, closed: false,
    'arrival-sector-group': sectorGroup.id, 'departure-sector-group': sectorGroup.id,
    'airline-groups': [airlineGroup.id],
  });
  return result;
};
const occupancy = (id, standId, type, legs = []) => {
  const sectorId = data.sectorGroups['sector-groups'][0].sectors[0];
  const operatingAirlineId = data.airlineGroups.groups.find(group => group.airlines.length).airlines[0];
  return {
    id, standId, aircraftId: aircraft(type), start: 0, end: 100,
    ...Object.fromEntries(legs.map(leg => [leg, { sectorId, operatingAirlineId }])),
  };
};
const run = (items, input = fixture()) => evaluatePlan(compileAirport(input), items);
const denied = (items, input) => run(items, input).filter(finding => finding.assignmentIds.includes('target'));

test('local aircraft catalog overrides do not change the Contoso catalog', () => {
  assert.ok(data.aircraft.aircraft.every(item => item.id.startsWith('gtaa:aircraft:')));
  const contoso = loadAirport();
  assert.ok(contoso.aircraft.aircraft.some(item => item.id === 'A333'));
  assert.ok(contoso.aircraft.aircraft.every(item => !item.id.startsWith('gtaa:')));
  assert.deepEqual(validateAirport(data).errors, []);
});

test('every current ASM stand has exact compatibility and physical cell provenance', () => {
  assert.equal(rules.tables.length, 158);
  assert.equal(evidence.asm_page_layouts.length, 94);
  for (const table of rules.tables) {
    const stand = data.stands.stands.find(stand => stand.id === table.stand_id);
    assert.ok(stand['aircraft-groups'].length, stand.id);
    assert.equal(stand.source.asm_rules.stand_id, stand.id);
    for (const entry of table.entries) {
      assert.ok(entry.source_rows.length);
      assert.equal(entry.aircraft_cell_y.length, 2);
      if (entry.unresolved_tokens.length) assert.ok(rules.review_requirements.some(review =>
        review.stand_id === table.stand_id && review.pdf_page === entry.pdf_page && review.text === entry.aircraft_expression));
    }
  }
  for (const stand of data.stands.stands.filter(stand => !table(stand.id))) assert.deepEqual(stand['aircraft-groups'], []);
});

test('regeneration is deterministic and preserves user sector, airline and geographic fields', () => {
  const input = structuredClone(data.stands);
  input.stands[0]['arrival-sector-group'] = 'user-arrival';
  input.stands[0]['departure-sector-group'] = 'user-departure';
  input.stands[0]['airline-groups'] = ['user-airlines'];
  const generated = buildASMDatasets(evidence, input);
  assert.deepEqual(generated.stands.stands[0].coordinates, input.stands[0].coordinates);
  for (const key of ['arrival-sector-group', 'departure-sector-group', 'airline-groups']) {
    assert.deepEqual(generated.stands.stands[0][key], input.stands[0][key]);
  }
  assert.deepEqual(buildASMDatasets(evidence, generated.stands), generated);
  assert.deepEqual(generated.aircraft.aircraft.map(item => item.id).sort(), data.aircraft.aircraft.map(item => item.id).sort());
  assert.deepEqual(generated.groups, data.aircraftGroups);
  assert.deepEqual(normalizeASM(evidence), rules.tables);
});

test('T1 254 merged Airbus cell is arrivals-only without denying regional departures', () => {
  for (const type of ['A319', 'A320-W', 'A321-NEO']) {
    assert.deepEqual(run([occupancy('target', 't1:stand:254', type, ['arrival'])]), []);
    assert.deepEqual(denied([occupancy('target', 't1:stand:254', type, ['departure'])]).map(f => f.code), ['departure-aircraft-not-allowed']);
  }
  for (const type of ['CRJ900', 'DH8-400', 'EMB175']) assert.deepEqual(run([occupancy('target', 't1:stand:254', type, ['departure'])]), []);
});

test('IFC 521 regional types are parking-only, not a stand-wide passenger prohibition', () => {
  for (const type of ['CRJ900', 'DH8-400', 'EMB175', 'EMB145']) {
    assert.deepEqual(run([occupancy('target', 'ifc:stand:521', type)]), []);
    for (const leg of ['arrival', 'departure']) {
      assert.deepEqual(denied([occupancy('target', 'ifc:stand:521', type, [leg])]).map(f => f.code), [`${leg}-aircraft-not-allowed`]);
    }
  }
  assert.deepEqual(run([occupancy('target', 'ifc:stand:521', 'A320', ['arrival', 'departure'])]), []);
});

test('120A widebody rows restrict exact types on 124 without closing the stand', () => {
  const trigger = occupancy('trigger', 't1:stand:120A', 'B777-300-ER');
  for (const type of ['A350-900', 'A350-1000', 'B777-300', 'B777-300-ER']) {
    const findings = denied([occupancy('target', 't1:stand:124', type), trigger]);
    assert.equal(findings.filter(f => f.code === 'conditional-restriction').length, 1, type);
    assert.ok(!findings.some(f => f.code === 'conditional-closure'));
  }
  assert.deepEqual(denied([occupancy('target', 't1:stand:124', 'A330-300'), trigger]), []);
  assert.deepEqual(denied([occupancy('target', 't1:stand:124', 'A350-900'), { ...trigger, start: 100, end: 200 }]), []);
  assert.deepEqual(run([occupancy('target', 't1:stand:124', 'A350-900'), occupancy('trigger', 't1:stand:120A', 'A330-300')]), []);
});

test('124 scoped restrictions prohibit B777 ER/LR and B747 on 120A, not all aircraft', () => {
  const trigger = occupancy('trigger', 't1:stand:124', 'A350-900');
  for (const type of ['B777-300-ER', 'B777-200-LR', 'B747-400']) {
    assert.ok(denied([occupancy('target', 't1:stand:120A', type), trigger]).some(f => f.code === 'conditional-restriction'), type);
  }
  assert.deepEqual(run([occupancy('target', 't1:stand:120A', 'A330-300'), trigger]), []);
});

test('aircraft-conditioned closure depends on the actual neighbor aircraft', () => {
  const input = fixture();
  input.aircraft.aircraft.find(item => item.id === aircraft('A320'))['ICAO-code'] = 'C';
  const target = occupancy('target', 't1:stand:171A', 'A380-800');
  assert.ok(denied([target, occupancy('trigger', 't1:stand:172', 'A350-900')], input).some(f => f.code === 'conditional-closure'));
  assert.deepEqual(run([target, occupancy('trigger', 't1:stand:172', 'A320')], input), []);
});

test('stand fit does not interchange winglets, Scimitar or MAX variants', () => {
  for (const type of ['B737-900-W', 'B737-800-SSW', 'B737-MAX8']) {
    assert.deepEqual(run([occupancy('target', 't1:stand:172', type)]), []);
  }
  for (const type of ['B737-900-SSW', 'B737-MAX7']) {
    assert.ok(denied([occupancy('target', 't1:stand:172', type)]).some(f => f.code === 'aircraft-not-allowed'));
  }
});

test('Code C neighbor limits accept verified C, deny larger and fail closed for absent size metadata', () => {
  const input = fixture();
  input.aircraft.aircraft.find(item => item.id === aircraft('A320'))['ICAO-code'] = 'C';
  input.aircraft.aircraft.find(item => item.id === aircraft('A330-300'))['ICAO-code'] = 'E';
  const trigger = occupancy('trigger', 't1:stand:132', 'A320');
  assert.deepEqual(denied([occupancy('target', 't1:stand:151', 'A320'), trigger], input), []);
  assert.ok(denied([occupancy('target', 't1:stand:151', 'A330-300'), trigger], input).some(f => f.denied?.includes('aircraft-size')));
  delete input.aircraft.aircraft.find(item => item.id === aircraft('A320'))['ICAO-code'];
  assert.ok(denied([occupancy('target', 't1:stand:151', 'A320'), trigger], input).some(f => f.denied?.includes('aircraft-size-unverified')));
  const limits = data.stands.stands.flatMap(stand => stand['restriction-conditions'].filter(rule => rule.allow['maximum-aircraft-size-code']).map(rule => [stand.id, rule.stand]));
  assert.deepEqual(limits, [
    ['t1:stand:151', 't1:stand:132'], ['t1:stand:151', 't1:stand:153'],
    ['t1:stand:168B', 't1:stand:166'], ['t1:stand:172', 't1:stand:171A'],
    ['t1:stand:172', 't1:stand:173A'], ['t3:stand:C35', 't3:stand:C34A'],
  ]);
});

test('relative aircraft size remains explicit and manual procedures do not become permission claims', () => {
  assert.ok(rules.review_requirements.some(review => review.kind === 'relative-aircraft-size' &&
    review.stand_id === 't1:stand:175A' && review.target_stand_id === 't1:stand:176'));
  assert.ok(!data.stands.stands.find(stand => stand.id === 't1:stand:176')['restriction-conditions'].some(rule => rule.stand === 't1:stand:175A'));
  assert.ok(table('t1:stand:124').entries.some(entry => entry.instructions.some(i => i.column === 'bridge_1') && entry.instructions.some(i => i.column === 'bridge_2')));
  assert.ok(rules.tables.flatMap(table => table.entries).some(entry => entry.stoplines.length && entry.vdgs.length));
  assert.ok(table('t1:stand:177').notes.some(note => /visual contact with the spotter/.test(note.text)));
});
