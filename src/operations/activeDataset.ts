import { createFixtureDataset } from "../stand-timeline-demo/fixtureDataset";
import type { OperationsDataset } from "./dataset";

export let ACTIVE_DATASET = createFixtureDataset();
let sealed = false;
let initialized = false;
let approvedDataset = ACTIVE_DATASET;

/** Called only by bootstrap, before importing App and its session stores. */
export function initializeActiveDataset(dataset: OperationsDataset): void {
  if (sealed || initialized) throw new Error("Changing the active schedule requires a page reload.");
  ACTIVE_DATASET = dataset;
  approvedDataset = dataset;
  initialized = true;
}

/** Only validated accommodation may amend the already-loaded source in this page. */
export function activateAccommodationWorkspace(reference: OperationsDataset, dataset: OperationsDataset): void {
  if (!initialized || reference !== approvedDataset || reference.capabilities.editStands ||
      dataset.capabilities.editStands || dataset.capabilities.fixtureAnalyses ||
      dataset.airportId !== reference.airportId || dataset.date !== reference.date ||
      JSON.stringify(dataset.domain) !== JSON.stringify(reference.domain) ||
      JSON.stringify(dataset.stands) !== JSON.stringify(reference.stands) ||
      JSON.stringify(dataset.timeline.rows) !== JSON.stringify(reference.timeline.rows) ||
      (dataset !== reference && (!dataset.id.startsWith(`${reference.id}/accommodation/`) || dataset.preparedPlan ||
        dataset.overlays?.companions || Object.keys(dataset.overlays?.profiles ?? {}).some(id => !["buffers", "gate-wait"].includes(id))))) {
    throw new Error("Accommodation cannot change the approved source or reuse reference analysis evidence.");
  }
  ACTIVE_DATASET = dataset;
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
