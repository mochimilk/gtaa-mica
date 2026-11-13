import { compareIds, standCandidates } from './stand-pressure.mjs';

function allocate(count, rows) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Traffic allocation requires positive eligible stand/airline weights');
  const quotas = rows.map(row => {
    const exact = count * row.weight / total;
    return { id: row.id, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = count - quotas.reduce((sum, row) => sum + row.count, 0);
  quotas.sort((a, b) => b.remainder - a.remainder || compareIds(a.id, b.id));
  for (const row of quotas) {
    if (remaining-- > 0) row.count++;
  }
  return new Map(quotas.map(row => [row.id, row.count]));
}

export function allocateTraffic(profile, airport, model) {
  const targets = new Map();
  for (const target of profile.traffic_targets ?? []) {
    if (targets.has(target.id)) throw new Error(`Duplicate traffic target: ${target.id}`);
    if (target.sector_id === 'domestic' && target.market_id !== undefined) throw new Error('Domestic traffic target cannot select an international market');
    targets.set(target.id, target);
  }
  const rows = profile.traffic_mix.map(row => ({ ...row }));
  const allocation = [];
  const membership = new Map(airport.airlineGroups.groups.flatMap(group => group.airlines.map(id => [id, group.id])));
  for (const row of rows) {
    if (row.target_id === undefined) continue;
    const target = targets.get(row.target_id);
    if (!target) throw new Error(`Unknown traffic target: ${row.target_id}`);
    if (row.arrival_sector_id !== target.sector_id || row.departure_sector_id !== target.sector_id) {
      throw new Error(`Traffic target sector does not match row: ${row.id}`);
    }
  }
  for (const target of [...targets.values()].sort((a, b) => compareIds(a.id, b.id))) {
    const members = rows.filter(row => row.target_id === target.id);
    if (!members.length) throw new Error(`Traffic target has no airline rows: ${target.id}`);
    const groups = new Map();
    const standGroups = new Map();
    for (const row of members) {
      const groupId = membership.get(row.operating_airline_id);
      if (!groupId) throw new Error(`Weighted traffic airline has no planning group: ${row.operating_airline_id}`);
      const candidates = standCandidates(model, {
        id: row.id, aircraft_id: row.aircraft_id, operating_airline_ids: [row.operating_airline_id],
        arrival: { sectorId: row.arrival_sector_id, operatingAirlineId: row.operating_airline_id },
        departure: { sectorId: row.departure_sector_id, operatingAirlineId: row.operating_airline_id },
        start: profile.plan_window.start, end: profile.plan_window.end, stand_kind: 'any',
      }).candidate_stand_ids;
      if (!candidates.length) throw new Error(`Weighted traffic row has no eligible stands: ${row.id}`);
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(row);
      for (const standId of candidates) {
        if (!standGroups.has(standId)) standGroups.set(standId, new Set());
        standGroups.get(standId).add(groupId);
      }
    }
    const credits = new Map([...groups.keys()].sort(compareIds).map(id => [id, 0]));
    for (const standId of [...standGroups.keys()].sort(compareIds)) {
      const allowed = standGroups.get(standId);
      for (const id of allowed) credits.set(id, credits.get(id) + 1 / allowed.size);
    }
    const quotas = allocate(target.count, [...credits].map(([id, weight]) => ({ id, weight })));
    for (const [groupId, credit] of credits) {
      const counts = allocate(quotas.get(groupId), groups.get(groupId).map(row => ({ id: row.id, weight: row.weight })));
      for (const row of groups.get(groupId)) {
        row.count = counts.get(row.id);
        row.market_id = target.market_id;
      }
      allocation.push({ target_id: target.id, planning_group_id: groupId, stand_credit: credit, visit_count: quotas.get(groupId) });
    }
  }
  return { rows, allocation };
}
