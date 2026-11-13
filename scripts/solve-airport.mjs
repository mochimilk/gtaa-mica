import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadAirport } from './airport-model.mjs';
import { loadDemand } from './demand-model.mjs';
import { loadTowProfile } from './tow-preparation.mjs';
import { buildLocalSolver, solveAirport } from './local-assignment.mjs';

try {
  const { values } = parseArgs({
    options: {
      'plan-start': { type: 'string' }, 'plan-end': { type: 'string' }, 'time-limit-seconds': { type: 'string' },
      demand: { type: 'string' }, airport: { type: 'string' }, profile: { type: 'string' }, output: { type: 'string' },
    }, allowPositionals: false,
  });
  const timeLimitSeconds = values['time-limit-seconds'] === undefined ? 10 : Number(values['time-limit-seconds']);
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0 || timeLimitSeconds > 300) throw new Error('Time limit must be in (0, 300] seconds');
  const demand = loadDemand(values.demand);
  const airport = loadAirport(values.airport);
  const profile = loadTowProfile(values.profile);
  buildLocalSolver();
  const result = solveAirport(demand, airport, {
    planStart: values['plan-start'], planEnd: values['plan-end'], timeLimitSeconds,
  }, profile);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output === undefined) process.stdout.write(json);
  else writeFileSync(values.output, json, { flag: 'wx' });
  for (const [variant, plan] of Object.entries(result.variants)) {
    console.error(`${variant}: ${plan.status}; ${plan.covered_flight_count} represented flight legs; ${plan.unassigned_group_ids.length} unassigned groups; ${plan.generated_movement_count} generated movements.`);
  }
  for (const limitation of result.limitations) console.error(`LIMITATION: ${limitation}`);
  for (const finding of result.preparation.findings) console.error(`${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`);
  if (values.output !== undefined) console.error(`Local assignment review written to ${values.output}`);
  console.error('No Gantt changes. Local review evidence only; not an operationally complete plan.');
  process.exitCode = result.preparation.findings.some(finding => finding.severity === 'error') ||
    Object.values(result.variants).some(plan => plan.disposition !== 'stand-rules-validated') ? 2 : 3;
} catch (error) {
  console.error(error.message);
  console.error('Usage: npm run solve:airport -- --plan-start <UTC> --plan-end <UTC> [--demand <file>] [--airport <file>] [--profile <file>] [--time-limit-seconds <1..300>] [--output <new-file>]');
  process.exitCode = 1;
}
