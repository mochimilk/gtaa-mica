import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadAirport } from './airport-model.mjs';
import { loadDemand } from './demand-model.mjs';
import { linkDemand } from './visit-linker.mjs';

try {
  const { values } = parseArgs({
    options: {
      'plan-start': { type: 'string' }, 'plan-end': { type: 'string' },
      demand: { type: 'string' }, airport: { type: 'string' }, output: { type: 'string' },
    },
    allowPositionals: false,
  });
  const result = linkDemand(loadDemand(values.demand), loadAirport(values.airport), {
    planStart: values['plan-start'], planEnd: values['plan-end'],
  });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output !== undefined) writeFileSync(values.output, json, { flag: 'wx' });
  else process.stdout.write(json);
  const errors = result.findings.filter(finding => finding.severity === 'error');
  console.error(`${errors.length ? 'NEEDS REVIEW' : 'LINKED'}: ${result.visits.length} visits, ${result.tow_requirements.length} provisional tow requirements, ${result.unresolved_connection_leg_ids.length} unresolved flight legs; search radius ${result.connection_search_radius_ms / 3_600_000} hours.`);
  for (const finding of result.findings) console.error(`${finding.severity.toUpperCase()} ${finding.code} [${finding.leg_ids.join(', ')}]: ${finding.message}`);
  if (values.output !== undefined) console.error(`Linked demand package written to ${values.output}`);
  console.error(`${result.ground_movements.length} normalized ground movements; ${result.movement_matches.length} existing-movement matches. Inferred times carry provenance; no stand assignments or solver run. Existing output files are never overwritten.`);
  if (errors.length) process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  console.error('Usage: npm run link:demand -- --plan-start <UTC> --plan-end <UTC> [--demand <file>] [--airport <file>] [--output <new-file>]');
  process.exitCode = 1;
}
