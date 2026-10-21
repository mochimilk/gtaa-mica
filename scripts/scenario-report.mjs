import { compileAirport } from './airport-model.mjs';
import { formatUtcInstant, parseUtcInstant } from './demand-model.mjs';
import { compareIds } from './stand-pressure.mjs';

export function summarizeScenario(scenario, comparison, airport) {
  if (comparison.demand_id !== scenario.raw_demand.id || comparison.airport_id !== scenario.raw_demand.airport_id ||
      comparison.airport_id !== airport.airport.id ||
      parseUtcInstant(comparison.preparation.baseline.plan_window.start) !== parseUtcInstant(scenario.plan_window.start) ||
      parseUtcInstant(comparison.preparation.baseline.plan_window.end) !== parseUtcInstant(scenario.plan_window.end)) {
    throw new Error('Scenario comparison identity does not match generated demand');
  }
  const model = compileAirport(airport);
  const start = parseUtcInstant(scenario.plan_window.start);
  const end = parseUtcInstant(scenario.plan_window.end);
  const legs = scenario.raw_demand.legs;
  const inHorizon = legs.filter(leg => {
    const time = parseUtcInstant(leg.scheduled_on_block ?? leg.scheduled_off_block);
    return start <= time && time < end;
  }).length;
  const metrics = {};
  for (const [name, plan] of Object.entries(comparison.variants)) {
    const selectedVisitIds = new Set(plan.assignments.map(item => item.demand.visit_id));
    const visits = comparison.preparation.baseline.linked_demand.visits;
    const boundaryState = (states, time) => states.map(state => {
      const visit = visits.find(item => item.arrival_leg_id === state.arrival_leg_id && item.departure_leg_id === state.departure_leg_id);
      if (!visit) throw new Error(`Missing scenario boundary visit: ${state.aircraft_registration}`);
      const assignment = plan.assignments.find(item => item.demand.visit_id === visit.id &&
        parseUtcInstant(item.demand.start) <= time && time < parseUtcInstant(item.demand.end));
      if (assignment) return { aircraft_registration: state.aircraft_registration, status: 'on-stand', stand_id: assignment.stand_id };
      const movement = plan.generated_movements.find(item => parseUtcInstant(item.scheduled_off_block) <= time &&
        time < parseUtcInstant(item.scheduled_on_block) &&
        plan.assignments.some(selected => selected.demand_id === item.from_demand_id && selected.demand.visit_id === visit.id));
      if (movement) return { aircraft_registration: state.aircraft_registration, status: 'in-transit', movement_id: movement.id };
      if (selectedVisitIds.has(visit.id)) throw new Error(`Assigned visit has an unexplained boundary state: ${visit.id}`);
      return { aircraft_registration: state.aircraft_registration, status: 'unassigned' };
    });
    const stands = [...model.stands.values()].filter(stand => stand.configuration_status === 'ready' && !stand.closed &&
      model.allowedAirlines.get(stand.id).size).sort((a, b) => compareIds(a.id, b.id)).map(stand => {
      const intervals = plan.assignments.filter(item => item.stand_id === stand.id).map(item => ({
        start: Math.max(start, parseUtcInstant(item.demand.start)), end: Math.min(end, parseUtcInstant(item.demand.end)),
      })).filter(item => item.start < item.end).sort((a, b) => a.start - b.start);
      let cursor = start;
      let occupied = 0;
      const gaps = [];
      for (const interval of intervals) {
        if (interval.start < cursor) throw new Error(`Scenario metric encountered overlapping stand assignments: ${stand.id}`);
        if (cursor < interval.start) gaps.push({ start: formatUtcInstant(cursor), end: formatUtcInstant(interval.start) });
        occupied += interval.end - interval.start;
        cursor = interval.end;
      }
      if (cursor < end) gaps.push({ start: formatUtcInstant(cursor), end: formatUtcInstant(end) });
      return {
        stand_id: stand.id, contact: stand.contact, occupied_minutes: occupied / 60_000,
        utilization_fraction: occupied / (end - start), unoccupied_minutes: (end - start - occupied) / 60_000,
        unoccupied_intervals: gaps,
      };
    });
    const countService = contact => plan.assignments.reduce((sum, item) => {
      if (model.stands.get(item.stand_id).contact !== contact) return sum;
      return sum + Number(Boolean(item.demand.arrival)) + Number(Boolean(item.demand.departure));
    }, 0);
    const fixedComplete = comparison.preparation.baseline.timing_complete &&
      plan.excluded_segment_ids.length === 0 && comparison.preparation.baseline.blocked_source_leg_ids.length === 0;
    metrics[name] = {
      solver_status: plan.status,
      complete_assignment: fixedComplete && plan.disposition === 'stand-rules-validated',
      assigned_visits: selectedVisitIds.size, unassigned_visits: visits.length - selectedVisitIds.size,
      represented_flight_legs: visits.reduce((sum, visit) => sum + Number(Boolean(visit.arrival_leg_id)) + Number(Boolean(visit.departure_leg_id)), 0),
      assigned_flight_legs: plan.covered_flight_count, generated_tows: plan.generated_movement_count,
      contact_service_flight_legs: countService(true), remote_service_flight_legs: countService(false),
      unresolved_segment_count: plan.excluded_segment_ids.length,
      blocked_source_leg_count: comparison.preparation.baseline.blocked_source_leg_ids.length,
      stand_validation_passed: plan.stand_validation.passed,
      initial_state: boundaryState(scenario.initial_state, start), final_state: boundaryState(scenario.final_state, end),
      stands,
    };
  }
  const expectations = scenario.profile.cases.find(item => item.id === scenario.case_id).expectations;
  const baseline = metrics.baseline;
  const variant = metrics['tow-options'];
  const gain = variant.assigned_flight_legs - baseline.assigned_flight_legs;
  const checks = [
    { name: 'baseline-completeness', passed: baseline.complete_assignment === expectations.baseline_complete },
    { name: 'variant-completeness', passed: variant.complete_assignment === expectations.variant_complete },
    { name: 'minimum-coverage-gain', passed: gain >= expectations.minimum_coverage_gain },
    { name: 'movement-range', passed: variant.generated_tows >= expectations.minimum_generated_movements &&
      variant.generated_tows <= expectations.maximum_generated_movements },
    { name: 'stand-validation', passed: Object.values(metrics).every(item => item.stand_validation_passed) },
    { name: 'source-and-timing-completeness', passed: Object.values(metrics).every(item =>
      !item.unresolved_segment_count && !item.blocked_source_leg_count) },
  ];
  return {
    total_source_flight_legs: legs.length, in_horizon_flight_legs: inHorizon, context_flight_legs: legs.length - inHorizon,
    expected_visits: scenario.expected_visit_count, metrics, coverage_gain: gain,
    expectation_checks: checks, expectations_passed: checks.every(check => check.passed),
    operationally_ready: false,
    limitations: [
      'Coverage includes surrounding source legs for complete visits; in-horizon event counts are reported separately.',
      'Unoccupied stand time is geometric schedule space, not compatible usable capacity; neighboring closures and other resources can reduce availability.',
      'Complete assignment means complete generated fixed occupancy under authored stand rules, not operational certification.',
    ],
  };
}
