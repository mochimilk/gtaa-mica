import { formatUtcInstant, parseUtcInstant } from './demand-model.mjs';

const offTime = movement => Date.parse(movement.scheduled_off_block);
const onTime = movement => Date.parse(movement.scheduled_on_block);
const byMovement = (a, b) => offTime(a) - offTime(b) || (a.source_leg_id < b.source_leg_id ? -1 : a.source_leg_id > b.source_leg_id ? 1 : 0);

export function normalizeGroundMovement(leg, model) {
  if (leg.type !== 'ground-movement') throw new Error('Ground normalization requires a ground-movement leg');
  const hasOff = leg.scheduled_off_block !== undefined;
  const hasOn = leg.scheduled_on_block !== undefined;
  if (!hasOff && !hasOn) throw new Error(`Ground movement ${leg.id} has no time anchor`);
  let off = hasOff ? parseUtcInstant(leg.scheduled_off_block) : undefined;
  let on = hasOn ? parseUtcInstant(leg.scheduled_on_block) : undefined;
  if (!hasOff || !hasOn) {
    const duration = model.defaultTowMinutes * 60_000;
    if (!Number.isSafeInteger(duration) || duration <= 0) throw new Error(`Default tow duration policy is not configured with safe positive minutes for ${leg.id}`);
    if (!hasOff) off = on - duration;
    if (!hasOn) on = off + duration;
  }
  if (on <= off) throw new Error(`Ground movement ${leg.id} must have positive duration`);
  return {
    source_leg_id: leg.id, aircraft_registration: leg.aircraft_registration, aircraft_id: leg.aircraft_id,
    origin_stand_id: leg.origin_stand_id, destination_stand_id: leg.destination_stand_id,
    scheduled_off_block: hasOff ? leg.scheduled_off_block : formatUtcInstant(off),
    scheduled_on_block: hasOn ? leg.scheduled_on_block : formatUtcInstant(on),
    timing_source: hasOff && hasOn ? 'supplied' : hasOff ? 'inferred-on-block' : 'inferred-off-block',
    ...(!hasOff || !hasOn ? { inferred_duration_minutes: model.defaultTowMinutes } : {}),
  };
}

export function reconcileGroundMovements({ visits, requirements, movements, flights, unresolvedLegIds, radius }) {
  const result = movements.map(movement => ({ ...movement, status: 'standalone' }));
  const findings = [];
  const matches = [];
  const affected = new Map();
  const groups = new Map();
  const groupFor = registration => {
    if (!groups.has(registration)) groups.set(registration, { movements: [], visits: [], flights: [], unresolved: [] });
    return groups.get(registration);
  };
  for (const movement of result) groupFor(movement.aircraft_registration).movements.push(movement);
  for (const visit of visits) groupFor(visit.aircraft_registration).visits.push(visit);
  for (const leg of flights) {
    const group = groupFor(leg.aircraft_registration);
    group.flights.push({ leg, time: Date.parse(leg.scheduled_on_block ?? leg.scheduled_off_block) });
    if (unresolvedLegIds.has(leg.id)) group.unresolved.push(leg.id);
  }
  const affect = (visit, movement) => {
    if (!affected.has(visit.id)) affected.set(visit.id, new Set());
    affected.get(visit.id).add(movement.source_leg_id);
  };
  const issue = (code, items, legIds, message) => {
    for (const movement of items) movement.status = 'needs-review';
    findings.push({
      code, severity: 'error',
      leg_ids: [...new Set([...items.map(movement => movement.source_leg_id), ...legIds])].sort(), message,
    });
  };
  for (const group of groups.values()) {
    group.movements.sort(byMovement);
    group.flights.sort((a, b) => a.time - b.time || (a.leg.id < b.leg.id ? -1 : a.leg.id > b.leg.id ? 1 : 0));
    let eventIndex = 0;
    let previous;
    let cluster = [];
    let clusterEnd = -Infinity;
    const closeCluster = () => {
      if (cluster.length > 1) issue('overlapping-ground-movements', cluster, [], 'The same aircraft has overlapping ground movements; no interval is silently shifted.');
      cluster = [];
      clusterEnd = -Infinity;
    };
    for (const movement of group.movements) {
      const off = offTime(movement);
      const on = onTime(movement);
      if (off >= clusterEnd) closeCluster();
      cluster.push(movement);
      clusterEnd = Math.max(clusterEnd, on);
      while (eventIndex < group.flights.length && group.flights[eventIndex].time <= off) eventIndex++;
      const lastFlight = group.flights[eventIndex - 1];
      const nextFlight = group.flights[eventIndex];
      const crossing = [lastFlight, nextFlight].filter(event => event && off <= event.time && event.time <= on);
      if (crossing.length) {
        issue('ground-movement-crosses-flight-event', [movement], crossing.map(event => event.leg.id), 'A ground interval includes a flight block event; review chronology and missing feed context.');
      } else if (lastFlight?.leg.type === 'departure') {
        issue('ground-movement-after-flight-departure', [movement], [lastFlight.leg.id], 'The last supplied flight event is a departure; an intervening arrival or corrected ground timing is needed.');
      }
      if (previous && onTime(previous) <= off && previous.destination_stand_id !== movement.origin_stand_id &&
          (!lastFlight || lastFlight.time < onTime(previous))) {
        issue('ground-stand-discontinuity', [previous, movement], [], 'Sequential ground endpoints do not join and no supplied flight separates them; review missing movements or feed context.');
      }
      previous = movement;
      const candidates = [];
      const overlapping = [];
      for (const visit of group.visits) {
        const lower = visit.arrival_window ? Date.parse(visit.arrival_window.start) : Date.parse(visit.departure_window.end) - radius;
        const upper = visit.departure_window ? Date.parse(visit.departure_window.end) : Date.parse(visit.arrival_window.start) + radius;
        if (lower <= off && on <= upper) candidates.push(visit);
        if (off < upper && on > lower) overlapping.push(visit);
      }
      if (group.unresolved.length) {
        for (const visit of [...candidates, ...overlapping]) affect(visit, movement);
        issue('ambiguous-movement-visit', [movement], group.unresolved, 'This aircraft has unresolved flight connections; no ground-to-visit association is guessed.');
      } else if (candidates.length === 1) {
        movement.visit_id = candidates[0].id;
        if (movement.status !== 'needs-review') movement.status = 'associated';
        affect(candidates[0], movement);
      } else if (candidates.length > 1 || overlapping.length) {
        const related = [...new Set([...candidates, ...overlapping])];
        for (const visit of related) affect(visit, movement);
        issue('movement-outside-or-ambiguous-visit', [movement], related.flatMap(visit =>
          [visit.arrival_leg_id, visit.departure_leg_id].filter(Boolean)), 'The movement cannot fit exactly one visit window; no visit is selected or time corrected.');
      }
    }
    closeCluster();
    for (const visit of group.visits) {
      const chain = group.movements.filter(movement => movement.visit_id === visit.id);
      if (!chain.length) continue;
      if (visit.arrival_window && offTime(chain[0]) < Date.parse(visit.arrival_window.end)) {
        issue('arrival-handling-conflict', chain, [visit.arrival_leg_id], 'Tow-out off-block is before the minimum arrival handling window ends.');
      }
      if (visit.departure_window && chain.some(movement => onTime(movement) > Date.parse(visit.departure_window.start))) {
        issue('departure-handling-conflict', chain, [visit.departure_leg_id], 'Tow-in on-block is after the minimum departure handling window begins.');
      }
      if (chain.some(movement => movement.status === 'needs-review')) {
        for (const movement of chain) movement.status = 'needs-review';
      }
    }
  }
  const outstanding = [];
  for (const requirement of requirements) {
    const relevant = result.filter(movement => affected.get(requirement.visit_id)?.has(movement.source_leg_id));
    const associated = relevant.filter(movement => movement.visit_id === requirement.visit_id).sort(byMovement);
    if (associated.length && relevant.every(movement => movement.status === 'associated')) {
      matches.push({
        visit_id: requirement.visit_id, source_leg_id: requirement.source_leg_id, type: requirement.type,
        movement_leg_id: (requirement.type === 'tow-out' ? associated[0] : associated.at(-1)).source_leg_id,
      });
    } else if (relevant.length) {
      outstanding.push({ ...requirement, blocked_by_ground_leg_ids: relevant.map(movement => movement.source_leg_id).sort() });
    } else outstanding.push(requirement);
  }
  return {
    movements: result.sort((a, b) => a.source_leg_id < b.source_leg_id ? -1 : a.source_leg_id > b.source_leg_id ? 1 : 0),
    matches: matches.sort((a, b) => a.visit_id < b.visit_id ? -1 : a.visit_id > b.visit_id ? 1 : 0),
    requirements: outstanding, findings,
  };
}
