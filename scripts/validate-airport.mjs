import { loadAirport, validateAirport } from './airport-model.mjs';

if (process.argv.length > 3) {
  console.error('Usage: npm run validate:airport -- [path-to-airport.json]');
  process.exitCode = 1;
} else {
  try {
    const data = loadAirport(process.argv[2]);
    const { errors, warnings } = validateAirport(data);
    for (const warning of warnings) console.warn(`WARNING ${warning}`);
    for (const error of errors) console.error(`ERROR ${error}`);
    if (errors.length) {
      console.error(`Airport validation failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
      process.exitCode = 1;
    } else {
      console.log(`PASS ${data.airport.id}: ${data.stands.stands.length} stands, ${data.gates.gates.length} gates; ${warnings.length} warning(s).`);
      console.log('Configuration validation only; no solver run, geometry clearance or operational certification.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
