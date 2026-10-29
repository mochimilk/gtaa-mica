import { createOperationsDataset, type OperationsDataset } from "../operations/dataset";
import { createFixtureDataset } from "../stand-timeline-demo/fixtureDataset";
import { adaptPreparedSchedule } from "./preparedAdapter";
import type { PlanVariant } from "./preparedTypes";
import { validateCapacitySnapshot } from "../overlays/capacity";

export interface SourceSelection {
  source: string;
  plan: PlanVariant;
}

export interface ScheduleSource {
  readonly id: string;
  readonly label: string;
  readonly plans: readonly PlanVariant[];
  readonly load: (plan: PlanVariant) => Promise<OperationsDataset>;
}

function preparedSource(
  id: string, label: string, load: () => Promise<{ default: unknown }>,
  loadOverlays?: (snapshot: unknown) => Promise<Readonly<Record<string, unknown>>>,
): ScheduleSource {
  return {
    id, label, plans: ["baseline", "tow-options"],
    load: async plan => {
      const snapshot = await load();
      const dataset = adaptPreparedSchedule(snapshot.default, { airportId: id, caseId: "full-day" }, plan);
      const profiles = await loadOverlays?.(snapshot.default);
      return profiles ? createOperationsDataset({
        ...dataset, overlays: { airportId: id, datasetId: dataset.id, profiles },
      }) : dataset;
    },
  };
}

export const SCHEDULE_SOURCES: readonly ScheduleSource[] = [
  { id: "fixture", label: "Original fixture", plans: ["baseline"], load: async () => createFixtureDataset() },
  preparedSource("contoso", "Contoso", () => import("./prepared/contoso/full-day.json", { with: { type: "json" } }), async snapshot => {
    const [buffers, waiting, capacity] = await Promise.all([
      import("../../data/airports/contoso/evaluation/buffer-profile.json", { with: { type: "json" } }),
      import("../../data/airports/contoso/evaluation/gate-wait-profile.json", { with: { type: "json" } }),
      import("./prepared/contoso/full-day.capacity.json", { with: { type: "json" } }),
    ]);
    return { buffers: buffers.default, "gate-wait": waiting.default, capacity: await validateCapacitySnapshot(capacity.default, snapshot) };
  }),
  preparedSource("gtaa", "GTAA - Toronto Pearson", () => import("./prepared/gtaa/full-day.json", { with: { type: "json" } })),
];

export function validateSourceSelection(source: string, plan: string): SourceSelection {
  const definition = SCHEDULE_SOURCES.find(item => item.id === source);
  const variant = definition?.plans.find(item => item === plan);
  if (!definition || !variant) throw new Error(`Unknown schedule source or plan: ${source}/${plan}`);
  return { source, plan: variant };
}

export function readSourceSelection(search: string): SourceSelection {
  const params = new URLSearchParams(search);
  return validateSourceSelection(params.get("source") ?? "fixture", params.get("plan") ?? "baseline");
}

export function sourceSelectionUrl(current: URL, selection: SourceSelection): string {
  const valid = validateSourceSelection(selection.source, selection.plan);
  const next = new URL(current);
  next.searchParams.set("source", valid.source);
  next.searchParams.set("plan", valid.plan);
  return next.href;
}

export async function loadSourceDataset(selection: SourceSelection): Promise<OperationsDataset> {
  const valid = validateSourceSelection(selection.source, selection.plan);
  const source = SCHEDULE_SOURCES.find(item => item.id === valid.source)!;
  return source.load(valid.plan);
}
