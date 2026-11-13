import { linkDemand } from './visit-linker.mjs';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fixed = (event, sourceLegId, time) => ({ kind: 'fixed', event, source_leg_id: sourceLegId, time });
const unknown = () => ({ kind: 'unknown' });
const off = movement => Date.parse(movement.scheduled_off_block);
const on = movement => Date.parse(movement.scheduled_on_block);
const boundaryKey = boundary => boundary.kind === 'unknown' ? 'unknown'
  : `${boundary.event}:${boundary.tow_requirement_id ?? boundary.source_leg_id}`;
const movementOrder = (a, b) => off(a) - off(b) || compare(a.source_leg_id, b.source_leg_id);

export function deriveOccupancy(demand, airport, options) {
  const linked = linkDemand(demand, airport, options);
  const segments = [];
  const segmentIds = new Set();
  const findings = linked.findings.map(finding => ({ ...structuredClone(finding), segment_ids: [] }));
  const blocked = new Set([
    ...linked.unresolved_connection_leg_ids,
    ...linked.findings.filter(finding => finding.severity === 'error').flatMap(finding => finding.leg_ids),
    ...linked.ground_movements.filter(movement => movement.status === 'needs-review').map(movement => movement.source_leg_id),
  ]);
  const claimedMovements = new Set();
  const movementsByVisit = new Map();
  for (const movement of linked.ground_movements) {
    if (movement.visit_id === undefined) continue;
    if (!movementsByVisit.has(movement.visit_id)) movementsByVisit.set(movement.visit_id, []);
    movementsByVisit.get(movement.visit_id).push(movement);
    claimedMovements.add(movement.source_leg_id);
  }
  const addSegment = (owner, start, end, standId, arrivalLegId, departureLegId) => {
    if (start.kind === 'fixed' && end.kind === 'fixed') {
      const duration = Date.parse(end.time) - Date.parse(start.time);
      if (duration < 0) throw new Error('Derived occupancy has a negative interval; source reconciliation must be corrected');
      if (duration === 0) return;
    }
    const id = `occupancy:${[boundaryKey(start), boundaryKey(end)].map(encodeURIComponent).join('/')}`;
    if (segmentIds.has(id)) throw new Error(`Duplicate derived occupancy ID: ${id}`);
    segmentIds.add(id);
    const timingStatus = start.kind === 'unknown' || end.kind === 'unknown' ? 'open'
      : start.kind === 'flexible' || end.kind === 'flexible' ? 'flexible' : 'fixed';
    const sourceIds = [...new Set([start.source_leg_id, end.source_leg_id].filter(Boolean))].sort(compare);
    segments.push({
      id, aircraft_registration: owner.aircraft_registration, aircraft_id: owner.aircraft_id,
      ...(owner.visit_id === undefined ? {} : { visit_id: owner.visit_id }),
      ...(standId === undefined ? {} : { stand_id: standId }),
      ...(arrivalLegId === undefined ? {} : { arrival_leg_id: arrivalLegId }),
      ...(departureLegId === undefined ? {} : { departure_leg_id: departureLegId }),
      source_leg_ids: sourceIds, start, end, timing_status: timingStatus,
    });
    if (timingStatus !== 'fixed') {
      findings.push({
        code: timingStatus === 'open' ? 'open-occupancy-boundary' : 'flexible-occupancy-boundary',
        severity: 'warning', leg_ids: sourceIds, segment_ids: [id],
        message: timingStatus === 'open'
          ? 'Parking has an unknown start or end. Resolve initial/final state; no plan-boundary occupancy is assumed.'
          : 'A tow time has a handling bound, not a chosen event time. This is not yet a fixed-window solver interval.',
      });
    }
  };
  const addChain = (owner, chain, visit) => {
    const first = chain[0];
    const last = chain.at(-1);
    addSegment(owner,
      visit?.arrival_window ? fixed('arrival-on-block', visit.arrival_leg_id, visit.arrival_window.start) : unknown(),
      fixed('movement-off-block', first.source_leg_id, first.scheduled_off_block),
      first.origin_stand_id, visit?.arrival_leg_id);
    for (let i = 1; i < chain.length; i++) {
      const previous = chain[i - 1];
      const next = chain[i];
      if (previous.destination_stand_id !== next.origin_stand_id) throw new Error('Reconciled occupancy chain has inconsistent stands');
      addSegment(owner,
        fixed('movement-on-block', previous.source_leg_id, previous.scheduled_on_block),
        fixed('movement-off-block', next.source_leg_id, next.scheduled_off_block),
        previous.destination_stand_id);
    }
    addSegment(owner,
      fixed('movement-on-block', last.source_leg_id, last.scheduled_on_block),
      visit?.departure_window ? fixed('departure-off-block', visit.departure_leg_id, visit.departure_window.end) : unknown(),
      last.destination_stand_id, undefined, visit?.departure_leg_id);
  };
  for (const visit of linked.visits) {
    const chain = (movementsByVisit.get(visit.id) ?? []).slice().sort(movementOrder);
    const lower = visit.arrival_window ? Date.parse(visit.arrival_window.start)
      : Date.parse(visit.departure_window.end) - linked.connection_search_radius_ms;
    const upper = visit.departure_window ? Date.parse(visit.departure_window.end)
      : Date.parse(visit.arrival_window.start) + linked.connection_search_radius_ms;
    const conflicts = linked.ground_movements.filter(movement => movement.status === 'needs-review' &&
      movement.aircraft_registration === visit.aircraft_registration && off(movement) < upper && on(movement) > lower);
    const sourceIds = [
      visit.arrival_leg_id, visit.departure_leg_id, ...chain.map(movement => movement.source_leg_id),
      ...conflicts.map(movement => movement.source_leg_id),
    ].filter(Boolean);
    const uniqueSourceIds = [...new Set(sourceIds)].sort(compare);
    const requirement = linked.tow_requirements.find(item => item.visit_id === visit.id);
    if (uniqueSourceIds.some(id => blocked.has(id)) || chain.some(movement => movement.status !== 'associated') ||
        requirement?.blocked_by_ground_leg_ids?.length) {
      for (const id of uniqueSourceIds) blocked.add(id);
      findings.push({
        code: 'occupancy-visit-blocked', severity: 'error', leg_ids: uniqueSourceIds, segment_ids: [],
        message: 'Conflicting visit or movement sources prevent a reliable occupancy partition; no replacement full-stay segment is invented.',
      });
      continue;
    }
    const owner = { aircraft_registration: visit.aircraft_registration, aircraft_id: visit.aircraft_id, visit_id: visit.id };
    if (chain.length) {
      addChain(owner, chain, visit);
    } else if (visit.arrival_leg_id && visit.departure_leg_id) {
      addSegment(owner,
        fixed('arrival-on-block', visit.arrival_leg_id, visit.arrival_window.start),
        fixed('departure-off-block', visit.departure_leg_id, visit.departure_window.end),
        undefined, visit.arrival_leg_id, visit.departure_leg_id);
    } else {
      if (!requirement) throw new Error(`Single-leg visit ${visit.id} has no movement or provisional tow requirement`);
      if (visit.arrival_leg_id) {
        addSegment(owner,
          fixed('arrival-on-block', visit.arrival_leg_id, visit.arrival_window.start),
          {
            kind: 'flexible', event: 'pending-tow-out', source_leg_id: visit.arrival_leg_id,
            tow_requirement_id: requirement.id, earliest: requirement.earliest_off_block,
          }, undefined, visit.arrival_leg_id);
      } else {
        addSegment(owner, {
          kind: 'flexible', event: 'pending-tow-in', source_leg_id: visit.departure_leg_id,
          tow_requirement_id: requirement.id, latest: requirement.latest_on_block,
        }, fixed('departure-off-block', visit.departure_leg_id, visit.departure_window.end),
        undefined, undefined, visit.departure_leg_id);
      }
    }
  }
  const contextIds = new Set(linked.context_leg_ids);
  const eventsByAircraft = new Map();
  for (const leg of linked.source_legs) {
    if (leg.type === 'ground-movement' || !contextIds.has(leg.id)) continue;
    if (!eventsByAircraft.has(leg.aircraft_registration)) eventsByAircraft.set(leg.aircraft_registration, []);
    eventsByAircraft.get(leg.aircraft_registration).push(Date.parse(leg.scheduled_on_block ?? leg.scheduled_off_block));
  }
  const movementsByAircraft = new Map();
  for (const movement of linked.ground_movements) {
    if (!movementsByAircraft.has(movement.aircraft_registration)) movementsByAircraft.set(movement.aircraft_registration, []);
    movementsByAircraft.get(movement.aircraft_registration).push(movement);
  }
  for (const group of movementsByAircraft.values()) {
    let chain = [];
    const flush = () => {
      if (chain.length) addChain(chain[0], chain);
      chain = [];
    };
    for (const movement of group.slice().sort(movementOrder)) {
      if (claimedMovements.has(movement.source_leg_id) || blocked.has(movement.source_leg_id) || movement.status !== 'standalone') {
        flush();
        continue;
      }
      const previous = chain.at(-1);
      if (previous && (eventsByAircraft.get(movement.aircraft_registration) ?? []).some(time => on(previous) <= time && time <= off(movement))) flush();
      chain.push(movement);
    }
    flush();
  }
  segments.sort((a, b) => compare(a.id, b.id));
  findings.sort((a, b) => compare(a.code, b.code) || compare(a.leg_ids.join('\n'), b.leg_ids.join('\n')) ||
    compare(a.segment_ids.join('\n'), b.segment_ids.join('\n')) || compare(a.message, b.message));
  const unresolvedIds = segments.filter(segment => segment.timing_status !== 'fixed').map(segment => segment.id);
  return {
    schema_version: '1.0.0', airport_id: linked.airport_id, demand_id: linked.demand_id,
    boundary_policy: 'preserve-unknown', plan_window: { ...linked.plan_window }, linked_demand: linked,
    segments, unresolved_segment_ids: unresolvedIds, blocked_source_leg_ids: [...blocked].sort(compare),
    timing_complete: unresolvedIds.length === 0 && blocked.size === 0 && !findings.some(finding => finding.severity === 'error'),
    findings,
  };
}
