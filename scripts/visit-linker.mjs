import { compileAirport, getMinimumLegWindow } from './airport-model.mjs';
import { formatUtcInstant as timestamp, parseUtcInstant, validateDemand } from './demand-model.mjs';
import { normalizeGroundMovement, reconcileGroundMovements } from './movement-model.mjs';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const derivedId = (kind, ids) => `${kind}:${ids.map(encodeURIComponent).join('/')}`;
const flightTime = leg => Date.parse(leg.type === 'arrival' ? leg.scheduled_on_block : leg.scheduled_off_block);
const contains = (start, end, time) => start <= time && time < end;

function bound(entries, time, afterEqual = false) {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].time < time || (afterEqual && entries[middle].time === time)) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function linkDemand(demand, airport, options) {
  if (!options || typeof options !== 'object') throw new Error('An explicit planStart and planEnd are required for linking');
  const start = parseUtcInstant(options.planStart);
  const end = parseUtcInstant(options.planEnd);
  if (end <= start) throw new Error('Plan end must be later than plan start');
  const radius = end - start;
  const contextStart = start - radius;
  const contextEnd = end + radius;
  const contextWindow = { start: timestamp(contextStart), end: timestamp(contextEnd) };
  const validation = validateDemand(demand, airport);
  if (validation.errors.length) throw new Error(`Cannot link invalid demand:\n${validation.errors.join('\n')}`);
  const model = compileAirport(airport);
  const normalized = new Map(demand.legs.filter(leg => leg.type === 'ground-movement')
    .map(leg => [leg.id, normalizeGroundMovement(leg, model)]));
  const findings = validation.warnings.map(message => ({ code: 'airport-warning', severity: 'warning', leg_ids: [], message }));
  const visits = [];
  const towRequirements = [];
  const unresolved = new Set();
  const contextIds = [];
  const groundIds = [];
  const aircraft = new Map();
  const groupFor = registration => {
    if (!aircraft.has(registration)) aircraft.set(registration, { flights: [], movements: [] });
    return aircraft.get(registration);
  };
  for (const leg of demand.legs) {
    if (leg.type === 'ground-movement') {
      const movement = normalized.get(leg.id);
      const off = Date.parse(movement.scheduled_off_block);
      const on = Date.parse(movement.scheduled_on_block);
      if (off >= contextEnd || on < contextStart) continue;
      groupFor(leg.aircraft_registration).movements.push(movement);
      groundIds.push(leg.id);
    } else {
      const time = flightTime(leg);
      if (!contains(contextStart, contextEnd, time)) continue;
      groupFor(leg.aircraft_registration).flights.push({ leg, time });
    }
    contextIds.push(leg.id);
  }
  const handling = leg => {
    const window = getMinimumLegWindow(model, leg.aircraft_id, leg.type, flightTime(leg));
    return { start: timestamp(window.start), end: timestamp(window.end), minimum_minutes: window.minimumMinutes };
  };
  const addVisit = (arrival, departure, movements) => {
    if (arrival && departure) {
      if (flightTime(arrival) >= end || flightTime(departure) < start) return;
    } else if (!contains(start, end, flightTime(arrival ?? departure))) {
      const time = flightTime(arrival ?? departure);
      const lower = arrival ? time : time - radius;
      const upper = departure ? time : time + radius;
      if (!movements.some(movement => {
        const off = Date.parse(movement.scheduled_off_block);
        const on = Date.parse(movement.scheduled_on_block);
        return off < end && on > start && off < upper && on > lower;
      })) return;
    }
    const source = arrival ?? departure;
    const sourceIds = [arrival, departure].filter(Boolean).map(leg => leg.id);
    const visit = {
      id: derivedId('visit', sourceIds),
      aircraft_registration: source.aircraft_registration,
      aircraft_id: source.aircraft_id,
      status: arrival && departure ? 'connected' : arrival ? 'arrival-only' : 'departure-only',
      ...(arrival ? { arrival_leg_id: arrival.id, arrival_window: handling(arrival) } : {}),
      ...(departure ? { departure_leg_id: departure.id, departure_window: handling(departure) } : {}),
    };
    visits.push(visit);
    if (arrival && departure) return;
    const type = arrival ? 'tow-out' : 'tow-in';
    towRequirements.push({
      id: derivedId(type, sourceIds), visit_id: visit.id, source_leg_id: source.id,
      type, status: 'provisional', reason: 'no-connection-within-plan-duration',
      ...(arrival ? { earliest_off_block: visit.arrival_window.end } : { latest_on_block: visit.departure_window.start }),
    });
  };
  for (const [registration, group] of [...aircraft].sort(([a], [b]) => compare(a, b))) {
    const flights = group.flights.sort((a, b) => a.time - b.time || compare(a.leg.id, b.leg.id));
    const paired = new Set();
    const reportAmbiguity = (code, entries) => {
      const ids = [...new Set(entries.map(entry => entry.leg.id))].sort(compare);
      for (const id of ids) unresolved.add(id);
      findings.push({
        code, severity: 'error', leg_ids: ids,
        message: `Aircraft ${registration} has an ambiguous flight sequence; no arbitrary connection or tow is derived for these legs.`,
      });
    };
    for (let i = 0; i < flights.length;) {
      let next = i + 1;
      while (next < flights.length && flights[next].time === flights[i].time) next++;
      if (next - i > 1) reportAmbiguity('simultaneous-flight-events', flights.slice(i, next));
      i = next;
    }
    const runs = [];
    for (const entry of flights) {
      const last = runs.at(-1);
      if (last?.[0].leg.type === entry.leg.type) last.push(entry);
      else runs.push([entry]);
    }
    for (let i = 0; i + 1 < runs.length; i++) {
      const arrivals = runs[i];
      const departures = runs[i + 1];
      if (arrivals[0].leg.type !== 'arrival') continue;
      const departureRanges = departures.map(entry => [
        bound(arrivals, entry.time - radius), bound(arrivals, entry.time),
      ]);
      const ambiguous = [];
      for (const arrival of arrivals) {
        const first = bound(departures, arrival.time, true);
        const last = bound(departures, arrival.time + radius, true);
        if (last === first) continue;
        const departure = departures[first];
        const [from, to] = departureRanges[first];
        if (last - first === 1 && to - from === 1 && !unresolved.has(arrival.leg.id) && !unresolved.has(departure.leg.id)) {
          paired.add(arrival.leg.id);
          paired.add(departure.leg.id);
          addVisit(arrival.leg, departure.leg, group.movements);
        } else ambiguous.push(arrival);
      }
      for (let j = 0; j < departures.length; j++) {
        if (departureRanges[j][1] > departureRanges[j][0] && !paired.has(departures[j].leg.id)) ambiguous.push(departures[j]);
      }
      if (ambiguous.length) reportAmbiguity('ambiguous-connection', ambiguous);
    }
    for (const run of runs) {
      let pending = [];
      const flush = () => {
        if (pending.length > 1) reportAmbiguity('repeated-unmatched-flight-events', pending);
        pending = [];
      };
      for (const entry of run) {
        if (paired.has(entry.leg.id) || unresolved.has(entry.leg.id)) {
          flush();
          continue;
        }
        if (pending.length && entry.time - pending.at(-1).time > radius) flush();
        pending.push(entry);
      }
      flush();
    }
    for (const entry of flights) {
      if (!paired.has(entry.leg.id) && !unresolved.has(entry.leg.id)) {
        addVisit(entry.leg.type === 'arrival' ? entry.leg : undefined, entry.leg.type === 'departure' ? entry.leg : undefined, group.movements);
      }
    }
  }
  const reconciled = reconcileGroundMovements({
    visits, requirements: towRequirements, movements: groundIds.map(id => normalized.get(id)),
    flights: [...aircraft.values()].flatMap(group => group.flights.map(entry => entry.leg)),
    unresolvedLegIds: unresolved, radius,
  });
  findings.push(...reconciled.findings);
  for (const requirement of reconciled.requirements) {
    findings.push({
      code: 'provisional-tow-requirement', severity: 'warning', leg_ids: [requirement.source_leg_id],
      message: requirement.blocked_by_ground_leg_ids
        ? 'A provisional tow requirement remains blocked by conflicting or ambiguous ground legs; review findings before creating another movement.'
        : `No connection found within ${radius} milliseconds. Surrounding feed completeness is unconfirmed; ${requirement.type} remains provisional.`,
    });
  }
  const byId = (a, b) => compare(a.id, b.id);
  findings.sort((a, b) => compare(a.code, b.code) || compare(a.leg_ids.join('\n'), b.leg_ids.join('\n')) || compare(a.message, b.message));
  return {
    schema_version: '2.0.0', airport_id: demand.airport_id, demand_id: demand.id, synthetic: demand.synthetic,
    plan_window: { start: timestamp(start), end: timestamp(end) },
    connection_search_radius_ms: radius, context_window: contextWindow,
    source_legs: structuredClone(demand.legs).sort(byId), context_leg_ids: contextIds.sort(compare),
    visits: visits.sort(byId), tow_requirements: reconciled.requirements.sort(byId),
    ground_movement_leg_ids: groundIds.sort(compare),
    ground_movements: reconciled.movements, movement_matches: reconciled.matches,
    unresolved_connection_leg_ids: [...unresolved].sort(compare), findings,
  };
}
