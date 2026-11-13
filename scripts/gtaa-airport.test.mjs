import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileAirport, evaluatePlan, getHourlyDistribution, getMinimumLegWindow, loadAirport, readJson, trafficWeightAt, validateAirport } from './airport-model.mjs';

const manifestPath = fileURLToPath(new URL('../data/airports/gtaa/airport.json', import.meta.url));
const directory = dirname(manifestPath);
const data = loadAirport(manifestPath);
const evidence = readJson(resolve(directory, data.airport.datasets.source_evidence));
const gaps = readJson(resolve(directory, data.airport.datasets.data_gaps));
const georeferencing = readJson(resolve(directory, data.airport.datasets.georeferencing));
const applyTransform = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const meanLabelPoint = labels => [0, 1].map(axis => labels.reduce((sum, label) => sum + label.point[axis], 0) / labels.length);
function geographicPoint([x, y]) {
  const [longitude, latitude] = georeferencing.anchor.coordinates;
  const radians = Math.PI / 180;
  const radius = georeferencing.projection.radius_metres;
  const metres = georeferencing.scale.ground_metres_per_pixel / Math.cos(latitude * radians);
  const mercatorY = radius * Math.log(Math.tan(Math.PI / 4 + latitude * radians / 2));
  return [
    longitude + (x - georeferencing.anchor.image_pixel[0]) * metres / radius / radians,
    Math.atan(Math.sinh((mercatorY - (y - georeferencing.anchor.image_pixel[1]) * metres) / radius)) / radians,
  ].map(value => Number(value.toFixed(6)));
}
const stand = id => data.stands.stands.find(s => s.id === id);
const table = id => evidence.stand_tables.find(s => s.stand_id === id);
const rows = id => table(id).sections.flatMap(s => s.rows);
const triggers = id => stand(id)['close-conditions'].filter(c => !c['aircraft-groups']).map(c => c.stand);

test('GTAA user-ready stand configuration validates without implying operational approval', () => {
  const result = validateAirport(data);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(data.stands.stands.every(s => s.configuration_status === 'ready'));
  assert.equal(data.airport.time_zone, 'America/Toronto');
  assert.equal(data.airport.planning_ready, false);
  assert.equal(data.airport.routing_ready, false);
  assert.deepEqual(
    ['t1', 't3', 'ifc'].map(id => data.stands.stands.filter(s => s.associated_building_id === id).length),
    [97, 57, 14],
  );
  assert.deepEqual(
    ['t1', 't3', 'ifc'].map(id => data.gates.gates.filter(g => g.building_id === id).length),
    [86, 48, 13],
  );
});

test('every supplied document has a source digest, with local files checked when available', async t => {
  assert.equal(evidence.sources.length, 10);
  assert.equal(new Set(evidence.sources.map(s => s.id)).size, 10);
  for (const source of evidence.sources) {
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    const file = resolve(directory, source.file);
    await t.test(source.id, {
      skip: existsSync(file) ? false : 'User-provided source is local-only; data/samples is gitignored.',
    }, () => {
      const bytes = readFileSync(file);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, source.id);
    });
  }
  const workbook = evidence.sources.find(s => s.id === 'sector-workbook');
  assert.equal(workbook.status, 'blocked-rights-management-encryption');
  assert.equal(gaps.blockers.find(g => g.id === 'sectors').status, 'user-configured');
});

test('all current ASM table pages are covered without promoting revision-history stands', () => {
  assert.equal(evidence.stand_tables.length, 158);
  assert.deepEqual(evidence.extraction.stand_counts, { t1: 87, t3: 57, ifc: 14 });
  let pages = 0;
  for (const source of evidence.sources.filter(s => s.role === 'aircraft-stand-mix')) {
    const sections = evidence.stand_tables.flatMap(s => s.sections).filter(s => s.source_id === source.id);
    const covered = [...new Set(sections.map(s => s.pdf_page))].sort((a, b) => a - b);
    const [first, last] = source.current_table_pages;
    assert.deepEqual(covered, Array.from({ length: last - first + 1 }, (_, i) => first + i));
    pages += covered.length;
    assert.ok(sections.every(s => s.rows.length > 0));
    for (const section of sections) {
      assert.ok(section.rows.every(r => typeof r.raw === 'string' && Number.isFinite(r.source_y)));
    }
  }
  assert.equal(pages, 94);
  assert.equal(evidence.extraction.table_pages, pages);
  assert.equal(stand('t1:stand:000'), undefined);
  assert.equal(stand('t3:stand:C40A'), undefined);
  assert.ok(table('t3:stand:B7E'));
  assert.ok(table('t3:stand:B7F'));
});

test('user-configured ready stands retain explicit permissions and geometry-only evaluation safeguards', () => {
  for (const s of data.stands.stands) {
    assert.equal(s.configuration_status, 'ready');
    assert.equal(typeof s.contact, 'boolean');
    assert.equal(typeof s.closed, 'boolean');
    assert.ok(s['airline-groups'].length, s.id);
    assert.ok(s['arrival-sector-group'], s.id);
    assert.ok(s['departure-sector-group'], s.id);
  }
  for (const gate of data.gates.gates) {
    assert.equal(gate.source.level_status, 'unverified');
  }
  assert.ok([...compileAirport(data).allowedAirlines.values()].every(airlines => airlines.size > 0));
  const fixture = structuredClone(data);
  fixture.stands.stands.find(s => s.id === 't1:stand:124').configuration_status = 'geometry-only';
  assert.throws(() => evaluatePlan(compileAirport(fixture), [{
    id: 'unreviewed', standId: 't1:stand:124', aircraftId: 'gtaa:aircraft:A330-300', start: 0, end: 100,
  }]), /Stand is not configured/);
});

test('GTAA handling and tow policies match the explicitly approved synthetic defaults', () => {
  const contoso = loadAirport();
  assert.equal(data.operatingPolicy.airport_id, 'gtaa');
  assert.match(data.operatingPolicy.description, /synthetic demo assumptions copied from Contoso/);
  assert.deepEqual(data.operatingPolicy['minimum-leg-windows'], contoso.operatingPolicy['minimum-leg-windows']);
  const fixture = structuredClone(data);
  for (const code of 'ABCDEF') fixture.aircraft.aircraft.push({ id: `test:${code}`, 'ICAO-code': code });
  const model = compileAirport(fixture);
  assert.equal(model.defaultTowMinutes, 12);
  const block = Date.parse('2026-10-27T15:00:00Z');
  for (const code of 'ABCDEF') {
    const minutes = code <= 'C' ? 45 : 60;
    assert.deepEqual(getMinimumLegWindow(model, `test:${code}`, 'arrival', block), {
      start: block, end: block + minutes * 60_000, minimumMinutes: minutes, aircraftSizeCode: code,
    });
    assert.deepEqual(getMinimumLegWindow(model, `test:${code}`, 'departure', block), {
      start: block - minutes * 60_000, end: block, minimumMinutes: minutes, aircraftSizeCode: code,
    });
  }
});

test('synthetic handling windows still require aircraft size metadata', () => {
  const fixture = structuredClone(data);
  const aircraft = fixture.aircraft.aircraft[0];
  delete aircraft['ICAO-code'];
  assert.ok(validateAirport(fixture).errors.some(error => error.includes(`${aircraft.id}/ICAO-code`)));
  assert.throws(() => compileAirport(fixture), /missing or unconfigured aircraft size code/);
  const model = compileAirport(data);
  model.aircraftSizeCodes.delete(aircraft.id);
  assert.throws(() => getMinimumLegWindow(model, aircraft.id, 'arrival', Date.now()), /Minimum leg window policy is not configured/);
});

test('GTAA synthetic traffic retains the approved Contoso weights for every configured sector', () => {
  const contoso = loadAirport();
  assert.equal(data.trafficProfile.airport_id, 'gtaa');
  assert.equal(data.trafficProfile.synthetic, true);
  assert.equal(data.trafficProfile.time_basis, 'airport-local');
  assert.match(data.trafficProfile.description, /copied from Contoso/);
  assert.deepEqual(data.trafficProfile['sector-patterns'], contoso.trafficProfile['sector-patterns']);
  const model = compileAirport(data);
  const sectors = data.sectors.sectors.map(sector => sector.id).sort();
  assert.deepEqual([...model.trafficPatterns.keys()].sort(), sectors);
  for (const sector of sectors) for (const leg of ['arrival', 'departure']) {
    const distribution = getHourlyDistribution(model, sector, leg);
    assert.equal(distribution.length, 24);
    assert.ok(distribution.every(weight => Number.isFinite(weight) && weight >= 0));
    assert.ok(Math.abs(distribution.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
  }
});

test('GTAA traffic uses Toronto local hours in both standard and daylight time', () => {
  const model = compileAirport(data);
  const sixAM = getHourlyDistribution(model, 'domestic', 'departure')[6];
  assert.equal(trafficWeightAt(model, 'domestic', 'departure', Date.parse('2026-01-15T11:00:00Z')), sixAM);
  assert.equal(trafficWeightAt(model, 'domestic', 'departure', Date.parse('2026-07-15T10:00:00Z')), sixAM);
});

test('georeferencing uses the confirmed pin tip and physical scale, not a cropped page centre', () => {
  const { anchor, image, overview, scale } = georeferencing;
  assert.deepEqual(anchor.coordinates, [-79.622388, 43.682157]);
  assert.deepEqual(data.airport.spatial_reference.reference_coordinates, anchor.coordinates);
  assert.deepEqual(anchor.image_pixel, applyTransform(overview.overview_to_image, anchor.overview_pixel));
  assert.notDeepEqual(anchor.image_pixel, [image.width_pixels / 2, image.height_pixels / 2]);
  assert.deepEqual(geographicPoint(anchor.image_pixel), anchor.coordinates);
  assert.equal(scale.ground_metres_per_pixel, 100 / 114);
  assert.equal(scale.metric.pixel_edges[1] - scale.metric.pixel_edges[0], scale.metric.pixel_width);
  assert.equal(scale.imperial_check.pixel_edges[1] - scale.imperial_check.pixel_edges[0], scale.imperial_check.pixel_width);
  const scaleDifference = Math.abs((scale.imperial_check.metres / scale.imperial_check.pixel_width) / scale.ground_metres_per_pixel - 1);
  assert.equal(scale.cross_check_relative_difference, scaleDifference);
  assert.ok(scaleDifference < 0.02);
  const cssMetresPerPixel = Math.cos(anchor.coordinates[1] * Math.PI / 180) * 2 * Math.PI * 6378137 / (256 * 2 ** scale.user_zoom);
  assert.ok(cssMetresPerPixel / scale.ground_metres_per_pixel > 1.4);
  assert.ok(cssMetresPerPixel / scale.ground_metres_per_pixel < 1.6);
  const east = geographicPoint([anchor.image_pixel[0] + 114, anchor.image_pixel[1]]);
  const north = geographicPoint([anchor.image_pixel[0], anchor.image_pixel[1] - 114]);
  assert.ok(east[0] > anchor.coordinates[0]);
  assert.equal(east[1], anchor.coordinates[1]);
  assert.ok(north[1] > anchor.coordinates[1]);
  assert.equal(north[0], anchor.coordinates[0]);
  assert.equal(georeferencing.accuracy.absolute_horizontal_metres, null);
});

test('terminal transforms reproduce control vertices and held-out drawing checks', () => {
  const sourceIds = new Set(evidence.sources.map(source => source.id));
  for (const [id, transform] of Object.entries(georeferencing.transforms)) {
    assert.ok(sourceIds.has(transform.source_id));
    assert.ok(sourceIds.has(transform.alignment_source_id));
    const alignmentToImage = id === 'ifc' ? georeferencing.overview.overview_to_image : georeferencing.image.overlay_pdf_to_image;
    for (const control of transform.fit_controls) {
      const expected = applyTransform(alignmentToImage, control.alignment_point);
      const actual = applyTransform(transform.pdf_to_image, control.pdf_point);
      assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 0.00001);
    }
    const residuals = transform.registration_checks.map(check => {
      const expected = applyTransform(alignmentToImage, check.alignment_point);
      const actual = applyTransform(transform.pdf_to_image, check.pdf_point);
      const metres = Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) * georeferencing.scale.ground_metres_per_pixel;
      assert.ok(Math.abs(metres - check.residual_ground_metres) < 0.000001);
      assert.ok(metres < (id === 'ifc' ? 4 : 0.01));
      return metres;
    });
    assert.ok(residuals.length > 0);
    assert.ok(Math.abs(Math.max(...residuals) - transform.max_registration_residual_ground_metres) < 0.000001);
  }
});

test('all located entities have reproducible label coordinates while two ASM-only stands stay unlocated', () => {
  const located = [];
  const unlocated = [];
  for (const entity of [...data.stands.stands, ...data.gates.gates]) {
    const labels = entity.source.map_labels ?? entity.source.label_points;
    if (!labels.length) {
      unlocated.push(entity.id);
      assert.deepEqual(entity.coordinates, georeferencing.unlocated_placeholder_coordinates);
      assert.equal(entity.source.coordinate_status, 'airport-reference-placeholder');
      assert.equal(entity.source.georeferencing, undefined);
      continue;
    }
    located.push(entity);
    const id = entity.associated_building_id ?? entity.building_id;
    const pixel = applyTransform(georeferencing.transforms[id].pdf_to_image, meanLabelPoint(labels));
    assert.equal(entity.source.coordinate_status, 'approximate-georeferenced-label');
    assert.equal(entity.source.georeferencing.transform_id, id);
    assert.deepEqual(entity.coordinates, geographicPoint(pixel), entity.id);
    assert.notDeepEqual(entity.coordinates, georeferencing.unlocated_placeholder_coordinates);
    assert.ok(entity.coordinates[0] > -79.64 && entity.coordinates[0] < -79.59, entity.id);
    assert.ok(entity.coordinates[1] > 43.67 && entity.coordinates[1] < 43.70, entity.id);
    for (const axis of [0, 1]) assert.ok(Math.abs(entity.source.georeferencing.image_pixel[axis] - pixel[axis]) <= 0.00005);
    assert.equal(resolve(directory, 'infrastructure', entity.source.georeferencing.file), resolve(directory, data.airport.datasets.georeferencing));
  }
  assert.deepEqual(unlocated.sort(), ['ifc:stand:528A', 't1:stand:193']);
  assert.deepEqual(unlocated, georeferencing.unlocated_stand_ids);
  assert.equal(located.length, 313);
  assert.equal(new Set(data.stands.stands.filter(s => s.source.map_labels.length).map(s => s.coordinates.join(','))).size, 166);
  const centroid = id => meanLabelPoint(located.filter(e => (e.associated_building_id ?? e.building_id) === id).map(e => ({ point: e.coordinates })));
  assert.ok(centroid('ifc')[0] < centroid('t3')[0]);
  assert.ok(centroid('t3')[0] < centroid('t1')[0]);
  assert.ok(centroid('t3')[1] > centroid('t1')[1]);
  const gap = gaps.blockers.find(g => g.id === 'coordinates');
  assert.equal(gap.located_stands, 166);
  assert.equal(gap.located_gates, 147);
  assert.deepEqual(gap.unlocated_stand_ids, unlocated);
});

test('contact can be unknown only while a stand is geometry-only', () => {
  const fixture = loadAirport();
  fixture.stands.stands[0].contact = null;
  assert.ok(validateAirport(fixture).errors.some(e => e.includes('/contact')));
  fixture.stands.stands[0].configuration_status = 'geometry-only';
  assert.deepEqual(validateAirport(fixture).errors, []);
  delete fixture.stands.stands[0].contact;
  assert.ok(validateAirport(fixture).errors.some(e => e.includes('contact')));
});

test('closures are directional neighbor-occupancy rules, not unconditional stand shutdowns', () => {
  assert.equal(data.stands.stands.reduce((n, s) => n + triggers(s.id).length, 0), 113);
  assert.deepEqual(triggers('t1:stand:120A'), ['t1:stand:120', 't1:stand:122']);
  assert.deepEqual(triggers('t1:stand:120'), ['t1:stand:120A']);
  assert.deepEqual(triggers('ifc:stand:526'), ['ifc:stand:525', 'ifc:stand:527']);
  assert.deepEqual(triggers('t3:stand:B9'), ['t3:stand:B9A', 't3:stand:B9B']);
  assert.ok(triggers('t3:stand:C34A').includes('t3:stand:C34'));
  assert.ok(!triggers('t3:stand:C34').includes('t3:stand:C34A'));
  assert.ok(!triggers('t1:stand:120A').includes('t1:stand:124'));
  for (const s of data.stands.stands) {
    assert.equal(new Set(triggers(s.id)).size, triggers(s.id).length);
    for (const condition of s['close-conditions'].filter(c => !c['aircraft-groups'])) {
      assert.ok(evidence.translated_closure_headings.some(e =>
        e.target_stand_id === s.id && e.trigger_stand_id === condition.stand));
    }
  }
  for (const e of evidence.translated_closure_headings) {
    assert.ok(triggers(e.target_stand_id).includes(e.trigger_stand_id));
    assert.ok(table(e.trigger_stand_id).sections.some(s =>
      s.source_id === e.source_id && s.pdf_page === e.pdf_page && s.rows.some(r => r.restrictions === e.text)));
  }
});

test('aircraft variants, bridge columns and direction-specific procedures stay in source evidence', () => {
  assert.ok(rows('t1:stand:124').some(r => r.aircraft === 'A350-1000' && r.iata === '351'));
  assert.ok(rows('t1:stand:124').some(r => r.aircraft === 'A350-900' && r.iata === '359'));
  assert.ok(rows('t1:stand:124').some(r => r.bridge_1 === '-L1 Gating Only-' && r.bridge_2 === '-L2 Gating Only-'));
  assert.ok(rows('t1:stand:124').some(r => /permitted on Stand 120A/.test(r.restrictions)));
  assert.ok(rows('t1:stand:254').some(r => /Arrivals Only/.test(r.restrictions)));
  assert.ok(rows('t1:stand:175A').some(r => /176 RESTRICTED TO B737-500 OR SMALLER/.test(r.restrictions)));
  assert.ok(rows('t3:stand:C34A').some(r => r.aircraft === 'A380' && r.iata === '388'));
  assert.ok(rows('ifc:stand:521').some(r => /Aircraft Parking Only/.test(r.restrictions)));
  assert.ok(evidence.stand_tables.every(t => t.status === 'source-transcription-not-executable'));
});

test('physical stands stay distinct from shared or differently named passenger gates', () => {
  assert.deepEqual(stand('t3:stand:A1A').gate_ids, ['t3:gate:B1A']);
  assert.deepEqual(stand('t1:stand:124').gate_ids, ['t1:gate:D24', 't1:gate:D4']);
  assert.deepEqual(stand('t1:stand:162B').gate_ids, ['t1:gate:F62']);
  for (const code of ['245A', '245B', '245C']) assert.deepEqual(stand(`t1:stand:${code}`).gate_ids, ['t1:gate:F99']);
  for (const gate of data.gates.gates) {
    assert.deepEqual(gate.stand_ids, data.stands.stands.filter(s => s.gate_ids.includes(gate.id)).map(s => s.id));
    assert.equal(gate.stand_link_status, 'map-label-association-requires-review');
  }
  assert.equal(gaps.source_reconciliation.length, 12);
  assert.equal(gaps.source_reconciliation.filter(g => g.status === 'map-only-not-confirmed-by-current-asm').length, 10);
  assert.equal(stand('t1:stand:193').source.reconciliation_status, 'asm-only-not-located-on-map');
  assert.equal(stand('ifc:stand:528A').source.reconciliation_status, 'asm-only-not-located-on-map');
  assert.deepEqual(stand('t1:stand:193').gate_ids, []);
  assert.deepEqual(stand('ifc:stand:528A').gate_ids, []);
});

test('all manifest datasets exist and unmodelled geometry remains empty', () => {
  for (const [key, file] of Object.entries(data.airport.datasets)) {
    const dataset = readJson(resolve(directory, file));
    assert.equal(dataset.airport_id, 'gtaa', key);
    if (file.endsWith('.geojson')) {
      assert.equal(dataset.type, 'FeatureCollection');
      assert.deepEqual(dataset.features, []);
    }
  }
  const sources = new Set(evidence.sources.map(s => s.id));
  for (const s of data.stands.stands) {
    for (const ref of [...s.source.map_labels, ...s.source.asm_sections]) assert.ok(sources.has(ref.source_id));
    if (s.source.asm_sections.length) assert.ok(table(s.id));
  }
  for (const entry of evidence.stand_tables) assert.ok(stand(entry.stand_id));
});
