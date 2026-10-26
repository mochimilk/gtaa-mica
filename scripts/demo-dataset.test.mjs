import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const modules = new Map();
function moduleUrl(path) {
  if (modules.has(path)) return modules.get(path);
  const source = readFileSync(path, 'utf8');
  let code = path.endsWith('.json') ? `export default ${source};` : ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  code = code.replace(/\bfrom\s+(["'])([^"']+)\1/g, (_, quote, specifier) => {
    const target = specifier.startsWith('.')
      ? specifier.endsWith('.mjs') ? pathToFileURL(resolve(dirname(path), specifier)).href
        : moduleUrl(resolve(dirname(path), specifier.endsWith('.json') ? specifier : `${specifier}.ts`))
      : pathToFileURL(require.resolve(specifier)).href;
    return `from ${quote}${target}${quote}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(path, url);
  return url;
}
const load = path => import(moduleUrl(resolve(root, path)));
const { adaptPreparedScenario } = await load('src\\demo\\prepared-adapter.ts');
const { validatePreparedSnapshot } = await load('src\\demo\\validate-prepared.ts');
const { makeMatcher, makeFilterOptions, EMPTY_FILTERS } = await load('src\\operations\\opsFilters.ts');
const { ORIGINAL_DATASET, loadDemoDataset } = await load('src\\demo\\load-dataset.ts');
const { DEFAULT_DEMO_PREFERENCES, parseDemoPreferences } = await load('src\\demo\\preferences.ts');
const { DEMO_DATA, DEMO_DOMAIN, dayOffsetLabel, formatUtcWithDay } = await load('src\\stand-timeline-demo\\demoData.ts');
const { OPS_FLIGHTS, OPS_ALERTS } = await load('src\\operations\\operationsData.ts');
const { standLabel } = await load('src\\stand-timeline-demo\\adapter.ts');
const { BUFFER_METRIC, DEFAULT_BUFFER_PROFILE, parseBufferProfile, calculateStandBuffers, evaluateBufferPlans } = await load('src\\demo\\buffer-evaluation.ts');
const readSnapshot = caseId => validatePreparedSnapshot(JSON.parse(readFileSync(resolve(root, `src\\demo\\prepared\\${caseId}.json`), 'utf8')));

const bufferStay = (id, start, end, rowId = 'stand:1', visitId = id) =>
  ({ id, rowId, visitId, start: start * 60_000, end: end * 60_000 });
const bufferHorizon = [0, 200 * 60_000];

test('buffer review has a versioned derived, reporting-only contract and strict profile parameters', () => {
  assert.equal(BUFFER_METRIC.valueKind, 'derived');
  assert.equal(BUFFER_METRIC.optimizationKind, 'scoring-only');
  assert.equal(DEFAULT_BUFFER_PROFILE.threshold_minutes, 20);
  assert.deepEqual(parseBufferProfile(DEFAULT_BUFFER_PROFILE), DEFAULT_BUFFER_PROFILE);
  for (const value of [null, [], {}, { ...DEFAULT_BUFFER_PROFILE, weight: 1 },
    { ...DEFAULT_BUFFER_PROFILE, metric_version: '2.0.0' },
    { ...DEFAULT_BUFFER_PROFILE, metric_id: 'other' }, { ...DEFAULT_BUFFER_PROFILE, id: ' ' },
    ...[-1, 121, NaN, Infinity, '20'].map(threshold_minutes => ({ ...DEFAULT_BUFFER_PROFILE, threshold_minutes }))]) {
    assert.throws(() => parseBufferProfile(value), /profile/);
  }
});

test('stand buffers measure exact gaps including zero, strict threshold, median and nearest-rank P10', () => {
  const assignments = [
    bufferStay('a', 0, 10), bufferStay('b', 10, 20), bufferStay('c', 30, 40),
    bufferStay('d', 60, 70), bufferStay('e', 100, 110),
  ];
  const before = structuredClone(assignments);
  const result = calculateStandBuffers(assignments, bufferHorizon);
  assert.equal(result.availability, 'available');
  assert.deepEqual(result.handovers.map(item => item.minutes), [0, 10, 20, 30]);
  assert.deepEqual(result.summary, {
    handover_count: 4, tight_count: 2, minimum_minutes: 0, median_minutes: 15, p10_minutes: 0, overlap_count: 0,
  });
  assert.deepEqual(result.handovers.map(item => [item.previous.id, item.next.id]), [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']]);
  assert.deepEqual(assignments, before);
  assert.deepEqual(calculateStandBuffers([...assignments].reverse(), bufferHorizon), result);
  assert.equal(calculateStandBuffers(assignments, bufferHorizon, { ...DEFAULT_BUFFER_PROFILE, threshold_minutes: 0 }).summary.tight_count, 0);
  assert.equal(calculateStandBuffers(assignments, bufferHorizon, { ...DEFAULT_BUFFER_PROFILE, threshold_minutes: 10 }).summary.tight_count, 1);
});

test('P10 nearest rank and odd median retain full precision rather than display rounding', () => {
  const stays = Array.from({ length: 12 }, (_, index) => {
    const start = index * (index + 1) / 2 + index;
    return bufferStay(String(index), start, start + 1);
  });
  const result = calculateStandBuffers(stays, bufferHorizon);
  assert.deepEqual(result.handovers.map(item => item.minutes), Array.from({ length: 11 }, (_, index) => index + 1));
  assert.equal(result.summary.p10_minutes, 2);
  assert.equal(result.summary.median_minutes, 6);
  const fractional = calculateStandBuffers([bufferStay('a', 0, 1), bufferStay('b', 1.25, 2)], bufferHorizon);
  assert.equal(fractional.summary.minimum_minutes, 0.25);
});

test('empty, isolated and same-visit return occupancies are not applicable rather than zero buffers', () => {
  for (const assignments of [[], [bufferStay('a', 0, 10)],
    [bufferStay('a', 0, 10), bufferStay('b', 20, 30, 'stand:2')],
    [bufferStay('a', 0, 10, 'stand:1', 'same'), bufferStay('b', 20, 30, 'stand:1', 'same')]]) {
    const result = calculateStandBuffers(assignments, bufferHorizon);
    assert.equal(result.availability, 'not-applicable');
    assert.deepEqual(result.summary, {
      handover_count: 0, tight_count: 0, minimum_minutes: null, median_minutes: null, p10_minutes: null, overlap_count: 0,
    });
  }
});

test('buffer horizon uses known handovers only, without invented edge gaps or outside conflicts', () => {
  const assignments = [
    bufferStay('old', -100, -50), bufferStay('outside-overlap', -90, -60),
    bufferStay('release-at-start', -10, 0), bufferStay('first', 0, 10),
    bufferStay('last', 20, 210), bufferStay('starts-at-end', 200, 220),
  ];
  const result = calculateStandBuffers(assignments, bufferHorizon);
  assert.deepEqual(result.handovers.map(item => item.minutes), [0, 10]);
  assert.equal(result.overlaps.length, 0);
  assert.equal(result.availability, 'available');
  const crossing = calculateStandBuffers([bufferStay('before', -20, -10), bufferStay('inside', 10, 20)], bufferHorizon);
  assert.equal(crossing.summary.handover_count, 0);
});

test('all overlapping pairs are conflicts, and nested stays cannot manufacture a free gap', () => {
  const result = calculateStandBuffers([
    bufferStay('long', 0, 100), bufferStay('b', 10, 30), bufferStay('c', 20, 40),
    bufferStay('d', 50, 60), bufferStay('next', 110, 120),
  ], bufferHorizon);
  assert.equal(result.availability, 'invalid');
  assert.equal(result.summary.overlap_count, 4);
  assert.deepEqual(result.handovers.map(item => [item.previous.id, item.next.id, item.minutes]), [['long', 'next', 10]]);
  assert.equal(result.summary.minimum_minutes, null);
  assert.equal(result.summary.median_minutes, null);
  assert.equal(result.summary.p10_minutes, null);
  assert.ok(result.overlaps.every(item => item.minutes > 0));
});

test('overlap evidence is clipped to the horizon, including an overlap inherited at its start', () => {
  const result = calculateStandBuffers([bufferStay('a', -20, 30), bufferStay('b', -10, 20)], [0, 10 * 60_000]);
  assert.equal(result.availability, 'invalid');
  assert.equal(result.overlaps[0].start, 0);
  assert.equal(result.overlaps[0].end, 10 * 60_000);
  assert.equal(result.overlaps[0].minutes, 10);
});

test('buffer calculation rejects malformed inputs explicitly', () => {
  for (const assignments of [
    [bufferStay('a', 0, 0)], [bufferStay('a', 10, 0)], [bufferStay('a', NaN, 10)],
    [bufferStay('a', 0, Infinity)], [bufferStay('a', 0, 10), bufferStay('a', 20, 30)],
    [bufferStay('a', 0, 10, '')], [bufferStay('a', 0, 10, 'stand:1', '')],
  ]) assert.throws(() => calculateStandBuffers(assignments, bufferHorizon), /assignment/);
  for (const horizon of [[0, 0], [10, 0], [NaN, 10], [0, Infinity]]) {
    assert.throws(() => calculateStandBuffers([], horizon), /horizon/);
  }
});

test('all prepared scenarios evaluate both frozen plans without mutating solver or source data', () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) {
    const snapshot = readSnapshot(caseId), before = structuredClone(snapshot);
    const result = evaluateBufferPlans(snapshot);
    assert.deepEqual(snapshot, before);
    assert.equal(result.demand_id, snapshot.demand_id);
    assert.equal(result.population_count, snapshot.visits.length);
    assert.equal(result.metric.version, '1.0.0');
    assert.equal(result.profile.threshold_minutes, 20);
    for (const variant of ['baseline', 'tow-options']) {
      const plan = result.variants[variant];
      assert.equal(plan.assigned_visits, new Set(snapshot.variants[variant].stays.map(item => item.visitId)).size);
      assert.equal(plan.assigned_visits + plan.unassigned_visits, result.population_count);
      assert.equal(plan.buffers.overlaps.length, 0);
      assert.equal(plan.request_fingerprint, snapshot.variants[variant].request_fingerprint);
      assert.equal(plan.generated_tows, snapshot.variants[variant].generated_movement_count);
      assert.equal(plan.buffers.availability, 'available');
      assert.deepEqual(adaptPreparedScenario(snapshot, variant).prepared, { snapshot, variant });
    }
    const changedThreshold = evaluateBufferPlans(snapshot, { ...DEFAULT_BUFFER_PROFILE, threshold_minutes: 60 });
    assert.equal(changedThreshold.variants.baseline.buffers.summary.minimum_minutes, result.variants.baseline.buffers.summary.minimum_minutes);
    assert.equal(changedThreshold.variants.baseline.request_fingerprint, result.variants.baseline.request_fingerprint);
    assert.ok(changedThreshold.variants.baseline.buffers.summary.tight_count >= result.variants.baseline.buffers.summary.tight_count);
  }
});

test('constrained coverage gain is disclosed and suppresses same-assigned-population buffer deltas', () => {
  const result = evaluateBufferPlans(readSnapshot('constrained'));
  assert.equal(result.variants.baseline.assigned_visits, 40);
  assert.equal(result.variants['tow-options'].assigned_visits, 41);
  assert.equal(result.comparison.assigned_sets_differ, true);
  assert.equal(result.comparison.gained_visit_ids.length, 1);
  assert.equal(result.comparison.lost_visit_ids.length, 0);
  assert.equal(result.comparison.buffer_delta, null);
});

test('assignment changes ignore internal IDs but detect stand, timing and tow-pattern changes', () => {
  const snapshot = readSnapshot('comfortable');
  snapshot.variants['tow-options'] = structuredClone(snapshot.variants.baseline);
  snapshot.variants['tow-options'].stays.forEach(stay => { stay.id += '-different-internal-id'; });
  let result = evaluateBufferPlans(snapshot);
  assert.equal(result.comparison.changed_retained_visit_ids.length, 0);
  assert.equal(result.comparison.unchanged_retained_visits, 36);
  assert.deepEqual(result.comparison.buffer_delta, { minimum_minutes: 0, median_minutes: 0, p10_minutes: 0, tight_count: 0 });
  const first = snapshot.variants['tow-options'].stays[0];
  first.end = new Date(Date.parse(first.end) - 60_000).toISOString();
  result = evaluateBufferPlans(snapshot);
  assert.deepEqual(result.comparison.changed_retained_visit_ids, [first.visitId]);
  const standChanged = structuredClone(snapshot);
  standChanged.variants['tow-options'].stays[1].rowId = snapshot.rows.find(row => row.id !== standChanged.variants['tow-options'].stays[1].rowId).id;
  result = evaluateBufferPlans(standChanged);
  assert.equal(result.comparison.changed_retained_visit_ids.length, 2);
  const split = structuredClone(snapshot);
  const stay = split.variants['tow-options'].stays[2];
  const midpoint = (Date.parse(stay.start) + Date.parse(stay.end)) / 2;
  split.variants['tow-options'].stays.push({ ...stay, id: `${stay.id}-parking`, start: new Date(midpoint + 60_000).toISOString() });
  stay.end = new Date(midpoint).toISOString();
  assert.equal(evaluateBufferPlans(split).comparison.changed_retained_visit_ids.length, 2);
});

test('equal coverage counts do not hide different assigned populations', () => {
  const snapshot = readSnapshot('comfortable');
  snapshot.variants['tow-options'] = structuredClone(snapshot.variants.baseline);
  snapshot.variants.baseline.stays.shift();
  snapshot.variants['tow-options'].stays.pop();
  const result = evaluateBufferPlans(snapshot);
  assert.equal(result.variants.baseline.assigned_visits, result.variants['tow-options'].assigned_visits);
  assert.equal(result.comparison.assigned_sets_differ, true);
  assert.equal(result.comparison.gained_visit_ids.length, 1);
  assert.equal(result.comparison.lost_visit_ids.length, 1);
  assert.equal(result.comparison.buffer_delta, null);
});

test('buffer comparison rejects unknown assignment references and suppresses invalid-result deltas', () => {
  const snapshot = readSnapshot('comfortable');
  const invalid = structuredClone(snapshot);
  invalid.variants.baseline.stays[0].rowId = 'missing-stand';
  assert.throws(() => evaluateBufferPlans(invalid), /reference/);
  invalid.variants.baseline.stays[0].rowId = snapshot.variants.baseline.stays[0].rowId;
  invalid.variants.baseline.stays[0].visitId = 'missing-visit';
  assert.throws(() => evaluateBufferPlans(invalid), /reference/);
  const conflict = structuredClone(snapshot);
  conflict.variants.baseline.stays.push({ ...conflict.variants.baseline.stays[0], id: 'overlapping-copy' });
  const result = evaluateBufferPlans(conflict);
  assert.equal(result.variants.baseline.buffers.availability, 'invalid');
  assert.equal(result.comparison.buffer_delta, null);
});

test('fresh-install defaults retain the exact existing chart, panel and alert objects', async () => {
  assert.equal(DEFAULT_DEMO_PREFERENCES.source, 'original');
  assert.equal(await loadDemoDataset(DEFAULT_DEMO_PREFERENCES), ORIGINAL_DATASET);
  assert.equal(ORIGINAL_DATASET.timeline, DEMO_DATA);
  assert.equal(ORIGINAL_DATASET.domain, DEMO_DOMAIN);
  assert.equal(ORIGINAL_DATASET.flights, OPS_FLIGHTS);
  assert.equal(ORIGINAL_DATASET.alerts, OPS_ALERTS);
  assert.equal(ORIGINAL_DATASET.date, '2026-01-15');
  assert.equal(ORIGINAL_DATASET.timeBasis, 'estimated');
});

test('versioned preferences round-trip and reject malformed, unsupported or stale selections', () => {
  for (const source of ['original', 'contoso']) {
    for (const scenario of ['comfortable', 'constrained', 'full-day']) {
      for (const variant of ['baseline', 'tow-options']) {
        const preferences = { version: 1, source, scenario, variant };
        assert.deepEqual(parseDemoPreferences(JSON.parse(JSON.stringify(preferences))), preferences);
      }
    }
  }
  for (const value of [null, [], 'contoso', {}, { ...DEFAULT_DEMO_PREFERENCES, version: 2 },
    { ...DEFAULT_DEMO_PREFERENCES, scenario: 'deleted' }, { ...DEFAULT_DEMO_PREFERENCES, variant: 'unvalidated' },
    { ...DEFAULT_DEMO_PREFERENCES, source: 'live' }, { ...DEFAULT_DEMO_PREFERENCES, data: {} }]) {
    assert.throws(() => parseDemoPreferences(value), /invalid|unsupported/);
  }
});

test('both comfortable variants render all 36 visits with no fabricated tows or alerts', () => {
  for (const variant of ['baseline', 'tow-options']) {
    const snapshot = readSnapshot('comfortable');
    const before = structuredClone(snapshot);
    const dataset = adaptPreparedScenario(snapshot, variant);
    assert.deepEqual(snapshot, before);
    assert.equal(dataset.timeline.rows.length, 46);
    assert.equal(dataset.timeline.occupancies.length, 36);
    assert.equal(dataset.flights.length, 72);
    assert.equal(dataset.arrivals.length, 36);
    assert.equal(dataset.departures.length, 36);
    assert.equal(dataset.flights.filter(flight => !flight.standId).length, 0);
    assert.equal(dataset.alerts.length, 0);
    assert.ok([...dataset.timeline.endpoints.values()].every(item => item.start.kind === 'flight' && item.end.kind === 'flight'));
    assert.equal(dataset.timeBasis, 'scheduled');
  }
});

test('constrained baseline retains both flights of its unassigned visit without drawing invented occupancy', () => {
  const dataset = adaptPreparedScenario(readSnapshot('constrained'), 'baseline');
  assert.equal(dataset.timeline.occupancies.length, 40);
  assert.equal(dataset.flights.length, 82);
  assert.equal(dataset.arrivals.length, 41);
  assert.equal(dataset.departures.length, 41);
  const unassigned = dataset.flights.filter(flight => !flight.standId);
  assert.equal(unassigned.length, 2);
  assert.equal(new Set(unassigned.map(flight => flight.visitId)).size, 1);
  assert.ok(unassigned.every(flight => flight.occupancyId === undefined));
  assert.ok(dataset.timeline.occupancies.every(stay => stay.visitId !== unassigned[0].visitId));
  assert.equal(dataset.alerts.length, 2);
  assert.ok(dataset.alerts.every(alert => unassigned.some(flight => flight.id === alert.flightId)));
});

test('full day displays all 320 source legs, ten operators and its measured unassigned flights', () => {
  const snapshot = readSnapshot('full-day');
  for (const variant of ['baseline', 'tow-options']) {
    const dataset = adaptPreparedScenario(snapshot, variant);
    assert.match(dataset.label, /Full day/);
    assert.equal(dataset.date, '2026-10-24');
    assert.equal(dataset.domain[1] - dataset.domain[0], 24 * 60 * 60_000);
    assert.equal(dataset.flights.length, 320);
    assert.equal(dataset.arrivals.length, 160);
    assert.equal(dataset.departures.length, 160);
    assert.equal(dataset.timeline.occupancies.length, 149);
    assert.equal(dataset.flights.filter(flight => !flight.standId).length, 22);
    assert.equal(dataset.alerts.length, 22);
    assert.deepEqual(makeFilterOptions(dataset).carrier, ['AAL', 'AFR', 'ASA', 'BAW', 'CES', 'DAL', 'DLH', 'EVA', 'JAL', 'UAL']);
    assert.ok(dataset.flights.every(flight => /^[A-Z0-9]{2}[1-9][0-9]{2,3}$/.test(flight.flight)));
    assert.ok(dataset.flights.every(flight => /^[A-Z]{3}$/.test(flight.routeEnd)));
    const dal = makeMatcher(dataset, 'all', { ...EMPTY_FILTERS, carrier: ['DAL'] }, new Set());
    assert.equal(dataset.flights.filter(dal.flight).length, 76);
  }
});

test('constrained tow plan preserves exact fixed intervals, true endpoints and linked visit selection', () => {
  const snapshot = readSnapshot('constrained');
  const dataset = adaptPreparedScenario(snapshot, 'tow-options');
  assert.equal(dataset.timeline.occupancies.length, 43);
  assert.equal(dataset.flights.filter(flight => flight.standId).length, 82);
  assert.equal(dataset.alerts.length, 0);
  assert.equal([...dataset.timeline.endpoints.values()].filter(item => item.start.kind === 'tow').length, 2);
  assert.equal([...dataset.timeline.endpoints.values()].filter(item => item.end.kind === 'tow').length, 2);
  for (const stay of dataset.timeline.occupancies) {
    const source = snapshot.variants['tow-options'].stays.find(item => item.id === stay.id);
    assert.equal(stay.start, Date.parse(source.start));
    assert.equal(stay.end, Date.parse(source.end));
    assert.ok(dataset.timeline.rows.some(row => row.id === stay.rowId));
  }
  const parking = dataset.timeline.occupancies.find(stay => stay.kind === 'hold');
  assert.ok(parking);
  assert.equal(dataset.timeline.occupancies.filter(stay => stay.visitId === parking.visitId).length, 3);
  assert.equal(dataset.flights.filter(flight => flight.occupancyId === parking.id).length, 0);
});

test('all UI lookup IDs are scoped to their dataset, never the original fixture', () => {
  const originalIds = new Set(ORIGINAL_DATASET.flights.map(flight => flight.id));
  for (const caseId of ['comfortable', 'constrained', 'full-day']) {
    for (const variant of ['baseline', 'tow-options']) {
      const dataset = adaptPreparedScenario(readSnapshot(caseId), variant);
      assert.ok(dataset.flights.every(flight => dataset.flightsById.get(flight.id) === flight && !originalIds.has(flight.id)));
      for (const flight of dataset.flights) {
        if (!flight.occupancyId) continue;
        assert.ok(dataset.timeline.occupancies.some(stay => stay.id === flight.occupancyId && stay.rowId === flight.standId));
        assert.equal(standLabel(dataset.timeline, flight.standId), dataset.timeline.rows.find(row => row.id === flight.standId).label);
        assert.ok(!standLabel(dataset.timeline, flight.standId).includes(':stand:'));
      }
    }
  }
});

test('views and filters use actual prepared carrier metadata, assignment and tow endpoints', () => {
  const baseline = adaptPreparedScenario(readSnapshot('constrained'), 'baseline');
  const tows = adaptPreparedScenario(readSnapshot('constrained'), 'tow-options');
  assert.deepEqual(makeFilterOptions(tows).carrier, ['AAL', 'UAL']);
  const carrier = makeMatcher(tows, 'all', { ...EMPTY_FILTERS, carrier: ['UAL'] }, new Set());
  assert.ok(tows.flights.filter(carrier.flight).every(flight => flight.carrier === 'UAL'));
  assert.ok(tows.flights.filter(carrier.flight).length > 0);
  const towMatcher = makeMatcher(tows, 'tows', EMPTY_FILTERS, new Set());
  assert.equal(tows.timeline.occupancies.filter(stay => towMatcher.occupancy(stay.id)).length, 3);
  assert.equal(tows.flights.filter(towMatcher.flight).length, 2);
  const baselineTows = makeMatcher(baseline, 'tows', EMPTY_FILTERS, new Set());
  assert.equal(baseline.flights.filter(baselineTows.flight).length, 0);
  const attention = makeMatcher(baseline, 'attention', EMPTY_FILTERS, new Set());
  assert.equal(baseline.flights.filter(attention.flight).length, 2);
  const acknowledged = new Set(baseline.alerts.map(alert => alert.id));
  const cleared = makeMatcher(baseline, 'attention', EMPTY_FILTERS, acknowledged);
  assert.equal(baseline.flights.filter(cleared.flight).length, 0);
});

test('original views preserve carrier, unassigned and alert matching behavior', () => {
  assert.deepEqual(makeFilterOptions(ORIGINAL_DATASET).carrier, ['XA', 'XB', 'XC', 'XD']);
  const all = makeMatcher(ORIGINAL_DATASET, 'all', EMPTY_FILTERS, new Set());
  assert.equal(all.active, false);
  assert.equal(OPS_FLIGHTS.filter(all.flight).length, OPS_FLIGHTS.length);
  const unassigned = makeMatcher(ORIGINAL_DATASET, 'all', { ...EMPTY_FILTERS, area: ['Unassigned'] }, new Set());
  assert.equal(OPS_FLIGHTS.filter(unassigned.flight).length, 5);
  const tows = makeMatcher(ORIGINAL_DATASET, 'tows', EMPTY_FILTERS, new Set());
  assert.ok(DEMO_DATA.occupancies.filter(stay => tows.occupancy(stay.id)).length > 0);
});

test('day offsets reference the active scenario date while keeping original defaults intact', () => {
  const value = Date.parse('2026-10-22T01:00:00Z');
  assert.equal(dayOffsetLabel(value, '2026-10-21'), '+1d');
  assert.equal(formatUtcWithDay(value, '2026-10-21'), '01:00 +1d');
  assert.equal(dayOffsetLabel(Date.parse('2026-10-21T14:00:00Z'), '2026-10-21'), '');
  assert.equal(formatUtcWithDay(Date.parse('2026-01-15T06:00:00Z')), '06:00');
});

test('prepared schema rejects non-synthetic shape drift, invalid dates and false validation claims', () => {
  for (const change of [
    value => { value.schema_version = '2.0.0'; },
    value => { value.case_id = 'unknown'; },
    value => { value.variants.baseline.stand_validation_passed = false; },
    value => { value.flights[0].scheduled = '2026-02-30T00:00:00Z'; },
    value => { value.flights[0].actual_time = '2026-10-21T14:00:00Z'; },
  ]) {
    const snapshot = structuredClone(readSnapshot('comfortable'));
    change(snapshot);
    assert.throws(() => validatePreparedSnapshot(snapshot), /invalid/);
  }
});

test('prepared adapter rejects broken references, partial visits, overlaps in a visit and mismatched counts', () => {
  for (const change of [
    value => { value.variants.baseline.stays[0].rowId = 'invented'; },
    value => { value.variants.baseline.stays[0].visitId = 'invented'; },
    value => { value.variants.baseline.stays[0].arrivalFlightId = 'invented'; },
    value => { delete value.variants.baseline.stays[0].departureFlightId; },
    value => { value.variants.baseline.stays[0].towIn = true; },
    value => { value.variants.baseline.covered_flight_count = 0; },
    value => { value.variants.baseline.stays.push(value.variants.baseline.stays[0]); },
    value => { value.visits.push(value.visits[0]); },
  ]) {
    const snapshot = structuredClone(readSnapshot('comfortable'));
    change(snapshot);
    assert.throws(() => adaptPreparedScenario(snapshot, 'baseline'), /prepared|Prepared|Partial/);
  }
});
