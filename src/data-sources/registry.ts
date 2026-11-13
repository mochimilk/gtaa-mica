import { createOperationsDataset, type OperationsDataset } from "../operations/dataset";
import { createFixtureDataset } from "../stand-timeline-demo/fixtureDataset";
import { adaptPreparedSchedule } from "./preparedAdapter";
import type { PlanVariant } from "./preparedTypes";
import { validateCapacitySnapshot } from "../overlays/capacity";
import { validateTowWindowsSnapshot } from "../overlays/towWindows";
import { validateAccommodationCapacity, validateAccommodationSnapshot } from "../overlays/accommodation";
import { validateAtlasCapacity } from "../overlays/atlas";
import type { OverlayData } from "../overlays/profiles";
import { preparePlanComparison } from "./planComparison";

export interface SourceSelection {
  source: string;
  scenario?: string;
  plan: PlanVariant;
}

export interface ScheduleScenario {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly plans: readonly PlanVariant[];
  readonly load: (plan: PlanVariant) => Promise<OperationsDataset>;
}

export interface ScheduleSource {
  readonly id: string;
  readonly label: string;
  readonly defaultScenario: string;
  readonly scenarios: readonly ScheduleScenario[];
}

type JsonModule = { default: unknown };
type ContosoBundle = readonly [JsonModule, JsonModule, JsonModule, JsonModule, JsonModule];

function preparedScenario(
  airportId: string, id: string, label: string, description: string, load: () => Promise<JsonModule>,
): ScheduleScenario {
  return {
    id, label, description, plans: ["baseline", "tow-options"],
    load: async plan => {
      const snapshot = await load();
      return adaptPreparedSchedule(snapshot.default, { airportId, caseId: id }, plan);
    },
  };
}

function contosoScenario(id: string, label: string, description: string, load: () => Promise<ContosoBundle>): ScheduleScenario {
  return { id, label, description, plans: ["baseline", "tow-options"], load: async plan => {
    const [schedule, capacity, towWindows, accommodation, atlas] = await load();
    const snapshot = schedule.default;
    const dataset = adaptPreparedSchedule(snapshot, { airportId: "contoso", caseId: id }, plan);
    const [buffers, waiting, decisionReview] = await Promise.all([
      import("../../data/airports/contoso/evaluation/buffer-profile.json"),
      import("../../data/airports/contoso/evaluation/gate-wait-profile.json"),
      import("../../data/airports/contoso/evaluation/decision-review-profile.json"),
    ]);
    const [capacityEvidence, towEvidence, accommodationEvidence] = await Promise.all([
      validateCapacitySnapshot(capacity.default, snapshot), validateTowWindowsSnapshot(towWindows.default, snapshot),
      validateAccommodationSnapshot(accommodation.default, snapshot),
    ]);
    if (capacityEvidence.airport_fingerprint !== towEvidence.airport_fingerprint ||
        capacityEvidence.demand_fingerprint !== towEvidence.demand_fingerprint) {
      throw new Error("Prepared overlays have different airport or demand provenance. Regenerate their evidence together.");
    }
    validateAccommodationCapacity(accommodationEvidence, capacityEvidence);
    const atlasEvidence = await validateAtlasCapacity(atlas.default, capacityEvidence);
    const comparison = await preparePlanComparison(snapshot);
    const overlays: Pick<OverlayData, "profiles" | "companions"> = {
      profiles: {
        buffers: buffers.default, "gate-wait": waiting.default, capacity: capacityEvidence, "tow-windows": towEvidence,
        accommodation: accommodationEvidence, "decision-review": decisionReview.default,
      },
      companions: { "capacity-atlas": atlasEvidence, "plan-comparison": comparison },
    };
    return createOperationsDataset({ ...dataset, overlays: { ...overlays, airportId: "contoso", datasetId: dataset.id } });
  } };
}

export const SCHEDULE_SOURCES: readonly ScheduleSource[] = [
  { id: "fixture", label: "Original fixture", defaultScenario: "original", scenarios: [
    { id: "original", label: "Original fixture", description: "Editable sample board, not a prepared airport scenario.",
      plans: ["baseline"], load: async () => createFixtureDataset() },
  ] },
  { id: "contoso", label: "Contoso", defaultScenario: "full-day", scenarios: [
    contosoScenario("comfortable", "Comfortable", "36 visits. Both plans cover all visits without added tow movements.", () => Promise.all([
      import("./prepared/contoso/comfortable.json"),
      import("./prepared/contoso/comfortable.capacity.json"),
      import("./prepared/contoso/comfortable.tow-windows.json"),
      import("./prepared/contoso/comfortable.accommodation.json"),
      import("./prepared/contoso/comfortable.atlas.json"),
    ])),
    contosoScenario("constrained", "Constrained", "41 visits. Baseline covers 40; Tow options covers all 41 with 2 tow movements.", () => Promise.all([
      import("./prepared/contoso/constrained.json"),
      import("./prepared/contoso/constrained.capacity.json"),
      import("./prepared/contoso/constrained.tow-windows.json"),
      import("./prepared/contoso/constrained.accommodation.json"),
      import("./prepared/contoso/constrained.atlas.json"),
    ])),
    contosoScenario("full-day", "Full day", "160 visits. Both plans cover 149 visits; 11 remain unassigned.", () => Promise.all([
      import("./prepared/contoso/full-day.json"),
      import("./prepared/contoso/full-day.capacity.json"),
      import("./prepared/contoso/full-day.tow-windows.json"),
      import("./prepared/contoso/full-day.accommodation.json"),
      import("./prepared/contoso/full-day.atlas.json"),
    ])),
  ] },
  { id: "gtaa", label: "GTAA - Toronto Pearson", defaultScenario: "full-day", scenarios: [
    preparedScenario("gtaa", "full-day", "Full day", "160 visits. Schedule-only; no airport-specific analysis profiles.",
      () => import("./prepared/gtaa/full-day.json")),
  ] },
];

export function validateSourceSelection(source: string, plan: string, scenario?: string): SourceSelection & { scenario: string } {
  const definition = SCHEDULE_SOURCES.find(item => item.id === source);
  const selected = definition?.scenarios.find(item => item.id === (scenario ?? definition.defaultScenario));
  const variant = selected?.plans.find(item => item === plan);
  if (!definition || !selected || !variant) throw new Error(`Unknown schedule source, scenario or plan: ${source}/${scenario ?? "default"}/${plan}`);
  return { source, scenario: selected.id, plan: variant };
}

export function readSourceSelection(search: string) {
  const params = new URLSearchParams(search);
  return validateSourceSelection(params.get("source") ?? "fixture", params.get("plan") ?? "baseline", params.get("scenario") ?? undefined);
}

export function sourceSelectionUrl(current: URL, selection: SourceSelection): string {
  const valid = validateSourceSelection(selection.source, selection.plan, selection.scenario);
  const next = new URL(current);
  next.searchParams.set("source", valid.source);
  next.searchParams.set("scenario", valid.scenario);
  next.searchParams.set("plan", valid.plan);
  return next.href;
}

export async function loadSourceDataset(selection: SourceSelection): Promise<OperationsDataset> {
  const valid = validateSourceSelection(selection.source, selection.plan, selection.scenario);
  const source = SCHEDULE_SOURCES.find(item => item.id === valid.source)!;
  return source.scenarios.find(item => item.id === valid.scenario)!.load(valid.plan);
}
