import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileAirport, evaluatePlan, getHourlyDistribution, getMinimumLegWindow, loadAirport, trafficWeightAt, validateAirport } from './airport-model.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stand = (id, extra = {}) => ({
  id, name: id, code: id, coordinates: [-122, 47], contact: true, gate_ids: [],
  'arrival-sector-group': 'both', 'departure-sector-group': 'both',
  'aircraft-groups': ['small', 'large'], closed: false,
  'airline-groups': ['group:alliance:star', 'group:alliance:oneworld'],
  'close-conditions': [], 'restriction-conditions': [], configuration_status: 'ready',
  ...extra,
});
const fixture = () => ({
  airport: { id: 'test', datasets: { stands: 'stands.json', gates: 'gates.json', buildings: 'buildings.json' } },
  stands: { schema_version: '2.0.0', airport_id: 'test', stands: [stand('A'), stand('B'), stand('C')] },
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
  airlines: { airlines: [
    { id: 'airline:ACA', name: 'Air Canada', country: 'Canada' },
    { id: 'airline:UAL', name: 'United', country: 'United States' },
    { id: 'airline:AAL', name: 'American', country: 'United States' },
  ] },
  airlineGroups: { groups: [
    { id: 'group:alliance:star', name: 'Star test pool', airlines: ['airline:ACA', 'airline:UAL'] },
    { id: 'group:alliance:oneworld', name: 'Oneworld test pool', airlines: ['airline:AAL'] },
  ] },
});
const occupancy = (id, standId, extra = {}) => {
  const result = {
    id, standId, aircraftId: 'S', start: 0, end: 10,
    arrival: { sectorId: 'domestic' }, departure: { sectorId: 'domestic' }, ...extra,
  };
  for (const leg of ['arrival', 'departure']) {
    if (result[leg]) result[leg] = { operatingAirlineId: 'airline:ACA', ...result[leg] };
  }
  return result;
};
const closure = (trigger = 'B', filters = {}) => ({
  stand: trigger, category: 'fit', description: 'Neighbor occupancy closes the stand.', ...filters,
});
const restriction = (allow, filters = {}) => ({ ...closure('B', filters), allow });
const run = (data, items) => evaluatePlan(compileAirport(data), items);
const targetFindings = findings => findings.filter(f => f.assignmentIds.includes('target'));

test('current Contoso configuration validates without warnings', () => {
  assert.deepEqual(validateAirport(loadAirport()), { errors: [], warnings: [] });
});

test('optional leg aircraft groups inherit base permissions, intersect them and reject unknown references', () => {
  const data = fixture();
  const target = occupancy('target', 'A');
  assert.deepEqual(run(data, [target]), []);
  data.stands.stands[0]['arrival-aircraft-groups'] = [];
  assert.deepEqual(run(data, [target]).map(f => f.code), ['arrival-aircraft-not-allowed']);
  assert.deepEqual(run(data, [{ ...target, arrival: undefined }]), []);
  data.stands.stands[0]['arrival-aircraft-groups'] = ['small'];
  data.stands.stands[0]['departure-aircraft-groups'] = ['large'];
  assert.deepEqual(run(data, [target]).map(f => f.code), ['departure-aircraft-not-allowed']);
  data.stands.stands[0]['aircraft-groups'] = ['large'];
  assert.ok(run(data, [target]).some(f => f.code === 'aircraft-not-allowed'));
  data.stands.stands[0]['arrival-aircraft-groups'] = ['unknown'];
  assert.ok(validateAirport(data).errors.some(error => error.includes('unknown')));
});

test('maximum code restrictions cover smaller letters and fail closed for absent or invalid metadata', () => {
  const data = fixture();
  data.stands.stands[0]['restriction-conditions'] = [restriction({ 'maximum-aircraft-size-code': 'C' })];
  const items = [occupancy('target', 'A'), occupancy('neighbor', 'B')];
  for (const code of ['A', 'B', 'C']) {
    data.aircraft.aircraft[0]['ICAO-code'] = code;
    assert.deepEqual(run(data, items), []);
  }
  for (const code of ['D', 'E', 'F', undefined, 'unknown']) {
    data.aircraft.aircraft[0]['ICAO-code'] = code;
    assert.deepEqual(targetFindings(run(data, items))[0].denied, [code && /^[D-F]$/.test(code) ? 'aircraft-size' : 'aircraft-size-unverified']);
  }
  data.stands.stands[0]['restriction-conditions'][0].allow['maximum-aircraft-size-code'] = 'G';
  assert.ok(validateAirport(data).errors.length);
});

test('multiple allowed airline groups form a union without exclusion lists', () => {
  const data = fixture();
  for (const airline of ['airline:ACA', 'airline:UAL', 'airline:AAL']) {
    assert.deepEqual(run(data, [occupancy('target', 'A', {
      arrival: { sectorId: 'domestic', operatingAirlineId: airline },
      departure: { sectorId: 'domestic', operatingAirlineId: airline },
    })]), []);
  }
  data.stands.stands[0]['airline-groups'] = ['group:alliance:star'];
  const denied = run(data, [occupancy('target', 'A', {
    arrival: { sectorId: 'domestic', operatingAirlineId: 'airline:AAL' },
  })]);
  assert.deepEqual(denied.map(f => f.code), ['arrival-airline-not-allowed']);
});

test('operating airline is checked per present leg; marketing carriers do not override it', () => {
  const data = fixture();
  data.stands.stands[0]['airline-groups'] = ['group:alliance:star'];
  const departure = { sectorId: 'domestic', operatingAirlineId: 'airline:AAL', marketingAirlineIds: ['airline:ACA'] };
  assert.deepEqual(run(data, [occupancy('target', 'A', { arrival: undefined, departure })]).map(f => f.code), ['departure-airline-not-allowed']);
  assert.deepEqual(run(data, [occupancy('target', 'A', {
    departure: undefined, arrival: { sectorId: 'domestic', operatingAirlineId: 'airline:UAL' },
  })]), []);
  assert.deepEqual(run(data, [occupancy('target', 'A', { arrival: undefined, departure: undefined })]), []);
});

test('omitted, empty and empty-member airline permissions close the stand, including parking', () => {
  const data = fixture();
  const target = occupancy('target', 'A', { arrival: undefined, departure: undefined });
  delete data.stands.stands[0]['airline-groups'];
  assert.equal(run(data, [target])[0].reason, 'no-authorized-airlines');
  data.stands.stands[0]['airline-groups'] = [];
  assert.equal(run(data, [occupancy('target', 'A')])[0].reason, 'no-authorized-airlines');
  data.airlineGroups.groups.push({ id: 'empty', name: 'Empty', airlines: [] });
  data.stands.stands[0]['airline-groups'] = ['empty'];
  assert.equal(run(data, [target])[0].reason, 'no-authorized-airlines');
});

test('an ungrouped catalog airline cannot use a stand with allowed groups', () => {
  const data = fixture();
  data.airlines.airlines.push({ id: 'ungrouped', name: 'Ungrouped', country: 'Canada' });
  const findings = run(data, [occupancy('target', 'A', {
    arrival: { sectorId: 'domestic', operatingAirlineId: 'ungrouped' }, departure: undefined,
  })]);
  assert.deepEqual(findings.map(f => f.code), ['arrival-airline-not-allowed']);
});

test('version 1 is rejected rather than silently retaining common-use eligibility', () => {
  const data = fixture();
  data.stands.schema_version = '1.0.0';
  assert.ok(validateAirport(data).errors.length);
});

const trafficFixture = () => {
  const data = fixture();
  data.airport.time_zone = 'America/Los_Angeles';
  const arrival = Array(24).fill(1);
  arrival[7] = 4;
  data.trafficProfile = {
    schema_version: '1.0.0', airport_id: 'test', synthetic: true,
    description: 'Test clock-hour weights', time_basis: 'airport-local',
    'sector-patterns': [{
      sector: 'domestic', 'arrival-hourly-weights': arrival,
      'departure-hourly-weights': Array(24).fill(2),
    }],
  };
  return data;
};

const operatingFixture = () => {
  const data = fixture();
  data.aircraft.aircraft[0]['ICAO-code'] = 'C';
  data.aircraft.aircraft[1]['ICAO-code'] = 'E';
  for (const code of ['A', 'B', 'C', 'D', 'E', 'F']) {
    data.aircraft.aircraft.push({ id: `size-${code}`, 'ICAO-code': code });
  }
  data.operatingPolicy = {
    schema_version: '1.0.0', airport_id: 'test', description: 'Test handling windows',
    'minimum-leg-windows': [
      { 'aircraft-size-codes': ['A', 'B', 'C'], 'arrival-minutes': 45, 'departure-minutes': 45 },
      { 'aircraft-size-codes': ['D', 'E', 'F'], 'arrival-minutes': 60, 'departure-minutes': 60 },
    ],
  };
  return data;
};

test('minimum arrival and departure windows are exactly 45 minutes for A/B/C and 60 for D/E/F', () => {
  const model = compileAirport(operatingFixture());
  const block = Date.parse('2026-10-21T13:00:00Z');
  for (const code of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const minutes = ['A', 'B', 'C'].includes(code) ? 45 : 60;
    assert.deepEqual(getMinimumLegWindow(model, `size-${code}`, 'arrival', block), {
      start: block, end: block + minutes * 60_000, minimumMinutes: minutes, aircraftSizeCode: code,
    });
    assert.deepEqual(getMinimumLegWindow(model, `size-${code}`, 'departure', block), {
      start: block - minutes * 60_000, end: block, minimumMinutes: minutes, aircraftSizeCode: code,
    });
  }
});

test('actual Contoso aircraft use the configured handling thresholds', () => {
  const model = compileAirport(loadAirport());
  const block = Date.parse('2026-10-21T13:00:00Z');
  assert.equal(getMinimumLegWindow(model, 'A320', 'departure', block).start, Date.parse('2026-10-21T12:15:00Z'));
  assert.equal(getMinimumLegWindow(model, 'B789', 'departure', block).start, Date.parse('2026-10-21T12:00:00Z'));
  assert.equal(getMinimumLegWindow(model, 'B738', 'arrival', block).end, Date.parse('2026-10-21T13:45:00Z'));
  assert.equal(getMinimumLegWindow(model, 'A388', 'arrival', block).end, Date.parse('2026-10-21T14:00:00Z'));
});

test('window values come from airport configuration, not hardcoded constants or custom group names', () => {
  const data = operatingFixture();
  data.operatingPolicy['minimum-leg-windows'][0]['arrival-minutes'] = 35;
  data.operatingPolicy['minimum-leg-windows'][0]['departure-minutes'] = 50;
  data.aircraftGroups['aircraft-groups'][0].name = 'Large aircraft label';
  const model = compileAirport(data);
  assert.equal(getMinimumLegWindow(model, 'S', 'arrival', 0).minimumMinutes, 35);
  assert.equal(getMinimumLegWindow(model, 'S', 'departure', 0).minimumMinutes, 50);
  assert.equal(getMinimumLegWindow(model, 'L', 'arrival', 0).minimumMinutes, 60);
});

test('minimum windows cross midnight and daylight-saving changes using elapsed UTC minutes', () => {
  const model = compileAirport(operatingFixture());
  const midnight = getMinimumLegWindow(model, 'S', 'departure', Date.parse('2026-10-22T00:15:00Z'));
  assert.equal(midnight.start, Date.parse('2026-10-21T23:30:00Z'));
  const spring = getMinimumLegWindow(model, 'S', 'arrival', Date.parse('2026-03-08T09:30:00Z'));
  assert.equal(spring.end, Date.parse('2026-03-08T10:15:00Z'));
  const fall = getMinimumLegWindow(model, 'S', 'departure', Date.parse('2026-11-01T09:15:00Z'));
  assert.equal(fall.start, Date.parse('2026-11-01T08:30:00Z'));
});

test('handling boundaries identify potential tow space but do not impose a summed minimum turn time', () => {
  const model = compileAirport(operatingFixture());
  const arrival = getMinimumLegWindow(model, 'S', 'arrival', Date.parse('2026-10-21T10:00:00Z'));
  const departure = getMinimumLegWindow(model, 'S', 'departure', Date.parse('2026-10-21T13:00:00Z'));
  assert.equal(departure.start - arrival.end, 90 * 60_000);
  const short = getMinimumLegWindow(model, 'S', 'departure', Date.parse('2026-10-21T11:15:00Z'));
  assert.ok(short.start < arrival.end);
});

test('operating policy ordering does not change size-code window selection or mutate input', () => {
  const data = operatingFixture();
  const before = structuredClone(data);
  const expected = getMinimumLegWindow(compileAirport(data), 'L', 'arrival', 0);
  assert.deepEqual(data, before);
  data.operatingPolicy['minimum-leg-windows'].reverse();
  assert.deepEqual(getMinimumLegWindow(compileAirport(data), 'L', 'arrival', 0), expected);
});

test('invalid minimum-window configuration is rejected', async t => {
  const cases = [
    ['wrong airport', data => { data.operatingPolicy.airport_id = 'another'; }],
    ['unsupported version', data => { data.operatingPolicy.schema_version = '2.0.0'; }],
    ['empty policy', data => { data.operatingPolicy['minimum-leg-windows'] = []; }],
    ['zero minutes', data => { data.operatingPolicy['minimum-leg-windows'][0]['arrival-minutes'] = 0; }],
    ['negative minutes', data => { data.operatingPolicy['minimum-leg-windows'][0]['departure-minutes'] = -1; }],
    ['fractional minutes', data => { data.operatingPolicy['minimum-leg-windows'][0]['arrival-minutes'] = 45.5; }],
    ['overflow minutes', data => { data.operatingPolicy['minimum-leg-windows'][0]['arrival-minutes'] = 1e308; }],
    ['repeated code', data => { data.operatingPolicy['minimum-leg-windows'][0]['aircraft-size-codes'].push('C'); }],
    ['overlapping rules', data => { data.operatingPolicy['minimum-leg-windows'][1]['aircraft-size-codes'].push('C'); }],
    ['unknown code', data => { data.operatingPolicy['minimum-leg-windows'][0]['aircraft-size-codes'].push('G'); }],
    ['missing aircraft code', data => { delete data.aircraft.aircraft[0]['ICAO-code']; }],
    ['uncovered aircraft code', data => { data.operatingPolicy['minimum-leg-windows'][0]['aircraft-size-codes'] = ['A', 'B']; }],
    ['unknown property', data => { data.operatingPolicy.towDuration = 15; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const data = operatingFixture();
    mutate(data);
    assert.ok(validateAirport(data).errors.length > 0);
  });
});

test('minimum-window lookup rejects missing policy, unknown aircraft and invalid timing', () => {
  const model = compileAirport(operatingFixture());
  assert.throws(() => getMinimumLegWindow(model, 'S', 'tow', 0), /Unknown leg direction/);
  assert.throws(() => getMinimumLegWindow(model, 'missing', 'arrival', 0), /Unknown aircraft/);
  assert.throws(() => getMinimumLegWindow(model, 'S', 'arrival', NaN), /valid UTC/);
  assert.throws(() => getMinimumLegWindow(model, 'S', 'arrival', Infinity), /valid UTC/);
  assert.throws(() => getMinimumLegWindow(model, 'S', 'arrival', '13:00'), /valid UTC/);
  assert.throws(() => getMinimumLegWindow(model, 'S', 'arrival', 8_640_000_000_000_000), /timestamp range/);
  assert.throws(() => getMinimumLegWindow(model, 'S', 'departure', -8_640_000_000_000_000), /timestamp range/);
  assert.throws(() => getMinimumLegWindow(compileAirport(fixture()), 'S', 'arrival', 0), /not configured/);
});

test('optional profile validation reports each schema error once', () => {
  const data = trafficFixture();
  data.trafficProfile['sector-patterns'][0]['arrival-hourly-weights'].pop();
  assert.equal(validateAirport(data).errors.filter(error => error.startsWith('trafficProfile')).length, 1);
});

test('traffic weights normalize independently by sector and direction without mutation', () => {
  const data = trafficFixture();
  const before = structuredClone(data);
  const model = compileAirport(data);
  const arrival = getHourlyDistribution(model, 'domestic', 'arrival');
  const departure = getHourlyDistribution(model, 'domestic', 'departure');
  assert.equal(arrival.length, 24);
  assert.ok(Math.abs(arrival.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(Math.abs(departure.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.equal(arrival[7], 4 / 27);
  assert.equal(departure[7], 1 / 24);
  arrival[7] = 0;
  assert.equal(getHourlyDistribution(model, 'domestic', 'arrival')[7], 4 / 27);
  assert.deepEqual(data, before);
});

test('traffic lookup uses airport-local time instead of UTC', () => {
  const model = compileAirport(trafficFixture());
  const atSeven = trafficWeightAt(model, 'domestic', 'arrival', Date.parse('2026-10-21T14:00:00Z'));
  const atEight = trafficWeightAt(model, 'domestic', 'arrival', Date.parse('2026-10-21T15:00:00Z'));
  assert.equal(atSeven, 4 * atEight);
});

test('repeated and skipped daylight-saving hours follow local clock labels', () => {
  const data = trafficFixture();
  data.trafficProfile['sector-patterns'][0]['arrival-hourly-weights'][1] = 3;
  data.trafficProfile['sector-patterns'][0]['arrival-hourly-weights'][3] = 7;
  const model = compileAirport(data);
  const distribution = getHourlyDistribution(model, 'domestic', 'arrival');
  const lookup = instant => trafficWeightAt(model, 'domestic', 'arrival', Date.parse(instant));
  assert.equal(lookup('2026-11-01T08:30:00Z'), distribution[1]);
  assert.equal(lookup('2026-11-01T09:30:00Z'), distribution[1]);
  assert.equal(lookup('2026-03-08T09:30:00Z'), distribution[1]);
  assert.equal(lookup('2026-03-08T10:30:00Z'), distribution[3]);
});

test('traffic profiles are shaping inputs, not capacity constraints', () => {
  const data = trafficFixture();
  data.trafficProfile['sector-patterns'][0]['arrival-hourly-weights'][0] = 0;
  assert.deepEqual(run(data, [occupancy('target', 'A')]), []);
});

test('invalid traffic authoring is rejected explicitly', async t => {
  const cases = [
    ['wrong hour count', data => data.trafficProfile['sector-patterns'][0]['arrival-hourly-weights'].pop()],
    ['negative weight', data => { data.trafficProfile['sector-patterns'][0]['arrival-hourly-weights'][0] = -1; }],
    ['zero total', data => { data.trafficProfile['sector-patterns'][0]['arrival-hourly-weights'] = Array(24).fill(0); }],
    ['overflow total', data => { data.trafficProfile['sector-patterns'][0]['arrival-hourly-weights'] = Array(24).fill(1e308); }],
    ['unknown sector', data => { data.trafficProfile['sector-patterns'][0].sector = 'missing'; }],
    ['duplicate sector', data => data.trafficProfile['sector-patterns'].push(structuredClone(data.trafficProfile['sector-patterns'][0]))],
    ['wrong airport', data => { data.trafficProfile.airport_id = 'another'; }],
    ['missing timezone', data => { delete data.airport.time_zone; }],
    ['invalid timezone', data => { data.airport.time_zone = 'Not/AZone'; }],
    ['unknown property', data => { data.trafficProfile.capacity = 50; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const data = trafficFixture();
    mutate(data);
    assert.ok(validateAirport(data).errors.length > 0);
  });
});

test('traffic lookups do not fall back for missing patterns, invalid directions or bad instants', () => {
  const model = compileAirport(trafficFixture());
  assert.throws(() => getHourlyDistribution(model, 'missing', 'arrival'), /No traffic pattern/);
  assert.throws(() => getHourlyDistribution(model, 'domestic', 'landing'), /Unknown traffic direction/);
  assert.throws(() => trafficWeightAt(model, 'domestic', 'arrival', NaN), /valid UTC/);
  assert.throws(() => getHourlyDistribution(compileAirport(fixture()), 'domestic', 'arrival'), /No traffic pattern/);
});

test('schema rejects authoring mistakes', async t => {
  const cases = [
    ['numeric ID', data => { data.stands.stands[0].id = 1; }],
    ['whitespace ID', data => { data.stands.stands[0].id = ' '; }],
    ['unknown field', data => { data.stands.stands[0]['aircraft-group'] = ['small']; }],
    ['duplicate allowed group', data => { data.stands.stands[0]['aircraft-groups'] = ['small', 'small']; }],
    ['missing ready permission', data => { delete data.stands.stands[0]['arrival-sector-group']; }],
    ['bad coordinate', data => { data.stands.stands[0].coordinates = [-181, 47]; }],
    ['unsupported version', data => { data.stands.schema_version = '99.0.0'; }],
    ['null airline permission', data => { data.stands.stands[0]['airline-groups'] = null; }],
    ['duplicate airline permission', data => { data.stands.stands[0]['airline-groups'] = ['group:alliance:star', 'group:alliance:star']; }],
    ['repeated airline member', data => { data.airlineGroups.groups[0].airlines.push('airline:ACA'); }],
    ['airline trigger not supported', data => { data.stands.stands[0]['close-conditions'] = [closure('B', { 'airline-groups': ['group:alliance:star'] })]; }],
    ['airline restriction not supported', data => { data.stands.stands[0]['restriction-conditions'] = [restriction({ 'airline-groups': ['group:alliance:star'] })]; }],
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
    ['unknown airline group', data => { data.stands.stands[0]['airline-groups'] = ['missing']; }],
    ['unknown airline member', data => { data.airlineGroups.groups[0].airlines.push('missing'); }],
    ['duplicate airline', data => { data.airlines.airlines.push({ id: 'airline:ACA', name: 'Duplicate', country: 'Canada' }); }],
    ['duplicate airline group', data => { data.airlineGroups.groups.push(structuredClone(data.airlineGroups.groups[0])); }],
    ['overlapping airline groups', data => { data.airlineGroups.groups[1].airlines.push('airline:ACA'); }],
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
    ['missing operator', { arrival: { sectorId: 'domestic', operatingAirlineId: undefined } }],
    ['unknown operator', { departure: { sectorId: 'domestic', operatingAirlineId: 'missing' } }],
  ]) await t.test(name, () => assert.throws(() => run(fixture(), [occupancy('target', 'A', extra)])));
  assert.throws(() => run(fixture(), [occupancy('target', 'A'), occupancy('target', 'B')]), /duplicate/);
  const data = fixture();
  data.stands.stands[0].configuration_status = 'geometry-only';
  assert.throws(() => run(data, [occupancy('target', 'A')]), /not configured/);
});

test('Contoso contact closures free remote alternatives with explicit test airline authorizations', () => {
  const data = loadAirport();
  for (const item of data.stands.stands) item['airline-groups'] = data.airlineGroups.groups.map(group => group.id);
  const model = compileAirport(data);
  const at = (code, aircraftId = 'B738') => occupancy(code, `t1:stand:${code}`, { aircraftId });
  for (const [largeStand, contacts, remotes] of [
    ['102', ['101', '103'], ['R01', 'R03']],
    ['112', ['111', '113'], ['R04', 'R02']],
  ]) {
    const large = at(largeStand, 'B789');
    assert.equal(evaluatePlan(model, [large, ...contacts.map(code => at(code))]).filter(f => f.code === 'conditional-closure').length, 2);
    assert.deepEqual(evaluatePlan(model, [large, ...remotes.map(code => at(code))]), []);
  }
  for (const [contact, remote] of [['101', 'R01'], ['103', 'R03'], ['111', 'R04']]) {
    assert.equal(evaluatePlan(model, [at(contact), at(remote)])[0].code, 'conditional-closure');
  }
  assert.deepEqual(evaluatePlan(model, [at('113'), at('R02')]), []);
  assert.deepEqual(model.gatesToStands.get('t1:gate:A14'), ['t1:stand:R02']);
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

test('documented traffic and operating policy examples validate', () => {
  const document = readFileSync(join(root, 'docs', 'airport-characteristics.md'), 'utf8');
  const examples = [...document.matchAll(/<!-- example: (traffic-profile|operating-policy) -->\s*```json\r?\n([\s\S]*?)```/g)];
  assert.ok(examples.length > 0);
  assert.equal(examples.length, [...document.matchAll(/```json\r?\n/g)].length);
  for (const [, kind, json] of examples) {
    const data = loadAirport();
    data[kind === 'traffic-profile' ? 'trafficProfile' : 'operatingPolicy'] = JSON.parse(json);
    assert.deepEqual(validateAirport(data).errors, []);
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
