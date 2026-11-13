import { evaluatePlan } from './airport-model.mjs';
import { formatUtcInstant, parseUtcInstant } from './demand-model.mjs';

export const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

export function buildStandDemand(occupancy) {
  const sources = new Map(occupancy.linked_demand.source_legs.map(leg => [leg.id, leg]));
  const demands = [];
  const excluded = [];
  for (const segment of occupancy.segments) {
    let start;
    let end;
    if (segment.timing_status === 'fixed') {
      start = segment.start.time;
      end = segment.end.time;
    } else if (segment.timing_status === 'flexible') {
      start = segment.start.kind === 'fixed' ? segment.start.time : segment.start.latest;
      end = segment.end.kind === 'fixed' ? segment.end.time : segment.end.earliest;
    } else {
      excluded.push(segment.id);
      continue;
    }
    const flight = id => {
      const leg = sources.get(id);
      if (!leg) throw new Error(`Missing occupancy source leg: ${id}`);
      return { sectorId: leg.sector_id, operatingAirlineId: leg.operating_airline_id };
    };
    const operators = segment.source_leg_ids.map(id => {
      const leg = sources.get(id);
      if (!leg) throw new Error(`Missing occupancy source leg: ${id}`);
      return leg.operating_airline_id;
    });
    demands.push({
      id: segment.id, aircraft_id: segment.aircraft_id, aircraft_registration: segment.aircraft_registration,
      ...(segment.visit_id === undefined ? {} : { visit_id: segment.visit_id }),
      ...(segment.stand_id === undefined ? {} : { stand_id: segment.stand_id }),
      ...(segment.arrival_leg_id ? { arrival: flight(segment.arrival_leg_id) } : {}),
      ...(segment.departure_leg_id ? { departure: flight(segment.departure_leg_id) } : {}),
      operating_airline_ids: [...new Set(operators)].sort(compareIds),
      start, end, role: segment.arrival_leg_id || segment.departure_leg_id ? 'service' : 'parking',
      timing_basis: segment.timing_status === 'fixed' ? 'fixed' : 'minimum-service',
      stand_kind: 'any', source_segment_id: segment.id,
    });
  }
  return { demands: demands.sort((a, b) => compareIds(a.id, b.id)), excluded_segment_ids: excluded.sort(compareIds) };
}

export function standCandidates(model, demand) {
  const start = parseUtcInstant(demand.start);
  const end = parseUtcInstant(demand.end);
  if (end <= start) throw new Error(`Invalid stand-demand window: ${demand.id}`);
  if (typeof demand.id !== 'string' || !/^\S+$/.test(demand.id)) throw new Error('Stand demand requires a non-whitespace ID');
  if (demand.stand_kind !== 'any' && demand.stand_kind !== 'non-contact') throw new Error(`Invalid stand kind: ${demand.stand_kind}`);
  if (!Array.isArray(demand.operating_airline_ids) || !demand.operating_airline_ids.length) throw new Error(`Stand demand requires operating airlines: ${demand.id}`);
  if (!model.aircraft.has(demand.aircraft_id)) throw new Error(`Unknown stand-demand aircraft: ${demand.aircraft_id}`);
  if (demand.operating_airline_ids.some(id => !model.airlines.has(id))) throw new Error(`Unknown stand-demand operating airline: ${demand.id}`);
  if (demand.stand_id !== undefined && !model.stands.has(demand.stand_id)) throw new Error(`Unknown fixed stand: ${demand.stand_id}`);
  const candidates = [];
  const excluded = [];
  for (const stand of [...model.stands.values()].sort((a, b) => compareIds(a.id, b.id))) {
    const reasons = [];
    if (demand.stand_id !== undefined && stand.id !== demand.stand_id) reasons.push('fixed-to-another-stand');
    if (demand.stand_kind === 'non-contact' && stand.contact !== false) reasons.push('requires-non-contact-parking');
    if (stand.configuration_status !== 'ready') reasons.push('stand-not-ready');
    else {
      const findings = evaluatePlan(model, [{
        id: demand.id, standId: stand.id, aircraftId: demand.aircraft_id,
        start, end, operatingAirlineIds: demand.operating_airline_ids,
        ...(demand.arrival === undefined ? {} : { arrival: demand.arrival }),
        ...(demand.departure === undefined ? {} : { departure: demand.departure }),
      }]);
      reasons.push(...findings.map(finding => finding.code));
    }
    if (reasons.length) excluded.push({ stand_id: stand.id, reasons: [...new Set(reasons)].sort(compareIds) });
    else candidates.push(stand.id);
  }
  return { candidate_stand_ids: candidates, excluded_stands: excluded };
}

const scarcityOrder = (a, b) => a.candidate_stand_ids.length - b.candidate_stand_ids.length ||
  (b.end - b.start) - (a.end - a.start) || compareIds(a.id, b.id);

function matchSlice(active) {
  const owners = new Map();
  const byId = new Map(active.map(demand => [demand.id, demand]));
  const popularity = new Map();
  for (const demand of active) for (const stand of demand.candidate_stand_ids) popularity.set(stand, (popularity.get(stand) ?? 0) + 1);
  const choices = new Map(active.map(demand => [demand.id, demand.candidate_stand_ids.slice().sort((a, b) =>
    popularity.get(a) - popularity.get(b) || compareIds(a, b))]));
  const place = (demand, seen) => {
    for (const stand of choices.get(demand.id)) {
      if (seen.has(stand)) continue;
      seen.add(stand);
      if (!owners.has(stand) || place(byId.get(owners.get(stand)), seen)) {
        owners.set(stand, demand.id);
        return true;
      }
    }
    return false;
  };
  for (const demand of active.slice().sort(scarcityOrder)) place(demand, new Set());
  const matched = new Set(owners.values());
  const unmatched = active.filter(demand => !matched.has(demand.id)).map(demand => demand.id).sort(compareIds);
  const poolDemands = new Set(unmatched);
  const poolStands = new Set();
  const pending = unmatched.slice();
  for (let index = 0; index < pending.length; index++) {
    for (const stand of choices.get(pending[index])) {
      poolStands.add(stand);
      const owner = owners.get(stand);
      if (owner !== undefined && !poolDemands.has(owner)) {
        poolDemands.add(owner);
        pending.push(owner);
      }
    }
  }
  return {
    matched_count: owners.size, unmatched_demand_ids: unmatched,
    constrained_pool_demand_ids: [...poolDemands].sort(compareIds),
    constrained_pool_stand_ids: [...poolStands].sort(compareIds),
  };
}

export function analyzeStandPressure(model, demands, planWindow) {
  const start = parseUtcInstant(planWindow.start);
  const end = parseUtcInstant(planWindow.end);
  if (end <= start) throw new Error('Pressure analysis requires a positive plan window');
  const ids = new Set();
  const evaluated = demands.map(demand => {
    if (ids.has(demand.id)) throw new Error(`Duplicate stand-demand ID: ${demand.id}`);
    ids.add(demand.id);
    return { ...demand, ...standCandidates(model, demand) };
  }).sort((a, b) => compareIds(a.id, b.id));
  const intervals = evaluated.map(demand => ({
    ...demand, start: parseUtcInstant(demand.start), end: parseUtcInstant(demand.end),
  })).filter(demand => overlaps(demand, { start, end }));
  const events = [...new Set([start, end, ...intervals.flatMap(demand => [Math.max(start, demand.start), Math.min(end, demand.end)])])].sort((a, b) => a - b);
  const pressure = [];
  let total = 0;
  for (let index = 1; index < events.length; index++) {
    const left = events[index - 1];
    const right = events[index];
    const active = intervals.filter(demand => demand.start <= left && demand.end >= right);
    if (!active.length) continue;
    const matching = matchSlice(active);
    const shortfall = active.length - matching.matched_count;
    if (!shortfall) continue;
    total += shortfall * (right - left);
    if (!Number.isSafeInteger(total)) throw new Error('Stand-pressure shortfall exceeds safe millisecond precision');
    pressure.push({
      start: formatUtcInstant(left), end: formatUtcInstant(right),
      active_demand_ids: active.map(demand => demand.id).sort(compareIds),
      shortfall, ...matching,
    });
  }
  return {
    method: 'event-sliced-bipartite-relaxation',
    total_shortfall_ms: total, shortfall_minutes: total / 60_000,
    demands: evaluated,
    scarcity_order: intervals.slice().sort(scarcityOrder).map(demand => demand.id),
    pressure_slices: pressure,
    limitations: [
      'Static eligibility includes aircraft, operators, flight sectors, configured closures and pinned stand constraints.',
      'Conditional neighboring-stand rules, gate sharing, tow resources and routes are not enforced by this relaxation.',
      'Independent time-slice matching does not prove a continuous stand assignment across slices.',
      'Minimum-service rows are lower bounds, not chosen tow times. Unknown parking and blocked demand are excluded.',
    ],
  };
}
