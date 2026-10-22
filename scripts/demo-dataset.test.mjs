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
const readSnapshot = caseId => validatePreparedSnapshot(JSON.parse(readFileSync(resolve(root, `src\\demo\\prepared\\${caseId}.json`), 'utf8')));

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
    for (const scenario of ['comfortable', 'constrained']) {
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
  for (const caseId of ['comfortable', 'constrained']) {
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
