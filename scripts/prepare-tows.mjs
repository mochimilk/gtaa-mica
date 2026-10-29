import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadAirport } from './airport-model.mjs';
import { loadDemand } from './demand-model.mjs';
import { loadTowProfile, prepareTows } from './tow-preparation.mjs';

try {
  const { values } = parseArgs({
    options: {
      'plan-start': { type: 'string' }, 'plan-end': { type: 'string' }, demand: { type: 'string' },
      airport: { type: 'string' }, profile: { type: 'string' }, output: { type: 'string' },
    }, allowPositionals: false,
  });
  const result = prepareTows(loadDemand(values.demand), loadAirport(values.airport), {
    planStart: values['plan-start'], planEnd: values['plan-end'],
  }, loadTowProfile(values.profile));
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output === undefined) process.stdout.write(json);
  else writeFileSync(values.output, json, { flag: 'wx' });
  console.error(`Tow preparation: ${result.proposals.length} ranked proposals; ${result.selection.selected_proposal_ids.length} selected for review; ${result.selection.generated_movement_count} proposed movements.`);
  console.error(`Relaxed shortage-minutes: ${result.baseline_analysis.shortfall_minutes} baseline -> ${result.selection.analysis.shortfall_minutes} proposed.`);
  for (const finding of result.findings) console.error(`${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`);
  console.error('No assignments, raw-feed edits or Gantt changes. Selected timings require full solver validation.');
  if (values.output !== undefined) console.error(`Review package written to ${values.output}`);
  process.exitCode = result.findings.some(finding => finding.severity === 'error') ? 2 : 3;
} catch (error) {
  console.error(error.message);
  console.error('Usage: npm run prepare:tows -- --plan-start <UTC> --plan-end <UTC> [--demand <file>] [--airport <file>] [--profile <file>] [--output <new-file>]');
  process.exitCode = 1;
}
