import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDemandRouteSampler, createRouteSampler, deriveRouteProfile, loadCatalogs, validateCatalogs } from './airport-catalogs.mjs';

const fixture = () => ({
  airlines: { airlines: [
    { id: 'airline:ACA', name: 'Air Canada', iata: 'AC', icao: 'ACA', country: 'Canada', hub_airports: ['YYZ', 'YVR'] },
    { id: 'airline:UAL', name: 'United', iata: 'UA', icao: 'UAL', country: 'United States', hub_airports: ['ORD', 'SFO'] },
    { id: 'airline:BAW', name: 'British Airways', iata: 'BA', icao: 'BAW', country: 'United Kingdom', hub_airports: ['LHR'] },
  ] },
  airports: { airports: [
    { code: 'YYZ', name: 'Toronto Pearson', city: 'Toronto', country: 'Canada', airlines: [
      { airline_id: 'airline:ACA' }, { airline_id: 'airline:UAL' }, { airline_id: 'airline:BAW' },
    ] },
    { code: 'YVR', name: 'Vancouver', city: 'Vancouver', country: 'Canada' },
    { code: 'YUL', name: 'Montreal', city: 'Montreal', country: 'Canada' },
    { code: 'ORD', name: 'Chicago', city: 'Chicago', country: 'United States' },
    { code: 'SFO', name: 'San Francisco', city: 'San Francisco', country: 'United States' },
    { code: 'LAX', name: 'Los Angeles', city: 'Los Angeles', country: 'United States' },
    { code: 'LHR', name: 'London Heathrow', city: 'London', country: 'United Kingdom' },
    { code: 'EDI', name: 'Edinburgh', city: 'Edinburgh', country: 'United Kingdom' },
  ] },
});
const host = data => data.airports.airports.find(airport => airport.code === 'YYZ');
const carrier = (profile, id) => profile.airlines.find(airline => airline.airline_id === `airline:${id}`);
const sum = rows => rows.reduce((total, row) => total + row.probability, 0);
const samples = (sampler, seed = 'test', count = 100) =>
  Array.from({ length: count }, (_, index) => sampler.sample({ seed, key: `leg:${index}` }));

test('checked-in catalogs cover all 58 airlines and validate configured host routes', () => {
  const data = loadCatalogs();
  assert.equal(data.airlines.airlines.length, 58);
  assert.ok(data.airports.airports.length >= 104);
  assert.deepEqual(validateCatalogs(data).errors, []);
  assert.ok(validateCatalogs(data).warnings.every(warning => warning.includes('no hub hints')));
  const sampler = createRouteSampler(data, 'YYZ');
  assert.equal(sampler.profile.airlines.length, 6);
  const airline = carrier(sampler.profile, 'ACA');
  assert.equal(airline.weight, 8);
  assert.equal(carrier(sampler.profile, 'WJA').weight, 4);
  assert.ok(airline.routes.some(route => route.airport_code === 'YVR' && route.weight === 5));
  assert.ok(airline.routes.some(route => route.airport_code === 'YXY' && route.weight === 1));
  for (const sample of samples(sampler)) {
    assert.notEqual(sample.airport_code, 'YYZ');
    assert.ok(data.airports.airports.some(airport => airport.code === sample.airport_code));
  }
});

test('host carrier shares are independent of the number of route choices', () => {
  const profile = deriveRouteProfile(fixture(), 'YYZ');
  assert.equal(carrier(profile, 'ACA').weight, 4);
  assert.equal(carrier(profile, 'UAL').weight, 1);
  assert.equal(carrier(profile, 'BAW').weight, 1);
  assert.equal(carrier(profile, 'ACA').probability, 4 / 6);
  assert.equal(carrier(profile, 'UAL').probability, 1 / 6);
  assert.equal(carrier(profile, 'BAW').probability, 1 / 6);
  assert.ok(Math.abs(sum(profile.airlines) - 1) < 1e-12);
  for (const airline of profile.airlines) assert.ok(Math.abs(sum(airline.routes) - 1) < 1e-12);
});

test('every catalog airline can derive a non-self endpoint when included at the example host', () => {
  const data = loadCatalogs();
  host(data).airlines = data.airlines.airlines.map(airline => ({ airline_id: airline.id }));
  const sampler = createRouteSampler(data, 'YYZ');
  assert.equal(sampler.profile.airlines.length, 58);
  for (const airline of data.airlines.airlines) {
    const result = sampler.sample({ seed: 'all-carriers', key: 'arrival', airline_id: airline.id });
    assert.equal(result.airline_id, airline.id);
    assert.notEqual(result.airport_code, 'YYZ');
    if (airline.country !== 'Canada' && airline.hub_airports) {
      assert.ok(airline.hub_airports.includes(result.airport_code));
    } else {
      assert.equal(data.airports.airports.find(airport => airport.code === result.airport_code).country, airline.country);
    }
  }
});

test('local carriers prefer hubs over other home-country airports and never route to the host', () => {
  const profile = deriveRouteProfile(fixture(), 'YYZ');
  assert.deepEqual(carrier(profile, 'ACA').routes, [
    { airport_code: 'YUL', country: 'Canada', weight: 1, basis: 'home-country', probability: 1 / 6 },
    { airport_code: 'YVR', country: 'Canada', weight: 5, basis: 'hub', probability: 5 / 6 },
  ]);
  assert.deepEqual(carrier(profile, 'UAL').routes.map(route => route.airport_code), ['ORD', 'SFO']);
  assert.deepEqual(carrier(profile, 'BAW').routes.map(route => route.airport_code), ['LHR']);
});

test('a multinational hub is a local base without losing home-country coverage', () => {
  const data = fixture();
  data.airlines.airlines.find(airline => airline.id === 'airline:BAW').hub_airports.push('YYZ');
  const profile = deriveRouteProfile(data, 'YYZ');
  assert.equal(carrier(profile, 'BAW').weight, 4);
  assert.deepEqual(carrier(profile, 'BAW').routes.map(route => route.airport_code), ['EDI', 'LHR']);
  const actual = loadCatalogs();
  const sas = actual.airlines.airlines.find(airline => airline.id === 'airline:SAS');
  assert.ok(sas.hub_airports.includes('CPH'));
  assert.deepEqual(validateCatalogs(actual).errors, []);
});

test('single-airport home countries need no hub configuration', () => {
  const data = fixture();
  data.airports.airports = data.airports.airports.filter(airport => airport.code !== 'EDI');
  delete data.airlines.airlines.find(airline => airline.id === 'airline:BAW').hub_airports;
  assert.deepEqual(validateCatalogs(data), { errors: [], warnings: [] });
  assert.deepEqual(carrier(deriveRouteProfile(data, 'YYZ'), 'BAW').routes, [
    { airport_code: 'LHR', country: 'United Kingdom', weight: 1, basis: 'home-country', probability: 1 },
  ]);
});

test('missing multi-airport hub hints produce an explicit warning and country-based choices', () => {
  const data = fixture();
  delete data.airlines.airlines.find(airline => airline.id === 'airline:UAL').hub_airports;
  const profile = deriveRouteProfile(data, 'YYZ');
  assert.match(profile.warnings.join('\n'), /airline:UAL.*no hub hints.*3 home-country/);
  assert.deepEqual(carrier(profile, 'UAL').routes.map(route => [route.airport_code, route.weight]), [
    ['LAX', 1], ['ORD', 1], ['SFO', 1],
  ]);
});

test('host overrides change airline shares and zero disables a carrier', () => {
  const data = fixture();
  host(data).airlines[0].weight = 1;
  host(data).airlines[1].weight = 0;
  host(data).airlines[2].weight = 3;
  const sampler = createRouteSampler(data, 'YYZ');
  assert.deepEqual(sampler.profile.airlines.map(airline => [airline.airline_id, airline.probability]), [
    ['airline:ACA', 0.25], ['airline:BAW', 0.75],
  ]);
  assert.ok(samples(sampler).every(sample => sample.airline_id !== 'airline:UAL'));
  assert.throws(() => sampler.sample({ seed: 's', key: 'leg', airline_id: 'airline:UAL' }), /not enabled/);
});

test('fixed keyed sampling is repeatable, order-independent and does not use wall-clock randomness', () => {
  const data = fixture();
  const first = createRouteSampler(data, 'YYZ');
  const expected = samples(first);
  assert.deepEqual(samples(first), expected);
  const reordered = structuredClone(data);
  reordered.airports.airports.reverse();
  reordered.airlines.airlines.reverse();
  host(reordered).airlines.reverse();
  for (const airline of reordered.airlines.airlines) airline.hub_airports.reverse();
  const second = createRouteSampler(reordered, 'YYZ');
  assert.equal(JSON.stringify(first.profile), JSON.stringify(second.profile));
  assert.deepEqual(samples(second), expected);
  assert.deepEqual(Array.from({ length: 100 }, (_, index) =>
    first.sample({ seed: 'test', key: `leg:${99 - index}` })).reverse(), expected);
  assert.notDeepEqual(samples(first, 'another seed'), expected);
});

test('an explicit operating airline preserves its route draw when carrier shares change', () => {
  const data = fixture();
  const first = createRouteSampler(data, 'YYZ');
  host(data).airlines[0].weight = 99;
  const second = createRouteSampler(data, 'YYZ');
  for (let index = 0; index < 100; index++) {
    const args = { seed: 's', key: `leg:${index}`, airline_id: 'airline:ACA' };
    assert.deepEqual(first.sample(args), second.sample(args));
  }
  first.profile.airlines.length = 0;
  assert.ok(first.sample({ seed: 's', key: 'leg' }));
});

test('sampling follows carrier and conditional route weights within measured tolerances', () => {
  const sampler = createRouteSampler(fixture(), 'YYZ');
  const draws = samples(sampler, 'measured-weight-test', 12000);
  const ac = draws.filter(sample => sample.airline_id === 'airline:ACA');
  assert.ok(Math.abs(ac.length / draws.length - 4 / 6) < 0.02, `AC share: ${ac.length / draws.length}`);
  const vancouver = ac.filter(sample => sample.airport_code === 'YVR');
  assert.ok(Math.abs(vancouver.length / ac.length - 5 / 6) < 0.02, `AC YVR share: ${vancouver.length / ac.length}`);
  const british = draws.filter(sample => sample.airline_id === 'airline:BAW');
  assert.ok(Math.abs(british.length / draws.length - 1 / 6) < 0.02, `BA share: ${british.length / draws.length}`);
  assert.ok(british.every(sample => sample.airport_code === 'LHR'));
});

test('schema rejects incomplete airport metadata, invalid codes, unknown fields and malformed rosters', () => {
  for (const mutate of [
    data => { delete host(data).country; },
    data => { host(data).code = 'yyz'; },
    data => { host(data).name = '   '; },
    data => { host(data).country = 'Canada '; },
    data => { host(data).country = 'Canada\n'; },
    data => { host(data).unexpected = true; },
    data => { host(data).airlines = []; },
    data => { host(data).airlines[0].unexpected = true; },
    data => { host(data).airlines[0].weight = -1; },
    data => { host(data).airlines[0].weight = 0.5; },
    data => { host(data).airlines[0].weight = '4'; },
    data => { host(data).airlines[0].weight = 1000001; },
    data => { data.airlines.airlines[0].country = 'Canada '; },
    data => { data.airlines.airlines[0].country = 'Canada\n'; },
    data => { data.airlines.airlines[0].hub_airports = []; },
    data => { data.airlines.airlines[0].hub_airports = ['YYZ', 'YYZ']; },
  ]) {
    const data = fixture();
    mutate(data);
    assert.ok(validateCatalogs(data).errors.length);
    assert.throws(() => createRouteSampler(data, 'YYZ'), /Invalid route catalogs/);
  }
});

test('duplicate IDs/codes and unknown hub or host-airline references are explicit errors', () => {
  for (const [mutate, expected] of [
    [data => { data.airports.airports.push(structuredClone(host(data))); }, /duplicate code YYZ/],
    [data => { data.airlines.airlines.push(structuredClone(data.airlines.airlines[0])); }, /duplicate id airline:ACA/],
    [data => { data.airlines.airlines[1].iata = 'AC'; }, /duplicate iata AC/],
    [data => { data.airlines.airlines[1].icao = 'ACA'; }, /duplicate icao ACA/],
    [data => { host(data).airlines.push({ airline_id: 'airline:ACA' }); }, /duplicate airline_id airline:ACA/],
    [data => { host(data).airlines[0] = { airline_id: 'missing', weight: 0 }; }, /unknown airline missing/],
    [data => { data.airlines.airlines[0].hub_airports = ['ZZZ']; }, /unknown airport ZZZ/],
    [data => { data.airlines.airlines[0].hub_airports = ['LHR']; }, /include at least one home-country/],
    [data => { data.airlines.airlines[0].country = 'Missing country'; }, /no airport in home country Missing country/],
    [data => { data.airlines.airlines = []; }, /at least one airline/],
  ]) {
    const data = fixture();
    mutate(data);
    assert.match(validateCatalogs(data).errors.join('\n'), expected);
  }
});

test('unconfigured hosts, empty eligible routes and all-zero carrier weights never fall back silently', () => {
  assert.throws(() => deriveRouteProfile(fixture(), 'XXX'), /Unknown host airport/);
  assert.throws(() => deriveRouteProfile(fixture(), 'YVR'), /no synthetic airline roster/);
  const zero = fixture();
  for (const entry of host(zero).airlines) entry.weight = 0;
  assert.match(validateCatalogs(zero).errors.join('\n'), /positive carrier weight/);
  const noRoutes = fixture();
  noRoutes.airports.airports = noRoutes.airports.airports.filter(airport => airport.code !== 'EDI');
  noRoutes.airports.airports.find(airport => airport.code === 'LHR').airlines = [{ airline_id: 'airline:BAW' }];
  assert.match(validateCatalogs(noRoutes).errors.join('\n'), /no external route airports/);
  assert.throws(() => deriveRouteProfile(noRoutes, 'LHR'), /no external route airports/);
});

test('sampling rejects missing seeds/keys and airlines outside the host roster', () => {
  const sampler = createRouteSampler(fixture(), 'YYZ');
  for (const args of [undefined, {}, { seed: 's' }, { seed: '', key: 'k' }, { seed: 's', key: ' ' }]) {
    assert.throws(() => sampler.sample(args), /nonblank seed and stable leg key/);
  }
  assert.throws(() => sampler.sample({ seed: 's', key: 'k', airline_id: 'missing' }), /not enabled/);
});

test('demand route sampling requires explicit keys and supported sector/market choices', () => {
  const sampler = createDemandRouteSampler(fixture(), { id: 'test', country: 'Canada' }, {
    markets: [{ id: 'europe', weight: 1, airports: [{ airport_code: 'LHR', weight: 1 }] }],
  });
  assert.throws(() => sampler.sample(), /nonblank seed/);
  assert.throws(() => sampler.sample({ seed: 's', key: ' ' }), /nonblank seed/);
  assert.throws(() => sampler.validateRow('airline:ACA', 'transborder'), /sector policy/);
  assert.throws(() => sampler.validateRow('airline:BAW', 'domestic'), /No domestic route/);
  assert.throws(() => sampler.validateRow('airline:BAW', 'international', 'asia'), /Unknown route market/);
  assert.throws(() => sampler.validateRow('airline:UAL', 'international'), /No international route/);
  assert.deepEqual(sampler.sample({
    seed: 's', key: 'arrival:1', airline_id: 'airline:BAW', sector_id: 'international', market_id: 'europe',
  }), { airport_code: 'LHR', market_id: 'europe' });
});

test('catalog CLI validates, previews routes and fails explicitly for invalid arguments/hosts', () => {
  const cli = fileURLToPath(new URL('./validate-catalogs.mjs', import.meta.url));
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const success = run([]);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /PASS 58 airlines, \d+ airports/);
  const preview = run(['--host', 'YYZ']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).host_airport_code, 'YYZ');
  for (const args of [['unexpected'], ['--host'], ['--host', 'XXX'], ['--host', 'YVR']]) {
    const failure = run(args);
    assert.equal(failure.status, 1);
    assert.ok(failure.stderr.trim());
  }
});
