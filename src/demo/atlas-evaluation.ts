import validate from "./atlas-validator.mjs";
import { fingerprintJson, type CapacityOpportunity, type PreparedCapacity } from "./capacity-evaluation";
import type { PlanVariant } from "./preferences";

export type AtlasMode = "current" | "planned" | "end_of_day" | "retention";
type AtlasPhase = "planned" | "end_of_day";
interface AtlasProbe {
  id: string;
  rows: { stand_id: string; windows: [number, number][] }[];
}
interface AtlasParameters {
  planned_shift_minutes: number;
  planned_scale_basis_points: number;
  outcome_shift_minutes: number;
  outcome_scale_basis_points: number;
}
export interface PreparedAtlas {
  schema_version: "1.0.0";
  metric_id: "airport-opportunity-recurrence";
  metric_version: "1.0.0";
  source: "synthetic-timing-replays";
  time_basis: "utc-horizon-relative";
  case_id: string;
  horizon_duration_ms: number;
  capacity_fingerprint: string;
  profile: {
    schema_version: "1.0.0"; id: string; seed: string; start_date: string; day_count: number;
    planned_shift_minutes: [number, number];
    planned_scale_basis_points: [number, number];
    outcome_shift_minutes: [number, number];
    outcome_scale_basis_points: [number, number];
  };
  days: {
    date: string;
    parameters: AtlasParameters;
    variants: Record<PlanVariant, Record<AtlasPhase, AtlasProbe[]>>;
  }[];
}
const rangeKeys = ["planned_shift_minutes", "planned_scale_basis_points", "outcome_shift_minutes", "outcome_scale_basis_points"] as const;

export async function validateAtlas(value: unknown, capacity: PreparedCapacity): Promise<PreparedAtlas> {
  if (!validate(value)) throw new Error(`Prepared atlas is invalid: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  if (value.case_id !== capacity.case_id || value.capacity_fingerprint !== await fingerprintJson(capacity)) {
    throw new Error("Atlas does not match prepared capacity. Run npm run prepare:atlas.");
  }
  const origin = Date.parse(`${value.profile.start_date}T00:00:00Z`);
  const horizon = Date.parse(capacity.plan_window.end) - Date.parse(capacity.plan_window.start);
  if (value.horizon_duration_ms !== horizon || !Number.isFinite(origin) || new Date(origin).toISOString().slice(0, 10) !== value.profile.start_date ||
      value.days.length !== value.profile.day_count || rangeKeys.some(key => value.profile[key][0] > value.profile[key][1])) {
    throw new Error("Invalid atlas period or parameter ranges.");
  }
  for (const [index, day] of value.days.entries()) {
    if (day.date !== new Date(origin + index * 86400_000).toISOString().slice(0, 10) ||
        rangeKeys.some(key => day.parameters[key] < value.profile[key][0] || day.parameters[key] > value.profile[key][1])) {
      throw new Error("Invalid atlas date sequence or replay parameters.");
    }
    for (const variant of ["baseline", "tow-options"] as const) {
      const expected = capacity.variants[variant].probes;
      for (const phase of ["planned", "end_of_day"] as const) {
        const probes = day.variants[variant][phase];
        if (probes.length !== expected.length || new Set(probes.map(probe => probe.id)).size !== expected.length) throw new Error("Incomplete atlas probe assessment.");
        for (const probe of probes) {
          const source = expected.find(item => item.id === probe.id);
          if (!source || probe.rows.length !== source.rows.length || new Set(probe.rows.map(row => row.stand_id)).size !== source.rows.length ||
              probe.rows.some(row => !source.rows.some(item => item.stand_id === row.stand_id))) throw new Error("Incomplete atlas stand assessment.");
          for (const row of probe.rows) {
            let previous = -1;
            for (const [left, right] of row.windows) {
              if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left <= previous || left >= right || right > horizon) {
                throw new Error("Invalid atlas stand windows.");
              }
              previous = right;
            }
          }
        }
      }
    }
  }
  return value;
}

function windowsFor(day: PreparedAtlas["days"][number], variant: PlanVariant, phase: AtlasPhase, probeId: string, rowId: string) {
  const row = day.variants[variant][phase].find(probe => probe.id === probeId)?.rows.find(row => row.stand_id === rowId);
  if (!row) throw new Error(`Unknown atlas probe/stand: ${probeId}/${rowId}`);
  return row.windows;
}

export function atlasFrequency(atlas: PreparedAtlas, variant: PlanVariant, probeId: string, rowId: string, startOffset: number, durationMinutes: number) {
  if (!Number.isSafeInteger(startOffset) || startOffset < 0 || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440 ||
      startOffset + durationMinutes * 60_000 > atlas.horizon_duration_ms || atlas.days.length === 0) throw new Error("Invalid atlas frequency query.");
  const duration = durationMinutes * 60_000;
  const days = atlas.days.map(day => {
    const fits = (phase: AtlasPhase) => windowsFor(day, variant, phase, probeId, rowId)
      .some(([start, end]) => startOffset >= start && startOffset + duration <= end);
    return { date: day.date, planned: fits("planned"), end_of_day: fits("end_of_day") };
  });
  const planned = days.filter(day => day.planned).length, outcome = days.filter(day => day.end_of_day).length;
  const retained = days.filter(day => day.planned && day.end_of_day).length;
  return {
    assessed_days: days.length, planned_days: planned, end_of_day_days: outcome, retained_days: retained,
    planned_rate: planned / days.length, end_of_day_rate: outcome / days.length,
    retention_rate: planned ? retained / planned : null, days,
  };
}
export type AtlasFrequency = ReturnType<typeof atlasFrequency>;
export const atlasRate = (frequency: AtlasFrequency, mode: AtlasMode) =>
  mode === "retention" ? frequency.retention_rate : mode === "end_of_day" ? frequency.end_of_day_rate : frequency.planned_rate;

export function atlasSegments(atlas: PreparedAtlas, variant: PlanVariant, probeId: string, item: CapacityOpportunity, durationMinutes: number, origin: number) {
  const first = item.earliest - origin, end = item.latest - origin + 1;
  const boundaries = new Set([first, end]);
  for (const day of atlas.days) for (const phase of ["planned", "end_of_day"] as const) {
    for (const [left, right] of windowsFor(day, variant, phase, probeId, item.rowId)) {
      const last = right - durationMinutes * 60_000;
      if (last < left) continue;
      for (const edge of [left, last + 1]) if (edge > first && edge < end) boundaries.add(edge);
    }
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const segments: { start: number; end: number; frequency: AtlasFrequency }[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const frequency = atlasFrequency(atlas, variant, probeId, item.rowId, points[index], durationMinutes);
    const previous = segments.at(-1);
    if (previous && previous.frequency.planned_days === frequency.planned_days &&
        previous.frequency.end_of_day_days === frequency.end_of_day_days && previous.frequency.retained_days === frequency.retained_days) {
      previous.end = origin + points[index + 1];
    } else segments.push({ start: origin + points[index], end: origin + points[index + 1], frequency });
  }
  return segments;
}
