import validate from "./capacity-validator.mjs";
import { validate as validateSchedule } from "../data-sources/prepared-validator.mjs";
import type { PlanVariant } from "../data-sources/preparedTypes";
import type { OperationsDatasetInput } from "../operations/dataset";

export interface CapacityProbe {
  id: string;
  label: string;
  aircraft_id: string;
  operating_airline_id: string;
  arrival_sector_id: string;
  departure_sector_id: string;
  default_duration_minutes: number;
  separation_minutes: number;
}
export interface CapacityBlock {
  start: string;
  end: string;
  assignment_ids: string[];
  reasons: string[];
  rule_paths: string[];
}
export interface CapacityWindow {
  start: string;
  end: string;
  before: number | null;
  after: number | null;
}
export interface CapacityRow {
  stand_id: string;
  windows: CapacityWindow[];
  blocks: CapacityBlock[];
}
export interface PreparedCapacity {
  schema_version: "1.0.0";
  metric_id: "airport-single-turn-capacity";
  metric_version: "1.0.0";
  airport_id: string;
  case_id: string;
  demand_id: string;
  snapshot_fingerprint: string;
  airport_fingerprint: string;
  demand_fingerprint: string;
  plan_window: { start: string; end: string };
  profile: {
    schema_version: "1.0.0"; id: string; metric_id: "airport-single-turn-capacity"; metric_version: "1.0.0";
    default_probe_id: string; probes: CapacityProbe[];
  };
  variants: Record<PlanVariant, {
    request_fingerprint: string;
    probes: { id: string; rows: CapacityRow[]; excluded_stands: { stand_id: string; reasons: string[] }[] }[];
  }>;
}
export interface CapacityOpportunity {
  id: string;
  rowId: string;
  earliest: number;
  latest: number;
  availableStart: number;
  availableEnd: number;
  before: CapacityBlock | null;
  after: CapacityBlock | null;
}

const instant = (value: string) => {
  const time = Date.parse(value);
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(time) || new Date(time).toISOString() !== canonical) throw new Error(`Invalid capacity UTC instant: ${value}`);
  return time;
};

export function parseCapacitySnapshot(value: unknown): PreparedCapacity {
  if (!validate(value)) throw new Error(`Prepared capacity is invalid: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  const start = instant(value.plan_window.start), end = instant(value.plan_window.end);
  if (start >= end || !value.profile.id.startsWith(`${value.airport_id}:`)) throw new Error("Invalid capacity horizon/profile airport.");
  const ids = value.profile.probes.map(probe => probe.id);
  if (new Set(ids).size !== ids.length || !ids.includes(value.profile.default_probe_id)) throw new Error("Invalid capacity probe IDs/default.");
  for (const plan of Object.values(value.variants)) {
    if (plan.probes.length !== ids.length || new Set(plan.probes.map(probe => probe.id)).size !== ids.length ||
        plan.probes.some(probe => !ids.includes(probe.id))) throw new Error("Invalid capacity plan/probe identity.");
    for (const probe of plan.probes) {
      const stands = [...probe.rows.map(row => row.stand_id), ...probe.excluded_stands.map(row => row.stand_id)];
      if (new Set(stands).size !== stands.length) throw new Error("Duplicate capacity stand assessment.");
      for (const row of probe.rows) {
        let cursor = start;
        const expected: CapacityWindow[] = [];
        for (const [index, block] of row.blocks.entries()) {
          const left = instant(block.start), right = instant(block.end);
          if (left < start || right > end || left >= right || left < cursor || (index > 0 && left === cursor)) {
            throw new Error("Invalid capacity blocking evidence.");
          }
          if (cursor < left) expected.push({ start: new Date(cursor).toISOString(), end: new Date(left).toISOString(), before: index ? index - 1 : null, after: index });
          cursor = right;
        }
        if (cursor < end) expected.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString(), before: row.blocks.length ? row.blocks.length - 1 : null, after: null });
        if (row.windows.length !== expected.length || row.windows.some((window, index) => {
          const other = expected[index];
          return instant(window.start) !== instant(other.start) || instant(window.end) !== instant(other.end) ||
            window.before !== other.before || window.after !== other.after;
        })) throw new Error("Capacity windows do not match blocking evidence.");
      }
    }
  }
  return value;
}

export async function fingerprintJson(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Prepared overlay source verification requires a secure browser context (localhost or HTTPS).");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateCapacitySnapshot(value: unknown, source: unknown): Promise<PreparedCapacity> {
  const capacity = parseCapacitySnapshot(value);
  if (!validateSchedule(source) || source.airport?.id !== capacity.airport_id ||
      source.case_id !== capacity.case_id || source.demand_id !== capacity.demand_id ||
      source.plan_window.start !== capacity.plan_window.start || source.plan_window.end !== capacity.plan_window.end ||
      await fingerprintJson(source) !== capacity.snapshot_fingerprint) {
    throw new Error("Prepared capacity does not match the selected schedule. Regenerate its capacity evidence.");
  }
  const stands = new Set(source.rows.map(row => row.id));
  for (const variant of ["baseline", "tow-options"] as const) {
    const plan = capacity.variants[variant];
    if (plan.request_fingerprint !== source.variants[variant].request_fingerprint) throw new Error("Capacity request fingerprint does not match the selected plan.");
    validateReferences(plan, stands, new Set(source.variants[variant].stays.map(stay => stay.id)));
  }
  return capacity;
}

function validateReferences(plan: PreparedCapacity["variants"][PlanVariant], stands: ReadonlySet<string>, assignments: ReadonlySet<string>) {
  for (const probe of plan.probes) {
    const rows = [...probe.rows.map(row => row.stand_id), ...probe.excluded_stands.map(row => row.stand_id)];
    if (rows.length !== stands.size || rows.some(id => !stands.has(id))) throw new Error("Incomplete capacity stand assessment.");
    if (probe.rows.some(row => row.blocks.some(block => block.assignment_ids.some(id => !assignments.has(id))))) {
      throw new Error("Invalid capacity assignment reference.");
    }
  }
}

export function validateCapacityDataset(value: unknown, source: OperationsDatasetInput): { id: string } {
  const capacity = parseCapacitySnapshot(value), plan = source.preparedPlan;
  if (!plan || capacity.airport_id !== source.airportId || capacity.case_id !== plan.caseId ||
      capacity.demand_id !== plan.demandId || capacity.variants[plan.variant].request_fingerprint !== plan.requestFingerprint ||
      instant(capacity.plan_window.start) !== source.domain[0] || instant(capacity.plan_window.end) !== source.domain[1]) {
    throw new Error("Capacity evidence does not match the active dataset/plan.");
  }
  validateReferences(capacity.variants[plan.variant], new Set(source.timeline.rows.map(row => row.id)),
    new Set(source.timeline.occupancies.map(stay => stay.id)));
  return { id: capacity.profile.id };
}

export function queryCapacity(capacity: PreparedCapacity, variant: PlanVariant, probeId: string, durationMinutes: number, start: number, end: number) {
  const duration = durationMinutes * 60_000;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440 ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < instant(capacity.plan_window.start) || end > instant(capacity.plan_window.end) || end <= start) {
    throw new Error("Invalid capacity query window/duration.");
  }
  const probe = capacity.variants[variant].probes.find(item => item.id === probeId);
  if (!probe) throw new Error(`Unknown capacity probe: ${probeId}`);
  const opportunities: CapacityOpportunity[] = probe.rows.flatMap(row => row.windows.flatMap((window, index) => {
    const left = Math.max(start, instant(window.start)), right = Math.min(end, instant(window.end));
    if (right - left < duration) return [];
    return [{
      id: `${probeId}/${row.stand_id}/${index}`, rowId: row.stand_id,
      earliest: left, latest: right - duration, availableStart: left, availableEnd: right,
      before: window.before === null ? null : row.blocks[window.before],
      after: window.after === null ? null : row.blocks[window.after],
    }];
  }));
  return { opportunities, eligible_stands: probe.rows.length, excluded_stands: probe.excluded_stands };
}

export function evaluateCapacityQuery(capacity: PreparedCapacity, probeId: string, durationText: string, startText: string, endText: string) {
  const duration = Number(durationText);
  const localInstant = (text: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?$/.test(text)) return NaN;
    const time = Date.parse(`${text}Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 16) === text.slice(0, 16) ? time : NaN;
  };
  const start = localInstant(startText), end = localInstant(endText);
  const error = !Number.isInteger(duration) || duration < 1 || duration > 1440
    ? "Enter a whole-minute occupancy duration from 1 through 1440."
    : !Number.isFinite(start) || !Number.isFinite(end) || end <= start
      ? "Enter a positive UTC search window."
      : start < instant(capacity.plan_window.start) || end > instant(capacity.plan_window.end)
        ? "Keep the search window inside the prepared horizon." : null;
  return {
    error, variants: error ? null : {
      baseline: queryCapacity(capacity, "baseline", probeId, duration, start, end),
      "tow-options": queryCapacity(capacity, "tow-options", probeId, duration, start, end),
    },
  };
}
