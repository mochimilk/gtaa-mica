import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileAirport, evaluatePlan, loadAirport, readJson } from './airport-model.mjs';
import { fingerprint, loadCapacityProfile, sourceOccupancies } from './capacity-probe.mjs';
import { assessAccommodation, loadAccommodationProfile, prepareAccommodation, requestOccupancy, validateAccommodationProfile } from './accommodation.mjs';
import { generateScenario, loadScenarioProfile } from './scenario-generator.mjs';
import { spawnSync } from 'node:child_process';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));
const airport = loadAirport(path('../data/airports/contoso/airport.json'));
const scenarioProfile = loadScenarioProfile(path('../data/airports/contoso/demand/full-day-profile.json'));
const sources = [{
  snapshot: readJson(path('../src/data-sources/prepared/contoso/full-day.json')),
  raw: generateScenario(scenarioProfile, airport, 'full-day').raw_demand,
}];
const profile = loadAccommodationProfile(), probes = loadCapacityProfile().probes;
const model = compileAirport(airport);
const routeGeneration = scenarioProfile.route_generation;

test('accommodation profile is strict, bounded to one changed visit and complete across cases', () => {
  for (const change of [
    { ...profile, max_changed_visits: 2 }, { ...profile, max_displayed_options: 0 },
    { ...profile, cases: [profile.cases[0], profile.cases[0], profile.cases[2]] },
    { ...profile, cases: profile.cases.slice(1) }, { ...profile, allowSoftAirlinePermissions: true },
  ]) assert.throws(() => validateAccommodationProfile(change), /accommodation|Accommodation/);
});

test('all frozen alternatives reproduce, preserve commitments and independently pass the full rule evaluator', () => {
  for (const { snapshot, raw } of sources) {
    const frozen = fingerprint({ snapshot, raw, airport, profile });
    const definition = profile.cases.find(item => item.case_id === snapshot.case_id);
    const evidence = prepareAccommodation(snapshot, raw, airport, profile, probes.find(probe => probe.id === definition.probe_id), routeGeneration);
    assert.deepEqual(evidence, readJson(path(`../src/data-sources/prepared/contoso/${snapshot.case_id}.accommodation.json`)));
    assert.ok(Date.parse(evidence.approved_at) < Date.parse(evidence.received_at));
    assert.ok(Date.parse(evidence.received_at) < Date.parse(evidence.request.start));
    const fixed = sourceOccupancies(snapshot, raw), incoming = requestOccupancy(evidence.request);
    for (const [variant, result] of Object.entries(evidence.variants)) {
      assert.equal(result.options.length, result.total_options_found);
      assert.equal(result.status, 'options-found');
      assert.equal(result.search, snapshot.case_id === 'full-day' ? 'single-whole-turn-relocation' : 'direct-placement');
      for (const option of result.options) {
        assert.equal(option.target_stand_contact, model.stands.get(option.target_stand_id).contact);
        const proposed = fixed[variant].map(item => {
          const move = option.moves.find(move => move.stay_id === item.id);
          return move ? { ...item, standId: move.to_stand_id } : { ...item };
        });
        assert.ok(option.moves.length <= 1);
        assert.equal(option.moves.length, option.kind === 'direct' ? 0 : 1);
        for (const item of proposed) {
          const original = fixed[variant].find(source => source.id === item.id);
          assert.deepEqual({ ...item, standId: original.standId }, original);
        }
        for (const move of option.moves) assert.equal(move.to_stand_contact, model.stands.get(move.to_stand_id).contact);
        assert.deepEqual(evaluatePlan(model, [...proposed, { ...incoming, standId: option.target_stand_id }]), []);
        assert.equal(proposed.length, fixed[variant].length);
      }
      if (snapshot.case_id === 'full-day') {
        const protectedResult = assessAccommodation(model, fixed[variant], incoming, new Set());
        assert.equal(protectedResult.status, 'no-acceptable-option-found');
        assert.equal(protectedResult.total_options_found, 0);
        assert.deepEqual(protectedResult.options, []);
      }
    }
    assert.equal(fingerprint({ snapshot, raw, airport, profile }), frozen);
  }
});

test('direct fits do not search or introduce optional disruption; invalid plans and catalog identities fail explicitly', () => {
  const { snapshot } = sources[0];
  const evidence = readJson(path(`../src/data-sources/prepared/contoso/${snapshot.case_id}.accommodation.json`));
  const incoming = requestOccupancy(evidence.request);
  const result = assessAccommodation(model, [], incoming, new Set());
  assert.equal(result.search, 'direct-placement');
  assert.ok(result.options.every(option => option.kind === 'direct' && !option.moves.length));
  assert.throws(() => assessAccommodation(model, [], { ...incoming, aircraftId: 'unknown' }, new Set()), /Unknown/);
  assert.throws(() => assessAccommodation(model, [{ ...incoming, standId: 'unknown' }], incoming, new Set()), /Invalid/);
});

test('accommodation generation requires explicit source identity, policy and routing', () => {
  const { snapshot, raw } = sources[0], probe = probes.find(item => item.id === 'aal-domestic');
  const prepare = (source = snapshot, config = profile, routes = routeGeneration) =>
    prepareAccommodation(source, raw, airport, config, probe, routes);
  assert.throws(() => prepare(null), /source snapshot/);
  assert.throws(() => prepare({ ...snapshot, airport: { ...snapshot.airport, id: 'gtaa' } }), /identity/);
  assert.throws(() => prepare(snapshot, { ...profile, id: 'gtaa:late-request' }), /identity/);
  assert.throws(() => prepare(snapshot, profile, null), /explicit route-generation/);
  const changed = structuredClone(snapshot);
  changed.rows[1] = changed.rows[0];
  assert.throws(() => prepare(changed), /identity/);
  const collision = structuredClone(snapshot);
  collision.variants.baseline.stays[0].id = `late-request:${snapshot.case_id}/stay`;
  assert.throws(() => prepare(collision), /collides/);
  const result = spawnSync(process.execPath, [path('./prepare-accommodation.mjs')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicit --airport/);
});

test('a real international-bank request has no acceptable direct or one-turn repair option without dropping existing demand', () => {
  const { snapshot, raw } = sources.find(item => item.snapshot.case_id === 'full-day');
  const probe = probes.find(item => item.id === 'baw-international');
  const input = {
    ...profile,
    cases: profile.cases.map(item => item.case_id === 'full-day'
      ? { ...item, probe_id: probe.id, start_offset_minutes: 900, duration_minutes: 120 } : item),
  };
  const evidence = prepareAccommodation(snapshot, raw, airport, input, probe, routeGeneration);
  for (const result of Object.values(evidence.variants)) {
    assert.equal(result.status, 'no-acceptable-option-found');
    assert.equal(result.search, 'single-whole-turn-relocation');
    assert.equal(result.total_options_found, 0);
    assert.deepEqual(result.options, []);
    assert.equal(result.blocked_stands.length, 4);
    assert.ok(result.blocked_stands.every(item => item.blocking_stay_ids.length > 0 && item.reasons.length > 0));
  }
});

test('accommodation generation is airport-owned rather than hardcoded to Contoso', () => {
  const alternative = structuredClone(airport), snapshot = structuredClone(sources[0].snapshot), raw = structuredClone(sources[0].raw);
  alternative.airport.id = snapshot.airport.id = raw.airport_id = 'another-airport';
  for (const document of Object.values(alternative)) {
    if (document && typeof document === 'object' && 'airport_id' in document) document.airport_id = 'another-airport';
  }
  const config = { ...profile, id: 'another-airport:late-request' };
  const result = prepareAccommodation(snapshot, raw, alternative, config, probes.find(item => item.id === 'aal-domestic'), routeGeneration);
  assert.equal(result.airport_id, 'another-airport');
  assert.equal(result.profile.id, config.id);
  assert.equal(result.snapshot_fingerprint, fingerprint(snapshot));
  assert.equal(result.airport_fingerprint, fingerprint(alternative));
  for (const variant of Object.values(result.variants)) assert.equal(variant.options.length, 8);
});
