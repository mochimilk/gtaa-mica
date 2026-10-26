import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAirport, readJson } from './airport-model.mjs';
import { isUtcInstant } from './demand-model.mjs';
import { generateScenario, loadScenarioProfile } from './scenario-generator.mjs';
import { solveAirport } from './local-assignment.mjs';
import { summarizeScenario } from './scenario-report.mjs';
import { loadCapacityProfile, prepareCapacitySnapshot } from './capacity-probe.mjs';
import { writeCapacityArtifacts } from './prepare-capacity.mjs';

export function prepareDemoSnapshot(scenario, comparison, airport) {
  const summary = summarizeScenario(scenario, comparison, airport);
  if (!summary.expectations_passed) throw new Error(`Cannot prepare demo with failed scenario expectations: ${scenario.case_id}`);
  const legs = new Map(scenario.raw_demand.legs.map(leg => [leg.id, leg]));
  const visits = comparison.preparation.baseline.linked_demand.visits;
  const visitByLeg = new Map(visits.flatMap(visit => [
    [visit.arrival_leg_id, visit.id], [visit.departure_leg_id, visit.id],
  ]));
  const snapshot = {
    schema_version: '1.0.0', case_id: scenario.case_id, demand_id: scenario.raw_demand.id,
    plan_window: scenario.plan_window,
    rows: airport.stands.stands.map(stand => ({ id: stand.id, label: stand.code, group: stand.pier ?? stand.associated_building_id })),
    visits: visits.map(visit => {
      const arrival = legs.get(visit.arrival_leg_id), departure = legs.get(visit.departure_leg_id);
      if (!arrival || !departure) throw new Error(`Demo preparation requires complete flight pairs: ${visit.id}`);
      return {
        turnId: visit.id, carrier: arrival.operating_airline_id.replace(/^airline:/, ''),
        arrFlight: arrival.flight_number, depFlight: departure.flight_number,
        origin: arrival.origin_airport_id, destination: departure.destination_airport_id,
        registration: arrival.aircraft_registration, aircraftType: arrival.aircraft_id,
      };
    }),
    flights: scenario.raw_demand.legs.map(leg => ({
      id: leg.id, visitId: visitByLeg.get(leg.id), direction: leg.type, flight: leg.flight_number,
      routeEnd: leg.type === 'arrival' ? leg.origin_airport_id : leg.destination_airport_id,
      scheduled: leg.scheduled_on_block ?? leg.scheduled_off_block,
    })),
    variants: Object.fromEntries(Object.entries(comparison.variants).map(([name, plan]) => [name, {
      solver_status: plan.status, request_fingerprint: plan.request_fingerprint,
      covered_flight_count: plan.covered_flight_count, generated_movement_count: plan.generated_movement_count,
      stand_validation_passed: plan.stand_validation.passed,
      stays: plan.assignments.map(assignment => ({
        id: assignment.demand_id, visitId: assignment.demand.visit_id, rowId: assignment.stand_id,
        start: assignment.demand.start, end: assignment.demand.end,
        ...(assignment.demand.arrival ? { arrivalFlightId: visits.find(visit => visit.id === assignment.demand.visit_id).arrival_leg_id } : {}),
        ...(assignment.demand.departure ? { departureFlightId: visits.find(visit => visit.id === assignment.demand.visit_id).departure_leg_id } : {}),
        towIn: plan.generated_movements.some(movement => movement.to_demand_id === assignment.demand_id),
        towOut: plan.generated_movements.some(movement => movement.from_demand_id === assignment.demand_id),
      })),
    }])),
  };
  const ajv = new Ajv({ allErrors: true });
  ajv.addFormat('date-time', isUtcInstant);
  const validate = ajv.compile(readJson(fileURLToPath(new URL('../data/schemas/demo-scenario.schema.json', import.meta.url))));
  if (!validate(snapshot)) throw new Error(`Invalid prepared demo: ${ajv.errorsText(validate.errors)}`);
  return snapshot;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: npm run prepare:demo (regenerates all checked-in demo snapshots)');
    const airport = loadAirport(), profile = loadScenarioProfile(), capacityProfile = loadCapacityProfile();
    const fullDay = loadScenarioProfile(fileURLToPath(new URL('../data/airports/contoso/demand/full-day-profile.json', import.meta.url)));
    const snapshots = [['comfortable', profile], ['constrained', profile], ['full-day', fullDay]].map(([caseId, input]) => {
      const scenario = generateScenario(input, airport, caseId);
      for (const warning of scenario.routing_warnings ?? []) console.warn(`WARNING ${warning}`);
      const comparison = solveAirport(scenario.raw_demand, airport, { planStart: scenario.plan_window.start, planEnd: scenario.plan_window.end });
      for (const [variant, metrics] of Object.entries(summarizeScenario(scenario, comparison, airport).metrics)) {
        console.log(`${caseId}/${variant}: ${metrics.assigned_visits}/${scenario.expected_visit_count} visits; ${metrics.generated_tows} generated tows; ${metrics.solver_status}.`);
      }
      const snapshot = prepareDemoSnapshot(scenario, comparison, airport);
      return { snapshot, raw: scenario.raw_demand, capacity: prepareCapacitySnapshot(snapshot, scenario.raw_demand, airport, capacityProfile) };
    });
    const directory = fileURLToPath(new URL('../src/demo/prepared/', import.meta.url));
    mkdirSync(directory, { recursive: true });
    for (const { snapshot, raw } of snapshots) {
      const path = fileURLToPath(new URL(`../src/demo/prepared/${snapshot.case_id}.json`, import.meta.url));
      writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
      console.log(`Prepared ${snapshot.case_id}: ${snapshot.visits.length} visits, ${snapshot.flights.length} flight legs. ${path}`);
      if (snapshot.case_id === 'full-day') {
        const demandPath = fileURLToPath(new URL('../data/airports/contoso/demand/full-day-demand.json', import.meta.url));
        writeFileSync(demandPath, `${JSON.stringify(raw, null, 2)}\n`);
        console.log(`Generated full-day raw demand: ${demandPath}`);
      }
    }
    writeCapacityArtifacts(snapshots.map(item => item.capacity));
    const ajv = new Ajv({ allErrors: true, code: { source: true, esm: true } });
    ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
    const validate = ajv.compile(readJson(fileURLToPath(new URL('../data/schemas/demo-scenario.schema.json', import.meta.url))));
    writeFileSync(fileURLToPath(new URL('../src/demo/prepared-validator.mjs', import.meta.url)),
      `// Generated by npm run prepare:demo. Do not edit manually.\n${standaloneCode(ajv, validate)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
