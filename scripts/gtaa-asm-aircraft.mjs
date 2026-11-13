const ID_PREFIX = 'gtaa:aircraft:';

// This is an ASM identity vocabulary, not a technical aircraft database or
// an ordering of aircraft sizes. Only explicitly listed variants are accepted.
const definitions = [
  ['A220', 'Airbus', ['100', '300']],
  ['A300', 'Airbus', ['600']],
  ['A310', 'Airbus', ['300']],
  ['A318', 'Airbus', ['']],
  ['A319', 'Airbus', ['', 'W', 'NEO']],
  ['A320', 'Airbus', ['', 'W', 'NEO']],
  ['A321', 'Airbus', ['', 'W', 'NEO']],
  ['A330', 'Airbus', ['200', '300', '800', '900']],
  ['A340', 'Airbus', ['', '200', '300', '500', '600']],
  ['A350', 'Airbus', ['800', '900', '1000']],
  ['A380', 'Airbus', ['', '800']],
  ['B717', 'Boeing', ['', '200']],
  ['B727', 'Boeing', ['200', '200W']],
  ['B737', 'Boeing', [
    '100', '200', '300', '300W', '400', '500', '500W', '600',
    '700', '700W', '800', '800W', '800SSW', '900', '900W', '900SSW',
    'MAX7', 'MAX8', 'MAX9', 'MAX10',
  ]],
  ['B747', 'Boeing', ['8', '100', '200', '300', '400', '400C']],
  ['B757', 'Boeing', ['200', '200W', '300', '300W']],
  ['B767', 'Boeing', ['200', '300', '300W', '400']],
  ['B777', 'Boeing', ['200', '200ER', '200LR', '300', '300ER', '9', '9(FOLDED)']],
  ['B787', 'Boeing', ['8', '9', '10']],
  ['CRJ', 'CRJ', ['100', '200', '700', '705', '900']],
  ['DH8', 'De Havilland', ['100', '200', '300', '400']],
  ['EMB', 'Embraer', [
    '135', '140', '145', '170', '175', '175W', '175E2',
    '190', '190E2', '195', '195E2',
  ]],
  ['DC9', 'Douglas', ['15', '21', '32', '41', '51']],
  ['DC10', 'Douglas', ['30']],
  ['IL62', 'Ilyushin', ['']],
  ['IL76', 'Ilyushin', ['']],
  ['IL96', 'Ilyushin', ['']],
  ['MD', 'McDonnell Douglas', ['11', '81', '82', '83', '87', '88', '90']],
];

const byAsmType = new Map();
const byId = new Map();
const compactFamilies = new Set(['CRJ', 'EMB', 'MD']);
const plain737Series = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
const sizeClassifications = new Map();
const airbusCodeTable = 'https://www.aircraft.airbus.com/sites/g/files/jlcbta126/files/2023-02/NEW-AI~1.PDF';
const wingletSpans = 'https://www.boeing.com/content/dam/boeing/v2/airports/faq/wingletspans.pdf';

function recordSize(types, code, details) {
  for (const type of types.split(' ')) {
    sizeClassifications.set(type, { code_letter: code, ...details });
  }
}

// Exact existing model matches only; no generic catalog family is applied to
// a winglet, NEO, MAX, ER/LR or other separately named variant.
for (const [type, id, code] of [
  ['A319', 'A319', 'C'], ['A320', 'A320', 'C'], ['A321', 'A321', 'C'],
  ['A340', 'A340', 'E'], ['A380', 'A380', 'F'],
  ['B717-200', 'B712', 'C'],
  ['B737-400', 'B734', 'C'], ['B737-800', 'B738', 'C'], ['B737-900', 'B739', 'C'],
  ['B747-300', 'B743', 'E'], ['B747-400', 'B744', 'E'],
  ['B757-300', 'B753', 'D'],
  ['B767-200', 'B762', 'D'], ['B767-300', 'B763', 'D'], ['B767-400', 'B764', 'D'],
  ['B777-200', 'B772', 'E'], ['B777-300', 'B773', 'E'], ['B777-300ER', 'B77W', 'E'],
  ['B787-8', 'B788', 'E'], ['B787-9', 'B789', 'E'], ['B787-10', 'B78X', 'E'],
]) {
  recordSize(type, code, {
    basis: 'shared-catalog-exact-model',
    reference: 'data/aircraft.json',
    aircraft_id: id,
  });
}

for (const [types, code] of [
  ['A220-100 A220-300 A318 A319NEO A320NEO A321NEO', 'C'],
  ['A300-600 A310-300', 'D'],
  ['A330-200 A330-300 A330-800 A330-900 A340-200 A340-300 A340-500 A340-600 A350-900 A350-1000', 'E'],
  ['A380-800', 'F'],
]) {
  recordSize(types, code, {
    basis: 'manufacturer-icao-code-letter',
    reference: airbusCodeTable,
    locator: 'ME1911189 Issue 4.0, 6 July 2020, page 2; ICAO/EASA column, not FAA ADG or approach category',
  });
}

function recordSpan(types, span, reference, locator) {
  const code = span < 15 ? 'A' : span < 24 ? 'B' : span < 36 ? 'C' : span < 52 ? 'D' : span < 65 ? 'E' : 'F';
  recordSize(types, code, {
    basis: 'icao-code-letter-from-verified-wingspan',
    wingspan_m: span,
    reference,
    locator,
    classification_reference: airbusCodeTable,
    classification_locator: 'Page 3, ICAO Annex 14 Amendment 14 / EASA CS-ADR-DSN Issue 4 wingspan code-letter table',
  });
}

for (const family of ['A319', 'A320', 'A321']) {
  recordSpan(`${family}W`, 35.8,
    `https://www.aircraft.airbus.com/en/aircraft/a320-family/${family.toLowerCase()}ceo`,
    'Key figures / Dimensions / Wing span (geometric), Sharklet configuration');
}
for (const [types, span] of [
  ['B727-200', 32.9], ['B727-200W', 33.3],
  ['B737-300W B737-500W', 31.1],
  ['B737-700W B737-800W B737-900W', 35.8],
  ['B737-800SSW B737-900SSW', 35.9],
  ['B757-200', 38], ['B757-200W B757-300W', 41.1],
]) {
  recordSpan(types, span, wingletSpans, 'Wingspan Increases Due to the Addition of Winglets, Boeing Airport Compatibility, 2 May 2014, model-specific table row');
}

// EUROCONTROL's APC letter is an approach category, NOT an ICAO size code.
// Only its explicitly published wingspan is used here.
for (const [types, icao, span] of [
  ['B737-100', 'B731', 28.3], ['B737-200', 'B732', 28.3],
  ['B737-300', 'B733', 28.9], ['B737-500', 'B735', 28.9],
  ['B737-600', 'B736', 34.3], ['B737-700', 'B737', 34.3],
  ['B737-MAX7', 'B37M', 35.9], ['B737-MAX8', 'B38M', 35.9],
  ['B737-MAX9', 'B39M', 35.9], ['B737-MAX10', 'B3XM', 35.92],
  ['B747-8', 'B748', 68.5],
  ['CRJ100', 'CRJ1', 21.21], ['CRJ200', 'CRJ2', 21.21], ['CRJ700', 'CRJ7', 23.24],
  ['CRJ705 CRJ900', 'CRJ9', 24.9],
  ['DH8-100', 'DH8A', 25.9], ['DH8-300', 'DH8C', 27.4], ['DH8-400', 'DH8D', 28.4],
  ['EMB135', 'E135', 20.2], ['EMB145', 'E145', 20.2],
  ['EMB170', 'E170', 26], ['EMB190', 'E190', 28.7], ['EMB195', 'E195', 28.7],
  ['DC10-30', 'DC10', 50.4], ['IL62', 'IL62', 43.2],
  ['IL76', 'IL76', 50.5], ['IL96', 'IL96', 60.11], ['MD11', 'MD11', 51.7],
  ['MD81', 'MD81', 32.82], ['MD82', 'MD82', 32.8], ['MD83', 'MD83', 32.8],
  ['MD87', 'MD87', 32.9], ['MD88', 'MD88', 32.82], ['MD90', 'MD90', 32.9],
]) {
  recordSpan(types, span,
    `https://learningzone.eurocontrol.int/ilp/customs/ATCPFDB/details.aspx?ICAO=${icao}`,
    icao === 'CRJ9'
      ? 'Technical / Wing Span; alternative names explicitly include CRJ-705'
      : 'Technical / Wing Span');
}
for (const [type, span, section] of [
  ['EMB175E2', 31.39, '2.2.3'], ['EMB190E2', 33.72, '2.2.1'], ['EMB195E2', 35.12, '2.2.2'],
]) {
  recordSpan(type, span, 'https://embraer.com/media/vmsjxvk5/e-jets-e2_apm_e-jetse2.pdf',
    `APM 5824, section 02, ${section}, External Dimensions, revision 21, 5 August 2022`);
}
recordSize('EMB175 EMB175W', 'C', {
  basis: 'manufacturer-dimensions-all-wingtip-configurations',
  reference: 'https://embraer.com/media/g2tdpwcc/e175-apm_apm_175-1.pdf',
  locator: 'APM 2259, section 02, 2.2.1–2.2.2: 26.00 m with winglets, 28.65 m with enhanced wingtips; both Code C. Revision 22, 29 November 2024',
  classification_reference: airbusCodeTable,
  classification_locator: 'Page 3, ICAO/EASA wingspan code-letter table',
});

const boeingDesignCodes = 'https://www.boeing.com/content/dam/boeing/v2/airports/faq/aircraftdesigngroup.pdf';
for (const [types, code, row] of [
  ['B717', 'C', '717-200'],
  ['B747-100 B747-200', 'E', '747-100,200,300'],
  ['B767-300W', 'D', '767-300/-300W'],
  ['B777-200ER B777-200LR', 'E', '777-200, 200ER, 200LR, 777F'],
  ['DC9-15 DC9-21 DC9-32 DC9-41 DC9-51', 'C', 'DC-9-15, -21, -32, -41 and -51'],
]) {
  recordSize(types, code, {
    basis: 'manufacturer-icao-code-letter',
    reference: boeingDesignCodes,
    locator: `Boeing Airport Compatibility, 4 November 2014, page 1, ICAO Aeroplane Design Code letter column; row ${row}, not the FAA group column`,
  });
}
recordSize('B747-400C', 'E', {
  basis: 'manufacturer-icao-code-letter-and-combi-dimensions',
  reference: boeingDesignCodes,
  locator: 'Page 1, 747-400/400ER row, ICAO Code E; Combi shares the general dimensions in D6-58326-1 Rev F, section 2.2.1',
  configuration_reference: 'https://www.boeing.com/content/dam/boeing/v2/airports/acaps/747-400_Rev_F.pdf',
});
for (const [type, code, configuration] of [
  ['B777-9', 'F', 'wingtips-extended'],
  ['B777-9(FOLDED)', 'E', 'wingtips-folded'],
]) {
  recordSize(type, code, {
    basis: 'manufacturer-icao-code-letter',
    reference: 'https://www.boeing.com/content/dam/boeing/v2/airports/acaps/777X_Rev_G.pdf',
    locator: 'D6-86073 Rev G, September 2025, section 10.1.2, page 10-2 (PDF page 96): Code E folded, Code F extended',
    configuration,
    preliminary: true,
  });
}
recordSpan('A350-800', 64.75, 'https://skybrary.aero/aircraft/a358',
  'Technical Data / Wing span (metric); cancelled A350-800 planned dimensions, not a certified production aircraft');
Object.assign(sizeClassifications.get('A350-800'), { aircraft_status: 'cancelled-before-certification', planning_only: true });
recordSpan('DH8-200', 25.89, 'https://www.easa.europa.eu/en/downloads/7257/en',
  'EASA.IM.A.191, section 3: DHC-8 Series 200, III Technical Characteristics, item 4 Dimensions / Span');
recordSpan('EMB140', 20.04, 'https://embraer.com/media/3cknpwik/erj-140_apm_140-1.pdf',
  'ERJ-140 Airport Planning Manual, section 2.2.1 External Dimensions / Overall span, page 2-2');

for (const [family, manufacturer, variants] of definitions) {
  for (const variant of variants) {
    const asmType = `${family}${variant && !compactFamilies.has(family) && !/^A3(19|20|21)$/.test(family) ? '-' : ''}${variant}`;
    const canonical = asmType
      .replace(/(SSW|W|NEO|E2|ER|LR)$/, '-$1')
      .replace('(FOLDED)', '-FOLDED');
    const item = {
      id: `${ID_PREFIX}${canonical}`,
      name: `${manufacturer} ${asmType.replace('(FOLDED)', ' (Folded)')}`,
      source: {
        canonical_asm_type: asmType.replace('(FOLDED)', ' (Folded)'),
        catalog_status: 'asm-variant-identity-only',
      },
    };
    const size = sizeClassifications.get(asmType);
    if (size) {
      item['ICAO-code'] = size.code_letter;
      item.source.size_classification = size;
    }
    byAsmType.set(asmType, { item, family, variant });
    byId.set(item.id, item);
  }
}

function normalizeToken(token) {
  return token.toUpperCase()
    .replace(/(\d)\s+(?=\d|W\b|SSW\b|NEO\b|E2\b|ER\b|LR\b)/g, '$1')
    .replace(/(\d)\s*T\s*O\s*(?=\d)/g, '$1TO')
    .replace(/^ERJ-?/, 'EMB')
    .replace(/^E(?=\d)/, 'EMB')
    .replace(/^(EMB|CRJ)-/, '$1')
    .replace(/-E2$/, 'E2')
    .replace(/^B737(?=MAX)/, 'B737-');
}

function explicitFamily(token) {
  if (/^A31[89]|^A32[01]/.test(token)) return { family: 'A32X', prefix: 'A' };
  if (/^EMB/.test(token)) return { family: 'EMB', prefix: 'EMB' };
  if (/^CRJ/.test(token)) return { family: 'CRJ', prefix: 'CRJ' };
  if (/^MD\d/.test(token)) return { family: 'MD', prefix: 'MD' };
  const match = /^(A\d{3}|B\d{3}|DH8|DC10|DC9|IL\d{2})(?:-|$)/.exec(token);
  return match ? { family: match[1], prefix: `${match[1]}-` } : null;
}

function withoutAnnotations(text) {
  return text
    .replace(/\(\s*W\s*=\s*B737\s+with\s+Winglets\s*\)?/gi, ' ')
    .replace(/\(\s*SSW\s*=\s*Scimitars\s*\)?/gi, ' ')
    .replace(/\b(?:con['’‘]t|cont['’‘]d|continued|continuation)\b\.?/gi, ' ');
}

/**
 * Resolve only bounded, explicitly spelled ASM identities. Slash suffixes
 * inherit the latest explicit family, never a previous invocation's context.
 * Explicit B737 intervals enumerate only the fixed plain-series vocabulary;
 * they are not size-ordering rules and never include W, SSW or MAX variants.
 */
export function parseAircraftExpression(text) {
  if (typeof text !== 'string') throw new TypeError('Aircraft expression must be a string');
  const aircraftIds = new Set();
  const unresolved = [];
  let context = null;
  let previous = null;

  const cleaned = withoutAnnotations(text).trim()
    .replace(/\b(A\d{3}|B\d{3}|DH8|DC10|DC9|CRJ|EMB|ERJ)\s*-\s*/gi, '$1-')
    .replace(/\b(ERJ|EMB|CRJ)\s+(?=\d)/gi, '$1')
    .replace(/\bMAX\s+(?=\d)/gi, 'MAX')
    .replace(/\s+\(Folded\)/gi, '(Folded)');

  for (const part of cleaned.split('/')) {
    const fragment = part.trim();
    if (!fragment) continue;

    // Whitespace can separate complete tokens, but never split a range or
    // an unknown qualifier off an otherwise recognized aircraft.
    const pieces = fragment
      .split(/\s+(?=(?:A\d|B\d|CRJ|DH8|EMB|ERJ|E\d|DC\d|MD\d|IL\d|MAX\d))/i)
      .flatMap(piece => /\d\s*(?:t\s*o|-)\s*\d/i.test(piece)
        ? [piece]
        : piece.split(/\s+(?=\d{3}(?:W|SSW)?(?:\s|$))/i));
    for (const piece of pieces) {
      const original = piece.trim();
      const token = normalizeToken(original);
      const explicit = explicitFamily(token);
      if (explicit) {
        context = explicit;
        previous = null;
      }

      let candidate = token;
      if (!explicit) {
        if (/^MAX(?:7|8|9|10)$/.test(token)) {
          context = { family: 'B737', prefix: 'B737-' };
          candidate = `B737-${token}`;
        } else if (context) {
          if (context.family === 'B737' && /^(?:7|8|9|10)$/.test(token) && previous?.variant.startsWith('MAX')) {
            candidate = `B737-MAX${token}`;
          } else if (context.family === 'B777' && /^(ER|LR)$/.test(token) && /^200(?:ER|LR)?$/.test(previous?.variant ?? '')) {
            candidate = `B777-200${token}`;
          } else {
            candidate = `${context.prefix}${token}`;
          }
        }
      }

      const interval = /^(?:B737-)?([1-9]00)(?:TO|-)([1-9]00)$/.exec(token);
      if (interval && context?.family === 'B737') {
        const start = plain737Series.indexOf(interval[1]);
        const end = plain737Series.indexOf(interval[2]);
        if (start >= end) {
          for (const series of plain737Series.slice(end, start + 1)) {
            aircraftIds.add(byAsmType.get(`B737-${series}`).item.id);
          }
          previous = null;
          continue;
        }
      }

      const match = byAsmType.get(candidate);
      if (match) {
        aircraftIds.add(match.item.id);
        previous = match;
      } else {
        unresolved.push(original);
        previous = null;
        // An unknown manufacturer or family must not inherit the last one.
        if (!explicit && /^[A-Z]/.test(token) && !/^(?:MAX|\d)/.test(token)) context = null;
      }
    }
  }

  return { aircraft_ids: [...aircraftIds].sort(), unresolved_tokens: unresolved };
}

/** Return fresh, minimal GTAA-only catalog entries; reject aliases and guesses. */
export function createAircraftCatalog(aircraftIds) {
  if (!Array.isArray(aircraftIds)) throw new TypeError('Aircraft IDs must be an array');
  for (const id of aircraftIds) {
    if (typeof id !== 'string' || !byId.has(id)) {
      throw new Error(`Unknown or noncanonical GTAA aircraft ID: ${String(id)}`);
    }
  }
  return {
    aircraft: [...new Set(aircraftIds)].sort().map(id => {
      const item = byId.get(id);
      return {
        ...item,
        source: {
          ...item.source,
          ...(item.source.size_classification
            ? { size_classification: { ...item.source.size_classification } }
            : {}),
        },
      };
    }),
  };
}
