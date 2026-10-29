import Ajv from 'ajv';
import { compileAirport, readJson } from './airport-model.mjs';
import { calculateCapacityWindows, fingerprint, prepareCapacitySnapshot, sourceOccupancies } from './capacity-probe.mjs';
import { randomStream } from './scenario-generator.mjs';

const shape = new Ajv({ allErrors: true }).compile(readJson(new URL('../data/schemas/capacity-atlas-profile.schema.json', import.meta.url)));
const rangeKeys = ['planned_shift_minutes', 'planned_scale_basis_points', 'outcome_shift_minutes', 'outcome_scale_basis_points'];
export function validateAtlasProfile(profile) {
  if (!shape(profile)) throw new Error(`Invalid atlas profile: ${JSON.stringify(shape.errors)}`);
  const start = Date.parse(`${profile.start_date}T00:00:00Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== profile.start_date ||
      rangeKeys.some(key => profile[key][0] > profile[key][1])) throw new Error('Invalid atlas date or parameter range.');
  return profile;
}
export const loadAtlasProfile = path => validateAtlasProfile(readJson(path));

export function atlasDayParameters(profile, date) {
  const random = randomStream(profile.seed, date);
  return Object.fromEntries(rangeKeys.map(key => {
    const [min, max] = profile[key];
    return [key, min + Math.floor(random() * (max - min + 1))];
  }));
}

export function replayAtlasDay(occupancies, origin, parameters, outcome = false) {
  const transform = time => {
    const planned = Math.round((time - origin) * parameters.planned_scale_basis_points / 10000) + parameters.planned_shift_minutes * 60_000;
    return origin + (outcome
      ? Math.round(planned * parameters.outcome_scale_basis_points / 10000) + parameters.outcome_shift_minutes * 60_000 : planned);
  };
  return occupancies.map(item => ({ ...item, start: transform(item.start), end: transform(item.end) }));
}

export function prepareCapacityAtlas(snapshot, raw, airport, capacity, profile) {
  validateAtlasProfile(profile);
  if (!profile.id.startsWith(`${airport.airport.id}:`) || !capacity ||
      fingerprint(prepareCapacitySnapshot(snapshot, raw, airport, capacity.profile)) !== fingerprint(capacity)) {
    throw new Error('Atlas sources do not match authoritative prepared capacity. Regenerate capacity for these explicit inputs.');
  }
  const model = compileAirport(airport), fixed = sourceOccupancies(snapshot, raw);
  const origin = Date.parse(snapshot.plan_window.start), end = Date.parse(snapshot.plan_window.end);
  const days = Array.from({ length: profile.day_count }, (_, index) => {
    const date = new Date(Date.parse(`${profile.start_date}T00:00:00Z`) + index * 86400_000).toISOString().slice(0, 10);
    const parameters = atlasDayParameters(profile, date);
    return {
      date, parameters,
      variants: Object.fromEntries(Object.entries(fixed).map(([variant, items]) => [variant,
        Object.fromEntries([['planned', false], ['end_of_day', true]].map(([phase, outcome]) => {
          const replay = replayAtlasDay(items, origin, parameters, outcome);
          const probes = capacity.profile.probes.map(probe => ({
            id: probe.id,
            rows: calculateCapacityWindows(model, replay, probe, [origin, end]).rows.map(row => ({
              stand_id: row.stand_id,
              windows: row.windows.map(window => [Date.parse(window.start) - origin, Date.parse(window.end) - origin]),
            })),
          }));
          return [phase, probes];
        })),
      ])),
    };
  });
  return {
    schema_version: '2.0.0', metric_id: 'airport-opportunity-recurrence', metric_version: '1.0.0',
    source: 'synthetic-timing-replays', time_basis: 'utc-horizon-relative',
    airport_id: capacity.airport_id, case_id: capacity.case_id, demand_id: capacity.demand_id,
    snapshot_fingerprint: capacity.snapshot_fingerprint, airport_fingerprint: capacity.airport_fingerprint,
    demand_fingerprint: capacity.demand_fingerprint, plan_window: capacity.plan_window,
    variants: Object.fromEntries(Object.entries(capacity.variants).map(([variant, plan]) => [variant, {
      request_fingerprint: plan.request_fingerprint,
    }])),
    horizon_duration_ms: end - origin, capacity_fingerprint: fingerprint(capacity), profile, days,
  };
}
