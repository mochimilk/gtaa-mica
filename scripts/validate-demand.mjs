import { loadAirport } from './airport-model.mjs';
import { loadDemand, validateDemand } from './demand-model.mjs';

if (process.argv.length > 4) {
  console.error('Usage: npm run validate:demand -- [path-to-demand.json] [path-to-airport.json]');
  process.exitCode = 1;
} else {
  try {
    const demand = loadDemand(process.argv[2]);
    const airport = loadAirport(process.argv[3]);
    const { errors, warnings } = validateDemand(demand, airport);
    for (const warning of warnings) console.warn(`WARNING ${warning}`);
    for (const error of errors) console.error(`ERROR ${error}`);
    if (errors.length) {
      console.error(`Demand validation failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
      process.exitCode = 1;
    } else {
      const count = type => demand.legs.filter(leg => leg.type === type).length;
      console.log(`PASS ${demand.id}: ${demand.legs.length} legs (${count('arrival')} arrival, ${count('departure')} departure, ${count('ground-movement')} ground movement); ${warnings.length} warning(s).`);
      console.log(`Airport: ${demand.airport_id}; synthetic: ${demand.synthetic}.`);
      console.log('Raw input validation only; no visit linking, tow inference, stand assignment or Gantt update.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
