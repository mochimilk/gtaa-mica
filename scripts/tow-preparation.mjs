import Ajv from 'ajv';
import { fileURLToPath } from 'node:url';
import { compileAirport, getHourlyDistribution, readJson } from './airport-model.mjs';
import { formatUtcInstant, parseUtcInstant } from './demand-model.mjs';
import { deriveOccupancy } from './occupancy-model.mjs';
import { analyzeStandPressure, buildStandDemand, compareIds } from './stand-pressure.mjs';

const profilePath = fileURLToPath(new URL('../data/airports/contoso/demand/tow-profile.json', import.meta.url));
const ajv = new Ajv({ allErrors: true });
const profileShape = ajv.compile(readJson(fileURLToPath(new URL('../data/schemas/tow-profile.schema.json', import.meta.url))));
export const loadTowProfile = (path = profilePath) => readJson(path);

const replace = (demands, proposal) => demands.filter(demand => demand.id !== proposal.baseline_demand_id).concat(proposal.demands);
const ranking = (a, b) => Number(Boolean(a.unassignable_demand_ids.length)) - Number(Boolean(b.unassignable_demand_ids.length)) ||
  b.net_benefit_minutes - a.net_benefit_minutes ||
  b.estimated_relief_minutes - a.estimated_relief_minutes || b.peak_exposure - a.peak_exposure ||
  b.parking_minutes - a.parking_minutes || compareIds(a.id, b.id);
const assess = (before, after, profile) => {
  const relief = (before.total_shortfall_ms - after.total_shortfall_ms) / 60_000;
  return { estimated_relief_minutes: relief, net_benefit_minutes: relief - 2 * profile.movement_penalty_minutes };
};
const worthwhile = (proposal, profile) => proposal.estimated_relief_minutes > 0 &&
  proposal.net_benefit_minutes > 0 && proposal.net_benefit_minutes >= profile.minimum_net_benefit_minutes;

function peakExposure(model, visit, sourceById, slices, start, end) {
  const directions = [['arrival', visit.arrival_leg_id], ['departure', visit.departure_leg_id]];
  const distributions = directions.map(([direction, id]) => getHourlyDistribution(model, sourceById.get(id).sector_id, direction));
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: model.timeZone, hour: '2-digit', hourCycle: 'h23' });
  let exposure = 0;
  for (const slice of slices) {
    let time = Math.max(start, parseUtcInstant(slice.start));
    const limit = Math.min(end, parseUtcInstant(slice.end));
    while (time < limit) {
      const next = Math.min(limit, (Math.floor(time / 60_000) + 1) * 60_000);
      const hour = Number(clock.formatToParts(time).find(part => part.type === 'hour').value);
      const relative = distributions.reduce((sum, distribution) => sum + distribution[hour] * 24, 0) / distributions.length;
      exposure += (next - time) / 60_000 * relative * slice.shortfall;
      time = next;
    }
  }
  return exposure;
}

export function prepareTows(demand, airport, options, profile = loadTowProfile()) {
  if (!profileShape(profile)) throw new Error(`Invalid tow profile: ${ajv.errorsText(profileShape.errors)}`);
  const baseline = deriveOccupancy(demand, airport, options);
  const model = compileAirport(airport);
  if (model.defaultTowMinutes === undefined) throw new Error('Tow preparation requires configured default-tow-minutes');
  const travel = model.defaultTowMinutes * 60_000;
  const { demands, excluded_segment_ids: excluded } = buildStandDemand(baseline);
  const baselineAnalysis = analyzeStandPressure(model, demands, baseline.plan_window);
  const sourceById = new Map(baseline.linked_demand.source_legs.map(leg => [leg.id, leg]));
  const blocked = new Set(baseline.blocked_source_leg_ids);
  const proposals = [];
  const assessments = [];
  for (const visit of baseline.linked_demand.visits) {
    const assessment = { visit_id: visit.id };
    if ([visit.arrival_leg_id, visit.departure_leg_id].some(id => blocked.has(id))) {
      assessments.push({ ...assessment, reason: 'blocked-source' });
      continue;
    }
    if (visit.status !== 'connected') {
      assessments.push({ ...assessment, reason: 'single-leg-boundary-unresolved' });
      continue;
    }
    if (baseline.linked_demand.ground_movements.some(movement => movement.visit_id === visit.id)) {
      assessments.push({ ...assessment, reason: 'preserve-supplied-movements' });
      continue;
    }
    const original = demands.find(row => row.visit_id === visit.id);
    if (!original) {
      assessments.push({ ...assessment, reason: 'no-reliable-occupancy' });
      continue;
    }
    const out = parseUtcInstant(visit.arrival_window.end);
    const back = parseUtcInstant(visit.departure_window.start);
    const parkedStart = out + travel;
    const parkedEnd = back - travel;
    const parkingMinutes = (parkedEnd - parkedStart) / 60_000;
    if (parkingMinutes < profile.minimum_parking_minutes) {
      assessments.push({ ...assessment, reason: 'insufficient-parking-window' });
      continue;
    }
    const id = `tow-proposal:${encodeURIComponent(visit.id)}`;
    const common = {
      aircraft_id: original.aircraft_id, aircraft_registration: original.aircraft_registration,
      visit_id: visit.id, source_segment_id: original.source_segment_id,
      operating_airline_ids: original.operating_airline_ids.slice(), timing_basis: 'proposed',
    };
    const rows = [
      { ...common, id: `${id}/arrival`, role: 'service', stand_kind: 'any', start: original.start,
        end: formatUtcInstant(out), arrival: original.arrival, operating_airline_ids: [original.arrival.operatingAirlineId] },
      { ...common, id: `${id}/parking`, role: 'parking', stand_kind: profile.parking_stand_kind,
        start: formatUtcInstant(parkedStart), end: formatUtcInstant(parkedEnd) },
      { ...common, id: `${id}/departure`, role: 'service', stand_kind: 'any', start: formatUtcInstant(back),
        end: original.end, departure: original.departure, operating_airline_ids: [original.departure.operatingAirlineId] },
    ];
    const proposal = {
      id, visit_id: visit.id, baseline_demand_id: original.id, demands: rows, parking_minutes: parkingMinutes,
      tow_window: { start: formatUtcInstant(out), end: formatUtcInstant(back) },
      movements: [
        { id: `${id}/out`, from_demand_id: rows[0].id, to_demand_id: rows[1].id,
          scheduled_off_block: formatUtcInstant(out), scheduled_on_block: formatUtcInstant(parkedStart) },
        { id: `${id}/back`, from_demand_id: rows[1].id, to_demand_id: rows[2].id,
          scheduled_off_block: formatUtcInstant(parkedEnd), scheduled_on_block: formatUtcInstant(back) },
      ],
    };
    const alternative = analyzeStandPressure(model, replace(demands, proposal), baseline.plan_window);
    const ids = new Set(rows.map(row => row.id));
    proposal.unassignable_demand_ids = alternative.demands.filter(row => ids.has(row.id) && !row.candidate_stand_ids.length).map(row => row.id);
    const related = baselineAnalysis.pressure_slices.filter(slice =>
      slice.constrained_pool_demand_ids.includes(original.id) &&
      parseUtcInstant(slice.start) < back && parseUtcInstant(slice.end) > out);
    proposal.peak_exposure = related.length ? peakExposure(model, visit, sourceById, related, out, back) : 0;
    proposal.competing_demand_ids = [...new Set(related.flatMap(slice => slice.constrained_pool_demand_ids))]
      .filter(demandId => demandId !== original.id).sort(compareIds);
    Object.assign(proposal, assess(baselineAnalysis, alternative, profile), {
      movement_cost_minutes: 2 * profile.movement_penalty_minutes,
      rationale: proposal.unassignable_demand_ids.length ? 'no-compatible-alternative-stand'
        : !baselineAnalysis.demands.find(row => row.id === original.id).candidate_stand_ids.length
          ? 'repair-incompatible-continuous-stay' : 'relieve-shared-stand-pool',
    });
    proposals.push(proposal);
    assessments.push({ ...assessment, reason: 'proposal-generated' });
  }
  proposals.sort(ranking);
  proposals.forEach((proposal, index) => { proposal.rank = index + 1; });
  let selectedDemands = demands;
  let current = baselineAnalysis;
  const selected = new Set();
  const steps = [];
  while (2 * (selected.size + 1) <= profile.maximum_generated_movements) {
    const candidates = proposals.filter(proposal => !selected.has(proposal.id) && !proposal.unassignable_demand_ids.length).map(proposal => {
      const analysis = analyzeStandPressure(model, replace(selectedDemands, proposal), baseline.plan_window);
      return { ...proposal, ...assess(current, analysis, profile), analysis };
    }).filter(proposal => worthwhile(proposal, profile)).sort(ranking);
    if (!candidates.length) break;
    const best = candidates[0];
    steps.push({
      proposal_id: best.id, estimated_relief_minutes: best.estimated_relief_minutes, net_benefit_minutes: best.net_benefit_minutes,
      before_shortfall_ms: current.total_shortfall_ms, after_shortfall_ms: best.analysis.total_shortfall_ms,
    });
    selected.add(best.id);
    selectedDemands = replace(selectedDemands, best);
    current = best.analysis;
  }
  const rejected = proposals.filter(proposal => !selected.has(proposal.id)).map(proposal => {
    const trial = analyzeStandPressure(model, replace(selectedDemands, proposal), baseline.plan_window);
    const score = assess(current, trial, profile);
    return {
      proposal_id: proposal.id, ...score,
      reason: proposal.unassignable_demand_ids.length ? 'no-compatible-alternative-stand'
        : score.estimated_relief_minutes <= 0 ? 'no-marginal-shortfall-relief'
          : !worthwhile(score, profile) ? 'below-cost-or-benefit-threshold' : 'movement-budget',
    };
  });
  return {
    schema_version: '1.0.0', airport_id: baseline.airport_id, demand_id: baseline.demand_id,
    profile: structuredClone(profile), baseline, baseline_analysis: baselineAnalysis,
    excluded_segment_ids: excluded, visit_assessments: assessments,
    proposals, selection: {
      status: 'provisional-review', selected_proposal_ids: [...selected], generated_movement_count: selected.size * 2,
      steps, rejected, analysis: current,
    },
    solver_ready: false,
    findings: [
      ...baseline.findings,
      ...(excluded.length || !baseline.timing_complete ? [{
        code: 'partial-pressure-analysis', severity: 'warning', leg_ids: [], segment_ids: excluded,
        message: 'Pressure covers only fixed occupancies and minimum service. Unknown parking, unresolved single-leg extent and blocked demand prevent a complete capacity claim.',
      }] : []),
      {
        code: 'relaxed-tow-selection', severity: 'warning', leg_ids: [], segment_ids: [],
        message: 'Selected timings are unassigned proposals, not raw ground legs or a feasible plan. Validate conditional stand rules, continuity, gate sharing, parking, routes and towing resources before use.',
      },
    ],
  };
}
