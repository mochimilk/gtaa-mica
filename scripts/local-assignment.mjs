import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { compileAirport, evaluatePlan, readJson } from './airport-model.mjs';
import { isUtcInstant, parseUtcInstant } from './demand-model.mjs';
import { compareIds, standCandidates } from './stand-pressure.mjs';
import { prepareTows } from './tow-preparation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = fileURLToPath(new URL('../components/Planning.Solver/src/Planning.Solver.Cli/Planning.Solver.Cli.csproj', import.meta.url));
const host = fileURLToPath(new URL('../components/Planning.Solver/src/Planning.Solver.Cli/bin/Debug/net10.0/Planning.Solver.Cli.dll', import.meta.url));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ajv = new Ajv({ allErrors: true, strictRequired: false });
ajv.addFormat('date-time', isUtcInstant);
for (const name of ['raw-demand', 'linked-demand', 'occupancy', 'tow-profile', 'tow-preparation', 'local-solver-request', 'local-assignment']) {
  ajv.addSchema(readJson(fileURLToPath(new URL(`../data/schemas/${name}.schema.json`, import.meta.url))));
}
const requestShape = ajv.getSchema('urn:gtaa-mica:local-solver-request:1.0.0');
const resultShape = ajv.getSchema('urn:gtaa-mica:local-assignment:1.0.0#/definitions/rawResult');
const execute = (args, options = {}) => {
  const result = spawnSync('dotnet', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`Cannot execute local .NET solver: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`Local .NET command failed (${result.status ?? result.signal}):\n${result.stderr}\n${result.stdout}`);
  return result;
};
export function buildLocalSolver() {
  const result = execute(['build', project, '--nologo', '--verbosity', 'quiet'], { timeout: 180_000 });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}
const occupancyFor = (demand, standId) => ({
  id: demand.id, standId, aircraftId: demand.aircraft_id,
  start: parseUtcInstant(demand.start), end: parseUtcInstant(demand.end),
  operatingAirlineIds: demand.operating_airline_ids,
  ...(demand.arrival ? { arrival: demand.arrival } : {}),
  ...(demand.departure ? { departure: demand.departure } : {}),
});

export function compileAssignmentRequest(preparation, airport, variant, timeLimitSeconds = 10) {
  if (!['baseline', 'tow-options'].includes(variant)) throw new Error(`Unknown assignment variant: ${variant}`);
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0 || timeLimitSeconds > 300) throw new Error('Solver time limit must be in (0, 300] seconds');
  const model = compileAirport(airport);
  const fixed = preparation.baseline_analysis.demands.filter(demand => demand.timing_basis === 'fixed');
  const byGroup = new Map();
  for (const demand of fixed) {
    const key = demand.visit_id ?? demand.id;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(demand);
  }
  const eligibleProposals = new Map(preparation.proposals
    .filter(proposal => preparation.selection.selected_proposal_ids.includes(proposal.id))
    .map(proposal => [proposal.baseline_demand_id, proposal]));
  const demands = [];
  const groups = [];
  const movementsByOption = new Map();
  for (const [key, rows] of [...byGroup].sort(([a], [b]) => compareIds(a, b))) {
    const id = `assignment-group:${encodeURIComponent(key)}`;
    const visit = preparation.baseline.linked_demand.visits.find(item => item.id === rows[0].visit_id);
    const group = {
      id, flight_count: visit ? Number(Boolean(visit.arrival_leg_id)) + Number(Boolean(visit.departure_leg_id)) : 0,
      mandatory: rows.some(row => row.stand_id !== undefined),
      options: [{ id: `${id}/no-additional-tow`, demand_ids: rows.map(row => row.id), generated_movements: 0 }],
    };
    demands.push(...rows);
    const proposal = rows.length === 1 ? eligibleProposals.get(rows[0].id) : undefined;
    if (variant === 'tow-options' && proposal) {
      const optionId = `${id}/tow`;
      group.options.push({ id: optionId, demand_ids: proposal.demands.map(row => row.id), generated_movements: 2 });
      demands.push(...proposal.demands);
      movementsByOption.set(optionId, proposal.movements);
    }
    groups.push(group);
  }
  const candidates = [];
  const candidateEvidence = [];
  const placement = new Map();
  for (const demand of demands.slice().sort((a, b) => compareIds(a.id, b.id))) {
    const evidence = standCandidates(model, demand);
    candidateEvidence.push({ demand_id: demand.id, ...evidence });
    for (const stand of evidence.candidate_stand_ids) {
      const id = `placement:${encodeURIComponent(demand.id)}/${encodeURIComponent(stand)}`;
      candidates.push({ id, demand_id: demand.id, stand_id: stand });
      placement.set(id, occupancyFor(demand, stand));
    }
  }
  const movementPairs = new Set([...movementsByOption.values()].flat().map(movement =>
    JSON.stringify([movement.from_demand_id, movement.to_demand_id].sort(compareIds))));
  const conflicts = [];
  const conflictEvidence = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.demand_id === b.demand_id) continue;
      const first = placement.get(a.id);
      const second = placement.get(b.id);
      const findings = first.start < second.end && second.start < first.end
        ? evaluatePlan(model, [first, second]) : [];
      const sameEndpoint = a.stand_id === b.stand_id &&
        movementPairs.has(JSON.stringify([a.demand_id, b.demand_id].sort(compareIds)));
      if (!findings.length && !sameEndpoint) continue;
      const conflict = { first_candidate_id: a.id, second_candidate_id: b.id };
      conflicts.push(conflict);
      conflictEvidence.push({
        ...conflict, reasons: [...new Set([...findings.map(finding => finding.code), ...(sameEndpoint ? ['tow-requires-different-stands'] : [])])].sort(compareIds),
        rule_paths: [...new Set(findings.flatMap(finding => finding.rulePath ? [finding.rulePath] : []))].sort(compareIds),
      });
    }
  }
  const content = {
    schema_version: '1.0.0', time_limit_seconds: timeLimitSeconds, groups, candidates, conflicts,
  };
  return {
    request: { ...content, id: `assignment-request:${hash(content)}` },
    demands, candidate_evidence: candidateEvidence, conflict_evidence: conflictEvidence,
    movements_by_option: movementsByOption,
    excluded_segment_ids: preparation.baseline.segments.filter(segment => segment.timing_status !== 'fixed').map(segment => segment.id),
  };
}

export function runAssignmentRequest(compiled) {
  if (!requestShape(compiled.request)) throw new Error(`Invalid local solver request: ${ajv.errorsText(requestShape.errors)}`);
  const output = execute([host], { input: JSON.stringify(compiled.request), timeout: (compiled.request.time_limit_seconds + 15) * 1000 });
  if (output.stderr) process.stderr.write(output.stderr);
  return JSON.parse(output.stdout);
}

export function validateAssignmentResult(compiled, result, airport) {
  if (!resultShape(result)) throw new Error(`Invalid local solver result: ${ajv.errorsText(resultShape.errors)}`);
  const request = compiled.request;
  if (result.request_id !== request.id || result.schema_version !== '1.0.0' ||
      !['optimal', 'feasible', 'infeasible', 'unknown', 'modelinvalid'].includes(result.status)) {
    throw new Error('Solver returned an unknown status, version or request identity');
  }
  const hasSolution = ['optimal', 'feasible'].includes(result.status);
  const candidates = new Map(request.candidates.map(candidate => [candidate.id, candidate]));
  const assignments = new Map();
  const byDemand = new Map();
  for (const selected of result.assignments) {
    const expected = candidates.get(selected.id);
    if (!expected || expected.demand_id !== selected.demand_id || expected.stand_id !== selected.stand_id ||
        assignments.has(selected.id) || byDemand.has(selected.demand_id)) throw new Error('Solver returned an invalid or duplicate placement');
    assignments.set(selected.id, selected);
    byDemand.set(selected.demand_id, selected);
  }
  const selectedOptions = new Set(result.selected_option_ids);
  if (selectedOptions.size !== result.selected_option_ids.length) throw new Error('Solver returned duplicate options');
  const knownOptions = new Set(request.groups.flatMap(group => group.options.map(option => option.id)));
  for (const id of selectedOptions) if (!knownOptions.has(id)) throw new Error('Solver returned an unknown option');
  const expectedUnassigned = [];
  let covered = 0;
  let movements = 0;
  for (const group of request.groups) {
    const enabled = group.options.filter(option => selectedOptions.has(option.id));
    if (enabled.length > 1 || (hasSolution && group.mandatory && enabled.length !== 1)) throw new Error('Solver violated atomic group selection');
    if (!enabled.length) expectedUnassigned.push(group.id);
    else {
      covered += group.flight_count;
      movements += enabled[0].generated_movements;
    }
    for (const option of group.options) {
      if (option.demand_ids.some(id => byDemand.has(id) !== selectedOptions.has(option.id))) throw new Error('Solver returned a partial visit/tow option');
    }
  }
  if (!hasSolution && (assignments.size || selectedOptions.size)) throw new Error('Solver returned placements without a solution');
  if (JSON.stringify(expectedUnassigned.slice().sort(compareIds)) !== JSON.stringify(result.unassigned_group_ids.slice().sort(compareIds)) ||
      covered !== result.covered_flight_count || movements !== result.generated_movement_count) throw new Error('Solver coverage evidence does not match selected groups');
  for (const conflict of request.conflicts) {
    if (assignments.has(conflict.first_candidate_id) && assignments.has(conflict.second_candidate_id)) throw new Error('Solver violated a compiled candidate conflict');
  }
  const demands = new Map(compiled.demands.map(demand => [demand.id, demand]));
  const selectedOccupancies = [...assignments.values()].map(selected => occupancyFor(demands.get(selected.demand_id), selected.stand_id));
  const findings = evaluatePlan(compileAirport(airport), selectedOccupancies);
  if (findings.length) throw new Error(`Independent stand validation failed: ${JSON.stringify(findings)}`);
  const assignedMovements = [...selectedOptions].flatMap(option => compiled.movements_by_option.get(option) ?? []).map(movement => ({
    ...movement,
    origin_stand_id: byDemand.get(movement.from_demand_id).stand_id,
    destination_stand_id: byDemand.get(movement.to_demand_id).stand_id,
  }));
  return {
    ...result,
    disposition: !hasSolution ? 'no-solution' : expectedUnassigned.length ? 'partial-assignment' : 'stand-rules-validated',
    assignments: [...assignments.values()].map(selected => ({ ...selected, demand: demands.get(selected.demand_id) })),
    generated_movements: assignedMovements,
    stand_validation: { passed: hasSolution, findings },
    excluded_segment_ids: compiled.excluded_segment_ids,
    request_fingerprint: hash(request),
  };
}

export function solveAirport(demand, airport, options, profile) {
  const preparation = prepareTows(demand, airport, options, profile);
  const variants = {};
  for (const variant of ['baseline', 'tow-options']) {
    const compiled = compileAssignmentRequest(preparation, airport, variant, options.timeLimitSeconds);
    const result = validateAssignmentResult(compiled, runAssignmentRequest(compiled), airport);
    variants[variant] = {
      ...result, request: compiled.request, candidate_evidence: compiled.candidate_evidence, conflict_evidence: compiled.conflict_evidence,
    };
  }
  return {
    schema_version: '1.0.0', airport_id: preparation.airport_id, demand_id: preparation.demand_id,
    preparation, variants, operationally_ready: false,
    limitations: [
      'Only fully fixed occupancy segments are executable. Flexible/open segments and blocked sources remain unresolved.',
      'Authored static and conditional stand rules are enforced on continuous occupancy; shared gate service resources are not yet modeled.',
      'Tow endpoints and timing are assigned, but towing crews, routes, travel feasibility and gate/bus resources are not validated.',
      'Tow options are admitted by the preparation profile, not discovered by an integrated tow-time optimizer.',
      'Coverage maximizes represented flight legs, then minimizes additional movements; scores are not complete-day KPIs.',
    ],
  };
}
