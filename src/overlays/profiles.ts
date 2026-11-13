import type { OperationsDatasetInput } from "../operations/dataset";
import { validateCapacityDataset } from "./capacity";
import { validateTowWindowsDataset } from "./towWindows";
import { validateAccommodationDataset } from "./accommodation";
import { validateAtlasDataset } from "./atlas";
import { validatePlanComparisonDataset } from "../data-sources/planComparison";

export interface BufferProfile {
  schema_version: "1.0.0";
  id: string;
  metric_id: "airport-scheduled-stand-buffer";
  metric_version: "1.0.0";
  threshold_minutes: number;
}

export interface ReleaseAssumption {
  id: string;
  label: string;
  release_delay_probability: number;
  expected_release_delay_minutes_given_delay: number;
}

export interface GateWaitProfile {
  schema_version: "1.0.0";
  id: string;
  metric_id: "airport-predicted-stand-wait";
  metric_version: "1.0.0";
  model_id: string;
  model_version: "1.0.0";
  source: "synthetic";
  default_assumption_id: string;
  assumptions: ReleaseAssumption[];
}

export interface OverlayData {
  airportId: string;
  datasetId: string;
  profiles: Readonly<Record<string, unknown>>;
  companions?: Readonly<Record<string, unknown>>;
}

export interface DecisionReviewProfile {
  schema_version: "1.0.0";
  id: string;
  metric_id: "airport-decision-review";
  metric_version: "1.0.0";
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every(key => keys.includes(key));

// These parsers retain feature/solver's profile contracts, without airport defaults.
export function parseBufferProfile(value: unknown): BufferProfile {
  if (!record(value) || !onlyKeys(value, ["$schema", "schema_version", "id", "metric_id", "metric_version", "threshold_minutes"]) ||
      value.schema_version !== "1.0.0" || !text(value.id) ||
      value.metric_id !== "airport-scheduled-stand-buffer" || value.metric_version !== "1.0.0" ||
      !inRange(value.threshold_minutes, 0, 120) || ("$schema" in value && typeof value.$schema !== "string")) {
    throw new Error("Invalid or unsupported buffer evaluation profile.");
  }
  return {
    schema_version: value.schema_version, id: value.id, metric_id: value.metric_id,
    metric_version: value.metric_version, threshold_minutes: value.threshold_minutes,
  };
}

export function parseGateWaitProfile(value: unknown): GateWaitProfile {
  if (!record(value) || !onlyKeys(value, ["$schema", "schema_version", "id", "metric_id", "metric_version", "model_id", "model_version", "source", "default_assumption_id", "assumptions"]) ||
      value.schema_version !== "1.0.0" || !text(value.id) || value.metric_id !== "airport-predicted-stand-wait" ||
      value.metric_version !== "1.0.0" || !text(value.model_id) || value.model_version !== "1.0.0" ||
      value.source !== "synthetic" || !text(value.default_assumption_id) ||
      !Array.isArray(value.assumptions) || !value.assumptions.length ||
      ("$schema" in value && typeof value.$schema !== "string")) {
    throw new Error("Invalid or unsupported synthetic gate-wait profile.");
  }
  const ids = new Set<string>();
  const assumptions = value.assumptions.map((item: unknown): ReleaseAssumption => {
    if (!record(item) || !onlyKeys(item, ["id", "label", "release_delay_probability", "expected_release_delay_minutes_given_delay"]) ||
        !text(item.id) || ids.has(item.id) || !text(item.label) ||
        !inRange(item.release_delay_probability, 0, 1) ||
        !inRange(item.expected_release_delay_minutes_given_delay, 0, 240)) {
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

export function parseDecisionReviewProfile(value: unknown): DecisionReviewProfile {
  if (!record(value) || !onlyKeys(value, ["$schema", "schema_version", "id", "metric_id", "metric_version"]) ||
      value.schema_version !== "1.0.0" || !text(value.id) || /\s/.test(value.id) ||
      value.metric_id !== "airport-decision-review" || value.metric_version !== "1.0.0" ||
      ("$schema" in value && typeof value.$schema !== "string")) {
    throw new Error("Invalid or unsupported decision-review profile.");
  }
  return { schema_version: value.schema_version, id: value.id, metric_id: value.metric_id, metric_version: value.metric_version };
}

function validateDecisionReviewProfile(value: unknown, source: OperationsDatasetInput): DecisionReviewProfile {
  const profile = parseDecisionReviewProfile(value), plan = source.preparedPlan;
  if (!plan || source.capabilities?.editStands !== false ||
      !["baseline", "tow-options"].includes(plan.variant) || !plan.caseId.trim() || !plan.demandId.trim() ||
      !/^[0-9a-f]{64}$/.test(plan.requestFingerprint) || source.id !== `${plan.demandId}/${plan.variant}`) {
    throw new Error("Decision review requires an exact read-only prepared dataset/plan.");
  }
  return profile;
}

export const OVERLAY_PROFILE_PARSERS: Readonly<Record<string, (value: unknown, source: OperationsDatasetInput) => { id: string }>> = {
  buffers: parseBufferProfile,
  "gate-wait": parseGateWaitProfile,
  capacity: validateCapacityDataset,
  "tow-windows": validateTowWindowsDataset,
  accommodation: validateAccommodationDataset,
  "decision-review": validateDecisionReviewProfile,
};

const COMPANION_PARSERS: Readonly<Record<string, (
  value: unknown, source: OperationsDatasetInput, profiles: Readonly<Record<string, unknown>>,
) => { id: string }>> = {
  "capacity-atlas": validateAtlasDataset,
  "plan-comparison": validatePlanComparisonDataset,
};

/** Runs during source bootstrap, before any UI or session stores initialize. */
export function validateOverlayData(data: OverlayData, source: OperationsDatasetInput): void {
  if (!record(data) || data.airportId !== source.airportId || data.datasetId !== source.id || !record(data.profiles)) {
    throw new Error("Overlay data does not match the selected airport and dataset.");
  }
  for (const [id, value] of Object.entries(data.profiles)) {
    const parser = Object.hasOwn(OVERLAY_PROFILE_PARSERS, id) ? OVERLAY_PROFILE_PARSERS[id] : undefined;
    if (!parser) throw new Error(`Unregistered overlay data: ${id}`);
    const profile = parser(value, source);
    if (!profile.id.startsWith(`${source.airportId}:`)) throw new Error(`Overlay profile ${profile.id} belongs to another airport.`);
  }
  if (data.companions !== undefined) {
    if (!record(data.companions)) throw new Error("Invalid overlay companion data.");
    for (const [id, value] of Object.entries(data.companions)) {
      const parser = Object.hasOwn(COMPANION_PARSERS, id) ? COMPANION_PARSERS[id] : undefined;
      if (!parser) throw new Error(`Unregistered overlay companion: ${id}`);
      const companion = parser(value, source, data.profiles);
      if (!companion.id.startsWith(`${source.airportId}:`)) throw new Error("Overlay companion belongs to another airport.");
    }
  }
}
