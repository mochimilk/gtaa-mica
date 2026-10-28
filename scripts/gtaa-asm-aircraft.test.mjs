import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAircraftCatalog, parseAircraftExpression } from './gtaa-asm-aircraft.mjs';

const ids = (...types) => types.map(type => `gtaa:aircraft:${type}`).sort();
const resolves = (expression, ...types) => assert.deepEqual(parseAircraftExpression(expression), {
  aircraft_ids: ids(...types),
  unresolved_tokens: [],
});

test('Airbus series shorthand preserves exact series', () => {
  resolves('A220-100/300', 'A220-100', 'A220-300');
  resolves('A330-900/800/300/200', 'A330-900', 'A330-800', 'A330-300', 'A330-200');
  resolves('A340-200/300/500', 'A340-200', 'A340-300', 'A340-500');
  resolves('A350-1000', 'A350-1000');
});

test('Airbus short-haul variants remain separate', () => {
  resolves('A321/321W/A320/320W/319/319W',
    'A321', 'A321-W', 'A320', 'A320-W', 'A319', 'A319-W');
  resolves('A321neo/321W/321/320NEO/320W/320/319neo/319W/319/318',
    'A321-NEO', 'A321-W', 'A321', 'A320-NEO', 'A320-W', 'A320',
    'A319-NEO', 'A319-W', 'A319', 'A318');
});

test('B737 shorthand keeps plain, winglet and Scimitar identities', () => {
  resolves('B737-900W/900/800W/800SSW/800/700W/700/600',
    'B737-900-W', 'B737-900', 'B737-800-W', 'B737-800-SSW',
    'B737-800', 'B737-700-W', 'B737-700', 'B737-600');
  resolves('B737-900SSW/900W/900', 'B737-900-SSW', 'B737-900-W', 'B737-900');
});

test('MAX shorthand inherits MAX only for single-digit series or 10', () => {
  resolves('B737-MAX8/9', 'B737-MAX8', 'B737-MAX9');
  resolves('B737- MAX10/9/8/7/', 'B737-MAX10', 'B737-MAX9', 'B737-MAX8', 'B737-MAX7');
  resolves('B737MAX7/8/9/10', 'B737-MAX7', 'B737-MAX8', 'B737-MAX9', 'B737-MAX10');
  resolves('MAX8/800SSW/800W/800', 'B737-MAX8', 'B737-800-SSW', 'B737-800-W', 'B737-800');
  resolves('B737-MAX9/8/7/900SSW', 'B737-MAX9', 'B737-MAX8', 'B737-MAX7', 'B737-900-SSW');
});

test('regional slash shorthand and observed spelling aliases', () => {
  resolves('CRJ900/705/700/200/100', 'CRJ900', 'CRJ705', 'CRJ700', 'CRJ200', 'CRJ100');
  resolves('CRJ-705/900', 'CRJ705', 'CRJ900');
  resolves('DH8-300/200/100', 'DH8-300', 'DH8-200', 'DH8-100');
  resolves('EMB195-E2/195/190E2/190/175E2/175W/175/170',
    'EMB195-E2', 'EMB195', 'EMB190-E2', 'EMB190', 'EMB175-E2', 'EMB175-W', 'EMB175', 'EMB170');
  resolves('E175W/175/170', 'EMB175-W', 'EMB175', 'EMB170');
  resolves('ERJ 145/140/135', 'EMB145', 'EMB140', 'EMB135');
  resolves('EMB145/135', 'EMB145', 'EMB135');
});

test('widebody and legacy shorthand uses explicit series only', () => {
  resolves('B747-100/400/400C', 'B747-100', 'B747-400', 'B747-400C');
  resolves('B757-300W/300/200W/200', 'B757-300-W', 'B757-300', 'B757-200-W', 'B757-200');
  resolves('B767-400/300W/300/200', 'B767-400', 'B767-300-W', 'B767-300', 'B767-200');
  resolves('B777-200ER/LR', 'B777-200-ER', 'B777-200-LR');
  resolves('B777-9/300ER/300', 'B777-9', 'B777-300-ER', 'B777-300');
  resolves('B787-10/9/8', 'B787-10', 'B787-9', 'B787-8');
  resolves('DC9-51/41/32/21/15', 'DC9-51', 'DC9-41', 'DC9-32', 'DC9-21', 'DC9-15');
  resolves('MD81/82/83/87/88', 'MD81', 'MD82', 'MD83', 'MD87', 'MD88');
  resolves('IL62/IL76/IL96/DC10-30/MD11/MD90', 'IL62', 'IL76', 'IL96', 'DC10-30', 'MD11', 'MD90');
});

test('folded is not merged with unqualified B777-9', () => {
  resolves('B777-9 (Folded)/B777-9', 'B777-9-FOLDED', 'B777-9');
});

test('explicit manufacturer and family changes reset shorthand context', () => {
  resolves('A220-100/300 B737-800W/700 A321/320W CRJ900/705 EMB195/190 DH8-400/300',
    'A220-100', 'A220-300', 'B737-800-W', 'B737-700', 'A321', 'A320-W',
    'CRJ900', 'CRJ705', 'EMB195', 'EMB190', 'DH8-400', 'DH8-300');
  resolves('A340/A330-300', 'A340', 'A330-300');
  resolves('A320/MAX8/9', 'A320', 'B737-MAX8', 'B737-MAX9');
});

test('continuation whitespace and repeated delimiters do not create variants', () => {
  resolves('B737- \n800W//800SSW/700W/500W 300W/',
    'B737-800-W', 'B737-800-SSW', 'B737-700-W', 'B737-500-W', 'B737-300-W');
  resolves('CRJ900/705/700//200/100', 'CRJ900', 'CRJ705', 'CRJ700', 'CRJ200', 'CRJ100');
});

test('only known annotation text is discarded', () => {
  for (const annotation of ["con't", 'con’t', 'Cont’d', '(W=B737 with Winglets)', '(W=B737 with Winglets', '(SSW=Scimitars)']) {
    resolves(annotation);
  }
  resolves('Cont’d A330-900/300 (W=B737 with Winglets) (SSW=Scimitars)', 'A330-900', 'A330-300');
  resolves('Cont’d B777-9 (Folded)', 'B777-9-FOLDED');
  assert.deepEqual(parseAircraftExpression('W/SSW').unresolved_tokens, ['W', 'SSW']);
});

test('empty strings and delimiters have no aircraft', () => {
  resolves('');
  resolves(' \n /\t// ');
});

test('output IDs are sorted and distinct', () => {
  resolves('B737-800W/800/800W/B737-800/800SSW/800',
    'B737-800-W', 'B737-800', 'B737-800-SSW');
});

test('explicit descending B737 intervals enumerate only standard plain-series identities', () => {
  for (const range of ['900to100', '900 to 100', '900-100', '800 to 200', '600-200', '900to700']) {
    const result = parseAircraftExpression(`B737-800W/${range}/MAX8/9`);
    const [start, end] = range.match(/\d+/g).map(Number);
    const plain = [100, 200, 300, 400, 500, 600, 700, 800, 900]
      .filter(series => series >= end && series <= start).map(series => `B737-${series}`);
    assert.deepEqual(result, {
      aircraft_ids: ids(...plain, 'B737-800-W', 'B737-MAX8', 'B737-MAX9'),
      unresolved_tokens: [],
    });
  }
  resolves('B737-900 to 100',
    'B737-100', 'B737-200', 'B737-300', 'B737-400', 'B737-500', 'B737-600', 'B737-700', 'B737-800', 'B737-900');
  resolves('B737-900-300',
    'B737-300', 'B737-400', 'B737-500', 'B737-600', 'B737-700', 'B737-800', 'B737-900');
  resolves('B737-500-100', 'B737-100', 'B737-200', 'B737-300', 'B737-400', 'B737-500');
  assert.deepEqual(parseAircraftExpression('smaller than A320').unresolved_tokens, ['smaller than']);
});

test('intervals never expand unknown, qualified, reversed or non-B737 series', () => {
  for (const expression of ['B737-950to100', 'B737-900to150', 'B737-900Wto100',
    'B737-900to100W', 'B737-MAX9to7', 'B737-100to900',
    'B737-900 to', 'A330-900to200', 'CRJ900to100']) {
    assert.deepEqual(parseAircraftExpression(expression), {
      aircraft_ids: [], unresolved_tokens: [expression],
    });
  }
});

test('PDF whitespace within known tokens and explicit intervals is normalized', () => {
  resolves('B737-700 W/80 0W/8 00 to 200/900t o100/MAX8/9',
    'B737-100', 'B737-200', 'B737-300', 'B737-400', 'B737-500',
    'B737-600', 'B737-700', 'B737-700-W', 'B737-800', 'B737-800-W',
    'B737-900', 'B737-MAX8', 'B737-MAX9');
  resolves('A321/3 20W/319 W', 'A321', 'A320-W', 'A319-W');
});

test('missing slashes before intervals remain unresolved instead of widening', () => {
  assert.deepEqual(parseAircraftExpression('B737-700W/500W/300W700 to 200'), {
    aircraft_ids: ids('B737-700-W', 'B737-500-W'),
    unresolved_tokens: ['300W700 to 200'],
  });
  const expression = 'B737- 900SSW/900W/800SSW/ 800W/700W/500W /300W 900 to 100/MAX8/9';
  assert.deepEqual(parseAircraftExpression(expression), {
    aircraft_ids: ids('B737-900-SSW', 'B737-900-W', 'B737-800-SSW', 'B737-800-W',
      'B737-700-W', 'B737-500-W', 'B737-MAX8', 'B737-MAX9'),
    unresolved_tokens: ['300W 900 to 100'],
  });
});

test('unscoped shorthand never guesses a manufacturer from a number', () => {
  assert.deepEqual(parseAircraftExpression('/175W/170'), {
    aircraft_ids: [], unresolved_tokens: ['175W', '170'],
  });
  assert.deepEqual(parseAircraftExpression('900-100/MAX8/9'), {
    aircraft_ids: ids('B737-MAX8', 'B737-MAX9'), unresolved_tokens: ['900-100'],
  });
  resolves('A220-100', 'A220-100');
  assert.deepEqual(parseAircraftExpression('300').unresolved_tokens, ['300']);
});

test('malformed glued tokens are not repaired by guesswork', () => {
  for (const [expression, expected] of [
    ['CRJ900/705700/200/100', ['705700']],
    ['EMB195E2/195/190/175170', ['175170']],
    ['B737-700W/500W/300W700', ['300W700']],
    ['A321/321W/321neo/320/3', ['3']],
    ['B737-900SSW/900W/800SSW/80', ['80']],
  ]) {
    assert.deepEqual(parseAircraftExpression(expression).unresolved_tokens, expected);
  }
});

test('unknown variants and qualifiers cannot widen a supported identity', () => {
  for (const expression of ['A350-1100', 'A320ULR', 'A320-NEO', 'B737-800ER', 'B777-9 (Unfolded)', 'B787-9W', 'A220-900', 'EMB190W', 'B737-800 SS W']) {
    assert.deepEqual(parseAircraftExpression(expression), {
      aircraft_ids: [], unresolved_tokens: [expression],
    });
  }
  assert.deepEqual(parseAircraftExpression('B737-800/B999-100/200'), {
    aircraft_ids: ids('B737-800'), unresolved_tokens: ['B999-100', '200'],
  });
});

test('unsupported family changes do not leave stale shorthand context', () => {
  assert.deepEqual(parseAircraftExpression('B737-800/UNKNOWN/700'), {
    aircraft_ids: ids('B737-800'), unresolved_tokens: ['UNKNOWN', '700'],
  });
});

test('parse rejects non-string inputs', () => {
  for (const input of [null, undefined, 800, [], {}]) {
    assert.throws(() => parseAircraftExpression(input), TypeError);
  }
});

test('catalog contains only exact GTAA identities and provenance', () => {
  const requested = ids('B737-800', 'B737-800-W', 'B737-800-SSW', 'A321-NEO', 'B737-MAX8');
  const catalog = createAircraftCatalog([...requested, requested[0]]);
  assert.deepEqual(catalog.aircraft.map(item => item.id), requested);
  for (const item of catalog.aircraft) {
    assert.deepEqual(Object.keys(item).sort(), ['ICAO-code', 'id', 'name', 'source']);
    assert.deepEqual(Object.keys(item.source).sort(), ['canonical_asm_type', 'catalog_status', 'size_classification']);
    assert.equal(item.source.catalog_status, 'asm-variant-identity-only');
    assert.ok(item.name);
    assert.ok(item.source.canonical_asm_type);
  }
  assert.deepEqual(catalog.aircraft.filter(item => item.id.includes('B737-800')).map(item => item.source.canonical_asm_type),
    ['B737-800', 'B737-800SSW', 'B737-800W']);
  assert.deepEqual(createAircraftCatalog([]), { aircraft: [] });
});

test('catalog rejects unknown, shared, malformed and noncanonical IDs', () => {
  for (const id of ['A320', 'gtaa:aircraft:A320NEO', 'gtaa:aircraft:B737-800W', 'gtaa:aircraft:B737-123',
    'gtaa:aircraft:A330', 'gtaa:aircraft:B737-900to100', ' gtaa:aircraft:A320', null, 123]) {
    assert.throws(() => createAircraftCatalog([id]), /Unknown or noncanonical GTAA aircraft ID/);
  }
  for (const input of [null, undefined, 'gtaa:aircraft:A320', new Set(ids('A320'))]) {
    assert.throws(() => createAircraftCatalog(input), TypeError);
  }
});

test('catalog results cannot mutate the vocabulary', () => {
  const first = createAircraftCatalog(ids('A350-1000'));
  first.aircraft[0].name = 'changed';
  first.aircraft[0].source.canonical_asm_type = 'changed';
  const second = createAircraftCatalog(ids('A350-1000'));
  assert.equal(second.aircraft[0].source.canonical_asm_type, 'A350-1000');
  assert.notEqual(second.aircraft[0].name, 'changed');
  first.aircraft[0].source.size_classification.code_letter = 'A';
  assert.equal(createAircraftCatalog(ids('A350-1000')).aircraft[0].source.size_classification.code_letter, 'E');
});

test('verified ICAO size code letters are distinct from approach categories and FAA groups', () => {
  const types = ['CRJ100', 'CRJ200', 'CRJ700', 'CRJ705', 'CRJ900',
    'EMB135', 'EMB145', 'EMB170', 'EMB175', 'EMB175-W', 'EMB175-E2', 'EMB190-E2', 'EMB195-E2',
    'A220-100', 'A319-W', 'A320-NEO', 'B737-MAX10', 'B727-200-W', 'B757-300-W', 'A350-1000', 'B747-8', 'A380-800'];
  const catalog = createAircraftCatalog(ids(...types));
  const byType = new Map(catalog.aircraft.map(item => [item.id.slice('gtaa:aircraft:'.length), item]));
  for (const type of ['CRJ100', 'CRJ200', 'CRJ700', 'EMB135', 'EMB145']) {
    assert.equal(byType.get(type)['ICAO-code'], 'B', type);
  }
  for (const type of ['CRJ705', 'CRJ900', 'EMB170', 'EMB175', 'EMB175-W', 'EMB175-E2', 'EMB190-E2', 'EMB195-E2',
    'A220-100', 'A319-W', 'A320-NEO', 'B737-MAX10', 'B727-200-W']) {
    assert.equal(byType.get(type)['ICAO-code'], 'C', type);
  }
  assert.equal(byType.get('B757-300-W')['ICAO-code'], 'D');
  assert.equal(byType.get('A350-1000')['ICAO-code'], 'E');
  assert.equal(byType.get('B747-8')['ICAO-code'], 'F');
  assert.equal(byType.get('A380-800')['ICAO-code'], 'F');
  for (const item of catalog.aircraft) {
    assert.match(item['ICAO-code'], /^[A-F]$/);
    const provenance = item.source.size_classification;
    assert.equal(provenance.code_letter, item['ICAO-code']);
    assert.match(provenance.reference, /^https:\/\/|^data\//);
    assert.ok(provenance.basis);
  }
});

test('shared size classifications match only their documented exact model records', () => {
  const shared = JSON.parse(readFileSync(new URL('../data/aircraft.json', import.meta.url), 'utf8'));
  const catalog = createAircraftCatalog(parseAircraftExpression(
    'A319/A320/A321/A340/A380/B717-200/B737-400/800/900/B747-300/400/B757-300/B767-200/300/400/B777-200/300/300ER/B787-8/9/10',
  ).aircraft_ids);
  for (const item of catalog.aircraft) {
    const provenance = item.source.size_classification;
    assert.equal(provenance.basis, 'shared-catalog-exact-model', item.id);
    const match = shared.aircraft.find(candidate => candidate.id === provenance.aircraft_id);
    assert.ok(match, item.id);
    assert.equal(item['ICAO-code'], match['ICAO-code'], item.id);
  }
});

test('completed size classifications retain exact source and configuration distinctions', () => {
  const expected = new Map([
    ['A350-800', 'E'], ['B717', 'C'], ['B747-100', 'E'], ['B747-200', 'E'], ['B747-400C', 'E'],
    ['B767-300-W', 'D'], ['B777-200-ER', 'E'], ['B777-200-LR', 'E'],
    ['B777-9', 'F'], ['B777-9-FOLDED', 'E'],
    ['DC9-15', 'C'], ['DC9-21', 'C'], ['DC9-32', 'C'], ['DC9-41', 'C'], ['DC9-51', 'C'],
    ['DH8-200', 'C'], ['EMB140', 'B'],
  ]);
  const catalog = createAircraftCatalog(ids(...expected.keys()));
  for (const item of catalog.aircraft) {
    assert.equal(item['ICAO-code'], expected.get(item.id.replace('gtaa:aircraft:', '')), item.id);
    assert.equal(item.source.size_classification.code_letter, item['ICAO-code']);
    assert.match(item.source.size_classification.reference, /^https:\/\//);
  }
  const size = type => catalog.aircraft.find(item => item.id === `gtaa:aircraft:${type}`).source.size_classification;
  assert.equal(size('B777-9').configuration, 'wingtips-extended');
  assert.equal(size('B777-9-FOLDED').configuration, 'wingtips-folded');
  assert.equal(size('A350-800').planning_only, true);
  assert.equal(size('A350-800').aircraft_status, 'cancelled-before-certification');
});

test('every resolved evidence token has a catalog entry without technical metadata', () => {
  const evidence = JSON.parse(readFileSync(new URL('../data/airports/gtaa/source-evidence.json', import.meta.url), 'utf8'));
  const aircraftIds = new Set();
  const expressions = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'aircraft' && typeof child === 'string') expressions.add(child);
      else visit(child);
    }
  }
  visit(evidence);
  for (const expression of expressions) {
    for (const id of parseAircraftExpression(expression).aircraft_ids) aircraftIds.add(id);
  }
  assert.ok(aircraftIds.size > 100);
  const catalog = createAircraftCatalog([...aircraftIds]);
  assert.equal(catalog.aircraft.length, aircraftIds.size);
  assert.ok(catalog.aircraft.every(item => !('seats' in item) && !('MTOW' in item)));
});
