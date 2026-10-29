import { createFixtureDataset } from "../stand-timeline-demo/fixtureDataset";
import type { OperationsDataset } from "./dataset";

export let ACTIVE_DATASET = createFixtureDataset();
let sealed = false;
let initialized = false;

/** Called only by bootstrap, before importing App and its session stores. */
export function initializeActiveDataset(dataset: OperationsDataset): void {
  if (sealed || initialized) throw new Error("Changing the active schedule requires a page reload.");
  ACTIVE_DATASET = dataset;
  initialized = true;
}

export function sealActiveDataset(): void {
  sealed = true;
}

export const READ_ONLY_REASON = "This schedule is read-only. Stand editing and fixture-rule recommendations are unavailable; browsing and filtering remain available.";

export function requireStandEditing(): void {
  if (!ACTIVE_DATASET.capabilities.editStands) throw new Error(READ_ONLY_REASON);
}

export function requireFixtureAnalyses(): void {
  if (!ACTIVE_DATASET.capabilities.fixtureAnalyses) throw new Error("Fixture-only analyses are unavailable for this schedule.");
}

if (import.meta.hot) import.meta.hot.accept(() => location.reload());
