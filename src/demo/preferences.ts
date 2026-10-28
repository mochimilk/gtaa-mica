export type ScenarioId = "comfortable" | "constrained" | "full-day";
export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  comfortable: "Comfortable", constrained: "Constrained", "full-day": "Full day",
};
export type PlanVariant = "baseline" | "tow-options";
export type DemoSource = "original" | "contoso" | "gtaa";
export interface DemoPreferences {
  version: 1;
  source: DemoSource;
  scenario: ScenarioId;
  variant: PlanVariant;
}

export const DEMO_STORAGE_KEY = "gtaa-mica.demo.v1";
export const DEFAULT_DEMO_PREFERENCES: DemoPreferences = {
  version: 1, source: "original", scenario: "comfortable", variant: "baseline",
};
export const isScenarioId = (value: string): value is ScenarioId =>
  value === "comfortable" || value === "constrained" || value === "full-day";
export const isPlanVariant = (value: string): value is PlanVariant =>
  value === "baseline" || value === "tow-options";
export const isDemoSource = (value: string): value is DemoSource =>
  value === "original" || value === "contoso" || value === "gtaa";
export const scenariosForSource = (source: DemoSource): readonly ScenarioId[] =>
  source === "gtaa" ? ["full-day"] : ["comfortable", "constrained", "full-day"];

export function parseDemoPreferences(value: unknown): DemoPreferences {
  if (typeof value !== "object" || value === null ||
      !("version" in value) || value.version !== 1 ||
      !("source" in value) || typeof value.source !== "string" || !isDemoSource(value.source) ||
      !("scenario" in value) || typeof value.scenario !== "string" || !isScenarioId(value.scenario) ||
      !scenariosForSource(value.source).includes(value.scenario) ||
      !("variant" in value) || typeof value.variant !== "string" || !isPlanVariant(value.variant) ||
      Object.keys(value).some(key => !["version", "source", "scenario", "variant"].includes(key))) {
    throw new Error("Saved demo settings are invalid or from an unsupported version.");
  }
  return { version: 1, source: value.source, scenario: value.scenario, variant: value.variant };
}
