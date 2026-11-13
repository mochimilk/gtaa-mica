import { createAircraftCatalog, parseAircraftExpression } from './gtaa-asm-aircraft.mjs';

const unique = values => [...new Set(values)].sort();
const cellAt = (boundaries, y, context) => {
  for (let i = 1; i < boundaries.length; i++) {
    if (y < boundaries[i - 1] + 0.1 && y > boundaries[i] - 0.1) return [boundaries[i], boundaries[i - 1]];
  }
  throw new Error(`ASM text outside recovered table cells: ${context} at ${y}`);
};
const overlaps = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 1;
const annotationOnly = text => /^(?:con[’']?t(?:inued)?[’']?d?\.?|\(?W\s*=.*|\(?SSW\s*=.*)$/i.test(text.trim());
const proceduralText = text => /^(?:‡|†|[*•]|When\s|Ground spotter|Bridge operator|The bridge|visual contact with the spotter|Note\s)/i.test(text.trim());
const sourceRef = (section, row) => ({ source_id: section.source_id, pdf_page: section.pdf_page, source_y: row.source_y });

export function normalizeASM(evidence) {
  const layouts = new Map(evidence.asm_page_layouts.map(layout => [`${layout.source_id}:${layout.pdf_page}`, layout]));
  const result = [];
  for (const table of evidence.stand_tables) {
    const entries = [];
    const headers = [];
    const notes = [];
    for (const section of table.sections) {
      const layout = layouts.get(`${section.source_id}:${section.pdf_page}`);
      if (!layout) throw new Error(`Missing ASM page layout: ${section.source_id}:${section.pdf_page}`);
      const cells = new Map();
      for (const row of section.rows) {
        if (!row.aircraft || annotationOnly(row.aircraft)) continue;
        if (proceduralText(row.aircraft)) {
          notes.push({ ...sourceRef(section, row), text: row.aircraft });
          continue;
        }
        const interval = cellAt(layout.horizontal_boundaries.aircraft, row.source_y, table.stand_id);
        const key = interval.join(':');
        if (!cells.has(key)) cells.set(key, { interval, rows: [] });
        cells.get(key).rows.push(row);
      }
      if (!cells.size) throw new Error(`No aircraft cells for ${table.stand_id} on page ${section.pdf_page}`);
      const top = Math.max(...[...cells.values()].map(cell => cell.interval[1]));
      const headerRows = section.rows.filter(row => row.source_y > top && row.restrictions);
      headers.push(...headerRows.map(row => ({ ...sourceRef(section, row), text: row.restrictions })));
      for (const cell of cells.values()) {
        const expression = cell.rows.map(row => row.aircraft).join(' ');
        const parsed = parseAircraftExpression(expression);
        const instructions = [];
        for (const row of section.rows) {
          if (!row.restrictions || row.source_y > top) continue;
          if (/^BRIDGE\s+1\s+BRIDGE\s+2$/i.test(row.restrictions)) continue;
          for (const [field, column] of [['bridge_1', 'comment_1'], ['bridge_2', 'comment_2']]) {
            const text = row[field] || (!row.bridge_1 && !row.bridge_2 && field === 'bridge_1' ? row.restrictions : '');
            if (!text) continue;
            const interval = cellAt(layout.horizontal_boundaries[column], row.source_y, `${table.stand_id}/${column}`);
            if (overlaps(cell.interval, interval)) instructions.push({
              ...sourceRef(section, row), column: row.bridge_1 || row.bridge_2 ? field : 'comments', text,
            });
          }
        }
        const stoplines = unique(section.rows.filter(row => row.stopline &&
          overlaps(cell.interval, cellAt(layout.horizontal_boundaries.stopline, row.source_y, table.stand_id)))
          .map(row => row.stopline));
        const requirements = [...headers.filter(h => h.source_id === section.source_id && h.pdf_page === section.pdf_page).map(h => h.text), ...instructions.map(i => i.text)].join(' ');
        const parkingOnly = /aircraft\s+parking\s+only/i.test(requirements);
        const arrivalsOnly = /arrivals?\s+only/i.test(requirements);
        entries.push({
          source_id: section.source_id, pdf_page: section.pdf_page, aircraft_cell_y: cell.interval,
          source_rows: cell.rows.map(row => sourceRef(section, row)), aircraft_expression: expression,
          iata_text: cell.rows.map(row => row.iata).filter(Boolean).join(' '),
          aircraft_ids: parsed.aircraft_ids, unresolved_tokens: parsed.unresolved_tokens,
          arrival_allowed: !parkingOnly, departure_allowed: !parkingOnly && !arrivalsOnly,
          parking_allowed: true, stoplines, instructions,
          vdgs: unique(section.rows.map(row => row.vdgs).filter(Boolean)),
          vdgs_scope: 'source-section-text-not-an-aircraft-specific-approval',
        });
      }
    }
    result.push({ stand_id: table.stand_id, headers, notes, entries });
  }
  return result;
}

export function buildASMDatasets(evidence, standsDocument) {
  const tables = normalizeASM(evidence);
  const aircraftIds = unique(tables.flatMap(table => table.entries.flatMap(entry => entry.aircraft_ids)));
  const catalog = createAircraftCatalog(aircraftIds);
  const aircraft = { schema_version: '1.0.0', airport_id: 'gtaa', ...catalog };
  const groups = { schema_version: '1.0.0', airport_id: 'gtaa', 'aircraft-groups': [] };
  const stands = structuredClone(standsDocument);
  const byId = new Map(stands.stands.map(stand => [stand.id, stand]));
  for (const stand of stands.stands) {
    const hasTable = tables.some(table => table.stand_id === stand.id);
    if (stand.description === 'Unreviewed source-backed stub. Coordinates approximate the map label position, not an aircraft parking point. Contact status, operational permissions and aircraft-specific rules remain pending.') {
      stand.description = hasTable
        ? 'Source-backed draft. Coordinates approximate map labels, not aircraft parking points. ASM aircraft permissions and supported neighbor rules are translated; manual procedures, contact, sectors, airline authorization and availability require review.'
        : 'Source-backed map-only stub with no current ASM aircraft authorization. Coordinates approximate map labels; current stand status and operating permissions require confirmation.';
    }
    for (const kind of ['close-conditions', 'restriction-conditions']) {
      if (stand[kind]) stand[kind] = stand[kind].filter(rule => rule.category !== 'gtaa-asm-fit');
    }
    if (!hasTable) {
      stand['aircraft-groups'] = [];
      stand['arrival-aircraft-groups'] = [];
      stand['departure-aircraft-groups'] = [];
      stand['restriction-conditions'] ??= [];
      stand.source.asm_rules = { file: '../asm-rules.json', stand_id: stand.id, status: 'no-current-asm-table-no-aircraft-authorized' };
    }
  }
  const translated = [];
  const review = [];
  const group = (name, members) => {
    if (!members.length) return [];
    const id = `gtaa:aircraft-group:${name}`;
    if (!groups['aircraft-groups'].some(g => g.id === id)) groups['aircraft-groups'].push({ id, name, 'aircraft-ids': unique(members) });
    return [id];
  };
  for (const table of tables) {
    const stand = byId.get(table.stand_id);
    if (!stand) throw new Error(`ASM stand is not in the inventory: ${table.stand_id}`);
    const members = unique(table.entries.flatMap(entry => entry.aircraft_ids));
    stand['aircraft-groups'] = group(`${stand.id}:fit`, members);
    for (const leg of ['arrival', 'departure']) {
      stand[`${leg}-aircraft-groups`] = group(`${stand.id}:${leg}`, table.entries.filter(entry => entry[`${leg}_allowed`]).flatMap(entry => entry.aircraft_ids));
    }
    stand['restriction-conditions'] ??= [];
    stand.source.asm_rules = { file: '../asm-rules.json', stand_id: stand.id, status: 'source-derived-not-operationally-approved' };
    for (const entry of table.entries) {
      if (entry.unresolved_tokens.length) review.push({
        kind: 'aircraft-expression', stand_id: stand.id, source_id: entry.source_id, pdf_page: entry.pdf_page,
        text: entry.aircraft_expression, unresolved_tokens: entry.unresolved_tokens,
      });
    }
  }
  const addRule = (targetId, triggerId, kind, condition, provenance) => {
    const target = byId.get(targetId);
    if (!target || !byId.has(triggerId)) throw new Error(`ASM rule references an unknown stand: ${targetId} / ${triggerId}`);
    if (targetId === triggerId) throw new Error(`ASM neighbor rule references itself: ${targetId}`);
    target[kind] ??= [];
    if (kind === 'close-conditions' && target[kind].some(c => c.stand === triggerId && !c['aircraft-groups'])) return;
    const normalized = { stand: triggerId, category: 'gtaa-asm-fit', ...condition };
    const existing = target[kind].find(c => JSON.stringify(c) === JSON.stringify(normalized));
    if (!existing) target[kind].push(normalized);
    const index = target[kind].findIndex(c => JSON.stringify(c) === JSON.stringify(normalized));
    translated.push({ target_stand_id: targetId, trigger_stand_id: triggerId, kind, index, ...provenance });
  };
  const closeTargets = text => {
    const targets = [];
    for (const match of text.matchAll(/((?:STANDS?\s+)?(?:[A-C]\d+[A-Z]?|\d+[A-Z]?)(?:\s*(?:,|&|AND)\s*(?:[A-C]\d+[A-Z]?|\d+[A-Z]?))*)\s+CLOSED\b/gi)) {
      targets.push(...match[1].replace(/STANDS?/gi, '').split(/\s*(?:,|&|AND)\s*/i).filter(Boolean));
    }
    for (const match of text.matchAll(/CLOSES?\s+STAND\s+([A-Z0-9]+)/gi)) targets.push(match[1]);
    return unique(targets.map(code => code.trim()));
  };
  for (const table of tables) {
    const terminal = table.stand_id.split(':')[0];
    for (const header of table.headers) {
      for (const code of closeTargets(header.text)) addRule(`${terminal}:stand:${code}`, table.stand_id, 'close-conditions', { description: header.text }, header);
    }
    const headerText = table.headers.map(header => header.text).join(' ');
    for (const match of headerText.matchAll(/(?:STAND\s+)?([A-Z0-9]+)\s+RESTRICTED\s+TO\s+[“"]?CODE\s+C[”"]?\s+(?:AIRCRAFT\s+)?(?:AND|OR)\s+SMALLER/gi)) {
      addRule(`${terminal}:stand:${match[1]}`, table.stand_id, 'restriction-conditions', {
        description: headerText, allow: { 'maximum-aircraft-size-code': 'C' },
      }, { source_id: table.headers[0].source_id, pdf_page: table.headers[0].pdf_page, text: headerText });
    }
    if (/RESTRICTED TO B737-500 OR SMALLER/.test(headerText)) review.push({
      kind: 'relative-aircraft-size', stand_id: table.stand_id, target_stand_id: `${terminal}:stand:176`,
      source_id: table.headers[0].source_id, pdf_page: table.headers[0].pdf_page, text: headerText,
      question: 'Define the exact permitted model set for B737-500 or smaller; no dimensional or family ordering is assumed.',
    });
    for (const entry of table.entries) {
      const triggerGroups = group(`${table.stand_id}:page-${entry.pdf_page}:y-${entry.aircraft_cell_y[0]}:trigger`, entry.aircraft_ids);
      if (!triggerGroups.length) continue;
      const text = entry.instructions.filter(i => i.column !== 'bridge_2').map(i => i.text).join(' ');
      for (const code of closeTargets(text)) addRule(`${terminal}:stand:${code}`, table.stand_id, 'close-conditions', {
        description: text, 'aircraft-groups': triggerGroups,
      }, { source_id: entry.source_id, pdf_page: entry.pdf_page, text });
      if (/not\s+permitted\s+on\s+stand/i.test(text)) {
        const match = /not\s+permitted\s+on\s+stand\s+([A-Z0-9]+)/i.exec(text);
        const targetId = `${terminal}:stand:${match[1]}`;
        const target = byId.get(targetId);
        if (!target) throw new Error(`Unknown aircraft-prohibition target: ${targetId}`);
        const forbidden = aircraftIds.filter(id => targetId === 't1:stand:124' && table.stand_id === 't1:stand:120A'
          ? ['A350-1000', 'A350-900', 'B777-300-ER', 'B777-300'].some(type => id === `gtaa:aircraft:${type}`)
          : targetId === 't1:stand:120A' && table.stand_id === 't1:stand:124'
            ? /:B747(?:-|$)/.test(id) || [':B777-300-ER', ':B777-200-LR'].some(suffix => id.endsWith(suffix))
            : false);
        if (!forbidden.length) throw new Error(`Unreviewed aircraft prohibition: ${table.stand_id}: ${text}`);
        const allowed = group(`${targetId}:except-${table.stand_id}:page-${entry.pdf_page}`, aircraftIds.filter(id => !forbidden.includes(id)));
        addRule(targetId, table.stand_id, 'restriction-conditions', {
          description: text, 'aircraft-groups': triggerGroups, allow: { 'aircraft-groups': allowed },
        }, { source_id: entry.source_id, pdf_page: entry.pdf_page, text, forbidden_aircraft_ids: forbidden });
      }
    }
  }
  const used = new Set(stands.stands.flatMap(stand => [
    ...(stand['aircraft-groups'] ?? []), ...(stand['arrival-aircraft-groups'] ?? []), ...(stand['departure-aircraft-groups'] ?? []),
    ...(stand['close-conditions'] ?? []).flatMap(rule => rule['aircraft-groups'] ?? []),
    ...(stand['restriction-conditions'] ?? []).flatMap(rule => [...(rule['aircraft-groups'] ?? []), ...(rule.allow['aircraft-groups'] ?? [])]),
  ]));
  groups['aircraft-groups'] = groups['aircraft-groups'].filter(g => used.has(g.id));
  return {
    aircraft, groups, stands,
    rules: {
      schema_version: '1.0.0', airport_id: 'gtaa', status: 'source-derived-not-operationally-approved',
      description: 'Exact ASM aircraft cells, leg-specific eligibility, stoplines and operating requirements. Instructions are manual requirements, not automatically satisfied by stand assignment. Pending interpretations do not grant permissions.',
      tables, translated_rules: translated, review_requirements: review,
    },
  };
}
