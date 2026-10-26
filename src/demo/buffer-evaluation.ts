import configuredProfile from "../../data/airports/contoso/evaluation/buffer-profile.json";
import type { PreparedScenario } from "./dataset";
import type { PlanVariant } from "./preferences";

export const BUFFER_METRIC = {
  id: "airport-scheduled-stand-buffer",
  version: "1.0.0",
  name: "Scheduled stand buffer",
  unit: "minutes",
  valueKind: "derived",
  optimizationKind: "scoring-only",
  definition: "Release-to-start gaps between consecutive occupancies of different visits on the same stand.",
} as const;

export interface BufferProfile {
  schema_version: "1.0.0";
  id: string;
  metric_id: typeof BUFFER_METRIC.id;
  metric_version: typeof BUFFER_METRIC.version;
  threshold_minutes: number;
}

export function parseBufferProfile(value: unknown): BufferProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid buffer evaluation profile.");
  const keys = ["$schema", "schema_version", "id", "metric_id", "metric_version", "threshold_minutes"];
  if (Object.keys(value).some(key => !keys.includes(key)) ||
      !("schema_version" in value) || value.schema_version !== "1.0.0" ||
      !("id" in value) || typeof value.id !== "string" || !value.id.trim() ||
      !("metric_id" in value) || value.metric_id !== BUFFER_METRIC.id ||
      !("metric_version" in value) || value.metric_version !== BUFFER_METRIC.version ||
      !("threshold_minutes" in value) || typeof value.threshold_minutes !== "number" ||
      !Number.isFinite(value.threshold_minutes) || value.threshold_minutes < 0 || value.threshold_minutes > 120 ||
      ("$schema" in value && typeof value.$schema !== "string")) {
    throw new Error("Invalid or unsupported buffer evaluation profile.");
  }
  return {
    schema_version: value.schema_version, id: value.id, metric_id: value.metric_id,
    metric_version: value.metric_version, threshold_minutes: value.threshold_minutes,
  };
}

export const DEFAULT_BUFFER_PROFILE = Object.freeze(parseBufferProfile(configuredProfile));

export interface BufferAssignment {
  id: string;
  rowId: string;
  visitId: string;
  start: number;
  end: number;
}

export interface BufferEvidence {
  id: string;
  rowId: string;
  previous: BufferAssignment;
  next: BufferAssignment;
  start: number;
  end: number;
  minutes: number;
  tight: boolean;
}

export interface BufferOverlap {
  rowId: string;
  first: BufferAssignment;
  second: BufferAssignment;
  start: number;
  end: number;
  minutes: number;
}

export interface BufferResult {
  availability: "available" | "not-applicable" | "invalid";
  handovers: BufferEvidence[];
  overlaps: BufferOverlap[];
  summary: {
    handover_count: number;
    tight_count: number;
    minimum_minutes: number | null;
    median_minutes: number | null;
    p10_minutes: number | null;
    overlap_count: number;
  };
}

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function calculateStandBuffers(
  assignments: readonly BufferAssignment[],
  domain: readonly [number, number],
  requestedProfile: BufferProfile = DEFAULT_BUFFER_PROFILE,
): BufferResult {
  const profile = parseBufferProfile(requestedProfile);
  const [start, end] = domain;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("Invalid buffer evaluation horizon.");
  const ids = new Set<string>();
  const rows = new Map<string, BufferAssignment[]>();
  for (const source of assignments) {
    if (![source.id, source.rowId, source.visitId].every(value => typeof value === "string" && value.trim()) ||
        ids.has(source.id) || !Number.isFinite(source.start) || !Number.isFinite(source.end) || source.start >= source.end) {
      throw new Error(`Invalid or duplicate buffer assignment: ${source.id}`);
    }
    ids.add(source.id);
    if (source.start >= end || source.end < start) continue;
    const row = rows.get(source.rowId) ?? [];
    row.push({ ...source });
    rows.set(source.rowId, row);
  }
  const handovers: BufferEvidence[] = [];
  const overlaps: BufferOverlap[] = [];
  for (const [rowId, row] of [...rows].sort(([a], [b]) => compareIds(a, b))) {
    row.sort((a, b) => a.start - b.start || a.end - b.end || compareIds(a.id, b.id));
    let frontier: BufferAssignment | undefined;
    let active: BufferAssignment[] = [];
    for (const current of row) {
      active = active.filter(item => item.end > current.start);
      for (const previous of active) {
        const overlapStart = Math.max(start, previous.start, current.start);
        const overlapEnd = Math.min(end, previous.end, current.end);
        if (overlapStart < overlapEnd) overlaps.push({
          rowId, first: previous, second: current, start: overlapStart, end: overlapEnd,
          minutes: (overlapEnd - overlapStart) / 60_000,
        });
      }
      // Use the end of the occupied union: nested intervals must not create false gaps.
      if (frontier && frontier.end <= current.start && current.start >= start && frontier.visitId !== current.visitId) {
        const minutes = (current.start - frontier.end) / 60_000;
        handovers.push({
          id: JSON.stringify([rowId, frontier.id, current.id]), rowId, previous: frontier, next: current,
          start: frontier.end, end: current.start, minutes, tight: minutes < profile.threshold_minutes,
        });
      }
      if (!frontier || current.end > frontier.end) frontier = current;
      active.push(current);
    }
  }
  const values = handovers.map(item => item.minutes).sort((a, b) => a - b);
  const available = overlaps.length === 0 && values.length > 0;
  const middle = Math.floor(values.length / 2);
  return {
    availability: overlaps.length ? "invalid" : values.length ? "available" : "not-applicable",
    handovers, overlaps,
    summary: {
      handover_count: handovers.length, tight_count: handovers.filter(item => item.tight).length,
      minimum_minutes: available ? values[0] : null,
      median_minutes: available ? values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2 : null,
      p10_minutes: available ? values[Math.ceil(values.length * 0.1) - 1] : null,
      overlap_count: overlaps.length,
    },
  };
}

export interface EvaluatedBufferPlan {
  plan_id: string;
  request_fingerprint: string;
  solver_status: string;
  assigned_visit_ids: string[];
  assigned_visits: number;
  unassigned_visits: number;
  generated_tows: number;
  buffers: BufferResult;
}

export interface BufferEvaluation {
  metric: typeof BUFFER_METRIC;
  profile: BufferProfile;
  demand_id: string;
  horizon: readonly [number, number];
  population_count: number;
  variants: Record<PlanVariant, EvaluatedBufferPlan>;
  comparison: {
    assigned_sets_differ: boolean;
    gained_visit_ids: string[];
    lost_visit_ids: string[];
    changed_retained_visit_ids: string[];
    unchanged_retained_visits: number;
    buffer_delta: null | { minimum_minutes: number; median_minutes: number; p10_minutes: number; tight_count: number };
  };
}

export function evaluateBufferPlans(snapshot: PreparedScenario, requestedProfile: BufferProfile = DEFAULT_BUFFER_PROFILE): BufferEvaluation {
  const profile = parseBufferProfile(requestedProfile);
  const horizon = [Date.parse(snapshot.plan_window.start), Date.parse(snapshot.plan_window.end)] as const;
  const population = new Set(snapshot.visits.map(visit => visit.turnId));
  if (population.size !== snapshot.visits.length) throw new Error("Duplicate buffer evaluation visits.");
  const rows = new Set(snapshot.rows.map(row => row.id));
  const signatures = new Map<PlanVariant, Map<string, string>>();
  const evaluate = (variant: PlanVariant): EvaluatedBufferPlan => {
    const plan = snapshot.variants[variant];
    const assignments = plan.stays.map(stay => ({
      id: stay.id, visitId: stay.visitId, rowId: stay.rowId, start: Date.parse(stay.start), end: Date.parse(stay.end),
    }));
    const buffers = calculateStandBuffers(assignments, horizon, profile);
    const byVisit = new Map<string, BufferAssignment[]>();
    for (const assignment of assignments) {
      if (!population.has(assignment.visitId) || !rows.has(assignment.rowId)) throw new Error("Unknown buffer evaluation assignment reference.");
      const stays = byVisit.get(assignment.visitId) ?? [];
      stays.push(assignment);
      byVisit.set(assignment.visitId, stays);
    }
    signatures.set(variant, new Map([...byVisit].map(([id, stays]) => [
      id, JSON.stringify(stays.map(stay => [stay.rowId, stay.start, stay.end]).sort((a, b) => compareIds(JSON.stringify(a), JSON.stringify(b)))),
    ])));
    const assigned = [...byVisit.keys()].sort(compareIds);
    return {
      plan_id: `${snapshot.demand_id}/${variant}`, request_fingerprint: plan.request_fingerprint,
      solver_status: plan.solver_status, assigned_visit_ids: assigned,
      assigned_visits: assigned.length, unassigned_visits: population.size - assigned.length,
      generated_tows: plan.generated_movement_count, buffers,
    };
  };
  const baseline = evaluate("baseline");
  const variant = evaluate("tow-options");
  const original = new Set(baseline.assigned_visit_ids);
  const revised = new Set(variant.assigned_visit_ids);
  const gained = variant.assigned_visit_ids.filter(id => !original.has(id));
  const lost = baseline.assigned_visit_ids.filter(id => !revised.has(id));
  const retained = baseline.assigned_visit_ids.filter(id => revised.has(id));
  const changed = retained.filter(id => signatures.get("baseline")?.get(id) !== signatures.get("tow-options")?.get(id));
  const before = baseline.buffers.summary, after = variant.buffers.summary;
  const comparable = !gained.length && !lost.length && baseline.buffers.availability === "available" && variant.buffers.availability === "available";
  return {
    metric: BUFFER_METRIC, profile, demand_id: snapshot.demand_id, horizon,
    population_count: population.size, variants: { baseline, "tow-options": variant },
    comparison: {
      assigned_sets_differ: Boolean(gained.length || lost.length),
      gained_visit_ids: gained, lost_visit_ids: lost, changed_retained_visit_ids: changed,
      unchanged_retained_visits: retained.length - changed.length,
      buffer_delta: comparable && before.minimum_minutes !== null && after.minimum_minutes !== null &&
        before.median_minutes !== null && after.median_minutes !== null && before.p10_minutes !== null && after.p10_minutes !== null ? {
          minimum_minutes: after.minimum_minutes - before.minimum_minutes,
          median_minutes: after.median_minutes - before.median_minutes,
          p10_minutes: after.p10_minutes - before.p10_minutes,
          tight_count: after.tight_count - before.tight_count,
        } : null,
    },
  };
}
