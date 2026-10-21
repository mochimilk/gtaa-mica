import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadAirport } from './airport-model.mjs';
import { generateScenario, loadScenarioProfile } from './scenario-generator.mjs';
import { summarizeScenario } from './scenario-report.mjs';

try {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string' }, airport: { type: 'string' }, case: { type: 'string' },
      output: { type: 'string' }, solve: { type: 'boolean', default: false },
      'tow-profile': { type: 'string' }, 'time-limit-seconds': { type: 'string' },
    }, allowPositionals: false,
  });
  if (!values.case) throw new Error('An explicit --case is required');
  if (!values.solve && (values['tow-profile'] !== undefined || values['time-limit-seconds'] !== undefined)) {
    throw new Error('Tow profile and time limit require --solve');
  }
  const timeLimitSeconds = values['time-limit-seconds'] === undefined ? 10 : Number(values['time-limit-seconds']);
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0 || timeLimitSeconds > 300) throw new Error('Time limit must be in (0, 300] seconds');
  const airport = loadAirport(values.airport);
  const scenario = generateScenario(loadScenarioProfile(values.profile), airport, values.case);
  let result = scenario;
  if (values.solve) {
    const { buildLocalSolver, solveAirport } = await import('./local-assignment.mjs');
    const { loadTowProfile } = await import('./tow-preparation.mjs');
    const towProfile = loadTowProfile(values['tow-profile']);
    buildLocalSolver();
    const comparison = solveAirport(scenario.raw_demand, airport, {
      planStart: scenario.plan_window.start, planEnd: scenario.plan_window.end, timeLimitSeconds,
    }, towProfile);
    const summary = summarizeScenario(scenario, comparison, airport);
    result = { schema_version: '1.0.0', scenario, comparison, summary };
    for (const [name, metrics] of Object.entries(summary.metrics)) {
      console.error(`${name}: ${metrics.assigned_visits}/${scenario.expected_visit_count} visits; ${metrics.assigned_flight_legs}/${metrics.represented_flight_legs} represented flight legs; ${metrics.generated_tows} generated tows; ${metrics.solver_status}.`);
    }
    for (const check of summary.expectation_checks) console.error(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}`);
    for (const limitation of [...comparison.limitations, ...summary.limitations]) console.error(`LIMITATION: ${limitation}`);
    process.exitCode = summary.expectations_passed ? 3 : 2;
  }
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output === undefined) process.stdout.write(json);
  else writeFileSync(values.output, json, { flag: 'wx' });
  console.error(`Generated ${scenario.case_id}: ${scenario.expected_visit_count} complete scheduled visits, ${scenario.raw_demand.legs.length} raw legs; ${scenario.initial_state.length} initial and ${scenario.final_state.length} final aircraft.`);
  if (values.output !== undefined) console.error(`Scenario ${values.solve ? 'review' : 'demand'} written to ${values.output}`);
  console.error('Synthetic closed-feed scenario only. Airport configuration, validation seed and Gantt are unchanged.');
} catch (error) {
  console.error(error.message);
  console.error('Usage: npm run generate:scenario -- --case <id> [--profile <file>] [--airport <file>] [--output <new-file>] [--solve --tow-profile <file> --time-limit-seconds <1..300>]');
  process.exitCode = 1;
}
