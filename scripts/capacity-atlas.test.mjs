import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileAirport, evaluatePlan, readJson } from './airport-model.mjs';
import { fingerprint, sourceOccupancies } from './capacity-probe.mjs';
import { atlasDayParameters, loadAtlasProfile, prepareCapacityAtlas, replayAtlasDay, validateAtlasProfile } from './capacity-atlas.mjs';
import { loadFrozenScenarioSources } from './prepare-capacity.mjs';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));

test('atlas profiles reject unknown fields, invalid dates and inverted timing ranges', () => {
  const profile = loadAtlasProfile();
  for (const change of [
    { ...profile, start_date: '2026-02-30' }, { ...profile, day_count: 0 },
    { ...profile, planned_shift_minutes: [30, -30] }, { ...profile, outcome_scale_basis_points: [0, 10000] },
    { ...profile, hiddenWeight: 3 },
  ]) assert.throws(() => validateAtlasProfile(change), /atlas|Atlas/);
  assert.deepEqual(atlasDayParameters(profile, profile.start_date), atlasDayParameters(profile, profile.start_date));
});

test('all synthetic days preserve authoritative hard feasibility and exact prepared evidence without mutating sources', () => {
  const { airport, sources } = loadFrozenScenarioSources(), profile = loadAtlasProfile(), model = compileAirport(airport);
  for (const { snapshot, raw } of sources) {
    const capacity = readJson(path(`../src/demo/prepared/${snapshot.case_id}.capacity.json`));
    const frozen = fingerprint({ snapshot, raw, airport, capacity, profile });
    const atlas = prepareCapacityAtlas(snapshot, raw, airport, capacity, profile);
    assert.deepEqual(atlas, readJson(path(`../src/demo/prepared/${snapshot.case_id}.atlas.json`)));
    assert.equal(atlas.days.length, 30);
    assert.equal(atlas.days[0].date, '2026-09-24');
    assert.equal(atlas.days.at(-1).date, '2026-10-23');
    const occupancy = sourceOccupancies(snapshot, raw), origin = Date.parse(snapshot.plan_window.start);
    for (const day of atlas.days) {
      assert.deepEqual(day.parameters, atlasDayParameters(profile, day.date));
      for (const items of Object.values(occupancy)) for (const outcome of [false, true]) {
        const replay = replayAtlasDay(items, origin, day.parameters, outcome);
        assert.deepEqual(evaluatePlan(model, replay), []);
        assert.deepEqual(replay.map(item => item.id), items.map(item => item.id));
        assert.deepEqual(replay.map(item => item.standId), items.map(item => item.standId));
        assert.ok(replay.every(item => Number.isSafeInteger(item.start) && item.end > item.start));
      }
    }
    assert.equal(fingerprint({ snapshot, raw, airport, capacity, profile }), frozen);
    assert.throws(() => prepareCapacityAtlas({ ...snapshot, case_id: 'changed' }, raw, airport, capacity, profile), /sources/);
  }
});
