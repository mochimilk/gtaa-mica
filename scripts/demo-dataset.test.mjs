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
  const resolveSpecifier = specifier => specifier.startsWith('.')
      ? specifier.endsWith('.mjs') ? pathToFileURL(resolve(dirname(path), specifier)).href
        : moduleUrl(resolve(dirname(path), specifier.endsWith('.json') ? specifier : `${specifier}.ts`))
      : pathToFileURL(require.resolve(specifier)).href;
  code = code.replace(/\bfrom\s+(["'])([^"']+)\1/g, (_, quote, specifier) =>
    `from ${quote}${resolveSpecifier(specifier)}${quote}`);
  code = code.replace(/\bimport\((["'])([^"']+)\1\)/g, (_, quote, specifier) =>
    `import(${quote}${resolveSpecifier(specifier)}${quote})`);
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(path, url);
  return url;
}
const load = path => import(moduleUrl(resolve(root, path)));
const { adaptPreparedScenario } = await load('src\\demo\\prepared-adapter.ts');
const { validatePreparedSnapshot } = await load('src\\demo\\validate-prepared.ts');
const { makeMatcher, makeFilterOptions, EMPTY_FILTERS } = await load('src\\operations\\opsFilters.ts');
const { ORIGINAL_DATASET, loadDemoDataset } = await load('src\\demo\\load-dataset.ts');
const { DEFAULT_DEMO_PREFERENCES, parseDemoPreferences, scenariosForSource } = await load('src\\demo\\preferences.ts');
const { DEMO_DATA, DEMO_DOMAIN, dayOffsetLabel, formatUtcWithDay } = await load('src\\stand-timeline-demo\\demoData.ts');
const { OPS_FLIGHTS, OPS_ALERTS } = await load('src\\operations\\operationsData.ts');
const { standLabel } = await load('src\\stand-timeline-demo\\adapter.ts');
const { BUFFER_METRIC, DEFAULT_BUFFER_PROFILE, parseBufferProfile, calculateStandBuffers, evaluateBufferPlans } = await load('src\\demo\\buffer-evaluation.ts');
const { GATE_WAIT_METRIC, DEFAULT_GATE_WAIT_PROFILE, parseGateWaitProfile, evaluateGateWaitPlans } = await load('src\\demo\\gate-wait-evaluation.ts');
const { validateCapacitySnapshot, queryCapacity, evaluateCapacityQuery } = await load('src\\demo\\capacity-evaluation.ts');
const { validateAtlas, atlasFrequency, atlasSegments } = await load('src\\demo\\atlas-evaluation.ts');
const { validateAccommodation, accommodationView, accommodationImpact, acceptAccommodation } = await load('src\\demo\\accommodation-evaluation.ts');
const { buildDecisionBrief } = await load('src\\demo\\decision-brief.ts');
const { accommodationChoices } = await load('src\\demo\\accommodation-choices.ts');
const { validateTowWindows, evaluateTowWindows, towWindowSegments } = await load('src\\demo\\tow-windows-evaluation.ts');
const readSnapshot = caseId => validatePreparedSnapshot(JSON.parse(readFileSync(resolve(root, `src\\demo\\prepared\\${caseId}.json`), 'utf8')));

const bufferStay = (id, start, end, rowId = 'stand:1', visitId = id) =>
  ({ id, rowId, visitId, start: start * 60_000, end: end * 60_000 });
const bufferHorizon = [0, 200 * 60_000];

const readAccommodation = caseId => JSON.parse(readFileSync(resolve(root, `src\\demo\\prepared\\${caseId}.accommodation.json`), 'utf8'));
const readCapacity = caseId => JSON.parse(readFileSync(resolve(root, `src\\demo\\prepared\\${caseId}.capacity.json`), 'utf8'));
const readTowWindows = caseId => JSON.parse(readFileSync(resolve(root, `src\\demo\\prepared\\${caseId}.tow-windows.json`), 'utf8'));

test('repair representatives cover available stand strategies, avoid cosmetic filler and retain explicit active choices', () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) for (const variant of ['baseline', 'tow-options']) {
    const snapshot = readSnapshot(caseId), evidence = readAccommodation(caseId);
    const frozen = JSON.stringify({ snapshot, evidence });
    const choices = accommodationChoices(snapshot, evidence, variant);
    assert.ok(choices.length > 0 && choices.length <= evidence.profile.max_displayed_options);
    assert.equal(new Set(choices.map(item => item.option.id)).size, choices.length);
    const reversed = structuredClone(evidence);
    reversed.variants[variant].options.reverse();
    assert.deepEqual(accommodationChoices(snapshot, reversed, variant), choices);
    for (const choice of choices) {
      assert.ok(evidence.variants[variant].options.some(option => option.id === choice.option.id));
      assert.match(choice.label, /contact/);
      assert.ok(Number.isInteger(choice.equivalentCount) && choice.equivalentCount >= 0);
    }
    if (caseId === 'full-day') {
      assert.ok(choices.some(item => item.option.moves[0].to_stand_contact));
      assert.ok(choices.some(item => !item.option.moves[0].to_stand_contact));
      assert.ok(choices.every(item => /move .* to/.test(item.label)));
    }
    const excluded = evidence.variants[variant].options.find(option => !choices.some(item => item.option.id === option.id));
    if (excluded) assert.ok(accommodationChoices(snapshot, evidence, variant, [excluded.id]).some(item => item.option.id === excluded.id));
    assert.throws(() => accommodationChoices(snapshot, evidence, variant, ['unknown']), /Unknown retained/);
    assert.equal(JSON.stringify({ snapshot, evidence }), frozen);
  }
});

test('cosmetic direct placements are not manufactured into three different outcomes', () => {
  const snapshot = readSnapshot('comfortable'), evidence = readAccommodation('comfortable');
  const candidates = evidence.variants.baseline.options;
  const first = candidates[0];
  evidence.variants.baseline.options = [first, { ...structuredClone(first), id: 'alternate-identity' }];
  const choices = accommodationChoices(snapshot, evidence, 'baseline');
  assert.equal(choices.length, 1);
  assert.equal(choices[0].equivalentCount, 1);
});

test('tow evidence is CSP-safe, complete and tied to airport, raw demand, source plan and visit endpoints', async () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) {
    const snapshot = readSnapshot(caseId), capacity = readCapacity(caseId), evidence = readTowWindows(caseId);
    assert.equal(await validateTowWindows(evidence, snapshot, capacity), evidence);
    for (const mutate of [
      value => { value.schema_version = '2'; },
      value => { value.airport.id = 'other'; },
      value => { value.snapshot_fingerprint = '0'.repeat(64); },
      value => { value.airport_fingerprint = '0'.repeat(64); },
      value => { value.demand_fingerprint = '0'.repeat(64); },
      value => { value.default_tow_minutes = 0; },
      value => { value.movement_kind = 'round-trip'; },
      value => { value.stand_validation_passed = false; },
      value => { value.visits.pop(); },
      value => { value.visits[1] = { ...value.visits[0] }; },
      value => { value.visits[0].visit_id = 'unknown'; },
      value => { value.visits[0].arrival_flight_id = value.visits[0].departure_flight_id; },
      value => { value.visits[0].arrival_handling_minutes = 0.0000001; },
      value => { value.visits[0].variants.baseline.source_stay_id = 'unknown'; },
      value => { value.visits.find(item => item.variants.baseline.destinations.length).variants.baseline.destinations[0].stand_id = 'unknown'; },
      value => { const item = value.visits.find(item => item.variants.baseline.destinations.length); item.variants.baseline.destinations[0].stand_id = snapshot.variants.baseline.stays.find(stay => stay.id === item.variants.baseline.source_stay_id).rowId; },
      value => { const list = value.visits.find(item => item.variants.baseline.destinations.length).variants.baseline.destinations; list.push({ ...list[0] }); },
      value => { value.visits.find(item => item.variants.baseline.destinations.length).variants.baseline.destinations[0].earliest_start = -1; },
      value => { value.visits.find(item => item.variants.baseline.destinations.length).variants.baseline.destinations[0].latest_start = Number.MAX_SAFE_INTEGER; },
      value => { const destination = value.visits.find(item => item.variants.baseline.destinations.length).variants.baseline.destinations[0]; destination.earliest_start = destination.latest_start + 1; },
    ]) {
      const broken = structuredClone(evidence);
      mutate(broken);
      await assert.rejects(validateTowWindows(broken, snapshot, capacity), /[Tt]ow|millisecond/);
    }
  }
});

test('tow windows preserve occupancy, exclude unassigned/actual movement chains and clip inclusive starts at exact horizon bounds', () => {
  let visibleRanges = 0;
  for (const caseId of ['comfortable', 'constrained', 'full-day']) for (const variant of ['baseline', 'tow-options']) {
    const snapshot = readSnapshot(caseId), evidence = readTowWindows(caseId), frozen = JSON.stringify({ snapshot, evidence });
    const assessments = evaluateTowWindows(snapshot, evidence, variant);
    const segments = towWindowSegments(assessments, [Date.parse(snapshot.plan_window.start), Date.parse(snapshot.plan_window.end)]);
    visibleRanges += segments.length;
    assert.equal(assessments.length, snapshot.visits.length);
    assert.ok(segments.every(segment => segment.assessment.available && segment.assessment.rowId && segment.earliest <= segment.latest));
    if (caseId === 'full-day') assert.equal(assessments.filter(item => item.status.startsWith('Unassigned')).length, 11);
    if (caseId === 'constrained' && variant === 'tow-options') assert.equal(assessments.filter(item => item.status.startsWith('Existing movement')).length, 1);
    assert.equal(JSON.stringify({ snapshot, evidence }), frozen);
    assert.match(adaptPreparedScenario(snapshot, variant, 'Portable Airport Test').label, /^Portable Airport Test/);
  }
  assert.ok(visibleRanges > 0);
  const source = evaluateTowWindows(readSnapshot('comfortable'), readTowWindows('comfortable'), 'baseline').find(item => item.available);
  const exact = { ...source, ranges: [[0, 0], [10, 10]] };
  assert.deepEqual(towWindowSegments([exact], [0, 10]).map(item => [item.earliest, item.latest]), [[0, 0]]);
  const clipped = { ...source, ranges: [[-10, 20]] };
  assert.deepEqual(towWindowSegments([clipped], [0, 10]).map(item => [item.earliest, item.latest]), [[0, 9]]);
  assert.throws(() => towWindowSegments([exact], [0, 0]), /Invalid/);
});

test('decision briefs compare prepared plans in either direction with explicit coverage and changed-visit evidence', () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) for (const variant of ['baseline', 'tow-options']) {
    const snapshot = readSnapshot(caseId), frozen = JSON.stringify(snapshot);
    const alternative = variant === 'baseline' ? 'tow-options' : 'baseline';
    const report = buildDecisionBrief(snapshot, variant, { kind: 'variant', variant: alternative }, 'routine');
    const before = new Set(snapshot.variants[variant].stays.map(stay => stay.visitId));
    const after = new Set(snapshot.variants[alternative].stays.map(stay => stay.visitId));
    assert.deepEqual(report.gainedIds, [...after].filter(id => !before.has(id)));
    assert.deepEqual(report.lostIds, [...before].filter(id => !after.has(id)));
    assert.equal(report.retainedIds.length + report.lostIds.length, before.size);
    assert.equal(report.retainedIds.length + report.gainedIds.length, after.size);
    assert.equal(report.originalUnresolvedAfter, snapshot.visits.length - after.size);
    assert.equal(report.addedIds.length, 0);
    assert.equal(report.retimedFlightIds.length, 0);
    assert.equal(report.alternativeSource.kind, 'solver');
    assert.equal(report.referenceSource.requestFingerprint, snapshot.variants[variant].request_fingerprint);
    assert.equal(report.alternativeSource.requestFingerprint, snapshot.variants[alternative].request_fingerprint);
    const buffers = evaluateBufferPlans(snapshot);
    assert.deepEqual(report.beforeBuffers, buffers.variants[variant].buffers);
    assert.deepEqual(report.afterBuffers, buffers.variants[alternative].buffers);
    const comparison = buffers.comparison;
    assert.deepEqual([...report.changedIds].sort(), comparison.changed_retained_visit_ids);
    for (const change of report.changes) {
      assert.equal(change.beforeStays.length === 0, !before.has(change.visitId));
      assert.equal(change.afterStays.length === 0, !after.has(change.visitId));
      assert.ok(change.flights.length);
      assert.ok(change.flights.every(flight => snapshot.flights.some(source => source.id === flight.id && source.visitId === change.visitId)));
      assert.ok([...change.beforeStays, ...change.afterStays].every(stay => snapshot.rows.some(row => row.id === stay.rowId)));
    }
    assert.equal(JSON.stringify(snapshot), frozen);
  }
});

test('decision briefs share exact accommodation consequences without counting the incoming request as unresolved original demand', () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) for (const variant of ['baseline', 'tow-options']) {
    const snapshot = readSnapshot(caseId), evidence = readAccommodation(caseId), frozen = JSON.stringify({ snapshot, evidence });
    for (const assumption of DEFAULT_GATE_WAIT_PROFILE.assumptions) for (const option of evidence.variants[variant].options) {
      const report = buildDecisionBrief(snapshot, variant, { kind: 'accommodation', optionId: option.id }, assumption.id, evidence);
      const impact = accommodationImpact(snapshot, evidence, variant, option.id, assumption);
      assert.deepEqual(report.beforeBuffers, impact.beforeBuffers);
      assert.deepEqual(report.afterBuffers, impact.afterBuffers);
      assert.deepEqual(report.beforeWaiting, impact.beforeWaiting);
      assert.deepEqual(report.afterWaiting, impact.afterWaiting);
      assert.equal(report.common.arrivalIds.length, impact.commonExistingArrivals);
      assert.equal(report.common.beforeMinutes, impact.beforeCommonWait);
      assert.equal(report.common.afterMinutes, impact.afterCommonWait);
      assert.equal(report.incomingWait, impact.incomingWait);
      assert.deepEqual(report.addedIds, [evidence.request.visit.turnId]);
      assert.equal(report.gainedIds.length, 0);
      assert.equal(report.lostIds.length, 0);
      assert.equal(report.changedIds.length, option.moves.length);
      assert.equal(report.retainedIds.length, impact.assignedVisits);
      assert.equal(report.originalUnresolvedAfter, report.before.unassignedVisits);
      assert.equal(report.after.scenario.visits.length, snapshot.visits.length + 1);
      assert.equal(report.after.plan.generated_movement_count, report.before.plan.generated_movement_count);
      assert.equal(report.alternativeSource.kind, 'bounded-accommodation');
      assert.equal('solverStatus' in report.alternativeSource, false);
      assert.equal(report.retimedFlightIds.length, 0);
      assert.ok(!report.common.arrivalIds.includes(evidence.request.flights[0].id));
      const incoming = report.changes.find(change => change.kind === 'New service');
      assert.deepEqual(incoming.flights, evidence.request.flights);
      assert.equal(incoming.beforeStays.length, 0);
      assert.equal(incoming.afterStays[0].rowId, option.target_stand_id);
    }
    assert.equal(JSON.stringify({ snapshot, evidence }), frozen);
  }
});

test('decision comparisons ignore stay identities and ordering, preserve N/A, and reject unsupported inputs', () => {
  const snapshot = readSnapshot('comfortable');
  snapshot.variants['tow-options'] = structuredClone(snapshot.variants.baseline);
  snapshot.variants['tow-options'].stays.reverse().forEach((stay, index) => { stay.id = `renamed:${index}`; });
  let report = buildDecisionBrief(snapshot, 'baseline', { kind: 'variant', variant: 'tow-options' }, 'routine');
  assert.equal(report.changes.length, 0);
  assert.equal(report.common.beforeMinutes, report.common.afterMinutes);
  snapshot.variants.baseline.stays = [];
  snapshot.variants.baseline.covered_flight_count = 0;
  report = buildDecisionBrief(snapshot, 'baseline', { kind: 'variant', variant: 'tow-options' }, 'routine');
  assert.equal(report.common.arrivalIds.length, 0);
  assert.equal(report.common.beforeMinutes, null);
  assert.equal(report.common.afterMinutes, null);
  assert.equal(report.beforeBuffers.summary.minimum_minutes, null);
  assert.equal(report.lostIds.length, 0);
  assert.ok(report.gainedIds.length > 0);
  assert.throws(() => buildDecisionBrief(snapshot, 'baseline', { kind: 'variant', variant: 'unknown' }, 'routine'), /Unknown/);
  assert.throws(() => buildDecisionBrief(snapshot, 'baseline', { kind: 'variant', variant: 'tow-options' }, 'unknown'), /Unknown/);
  assert.throws(() => buildDecisionBrief(snapshot, 'baseline', { kind: 'accommodation', optionId: 'unknown' }, 'routine'), /No validated/);
  assert.throws(() => buildDecisionBrief(snapshot, 'baseline', { kind: 'accommodation', optionId: 'unknown' }, 'routine', readAccommodation('comfortable')), /Unknown/);
});

test('accommodation sidecars are CSP-safe, verify exact approved sources and reject broken request or repair links', async () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) {
    const snapshot = readSnapshot(caseId), capacity = readCapacity(caseId), evidence = readAccommodation(caseId);
    assert.equal(await validateAccommodation(evidence, snapshot, capacity), evidence);
    const changed = structuredClone(snapshot);
    changed.variants.baseline.request_fingerprint = '0'.repeat(64);
    await assert.rejects(validateAccommodation(evidence, changed, capacity), /does not match/);
    for (const mutate of [
      value => { value.schema_version = '2'; },
      value => { value.airport_fingerprint = '0'.repeat(64); },
      value => { value.request.start = '2026-02-30T00:00:00Z'; },
      value => { value.received_at = value.approved_at; },
      value => { value.request.flights[0].id = value.request.flights[1].id; },
      value => { value.request.visit.aircraftType = 'unknown'; },
      value => { value.request.probe.operating_airline_id = 'airline:OTHER'; },
      value => { value.request.flights[1].scheduled = value.request.start; },
      value => { value.request.stay_id = snapshot.variants.baseline.stays[0].id; },
      value => { value.variants.baseline.status = 'no-acceptable-option-found'; },
      value => { value.variants.baseline.options.pop(); },
      value => { value.variants.baseline.options[0].target_stand_id = 'unknown'; },
      value => { value.variants.baseline.options[0].kind = value.variants.baseline.options[0].kind === 'direct' ? 'localized-repair' : 'direct'; },
      value => { value.variants.baseline.blocked_stands.push({ stand_id: 'unknown', blocking_stay_ids: [], reasons: [], rule_paths: [] }); },
    ]) {
      const broken = structuredClone(evidence);
      mutate(broken);
      await assert.rejects(validateAccommodation(broken, snapshot, capacity), /accommodation|Accommodation/);
    }
  }
  const snapshot = readSnapshot('full-day'), capacity = readCapacity('full-day'), evidence = readAccommodation('full-day');
  for (const mutate of [
    value => { value.variants.baseline.options[0].moves[0].stay_id = 'unknown'; },
    value => { value.variants.baseline.options[0].moves[0].from_stand_id = 'unknown'; },
    value => { value.variants.baseline.options[0].moves[0].to_stand_id = value.variants.baseline.options[0].moves[0].from_stand_id; },
    value => { value.variants.baseline.options[0].moves[0].to_stand_id = 'unknown'; },
    value => { value.variants.baseline.options[0].moves.push(value.variants.baseline.options[0].moves[0]); },
  ]) {
    const broken = structuredClone(evidence);
    mutate(broken);
    await assert.rejects(validateAccommodation(broken, snapshot, capacity), /accommodation|Accommodation/);
  }
});

test('acceptance adds only the late service, preserves unresolved traffic, updates every operational surface and drops stale review evidence', async () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) for (const variant of ['baseline', 'tow-options']) {
    const snapshot = readSnapshot(caseId), evidence = await validateAccommodation(readAccommodation(caseId), snapshot, readCapacity(caseId));
    const base = { ...adaptPreparedScenario(snapshot, variant), prepared: { snapshot, variant, accommodation: evidence, capacity: readCapacity(caseId) } };
    const frozen = JSON.stringify(base);
    const unresolved = base.flights.filter(flight => !flight.occupancyId).map(flight => flight.id);
    for (const option of evidence.variants[variant].options) {
      const view = accommodationView(snapshot, evidence, variant, option.id);
      const working = acceptAccommodation(base, option.id);
      assert.equal(working.flights.length, base.flights.length + 2);
      assert.equal(working.timeline.occupancies.length, base.timeline.occupancies.length + 1);
      assert.equal(working.arrivals.length, base.arrivals.length + 1);
      assert.equal(working.departures.length, base.departures.length + 1);
      assert.deepEqual(working.flights.filter(flight => !flight.occupancyId).map(flight => flight.id), unresolved);
      assert.deepEqual(working.alerts, base.alerts);
      assert.equal(working.prepared, undefined);
      assert.match(working.subtitle, /not a new solver run/);
      assert.ok(working.flightsById.get(evidence.request.flights[0].id).occupancyId);
      assert.ok(working.timeline.turnsById.has(evidence.request.visit.turnId));
      assert.equal(view.plan.covered_flight_count, snapshot.variants[variant].covered_flight_count + 2);
      for (const original of base.timeline.occupancies) {
        const current = working.timeline.occupancies.find(item => item.id === original.id);
        assert.deepEqual({ ...current, rowId: original.rowId }, original);
      }
      assert.equal(JSON.stringify(base), frozen);
      assert.throws(() => acceptAccommodation(working, option.id), /No validated/);
    }
    assert.throws(() => acceptAccommodation(base, 'unknown'), /Unknown/);
  }
});

test('accommodation consequences reuse versioned buffers and waiting with common-existing-arrival comparisons', () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) for (const variant of ['baseline', 'tow-options']) {
    const snapshot = readSnapshot(caseId), evidence = readAccommodation(caseId), frozen = JSON.stringify({ snapshot, evidence });
    for (const assumption of DEFAULT_GATE_WAIT_PROFILE.assumptions) for (const option of evidence.variants[variant].options) {
      const impact = accommodationImpact(snapshot, evidence, variant, option.id, assumption);
      assert.equal(impact.beforeBuffers.overlaps.length, 0);
      assert.equal(impact.afterBuffers.overlaps.length, 0);
      const existing = new Set(impact.beforeWaiting.contributions.map(item => item.arrival_id));
      const common = impact.afterWaiting.contributions.filter(item => existing.has(item.arrival_id));
      assert.equal(impact.commonExistingArrivals, common.length);
      assert.equal(impact.afterCommonWait, common.length ? common.reduce((sum, item) => sum + item.estimated_wait_minutes, 0) : null);
      assert.ok(!existing.has(evidence.request.flights[0].id));
      const incoming = impact.afterWaiting.contributions.find(item => item.arrival_id === evidence.request.flights[0].id);
      assert.equal(impact.incomingWait, incoming?.estimated_wait_minutes ?? null);
      assert.equal(impact.view.option.moves.length, option.moves.length);
      assert.equal(impact.view.plan.generated_movement_count, snapshot.variants[variant].generated_movement_count);
    }
    assert.equal(JSON.stringify({ snapshot, evidence }), frozen);
  }
});

test('all atlas sidecars verify source, dates, complete assessments and exact non-touching windows under CSP', async () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) {
    const capacity = JSON.parse(readFileSync(resolve(root, `src\\demo\\prepared\\${caseId}.capacity.json`), 'utf8'));
    const raw = JSON.parse(readFileSync(resolve(root, `src\\demo\\prepared\\${caseId}.atlas.json`), 'utf8'));
    assert.equal(await validateAtlas(raw, capacity), raw);
    const changed = structuredClone(capacity);
    changed.profile.probes[0].default_duration_minutes++;
    await assert.rejects(validateAtlas(raw, changed), /does not match/);
    for (const mutate of [
      value => { value.metric_version = '2'; },
      value => { value.days.pop(); },
      value => { value.profile.start_date = '2026-02-30'; },
      value => { value.days[1].date = value.days[0].date; },
      value => { value.days[0].parameters.planned_shift_minutes = 31; },
      value => { value.horizon_duration_ms++; },
      value => { value.days[0].variants.baseline.planned.pop(); },
      value => { value.days[0].variants.baseline.planned[0].rows.pop(); },
      value => { value.days[0].variants.baseline.planned[0].rows[0].stand_id = 'unknown'; },
      value => { value.days[0].variants.baseline.planned[0].rows[0].windows = [[10, 10]]; },
      value => { value.days[0].variants.baseline.planned[0].rows[0].windows = [[0, 10], [10, 20]]; },
      value => { value.days[0].variants.baseline.planned[0].rows[0].windows = [[0, value.horizon_duration_ms + 1]]; },
    ]) {
      const broken = structuredClone(raw);
      mutate(broken);
      await assert.rejects(validateAtlas(broken, capacity), /atlas|Atlas/);
    }
  }
});

function atlasFixture() {
  const probes = windows => [{ id: 'probe', rows: [{ stand_id: 'stand', windows }] }];
  const phase = (planned, outcome) => ({ planned: probes(planned), end_of_day: probes(outcome) });
  return { horizon_duration_ms: 10 * 60000, days: [
    { date: '2026-09-24', variants: { baseline: phase([[0, 120000]], [[60000, 180000]]) } },
    { date: '2026-09-25', variants: { baseline: phase([[0, 120000]], []) } },
    { date: '2026-09-26', variants: { baseline: phase([], [[60000, 180000]]) } },
  ] };
}
test('recurrence and retention use different denominators, exclude newly emerged space and preserve exact fits', () => {
  const atlas = atlasFixture();
  const frequency = atlasFrequency(atlas, 'baseline', 'probe', 'stand', 60000, 1);
  assert.equal(frequency.planned_rate, 2 / 3);
  assert.equal(frequency.end_of_day_rate, 2 / 3);
  assert.equal(frequency.retention_rate, 1 / 2);
  assert.equal(frequency.retained_days, 1);
  assert.equal(frequency.days.length, 3);
  const absent = atlasFrequency(atlas, 'baseline', 'probe', 'stand', 60001, 1);
  assert.equal(absent.planned_days, 0);
  assert.equal(absent.retention_rate, null);
  assert.equal(absent.end_of_day_rate, 2 / 3);
  assert.equal(atlasFrequency(atlas, 'baseline', 'probe', 'stand', 0, 2).planned_days, 2);
  for (const [start, duration] of [[-1, 1], [0, 0], [0, 1.5], [600000, 1]]) {
    assert.throws(() => atlasFrequency(atlas, 'baseline', 'probe', 'stand', start, duration), /query/);
  }
  assert.throws(() => atlasFrequency(atlas, 'baseline', 'unknown', 'stand', 0, 1), /Unknown/);
});
test('heat partitions include inclusive latest starts without interpolating unsupported times', () => {
  const atlas = atlasFixture();
  const item = { rowId: 'stand', earliest: 0, latest: 180000 };
  const segments = atlasSegments(atlas, 'baseline', 'probe', item, 1, 0);
  assert.deepEqual(segments.map(segment => [segment.start, segment.end, segment.frequency.planned_days, segment.frequency.retained_days]), [
    [0, 60000, 2, 0], [60000, 60001, 2, 1], [60001, 120001, 0, 0], [120001, 180001, 0, 0],
  ]);
  for (const segment of segments) for (const time of [segment.start, segment.end - 1]) {
    const actual = atlasFrequency(atlas, 'baseline', 'probe', 'stand', time, 1);
    assert.equal(actual.planned_days, segment.frequency.planned_days);
    assert.equal(actual.end_of_day_days, segment.frequency.end_of_day_days);
    assert.equal(actual.retained_days, segment.frequency.retained_days);
  }
  assert.equal(atlasSegments(atlas, 'baseline', 'probe', { ...item, earliest: 60000, latest: 60000 }, 1, 0).length, 1);
});

test('capacity sidecars verify exact source identities and partition every assessed stand', async () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) {
    const snapshot = readSnapshot(caseId);
    const raw = JSON.parse(readFileSync(resolve(root, `src\\demo\\prepared\\${caseId}.capacity.json`), 'utf8'));
    const before = JSON.stringify(raw);
    const capacity = await validateCapacitySnapshot(raw, snapshot);
    for (const variant of ['baseline', 'tow-options']) {
      const result = queryCapacity(capacity, variant, capacity.profile.default_probe_id, 75, Date.parse(snapshot.plan_window.start), Date.parse(snapshot.plan_window.end));
      for (const item of result.opportunities) {
        assert.ok(item.earliest <= item.latest);
        assert.ok(item.latest + 75 * 60_000 <= Date.parse(snapshot.plan_window.end));
      }
    }
    assert.equal(JSON.stringify(raw), before);
    const changed = structuredClone(snapshot);
    changed.variants.baseline.stays[0].rowId = 'changed';
    await assert.rejects(validateCapacitySnapshot(raw, changed), /does not match/);
    for (const mutate of [
      value => { value.schema_version = '2'; },
      value => { value.profile.default_probe_id = 'unknown'; },
      value => { value.variants.baseline.request_fingerprint = '0'.repeat(64); },
      value => { value.variants.baseline.probes[0].rows.pop(); },
      value => { value.variants.baseline.probes[0].rows[0].windows.push({ start: snapshot.plan_window.start, end: snapshot.plan_window.end, before: null, after: null }); },
      value => { value.variants.baseline.probes[0].rows.find(row => row.blocks.length).blocks[0].assignment_ids = ['missing']; },
    ]) {
      const invalid = structuredClone(raw); mutate(invalid);
      await assert.rejects(validateCapacitySnapshot(invalid, snapshot), /capacity|Capacity/);
    }
  }
});

test('capacity queries include exact-fit instants, clip both horizon edges and reject invalid input explicitly', async () => {
  const snapshot = readSnapshot('comfortable');
  const raw = JSON.parse(readFileSync(resolve(root, 'src\\demo\\prepared\\comfortable.capacity.json'), 'utf8'));
  const capacity = await validateCapacitySnapshot(raw, snapshot);
  const start = Date.parse(snapshot.plan_window.start), end = Date.parse(snapshot.plan_window.end), probe = capacity.profile.default_probe_id;
  const complete = queryCapacity(capacity, 'baseline', probe, 75, start, end);
  const item = complete.opportunities[0];
  const exact = queryCapacity(capacity, 'baseline', probe, 75, item.earliest, item.earliest + 75 * 60_000);
  assert.ok(exact.opportunities.some(value => value.rowId === item.rowId && value.earliest === value.latest));
  const tooShort = queryCapacity(capacity, 'baseline', probe, 75, item.earliest, item.earliest + 75 * 60_000 - 1);
  assert.equal(tooShort.opportunities.length, 0);
  for (const duration of [0, -1, NaN, 0.5, 1441]) assert.throws(() => queryCapacity(capacity, 'baseline', probe, duration, start, end), /Invalid/);
  assert.throws(() => queryCapacity(capacity, 'baseline', 'unknown', 75, start, end), /Unknown/);
  assert.throws(() => queryCapacity(capacity, 'baseline', probe, 75, start - 1, end), /Invalid/);
  assert.throws(() => queryCapacity(capacity, 'baseline', probe, 75, start, end + 1), /Invalid/);
  const local = value => new Date(value).toISOString().slice(0, 16);
  assert.match(evaluateCapacityQuery(capacity, probe, '', local(start), local(end)).error, /duration/);
  assert.match(evaluateCapacityQuery(capacity, probe, '75', local(end), local(start)).error, /positive UTC/);
  assert.match(evaluateCapacityQuery(capacity, probe, '75', local(start - 60_000), local(end)).error, /inside/);
  assert.equal(evaluateCapacityQuery(capacity, probe, '75', local(start), local(end)).error, null);
});

const waitInstant = minute => new Date(Date.parse('2026-10-24T07:00:00Z') + minute * 60_000).toISOString();
function waitingSnapshot(specs = [[0, 10, 'stand:1'], [20, 30, 'stand:1'], [40, 50, 'stand:1']]) {
  const template = readSnapshot('comfortable');
  const visits = specs.map((_, index) => ({
    ...template.visits[index], turnId: `v${index}`, arrFlight: `AA${101 + index * 2}`, depFlight: `AA${102 + index * 2}`,
  }));
  const flights = specs.flatMap(([start, end], index) => [
    { id: `arr:v${index}`, visitId: `v${index}`, direction: 'arrival', flight: visits[index].arrFlight, routeEnd: 'LAX', scheduled: waitInstant(start) },
    { id: `dep:v${index}`, visitId: `v${index}`, direction: 'departure', flight: visits[index].depFlight, routeEnd: 'LAX', scheduled: waitInstant(end) },
  ]);
  const stays = specs.map(([start, end, rowId], index) => ({
    id: `stay:v${index}`, visitId: `v${index}`, rowId, start: waitInstant(start), end: waitInstant(end),
    arrivalFlightId: `arr:v${index}`, departureFlightId: `dep:v${index}`, towIn: false, towOut: false,
  }));
  const plan = { ...template.variants.baseline, stays, covered_flight_count: flights.length, generated_movement_count: 0 };
  return validatePreparedSnapshot({
    ...template, demand_id: 'synthetic:waiting-test', plan_window: { start: waitInstant(0), end: waitInstant(200) },
    rows: [...new Set(specs.map(item => item[2]))].map(id => ({ id, label: id })), visits, flights,
    variants: { baseline: plan, 'tow-options': structuredClone(plan) },
  });
}

test('gate-wait profiles explicitly version synthetic prediction assumptions and reject unsupported data', () => {
  assert.equal(GATE_WAIT_METRIC.valueKind, 'predicted');
  assert.equal(GATE_WAIT_METRIC.optimizationKind, 'scoring-only');
  assert.equal(DEFAULT_GATE_WAIT_PROFILE.source, 'synthetic');
  assert.equal(DEFAULT_GATE_WAIT_PROFILE.default_assumption_id, 'routine');
  assert.deepEqual(parseGateWaitProfile(DEFAULT_GATE_WAIT_PROFILE), DEFAULT_GATE_WAIT_PROFILE);
  const invalid = [
    null, [], {}, { ...DEFAULT_GATE_WAIT_PROFILE, source: 'observed' },
    { ...DEFAULT_GATE_WAIT_PROFILE, metric_version: '2.0.0' }, { ...DEFAULT_GATE_WAIT_PROFILE, model_version: '2.0.0' },
    { ...DEFAULT_GATE_WAIT_PROFILE, model_id: ' ' }, { ...DEFAULT_GATE_WAIT_PROFILE, assumptions: [] },
    { ...DEFAULT_GATE_WAIT_PROFILE, default_assumption_id: 'missing' }, { ...DEFAULT_GATE_WAIT_PROFILE, weight: 2 },
    { ...DEFAULT_GATE_WAIT_PROFILE, assumptions: [DEFAULT_GATE_WAIT_PROFILE.assumptions[0], DEFAULT_GATE_WAIT_PROFILE.assumptions[0]] },
    ...[-0.1, 1.1, NaN, Infinity, '0.25'].map(release_delay_probability => ({
      ...DEFAULT_GATE_WAIT_PROFILE, assumptions: [{ ...DEFAULT_GATE_WAIT_PROFILE.assumptions[0], release_delay_probability }],
    })),
    ...[-1, 241, NaN, Infinity, '20'].map(expected_release_delay_minutes_given_delay => ({
      ...DEFAULT_GATE_WAIT_PROFILE, assumptions: [{ ...DEFAULT_GATE_WAIT_PROFILE.assumptions[0], expected_release_delay_minutes_given_delay }],
    })),
  ];
  for (const value of invalid) assert.throws(() => parseGateWaitProfile(value), /profile|assumption/);
  assert.throws(() => evaluateGateWaitPlans(waitingSnapshot(), DEFAULT_GATE_WAIT_PROFILE, 'missing'), /Unknown/);
  assert.throws(() => evaluateGateWaitPlans(waitingSnapshot(), null), /profile/);
});

test('hand-calculated waiting uses the predecessor release delay and preserves unassessed arrivals', () => {
  const snapshot = waitingSnapshot(), before = structuredClone(snapshot);
  const result = evaluateGateWaitPlans(snapshot);
  const waiting = result.variants.baseline.waiting;
  assert.equal(waiting.availability, 'available');
  assert.deepEqual(waiting.summary, {
    assigned_arrivals_in_horizon: 3, assessed_arrivals: 2, unassessed_arrivals: 1,
    context_arrivals: 0, arrivals_with_positive_estimate: 2, total_wait_minutes: 5, maximum_arrival_wait_minutes: 2.5,
  });
  assert.deepEqual(waiting.contributions.map(item => [item.arrival_id, item.gap_minutes, item.estimated_wait_minutes]),
    [['arr:v1', 10, 2.5], ['arr:v2', 10, 2.5]]);
  assert.deepEqual(waiting.unassessed, [{ arrival_id: 'arr:v0', reason: 'no-complete-predecessor-handover' }]);
  assert.equal(result.comparison.wait_delta_minutes, 0);
  assert.equal(result.profile.model_id, DEFAULT_GATE_WAIT_PROFILE.model_id);
  assert.equal(result.assumption.id, 'routine');
  assert.deepEqual(snapshot, before);
});

test('zero delay probability, zero conditional delay and gaps at or above the mean give valid zero estimates', () => {
  const base = DEFAULT_GATE_WAIT_PROFILE.assumptions[0];
  for (const assumption of [
    { ...base, release_delay_probability: 0 },
    { ...base, expected_release_delay_minutes_given_delay: 0 },
    { ...base, expected_release_delay_minutes_given_delay: 10 },
  ]) {
    const profile = { ...DEFAULT_GATE_WAIT_PROFILE, assumptions: [assumption] };
    const result = evaluateGateWaitPlans(waitingSnapshot(), profile).variants.baseline.waiting;
    assert.equal(result.availability, 'available');
    assert.equal(result.summary.total_wait_minutes, 0);
    assert.equal(result.summary.arrivals_with_positive_estimate, 0);
    assert.equal(result.summary.unassessed_arrivals, 1);
  }
  const zeroGap = evaluateGateWaitPlans(waitingSnapshot([[0, 10, 'stand:1'], [10, 20, 'stand:1']]));
  assert.equal(zeroGap.variants.baseline.waiting.summary.total_wait_minutes, 5);
  const largerGap = evaluateGateWaitPlans(waitingSnapshot([[0, 10, 'stand:1'], [40, 50, 'stand:1']]));
  assert.equal(largerGap.variants.baseline.waiting.summary.total_wait_minutes, 0);
});

test('fractional assumptions retain arithmetic precision, and stressed inputs do not change placements', () => {
  const snapshot = waitingSnapshot([[0, 10, 'stand:1'], [15.25, 25, 'stand:1']]);
  const assumption = { ...DEFAULT_GATE_WAIT_PROFILE.assumptions[0], release_delay_probability: 0.1, expected_release_delay_minutes_given_delay: 10.5 };
  const result = evaluateGateWaitPlans(snapshot, { ...DEFAULT_GATE_WAIT_PROFILE, assumptions: [assumption] });
  assert.ok(Math.abs(result.variants.baseline.waiting.summary.total_wait_minutes - 0.525) < 1e-12);
  const stressed = evaluateGateWaitPlans(waitingSnapshot(), DEFAULT_GATE_WAIT_PROFILE, 'stressed');
  assert.equal(stressed.variants.baseline.waiting.summary.total_wait_minutes, 30);
  assert.equal(stressed.variants.baseline.waiting.summary.maximum_arrival_wait_minutes, 15);
  assert.equal(stressed.variants.baseline.request_fingerprint, waitingSnapshot().variants.baseline.request_fingerprint);
});

test('only arrival handovers contribute, while predecessor tow releases remain explicit', () => {
  const snapshot = waitingSnapshot([[0, 10, 'stand:1'], [20, 30, 'stand:1'], [60, 70, 'stand:1']]);
  snapshot.flights.find(flight => flight.id === 'dep:v1').scheduled = waitInstant(90);
  for (const plan of Object.values(snapshot.variants)) {
    const service = plan.stays.find(stay => stay.visitId === 'v1');
    delete service.departureFlightId;
    service.towOut = true;
    plan.stays.push({
      id: 'v1-parking', visitId: 'v1', rowId: 'stand:1', start: waitInstant(40), end: waitInstant(50), towIn: true, towOut: true,
    }, {
      id: 'v1-departure', visitId: 'v1', rowId: 'stand:1', start: waitInstant(80), end: waitInstant(90),
      departureFlightId: 'dep:v1', towIn: true, towOut: false,
    });
    plan.generated_movement_count = 2;
  }
  const result = evaluateGateWaitPlans(snapshot).variants.baseline.waiting;
  assert.deepEqual(result.contributions.map(item => [item.arrival_id, item.predecessor_release_kind]),
    [['arr:v1', 'departure'], ['arr:v2', 'tow']]);
  assert.equal(result.summary.assessed_arrivals, 2);
  assert.equal(result.summary.total_wait_minutes, 5);
  assert.ok(result.contributions.every(item => item.handover.next.id !== 'v1-parking' && item.handover.next.id !== 'v1-departure'));
});

test('boundary context is separate from unassessed in-horizon arrivals, without imaginary predecessors', () => {
  const result = evaluateGateWaitPlans(waitingSnapshot([[-20, 10, 'stand:1'], [20, 30, 'stand:1'], [200, 210, 'stand:1']]));
  const waiting = result.variants.baseline.waiting;
  assert.deepEqual(waiting.context_arrival_ids, ['arr:v0', 'arr:v2']);
  assert.equal(waiting.summary.assigned_arrivals_in_horizon, 1);
  assert.equal(waiting.summary.assessed_arrivals, 1);
  assert.equal(waiting.summary.unassessed_arrivals, 0);
  assert.equal(waiting.summary.total_wait_minutes, 2.5);
  const noPredecessor = evaluateGateWaitPlans(waitingSnapshot([[10, 20, 'stand:1']])).variants.baseline.waiting;
  assert.equal(noPredecessor.availability, 'not-applicable');
  assert.equal(noPredecessor.summary.total_wait_minutes, null);
  assert.equal(noPredecessor.summary.maximum_arrival_wait_minutes, null);
  assert.equal(noPredecessor.summary.unassessed_arrivals, 1);
});

test('overlapping plans are invalid rather than false zero-wait predictions', () => {
  const result = evaluateGateWaitPlans(waitingSnapshot([[0, 30, 'stand:1'], [20, 40, 'stand:1']]));
  for (const plan of Object.values(result.variants)) {
    assert.equal(plan.waiting.availability, 'invalid');
    assert.equal(plan.waiting.summary.total_wait_minutes, null);
    assert.equal(plan.waiting.summary.maximum_arrival_wait_minutes, null);
    assert.equal(plan.waiting.contributions.length, 0);
    assert.equal(plan.waiting.unassessed.length, 2);
    assert.ok(plan.waiting.unassessed.every(item => item.reason === 'overlapping-occupancy'));
  }
  assert.equal(result.comparison.wait_delta_minutes, null);
});

test('empty assignments and parking-only handovers are not applicable, not measured zero waiting', () => {
  const snapshot = waitingSnapshot();
  for (const plan of Object.values(snapshot.variants)) plan.stays.forEach(stay => { delete stay.arrivalFlightId; stay.towIn = true; });
  let result = evaluateGateWaitPlans(snapshot);
  assert.equal(result.variants.baseline.waiting.availability, 'not-applicable');
  assert.equal(result.variants.baseline.waiting.summary.total_wait_minutes, null);
  for (const plan of Object.values(snapshot.variants)) plan.stays = [];
  result = evaluateGateWaitPlans(snapshot);
  assert.equal(result.variants.baseline.waiting.summary.assigned_arrivals_in_horizon, 0);
  assert.equal(result.comparison.wait_delta_minutes, null);
});

test('equal assessed counts do not hide different assessed arrival sets', () => {
  const snapshot = waitingSnapshot([[0, 10, 'stand:1'], [20, 30, 'stand:1'], [40, 50, 'stand:2']]);
  snapshot.variants['tow-options'].stays[0].rowId = 'stand:2';
  const result = evaluateGateWaitPlans(snapshot);
  assert.equal(result.comparison.assigned_sets_differ, false);
  assert.equal(result.variants.baseline.waiting.summary.assessed_arrivals, 1);
  assert.equal(result.variants['tow-options'].waiting.summary.assessed_arrivals, 1);
  assert.equal(result.comparison.assessed_sets_differ, true);
  assert.equal(result.comparison.wait_delta_minutes, null);
  const brief = buildDecisionBrief(snapshot, 'baseline', { kind: 'variant', variant: 'tow-options' }, 'routine');
  assert.equal(brief.common.arrivalIds.length, 0);
  assert.equal(brief.common.beforeMinutes, null);
  assert.equal(brief.common.afterMinutes, null);
});

test('gate-wait source endpoints fail explicitly on invalid or duplicate arrival references', () => {
  for (const mutate of [
    snapshot => { snapshot.variants.baseline.stays[0].arrivalFlightId = 'missing'; },
    snapshot => { snapshot.variants.baseline.stays[0].arrivalFlightId = 'dep:v0'; },
    snapshot => { snapshot.flights[0].scheduled = waitInstant(1); },
    snapshot => { snapshot.flights.push({ ...snapshot.flights[0] }); },
    snapshot => { snapshot.variants.baseline.stays[0].towIn = true; },
    snapshot => { snapshot.variants.baseline.stays[0].departureFlightId = 'missing'; },
    snapshot => { snapshot.variants.baseline.stays[0].departureFlightId = 'arr:v0'; },
    snapshot => { snapshot.variants.baseline.stays[0].towOut = true; },
    snapshot => { snapshot.flights.find(flight => flight.id === 'dep:v0').scheduled = waitInstant(11); },
  ]) {
    const snapshot = waitingSnapshot();
    mutate(snapshot);
    assert.throws(() => evaluateGateWaitPlans(snapshot), /gate-wait|Duplicate/);
  }
});

test('all prepared plans reconcile assessed arrivals, retain provenance and preserve source and buffer results', () => {
  for (const caseId of ['comfortable', 'constrained', 'full-day']) {
    const snapshot = readSnapshot(caseId), before = structuredClone(snapshot);
    const buffers = evaluateBufferPlans(snapshot);
    const result = evaluateGateWaitPlans(snapshot);
    const stressed = evaluateGateWaitPlans(snapshot, DEFAULT_GATE_WAIT_PROFILE, 'stressed');
    assert.equal(result.demand_id, snapshot.demand_id);
    for (const variant of ['baseline', 'tow-options']) {
      const plan = result.variants[variant], summary = plan.waiting.summary;
      assert.equal(plan.waiting.availability, 'available');
      assert.equal(summary.assessed_arrivals + summary.unassessed_arrivals, summary.assigned_arrivals_in_horizon);
      assert.equal(summary.assigned_arrivals_in_horizon + summary.context_arrivals,
        snapshot.variants[variant].stays.filter(stay => stay.arrivalFlightId).length);
      assert.equal(plan.assigned_visits, buffers.variants[variant].assigned_visits);
      assert.equal(plan.request_fingerprint, snapshot.variants[variant].request_fingerprint);
      assert.equal(summary.total_wait_minutes, plan.waiting.contributions.reduce((sum, item) =>
        sum + 0.25 * Math.max(0, 20 - item.gap_minutes), 0));
      assert.ok(stressed.variants[variant].waiting.summary.total_wait_minutes >= summary.total_wait_minutes);
    }
    assert.deepEqual(snapshot, before);
    assert.deepEqual(evaluateBufferPlans(snapshot), buffers);
    const reordered = structuredClone(snapshot);
    reordered.flights.reverse(); reordered.visits.reverse();
    for (const plan of Object.values(reordered.variants)) plan.stays.reverse();
    assert.deepEqual(evaluateGateWaitPlans(reordered), result);
  }
  const constrained = evaluateGateWaitPlans(readSnapshot('constrained'));
  assert.equal(constrained.comparison.assigned_sets_differ, true);
  assert.equal(constrained.comparison.wait_delta_minutes, null);
});

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
  for (const source of ['original', 'contoso', 'gtaa']) {
    for (const scenario of scenariosForSource(source)) {
      for (const variant of ['baseline', 'tow-options']) {
        const preferences = { version: 1, source, scenario, variant };
        assert.deepEqual(parseDemoPreferences(JSON.parse(JSON.stringify(preferences))), preferences);
      }
    }
  }
  for (const value of [null, [], 'contoso', {}, { ...DEFAULT_DEMO_PREFERENCES, version: 2 },
    { ...DEFAULT_DEMO_PREFERENCES, scenario: 'deleted' }, { ...DEFAULT_DEMO_PREFERENCES, variant: 'unvalidated' },
    { ...DEFAULT_DEMO_PREFERENCES, source: 'live' }, { ...DEFAULT_DEMO_PREFERENCES, data: {} },
    { ...DEFAULT_DEMO_PREFERENCES, source: 'gtaa', scenario: 'comfortable' },
    { ...DEFAULT_DEMO_PREFERENCES, source: 'gtaa', scenario: 'constrained' }]) {
    assert.throws(() => parseDemoPreferences(value), /invalid|unsupported/);
  }
});

test('GTAA loads both complete stand-only plans without Contoso analysis evidence or profiles', async () => {
  const ids = new Set([ORIGINAL_DATASET.id]);
  const stands = JSON.parse(readFileSync(resolve(root, 'data\\airports\\gtaa\\infrastructure\\stands.json'), 'utf8')).stands;
  const standIds = new Set(stands.map(stand => stand.id));
  for (const variant of ['baseline', 'tow-options']) {
    const dataset = await loadDemoDataset({ version: 1, source: 'gtaa', scenario: 'full-day', variant });
    assert.ok(!ids.has(dataset.id));
    ids.add(dataset.id);
    assert.match(dataset.label, /^Toronto Pearson International Airport/);
    assert.match(dataset.label, /Full day/);
    assert.equal(dataset.date, '2026-10-28');
    assert.deepEqual(dataset.domain, [Date.parse('2026-10-28T04:00:00Z'), Date.parse('2026-10-29T04:00:00Z')]);
    assert.equal(dataset.timeBasis, 'scheduled');
    assert.match(dataset.subtitle, /not operationally certified/);
    assert.equal(dataset.timeline.rows.length, 168);
    assert.deepEqual(new Set(dataset.timeline.rows.map(row => row.id)), standIds);
    assert.deepEqual(Object.fromEntries(['t1', 't3', 'ifc'].map(group =>
      [group, dataset.timeline.rows.filter(row => row.group === group).length])), { t1: 97, t3: 57, ifc: 14 });
    assert.equal(dataset.timeline.occupancies.length, 160);
    assert.equal(dataset.timeline.turnsById.size, 160);
    assert.equal(dataset.flights.length, 320);
    assert.equal(dataset.arrivals.length, 160);
    assert.equal(dataset.departures.length, 160);
    assert.equal(dataset.alerts.length, 0);
    assert.ok([...dataset.timeline.endpoints.values()].every(item => item.start.kind === 'flight' && item.end.kind === 'flight'));
    assert.equal(dataset.prepared.snapshot.airport.id, 'gtaa');
    assert.equal(dataset.prepared.snapshot.airport.time_zone, 'America/Toronto');
    assert.equal(dataset.prepared.snapshot.variants[variant].solver_status, 'optimal');
    assert.equal(dataset.prepared.snapshot.variants[variant].covered_flight_count, 320);
    assert.equal(dataset.prepared.snapshot.variants[variant].generated_movement_count, 0);
    for (const field of ['reviewProfiles', 'capacity', 'atlas', 'accommodation', 'towWindows']) {
      assert.equal(dataset.prepared[field], undefined, `GTAA must not borrow ${field}`);
    }
    for (const flight of dataset.flights) {
      assert.equal(dataset.flightsById.get(flight.id), flight);
      assert.ok(standIds.has(flight.standId));
      const stay = dataset.timeline.occupancies.find(stay => stay.id === flight.occupancyId);
      assert.equal(stay.visitId, flight.visitId);
      assert.equal(stay.rowId, flight.standId);
    }
    const options = makeFilterOptions(dataset);
    assert.deepEqual(options.carrier, ['AAL', 'ACA', 'AFR', 'BAW', 'CES', 'CPA', 'DAL', 'DLH', 'EVA', 'UAL']);
    assert.equal(options.type.length, 5);
    assert.ok(options.type.every(type => type.startsWith('gtaa:aircraft:')));
    const aca = makeMatcher(dataset, 'all', { ...EMPTY_FILTERS, carrier: ['ACA'] }, new Set());
    assert.equal(dataset.flights.filter(aca.flight).length, 220);
    for (const group of ['t1', 't3', 'ifc']) {
      const matcher = makeMatcher(dataset, 'all', { ...EMPTY_FILTERS, area: [group] }, new Set());
      const rows = new Set(dataset.timeline.rows.filter(row => row.group === group).map(row => row.id));
      assert.ok(dataset.flights.filter(matcher.flight).every(flight => rows.has(flight.standId)));
      assert.ok(dataset.timeline.occupancies.filter(stay => matcher.occupancy(stay.id)).every(stay => rows.has(stay.rowId)));
    }
    const tows = makeMatcher(dataset, 'tows', EMPTY_FILTERS, new Set());
    assert.equal(dataset.flights.filter(tows.flight).length, 0);
    assert.equal(dataset.timeline.occupancies.filter(stay => tows.occupancy(stay.id)).length, 0);
  }
});

test('actual Contoso loaders retain all cases, both variants and their own review profiles', async () => {
  for (const scenario of scenariosForSource('contoso')) for (const variant of ['baseline', 'tow-options']) {
    const dataset = await loadDemoDataset({ version: 1, source: 'contoso', scenario, variant });
    assert.match(dataset.label, /^Contoso/);
    assert.equal(dataset.prepared.snapshot.case_id, scenario);
    assert.equal(dataset.prepared.variant, variant);
    assert.ok(dataset.prepared.capacity && dataset.prepared.atlas && dataset.prepared.accommodation && dataset.prepared.towWindows);
    assert.equal(dataset.prepared.reviewProfiles.buffers, DEFAULT_BUFFER_PROFILE);
    assert.equal(dataset.prepared.reviewProfiles.waiting, DEFAULT_GATE_WAIT_PROFILE);
  }
  await assert.rejects(loadDemoDataset({ version: 1, source: 'gtaa', scenario: 'comfortable', variant: 'baseline' }), /invalid|unsupported/);
});

test('snapshot selection checks airport identity as well as a shared full-day case ID', () => {
  const gtaa = JSON.parse(readFileSync(resolve(root, 'src\\demo\\prepared\\gtaa\\full-day.json'), 'utf8'));
  const contoso = readSnapshot('full-day');
  const expected = { airportId: 'gtaa', caseId: 'full-day' };
  assert.equal(validatePreparedSnapshot(gtaa, expected), gtaa);
  assert.throws(() => validatePreparedSnapshot(contoso, expected), /airport or case/);
  assert.throws(() => validatePreparedSnapshot(gtaa, { airportId: 'contoso', caseId: 'full-day' }), /airport or case/);
  assert.throws(() => validatePreparedSnapshot(gtaa, { airportId: 'gtaa', caseId: 'comfortable' }), /airport or case/);
  const missingIdentity = structuredClone(gtaa);
  delete missingIdentity.airport;
  assert.throws(() => validatePreparedSnapshot(missingIdentity, expected), /airport or case/);
  assert.equal(validatePreparedSnapshot(contoso, { airportId: 'contoso', caseId: 'full-day' }), contoso);
});

test('decision review uses explicitly supplied airport profiles rather than Contoso assumptions', () => {
  const snapshot = readSnapshot('comfortable');
  const profiles = {
    buffers: { ...DEFAULT_BUFFER_PROFILE, threshold_minutes: 2 },
    waiting: {
      ...DEFAULT_GATE_WAIT_PROFILE,
      assumptions: DEFAULT_GATE_WAIT_PROFILE.assumptions.map(item => ({ ...item, id: `other-airport:${item.id}` })),
    },
  };
  const brief = buildDecisionBrief(snapshot, 'baseline', { kind: 'variant', variant: 'tow-options' },
    profiles.waiting.assumptions[0].id, undefined, profiles);
  assert.equal(brief.bufferProfile, profiles.buffers);
  assert.equal(brief.waitingProfile, profiles.waiting);
  assert.equal(brief.assumption, profiles.waiting.assumptions[0]);
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
