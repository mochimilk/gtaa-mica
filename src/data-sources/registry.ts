import type { OperationsDataset } from "../operations/dataset";
import { createFixtureDataset } from "../stand-timeline-demo/fixtureDataset";
import { adaptPreparedSchedule } from "./preparedAdapter";
import type { PlanVariant } from "./preparedTypes";

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

function preparedSource(id: string, label: string, load: () => Promise<{ default: unknown }>): ScheduleSource {
  return {
    id, label, plans: ["baseline", "tow-options"],
    load: async plan => adaptPreparedSchedule((await load()).default, { airportId: id, caseId: "full-day" }, plan),
  };
}

export const SCHEDULE_SOURCES: readonly ScheduleSource[] = [
  { id: "fixture", label: "Original fixture", plans: ["baseline"], load: async () => createFixtureDataset() },
  preparedSource("contoso", "Contoso", () => import("./prepared/contoso/full-day.json", { with: { type: "json" } })),
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
