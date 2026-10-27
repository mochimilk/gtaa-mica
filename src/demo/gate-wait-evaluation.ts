import configuredProfile from "../../data/airports/contoso/evaluation/gate-wait-profile.json";
import { evaluateBufferPlans, type BufferEvidence, type BufferResult, type EvaluatedBufferPlan } from "./buffer-evaluation";
import type { PreparedScenario, PreparedPlan } from "./dataset";
import type { PlanVariant } from "./preferences";

export const GATE_WAIT_METRIC = {
  id: "airport-predicted-stand-wait",
  version: "1.0.0",
  name: "Predicted gate waiting",
  unit: "minutes",
  direction: "minimize",
  valueKind: "predicted",
  optimizationKind: "scoring-only",
  definition: "P(predecessor stand-release delay) * max(0, conditional mean release delay - scheduled gap).",
} as const;

export interface ReleaseDelayAssumption {
  id: string;
  label: string;
  release_delay_probability: number;
  expected_release_delay_minutes_given_delay: number;
}

export interface GateWaitProfile {
  schema_version: "1.0.0";
  id: string;
  metric_id: typeof GATE_WAIT_METRIC.id;
  metric_version: typeof GATE_WAIT_METRIC.version;
  model_id: string;
  model_version: "1.0.0";
  source: "synthetic";
  default_assumption_id: string;
  assumptions: readonly ReleaseDelayAssumption[];
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const numberInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;

export function parseGateWaitProfile(value: unknown): GateWaitProfile {
  const keys = ["$schema", "schema_version", "id", "metric_id", "metric_version", "model_id", "model_version", "source", "default_assumption_id", "assumptions"];
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key)) ||
      value.schema_version !== "1.0.0" || !text(value.id) || value.metric_id !== GATE_WAIT_METRIC.id ||
      value.metric_version !== GATE_WAIT_METRIC.version || !text(value.model_id) || value.model_version !== "1.0.0" ||
      value.source !== "synthetic" || !text(value.default_assumption_id) || !Array.isArray(value.assumptions) || !value.assumptions.length ||
      ("$schema" in value && typeof value.$schema !== "string")) {
    throw new Error("Invalid or unsupported synthetic gate-wait profile.");
  }
  const ids = new Set<string>();
  const assumptionKeys = ["id", "label", "release_delay_probability", "expected_release_delay_minutes_given_delay"];
  const assumptions = value.assumptions.map((item: unknown): ReleaseDelayAssumption => {
    if (!record(item) || Object.keys(item).some(key => !assumptionKeys.includes(key)) ||
        !text(item.id) || ids.has(item.id) || !text(item.label) ||
        !numberInRange(item.release_delay_probability, 0, 1) ||
        !numberInRange(item.expected_release_delay_minutes_given_delay, 0, 240)) {
      throw new Error("Invalid or duplicate synthetic release-delay assumption.");
    }
    ids.add(item.id);
    return {
      id: item.id, label: item.label, release_delay_probability: item.release_delay_probability,
      expected_release_delay_minutes_given_delay: item.expected_release_delay_minutes_given_delay,
    };
  });
  if (!ids.has(value.default_assumption_id)) throw new Error("Unknown default gate-wait assumption.");
  return {
    schema_version: value.schema_version, id: value.id, metric_id: value.metric_id, metric_version: value.metric_version,
    model_id: value.model_id, model_version: value.model_version, source: value.source,
    default_assumption_id: value.default_assumption_id, assumptions,
  };
}

export const DEFAULT_GATE_WAIT_PROFILE = Object.freeze(parseGateWaitProfile(configuredProfile));

export interface GateWaitContribution {
  handover: BufferEvidence;
  arrival_id: string;
  arrival_flight: string;
  predecessor_release_kind: "departure" | "tow" | "occupancy-end";
  release_delay_probability: number;
  conditional_release_delay_minutes: number;
  gap_minutes: number;
  estimated_wait_minutes: number;
}

export interface GateWaitResult {
  availability: "available" | "not-applicable" | "invalid";
  contributions: GateWaitContribution[];
  assigned_arrival_ids: string[];
  context_arrival_ids: string[];
  unassessed: {
    arrival_id: string;
    reason: "no-complete-predecessor-handover" | "overlapping-occupancy";
  }[];
  summary: {
    assigned_arrivals_in_horizon: number;
    assessed_arrivals: number;
    unassessed_arrivals: number;
    context_arrivals: number;
    arrivals_with_positive_estimate: number;
    total_wait_minutes: number | null;
    maximum_arrival_wait_minutes: number | null;
  };
}

export interface GateWaitPlan extends Omit<EvaluatedBufferPlan, "buffers"> {
  waiting: GateWaitResult;
}

export interface GateWaitEvaluation {
  metric: typeof GATE_WAIT_METRIC;
  profile: GateWaitProfile;
  assumption: ReleaseDelayAssumption;
  demand_id: string;
  horizon: readonly [number, number];
  population_count: number;
  variants: Record<PlanVariant, GateWaitPlan>;
  comparison: {
    assigned_sets_differ: boolean;
    assessed_sets_differ: boolean;
    wait_delta_minutes: number | null;
  };
}

export function calculateWaiting(
  snapshot: Pick<PreparedScenario, "plan_window" | "flights">, plan: Pick<PreparedPlan, "stays">,
  buffers: BufferResult, assumption: ReleaseDelayAssumption,
): GateWaitResult {
  const [start, end] = [Date.parse(snapshot.plan_window.start), Date.parse(snapshot.plan_window.end)];
  const flights = new Map(snapshot.flights.map(flight => [flight.id, flight]));
  if (flights.size !== snapshot.flights.length) throw new Error("Duplicate gate-wait source flights.");
  const stays = new Map(plan.stays.map(stay => [stay.id, stay]));
  const arrivals = new Map<string, string>();
  const assignedIds = new Set<string>();
  const contextIds: string[] = [];
  for (const stay of plan.stays) {
    if (!stay.arrivalFlightId) continue;
    const arrival = flights.get(stay.arrivalFlightId);
    if (!arrival || arrival.direction !== "arrival" || arrival.visitId !== stay.visitId ||
        Date.parse(arrival.scheduled) !== Date.parse(stay.start) || assignedIds.has(arrival.id) || stay.towIn) {
      throw new Error(`Invalid gate-wait arrival endpoint: ${stay.id}`);
    }
    assignedIds.add(arrival.id);
    const time = Date.parse(arrival.scheduled);
    if (time < start || time >= end) contextIds.push(arrival.id);
    else arrivals.set(stay.id, arrival.id);
  }
  const contributions: GateWaitContribution[] = [];
  if (buffers.availability !== "invalid") {
    for (const handover of buffers.handovers) {
      const arrivalId = arrivals.get(handover.next.id);
      if (!arrivalId) continue;
      const arrival = flights.get(arrivalId);
      const predecessor = stays.get(handover.previous.id);
      if (!arrival || !predecessor) throw new Error("Missing gate-wait handover evidence.");
      if (predecessor.departureFlightId) {
        const departure = flights.get(predecessor.departureFlightId);
        if (!departure || departure.direction !== "departure" || departure.visitId !== predecessor.visitId ||
            Date.parse(departure.scheduled) !== Date.parse(predecessor.end) || predecessor.towOut) {
          throw new Error(`Invalid gate-wait predecessor release: ${predecessor.id}`);
        }
      }
      contributions.push({
        handover, arrival_id: arrival.id, arrival_flight: arrival.flight,
        predecessor_release_kind: predecessor.towOut ? "tow" : predecessor.departureFlightId ? "departure" : "occupancy-end",
        release_delay_probability: assumption.release_delay_probability,
        conditional_release_delay_minutes: assumption.expected_release_delay_minutes_given_delay,
        gap_minutes: handover.minutes,
        estimated_wait_minutes: assumption.release_delay_probability *
          Math.max(0, assumption.expected_release_delay_minutes_given_delay - handover.minutes),
      });
    }
  }
  const assessed = new Set(contributions.map(item => item.arrival_id));
  const unassessed = [...arrivals.values()].filter(id => !assessed.has(id)).sort().map(arrival_id => ({
    arrival_id,
    reason: buffers.availability === "invalid" ? "overlapping-occupancy" as const : "no-complete-predecessor-handover" as const,
  }));
  const available = contributions.length > 0;
  return {
    availability: buffers.availability === "invalid" ? "invalid" : available ? "available" : "not-applicable",
    contributions, assigned_arrival_ids: [...arrivals.values()].sort(), context_arrival_ids: contextIds.sort(), unassessed,
    summary: {
      assigned_arrivals_in_horizon: arrivals.size, assessed_arrivals: assessed.size, unassessed_arrivals: unassessed.length,
      context_arrivals: contextIds.length,
      arrivals_with_positive_estimate: contributions.filter(item => item.estimated_wait_minutes > 0).length,
      total_wait_minutes: available ? contributions.reduce((sum, item) => sum + item.estimated_wait_minutes, 0) : null,
      maximum_arrival_wait_minutes: available ? Math.max(...contributions.map(item => item.estimated_wait_minutes)) : null,
    },
  };
}

export function evaluateGateWaitPlans(
  snapshot: PreparedScenario,
  requestedProfile: GateWaitProfile = DEFAULT_GATE_WAIT_PROFILE,
  assumptionId?: string,
): GateWaitEvaluation {
  const profile = parseGateWaitProfile(requestedProfile);
  const selectedId = assumptionId === undefined ? profile.default_assumption_id : assumptionId;
  const assumption = profile.assumptions.find(item => item.id === selectedId);
  if (!assumption) throw new Error(`Unknown gate-wait assumption: ${assumptionId}`);
  const buffers = evaluateBufferPlans(snapshot);
  const evaluate = (variant: PlanVariant): GateWaitPlan => {
    const { buffers: evidence, ...plan } = buffers.variants[variant];
    return { ...plan, waiting: calculateWaiting(snapshot, snapshot.variants[variant], evidence, assumption) };
  };
  const baseline = evaluate("baseline"), variant = evaluate("tow-options");
  const original = baseline.waiting.contributions.map(item => item.arrival_id).sort();
  const revised = variant.waiting.contributions.map(item => item.arrival_id).sort();
  const assessedSetsDiffer = JSON.stringify(original) !== JSON.stringify(revised);
  const comparable = !buffers.comparison.assigned_sets_differ && !assessedSetsDiffer;
  const before = baseline.waiting.summary.total_wait_minutes, after = variant.waiting.summary.total_wait_minutes;
  return {
    metric: GATE_WAIT_METRIC, profile, assumption, demand_id: snapshot.demand_id, horizon: buffers.horizon,
    population_count: buffers.population_count, variants: { baseline, "tow-options": variant },
    comparison: {
      assigned_sets_differ: buffers.comparison.assigned_sets_differ, assessed_sets_differ: assessedSetsDiffer,
      wait_delta_minutes: comparable && before !== null && after !== null ? after - before : null,
    },
  };
}
