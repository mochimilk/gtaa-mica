import { compileAirport, loadAirport, validateAirport } from './airport-model.mjs';

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
      const model = compileAirport(data);
      const unauthorized = [...model.allowedAirlines.values()].filter(airlines => !airlines.size).length;
      console.log(`Airline permissions: ${data.airlines.airlines.length} airlines, ${data.airlineGroups.groups.length} disjoint groups; ${unauthorized} stand(s) unavailable because no airlines are authorized.`);
      if (data.trafficProfile) console.log(`Traffic profile: ${model.trafficPatterns.size} sector(s), airport-local hourly demand weights in ${model.timeZone}; not capacity limits.`);
      if (data.operatingPolicy) {
        const windows = data.operatingPolicy['minimum-leg-windows'].map(rule =>
          `${rule['aircraft-size-codes'].join('/')}: arrival ${rule['arrival-minutes']}m, departure ${rule['departure-minutes']}m`);
        console.log(`Minimum leg windows: ${windows.join('; ')} (elapsed time; tow travel excluded).`);
        if (model.defaultTowMinutes !== undefined) console.log(`Tow normalization: ${model.defaultTowMinutes}m airport default for missing endpoints; supplied intervals are preserved.`);
      }
      console.log('Configuration validation only; no solver run, geometry clearance or operational certification.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
