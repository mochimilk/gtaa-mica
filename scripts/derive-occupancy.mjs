import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadAirport } from './airport-model.mjs';
import { loadDemand } from './demand-model.mjs';
import { deriveOccupancy } from './occupancy-model.mjs';

try {
  const { values } = parseArgs({
    options: {
      'plan-start': { type: 'string' }, 'plan-end': { type: 'string' },
      demand: { type: 'string' }, airport: { type: 'string' }, output: { type: 'string' },
    },
    allowPositionals: false,
  });
  const result = deriveOccupancy(loadDemand(values.demand), loadAirport(values.airport), {
    planStart: values['plan-start'], planEnd: values['plan-end'],
  });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output !== undefined) writeFileSync(values.output, json, { flag: 'wx' });
  else process.stdout.write(json);
  const errors = result.findings.filter(finding => finding.severity === 'error');
  const label = errors.length ? 'NEEDS REVIEW' : result.timing_complete ? 'FIXED TIMING' : 'UNRESOLVED BOUNDARIES';
  const count = status => result.segments.filter(segment => segment.timing_status === status).length;
  console.error(`${label}: ${result.segments.length} occupancy segments (${count('fixed')} fixed, ${count('flexible')} flexible, ${count('open')} open); ${result.blocked_source_leg_ids.length} blocked source legs.`);
  for (const finding of result.findings) console.error(`${finding.severity.toUpperCase()} ${finding.code} [${finding.leg_ids.join(', ')}]: ${finding.message}`);
  if (values.output !== undefined) console.error(`Occupancy package written to ${values.output}`);
  console.error('Unknown boundaries are not plan-boundary assumptions. Tow travel is not stand occupancy. No solver run or stand-feasibility certification.');
  if (errors.length) process.exitCode = 2;
  else if (!result.timing_complete) process.exitCode = 3;
} catch (error) {
  console.error(error.message);
  console.error('Usage: npm run derive:occupancy -- --plan-start <UTC> --plan-end <UTC> [--demand <file>] [--airport <file>] [--output <new-file>]');
  process.exitCode = 1;
}
