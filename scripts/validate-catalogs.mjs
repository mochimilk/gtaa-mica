import { deriveRouteProfile, loadCatalogs, validateCatalogs } from './airport-catalogs.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--host')) {
  console.error('Usage: npm run validate:catalogs -- [--host YYZ]');
  process.exitCode = 1;
} else {
  try {
    const data = loadCatalogs();
    const { errors, warnings } = validateCatalogs(data);
    for (const warning of warnings) console.warn(`WARNING ${warning}`);
    for (const error of errors) console.error(`ERROR ${error}`);
    if (errors.length) {
      console.error(`Catalog validation failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
      process.exitCode = 1;
    } else if (args.length) {
      console.log(JSON.stringify(deriveRouteProfile(data, args[1]), null, 2));
    } else {
      console.log(`PASS ${data.airlines.airlines.length} airlines, ${data.airports.airports.length} airports; every airline has home-country airport coverage; ${warnings.length} warning(s).`);
      console.log('Reference and synthetic routing checks only; not verified airline service, stand eligibility or a traffic forecast.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
