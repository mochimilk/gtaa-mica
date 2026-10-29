import { compileAirport, evaluatePlan } from './airport-model.mjs';
import { sourceOccupancies, fingerprint } from './capacity-probe.mjs';
import { linkDemand } from './visit-linker.mjs';
import { standCandidates, compareIds } from './stand-pressure.mjs';
import { calculateOneWayTowRange } from '../src/overlays/tow-window-ranges.mjs';

export function assessOneWayTow(model, fixed, source, arrivalMinutes, departureMinutes) {
  if (!fixed.includes(source) || evaluatePlan(model, fixed).length || !source.arrival || !source.departure ||
      !Number.isFinite(arrivalMinutes) || arrivalMinutes <= 0 || !Number.isFinite(departureMinutes) || departureMinutes <= 0) {
    throw new Error('One-way tow assessment requires a fixed complete visit and positive handling policies.');
  }
  const range = calculateOneWayTowRange(source.start + arrivalMinutes * 60_000,
    source.end - departureMinutes * 60_000, model.defaultTowMinutes);
  if (!range) return { destinations: [], exclusions: [] };
  const travel = model.defaultTowMinutes * 60_000;
  const remaining = fixed.filter(item => item !== source);
  const target = { ...source, id: `${source.id}/tow-destination`, arrival: undefined, start: range[0] + travel };
  if (fixed.some(item => item.id === target.id)) throw new Error('Tow destination identity collides with the source plan.');
  const eligibility = standCandidates(model, {
    id: target.id, aircraft_id: target.aircraftId, operating_airline_ids: target.operatingAirlineIds,
    departure: target.departure, start: new Date(target.start).toISOString(), end: new Date(target.end).toISOString(), stand_kind: 'any',
  });
  const destinations = [];
  const exclusions = eligibility.excluded_stands.filter(item => item.stand_id !== source.standId)
    .map(item => ({ ...item, assignment_ids: [], rule_paths: [] }));
  for (const standId of eligibility.candidate_stand_ids) {
    if (standId === source.standId) continue;
    const destination = { ...target, standId };
    let earliest = range[0];
    const blockers = [];
    // The destination is a suffix ending at departure. It must start after every conflicting occupancy.
    for (const existing of remaining) {
      if (destination.start >= existing.end || existing.start >= destination.end) continue;
      const findings = evaluatePlan(model, [destination, existing]);
      if (!findings.length) continue;
      earliest = Math.max(earliest, existing.end - travel);
      blockers.push({
        assignment_id: existing.id, release: existing.end,
        reasons: [...new Set(findings.map(item => item.code))].sort(compareIds),
        rule_paths: [...new Set(findings.flatMap(item => item.rulePath ? [item.rulePath] : []))].sort(compareIds),
      });
    }
    if (earliest > range[1]) {
      exclusions.push({
        stand_id: standId, assignment_ids: blockers.map(item => item.assignment_id).sort(compareIds),
        reasons: [...new Set(blockers.flatMap(item => item.reasons))].sort(compareIds),
        rule_paths: [...new Set(blockers.flatMap(item => item.rule_paths))].sort(compareIds),
      });
      continue;
    }
    for (const start of new Set([earliest, range[1]])) {
      const proposed = [...remaining, { ...source, end: start, departure: undefined }, { ...destination, start: start + travel }];
      const findings = evaluatePlan(model, proposed);
      if (findings.length) throw new Error(`One-way tow failed independent full-plan validation: ${JSON.stringify(findings)}`);
    }
    destinations.push({ stand_id: standId, earliest_start: earliest, latest_start: range[1], blockers });
  }
  return {
    destinations: destinations.sort((a, b) => compareIds(a.stand_id, b.stand_id)),
    exclusions: exclusions.sort((a, b) => compareIds(a.stand_id, b.stand_id)),
  };
}

export function prepareTowWindows(snapshot, raw, airport) {
  const model = compileAirport(airport), fixed = sourceOccupancies(snapshot, raw);
  const stands = new Set(airport.stands.stands.map(stand => stand.id));
  if (snapshot.airport?.id !== airport.airport.id || raw.airport_id !== airport.airport.id ||
      snapshot.rows.length !== stands.size || new Set(snapshot.rows.map(row => row.id)).size !== stands.size ||
      snapshot.rows.some(row => !stands.has(row.id))) {
    throw new Error('Tow-window airport/stand identity does not match the selected schedule.');
  }
  if (!Number.isFinite(model.defaultTowMinutes) || model.defaultTowMinutes <= 0) throw new Error('Tow windows require configured travel policy.');
  for (const occupancies of Object.values(fixed)) if (evaluatePlan(model, occupancies).length) throw new Error('Invalid source plan for tow windows.');
  const linked = linkDemand(raw, airport, { planStart: snapshot.plan_window.start, planEnd: snapshot.plan_window.end });
  if (linked.findings.some(item => item.severity === 'error')) throw new Error('Tow windows cannot use ambiguous or conflicting linked demand.');
  const visits = snapshot.visits.map(source => {
    const visit = linked.visits.find(item => item.id === source.turnId);
    if (!visit || visit.status !== 'connected' || !visit.arrival_window || !visit.departure_window) {
      throw new Error(`Prepared tow-window display requires complete, known flight boundaries: ${source.turnId}`);
    }
    const variants = Object.fromEntries(Object.entries(snapshot.variants).map(([variant, plan]) => {
      const stays = plan.stays.filter(stay => stay.visitId === source.turnId);
      const stay = stays.length === 1 && !stays[0].towIn && !stays[0].towOut &&
        stays[0].arrivalFlightId && stays[0].departureFlightId ? stays[0] : null;
      const occupancy = stay ? fixed[variant].find(item => item.id === stay.id) : null;
      return [variant, {
        source_stay_id: stay?.id ?? null,
        ...(occupancy ? assessOneWayTow(model, fixed[variant], occupancy,
          visit.arrival_window.minimum_minutes, visit.departure_window.minimum_minutes) : { destinations: [], exclusions: [] }),
      }];
    }));
    return {
      visit_id: visit.id, arrival_flight_id: visit.arrival_leg_id, departure_flight_id: visit.departure_leg_id,
      arrival_handling_minutes: visit.arrival_window.minimum_minutes, departure_handling_minutes: visit.departure_window.minimum_minutes,
      variants,
    };
  });
  return {
    schema_version: '3.0.0', source: 'synthetic', movement_kind: 'one-way-relocation', stand_validation_passed: true,
    airport: { id: airport.airport.id, name: airport.airport.name },
    case_id: snapshot.case_id, demand_id: snapshot.demand_id, plan_window: { ...snapshot.plan_window },
    variants: Object.fromEntries(Object.entries(snapshot.variants).map(([id, plan]) => [id, { request_fingerprint: plan.request_fingerprint }])),
    snapshot_fingerprint: fingerprint(snapshot), airport_fingerprint: fingerprint(airport), demand_fingerprint: fingerprint(raw),
    default_tow_minutes: model.defaultTowMinutes, visits,
  };
}
