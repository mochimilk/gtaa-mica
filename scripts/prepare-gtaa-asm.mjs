import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAirport, readJson, validateAirport } from './airport-model.mjs';
import { buildASMDatasets } from './gtaa-asm.mjs';

const manifestPath = fileURLToPath(new URL('../data/airports/gtaa/airport.json', import.meta.url));
const directory = dirname(manifestPath);
const airport = loadAirport(manifestPath);
const evidence = readJson(resolve(directory, airport.airport.datasets.source_evidence));
const result = buildASMDatasets(evidence, airport.stands);
const manifest = structuredClone(airport.airport);
Object.assign(manifest.datasets, {
  aircraft: 'aircraft.json', aircraft_groups: 'aircraft-groups.json', asm_rules: 'asm-rules.json',
});
manifest.assumptions = manifest.assumptions.map(text => {
  if (text.startsWith('No sectors,')) return 'No sector permissions, airline authorizations, unconditional availability, handling durations, tow times or hourly traffic patterns have been invented. ASM aircraft permissions use a GTAA-specific exact-variant catalog.';
  if (text.startsWith('ASM aircraft variants,')) return 'ASM exact aircraft variants and per-leg permissions are translated separately from manual stopline, VDGS, bridge, GPU, ramp and spotter requirements. An assignment does not establish that those procedures are satisfied.';
  if (text.startsWith('Only explicit stand-level closure')) return 'Stand-level and aircraft-conditioned closures and supported neighbor restrictions are encoded with source references. Ambiguous source aircraft tokens and B737-500-or-smaller ordering remain explicit review requirements in asm-rules.json.';
  return text;
});
const validation = validateAirport({ ...airport, airport: manifest, stands: result.stands, aircraft: result.aircraft, aircraftGroups: result.groups });
if (validation.errors.length) throw new Error(`Generated ASM configuration is invalid:\n${validation.errors.join('\n')}`);
const gaps = readJson(resolve(directory, manifest.datasets.data_gaps));
const aircraftReviews = result.rules.review_requirements.filter(item => item.kind === 'aircraft-expression');
Object.assign(gaps.blockers.find(item => item.id === 'aircraft-variants'), {
  status: 'source-derived-exact-variants-with-explicit-review-items',
  question: 'Review unresolved source aircraft expressions listed in asm-rules.json. Exact W, SSW, NEO, MAX and regional types remain distinct; no ambiguous token grants compatibility.',
  unresolved_expression_count: aircraftReviews.length,
});
Object.assign(gaps.blockers.find(item => item.id === 'conditional-rules'), {
  status: 'supported-rules-encoded-manual-procedures-and-relative-size-pending',
  question: 'Supported aircraft-conditioned neighbor restrictions and Code C limits are encoded. Define the allowed set for B737-500 or smaller on stand 176 while 175A is occupied; confirm manual bridge, stopline, GPU, ramp and spotter requirements before operational use.',
});
if (!gaps.blockers.some(item => item.id === 'aircraft-generation-metadata')) gaps.blockers.push({
  id: 'aircraft-generation-metadata', scope: 'gtaa-exact-aircraft-catalog', status: 'pending',
  question: 'Confirm scenario seat counts and any unverified ICAO size codes for the exact ASM variants before generating synthetic demand and configuring handling policy. No generic seat/MTOW values were copied to variants.',
});
const missingSizeCodes = result.aircraft.aircraft.filter(item => !/^[A-F]$/.test(item['ICAO-code'] ?? '')).map(item => item.id);
const missingSeatCounts = result.aircraft.aircraft.filter(item => !Number.isInteger(item.seats) || item.seats <= 0).length;
Object.assign(gaps.blockers.find(item => item.id === 'aircraft-generation-metadata'), {
  aircraft_without_verified_size_code: missingSizeCodes,
  aircraft_without_seat_counts: missingSeatCounts,
});
const count = kind => result.stands.stands.reduce((n, stand) => n + (stand[kind]?.length ?? 0), 0);
result.rules.summary = {
  asm_stands: result.rules.tables.length, aircraft_variants: result.aircraft.aircraft.length,
  aircraft_cells: result.rules.tables.reduce((n, table) => n + table.entries.length, 0),
  unconditional_closures: result.stands.stands.flatMap(stand => stand['close-conditions']).filter(rule => !rule['aircraft-groups']).length,
  aircraft_conditioned_closures: result.stands.stands.flatMap(stand => stand['close-conditions']).filter(rule => rule['aircraft-groups']).length,
  restrictions: count('restriction-conditions'), unresolved_aircraft_expressions: aircraftReviews.length,
};
for (const [file, value] of [
  ['aircraft.json', result.aircraft], ['aircraft-groups.json', result.groups],
  ['infrastructure/stands.json', result.stands], ['asm-rules.json', result.rules],
  ['data-gaps.json', gaps], ['airport.json', manifest],
]) writeFileSync(resolve(directory, file), `${JSON.stringify(value, null, 2)}\n`);
console.log(JSON.stringify(result.rules.summary, null, 2));
for (const review of result.rules.review_requirements) console.warn(`REVIEW ${review.stand_id} / ${review.source_id} page ${review.pdf_page}: ${review.text}`);
console.log('GTAA ASM permissions updated. Sectors, airlines, readiness, coordinates and current availability remain unchanged.');
