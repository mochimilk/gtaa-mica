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

export const OVERLAY_PROFILE_PARSERS: Readonly<Record<string, (value: unknown) => { id: string }>> = {
  buffers: parseBufferProfile,
  "gate-wait": parseGateWaitProfile,
};

/** Runs during source bootstrap, before any UI or session stores initialize. */
export function validateOverlayData(data: OverlayData, source: { airportId: string; id: string }): void {
  if (!record(data) || data.airportId !== source.airportId || data.datasetId !== source.id || !record(data.profiles)) {
    throw new Error("Overlay data does not match the selected airport and dataset.");
  }
  for (const [id, value] of Object.entries(data.profiles)) {
    const parser = Object.hasOwn(OVERLAY_PROFILE_PARSERS, id) ? OVERLAY_PROFILE_PARSERS[id] : undefined;
    if (!parser) throw new Error(`Unregistered overlay data: ${id}`);
    const profile = parser(value);
    if (!profile.id.startsWith(`${source.airportId}:`)) throw new Error(`Overlay profile ${profile.id} belongs to another airport.`);
  }
}
