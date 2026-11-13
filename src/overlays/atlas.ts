import validate from "./atlas-validator.mjs";
import { fingerprintJson, parseCapacitySnapshot, validateCapacityDataset, parseCapacityQueryInstant,
  type CapacityOpportunity, type PreparedCapacity } from "./capacity";
import type { PlanVariant } from "../data-sources/preparedTypes";
import type { OperationsDatasetInput } from "../operations/dataset";

export const ATLAS_MODES = {
  current: "Current plan",
  planned: "Synthetic planned-day frequency",
  end_of_day: "Synthetic end-of-day frequency",
  retention: "Synthetic opportunity retention",
} as const;
export type AtlasMode = keyof typeof ATLAS_MODES;
export const isAtlasMode = (value: string): value is AtlasMode => Object.hasOwn(ATLAS_MODES, value);
type Phase = "planned" | "end_of_day";
const ranges = ["planned_shift_minutes", "planned_scale_basis_points", "outcome_shift_minutes", "outcome_scale_basis_points"] as const;
type Parameter = typeof ranges[number];
export interface PreparedAtlas {
  schema_version: "2.0.0";
  metric_id: "airport-opportunity-recurrence";
  metric_version: "1.0.0";
  source: "synthetic-timing-replays";
  time_basis: "utc-horizon-relative";
  airport_id: string; case_id: string; demand_id: string;
  snapshot_fingerprint: string; airport_fingerprint: string; demand_fingerprint: string; capacity_fingerprint: string;
  plan_window: { start: string; end: string };
  variants: Record<PlanVariant, { request_fingerprint: string }>;
  horizon_duration_ms: number;
  profile: {
    schema_version: "1.0.0"; id: string; seed: string; start_date: string; day_count: number;
  } & Record<Parameter, [number, number]>;
  days: {
    date: string; parameters: Record<Parameter, number>;
    variants: Record<PlanVariant, Record<Phase, { id: string; rows: { stand_id: string; windows: [number, number][] }[] }[]>>;
  }[];
}

const instant = (text: string) => {
  const value = Date.parse(text);
  if (!Number.isSafeInteger(value) || new Date(value).toISOString() !== (text.includes(".") ? text : text.replace("Z", ".000Z"))) {
    throw new Error(`Invalid Atlas UTC instant: ${text}`);
  }
  return value;
};

export function parseAtlas(value: unknown): PreparedAtlas {
  if (!validate(value)) throw new Error(`Prepared Atlas is invalid: ${validate.errors?.map(item => `${item.instancePath} ${item.message}`).join("; ")}`);
  const origin = Date.parse(`${value.profile.start_date}T00:00:00Z`);
  if (!Number.isFinite(origin) || new Date(origin).toISOString().slice(0, 10) !== value.profile.start_date ||
      instant(value.plan_window.end) - instant(value.plan_window.start) !== value.horizon_duration_ms ||
      !value.profile.id.startsWith(`${value.airport_id}:`) || value.days.length !== value.profile.day_count ||
      ranges.some(key => value.profile[key][0] > value.profile[key][1])) throw new Error("Invalid Atlas period, horizon or profile.");
  for (const [index, day] of value.days.entries()) {
    if (day.date !== new Date(origin + index * 86400_000).toISOString().slice(0, 10) ||
        ranges.some(key => day.parameters[key] < value.profile[key][0] || day.parameters[key] > value.profile[key][1])) {
      throw new Error("Invalid Atlas date sequence or replay parameters.");
    }
    for (const plan of Object.values(day.variants)) for (const probes of Object.values(plan)) {
      for (const probe of probes) for (const row of probe.rows) {
        let previous = -1;
        for (const [left, right] of row.windows) {
          if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left <= previous ||
              left >= right || right > value.horizon_duration_ms) throw new Error("Invalid Atlas stand windows.");
          previous = right;
        }
      }
    }
  }
  return value;
}

function bindAtlas(atlas: PreparedAtlas, capacity: PreparedCapacity) {
  if (atlas.airport_id !== capacity.airport_id || atlas.case_id !== capacity.case_id || atlas.demand_id !== capacity.demand_id ||
      atlas.snapshot_fingerprint !== capacity.snapshot_fingerprint || atlas.airport_fingerprint !== capacity.airport_fingerprint ||
      atlas.demand_fingerprint !== capacity.demand_fingerprint || atlas.plan_window.start !== capacity.plan_window.start ||
      atlas.plan_window.end !== capacity.plan_window.end) throw new Error("Atlas source provenance does not match prepared capacity.");
  for (const variant of ["baseline", "tow-options"] as const) {
    if (atlas.variants[variant].request_fingerprint !== capacity.variants[variant].request_fingerprint) {
      throw new Error("Atlas request does not match the prepared plan.");
    }
    const expected = capacity.variants[variant].probes;
    for (const day of atlas.days) for (const phase of ["planned", "end_of_day"] as const) {
      const probes = day.variants[variant][phase];
      if (probes.length !== expected.length || new Set(probes.map(probe => probe.id)).size !== expected.length) {
        throw new Error("Incomplete Atlas probe assessment.");
      }
      for (const probe of probes) {
        const source = expected.find(item => item.id === probe.id);
        if (!source || probe.rows.length !== source.rows.length || new Set(probe.rows.map(row => row.stand_id)).size !== source.rows.length ||
            probe.rows.some(row => !source.rows.some(item => item.stand_id === row.stand_id))) throw new Error("Incomplete Atlas stand assessment.");
      }
    }
  }
}

export async function validateAtlasCapacity(value: unknown, capacity: PreparedCapacity): Promise<PreparedAtlas> {
  const atlas = parseAtlas(value);
  bindAtlas(atlas, parseCapacitySnapshot(capacity));
  if (atlas.capacity_fingerprint !== await fingerprintJson(capacity)) throw new Error("Atlas does not match exact capacity evidence. Regenerate Atlas.");
  return atlas;
}

export function validateAtlasDataset(value: unknown, source: OperationsDatasetInput, profiles: Readonly<Record<string, unknown>>) {
  if (!Object.hasOwn(profiles, "capacity") || source.capabilities?.editStands !== false) {
    throw new Error("Atlas requires source-owned capacity evidence on a read-only dataset.");
  }
  validateCapacityDataset(profiles.capacity, source);
  const atlas = parseAtlas(value);
  bindAtlas(atlas, parseCapacitySnapshot(profiles.capacity));
  return { id: atlas.profile.id };
}

function windowsFor(day: PreparedAtlas["days"][number], variant: PlanVariant, phase: Phase, probeId: string, rowId: string) {
  const row = day.variants[variant][phase].find(probe => probe.id === probeId)?.rows.find(row => row.stand_id === rowId);
  if (!row) throw new Error(`Unknown Atlas probe/stand: ${probeId}/${rowId}`);
  return row.windows;
}

export function atlasFrequency(atlas: PreparedAtlas, variant: PlanVariant, probeId: string, rowId: string, startOffset: number, durationMinutes: number) {
  if (!["baseline", "tow-options"].includes(variant) || !Number.isSafeInteger(startOffset) || startOffset < 0 ||
      !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440 ||
      startOffset + durationMinutes * 60_000 > atlas.horizon_duration_ms || !atlas.days.length) throw new Error("Invalid Atlas frequency query.");
  const days = atlas.days.map(day => {
    const fits = (phase: Phase) => windowsFor(day, variant, phase, probeId, rowId)
      .some(([start, end]) => startOffset >= start && startOffset + durationMinutes * 60_000 <= end);
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
export type AtlasFrequencySummary = Omit<AtlasFrequency, "days">;
export function atlasRate(frequency: AtlasFrequencySummary, mode: Exclude<AtlasMode, "current">): number | null {
  if (mode === "retention") return frequency.retention_rate;
  if (mode === "end_of_day") return frequency.end_of_day_rate;
  if (mode === "planned") return frequency.planned_rate;
  throw new Error("Unknown Atlas frequency mode.");
}

export function atlasSegments(atlas: PreparedAtlas, variant: PlanVariant, probeId: string, item: CapacityOpportunity,
  durationMinutes: number, origin: number) {
  const first = item.earliest - origin, end = item.latest - origin + 1;
  if (origin !== instant(atlas.plan_window.start) || !Number.isSafeInteger(first) || !Number.isSafeInteger(end) ||
      first < 0 || end <= first || end - 1 + durationMinutes * 60_000 > atlas.horizon_duration_ms) {
    throw new Error("Invalid Atlas segment source/range.");
  }
  const boundaries = new Set([first, end]);
  for (const day of atlas.days) for (const phase of ["planned", "end_of_day"] as const) {
    for (const [left, right] of windowsFor(day, variant, phase, probeId, item.rowId)) {
      const last = right - durationMinutes * 60_000;
      if (last < left) continue;
      for (const edge of [left, last + 1]) if (edge > first && edge < end) boundaries.add(edge);
    }
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const segments: { start: number; end: number; frequency: AtlasFrequencySummary }[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    // Chart summaries may merge equal counts, but cannot carry a single point's daily membership.
    const { days: _days, ...frequency } = atlasFrequency(atlas, variant, probeId, item.rowId, points[index], durationMinutes);
    const previous = segments.at(-1);
    if (previous && previous.frequency.planned_days === frequency.planned_days &&
        previous.frequency.end_of_day_days === frequency.end_of_day_days && previous.frequency.retained_days === frequency.retained_days) {
      previous.end = origin + points[index + 1];
    } else segments.push({ start: origin + points[index], end: origin + points[index + 1], frequency });
  }
  return segments;
}

export interface AtlasInspection { bandId: string; start: string }
export function inspectAtlas(atlas: PreparedAtlas, variant: PlanVariant, probeId: string, duration: number,
  opportunities: readonly CapacityOpportunity[], inspection: AtlasInspection | null) {
  const selected = inspection ? opportunities.find(item => item.id === inspection.bandId) : opportunities[0];
  if (!selected) return { selected: null, start: "", error: "No current feasible range is selected.", frequency: null };
  const start = inspection?.start ?? new Date(selected.earliest).toISOString().slice(0, -1);
  const time = parseCapacityQueryInstant(start);
  if (!Number.isSafeInteger(time) || time < selected.earliest || time > selected.latest) {
    return { selected, start, error: "Enter a valid UTC arrival start inside the selected inclusive feasible range.", frequency: null };
  }
  return { selected, start, error: null, frequency: atlasFrequency(atlas, variant, probeId, selected.rowId,
    time - instant(atlas.plan_window.start), duration) };
}
