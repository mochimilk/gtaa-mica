import type { OperationsDataset } from "../operations/dataset";

export const REQUEST_PROFILE_IDS = ["accommodation", "decision-review"] as const;

export function availableRequests(dataset: OperationsDataset) {
  const profiles = dataset.overlays?.profiles;
  return {
    accommodation: !!profiles && Object.hasOwn(profiles, "accommodation"),
    analysis: !!profiles && Object.hasOwn(profiles, "decision-review"),
  };
}
