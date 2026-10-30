import { ACTIVE_DATASET, activateAccommodationWorkspace } from "./activeDataset";
import { refreshOperationsData } from "./operationsData";
import { refreshDemoData } from "../stand-timeline-demo/demoData";
import { refreshAccommodationAllocation } from "./allocation";
import { clearOutputs } from "./outputs";
import { hideSkyeAlerts } from "./skyeAlerts";
import { endGuestCall } from "../live/callGuests";
import { changeAccommodationSession, createAccommodationSession, type AccommodationAction } from "../overlays/accommodationSession";

let state = createAccommodationSession(ACTIVE_DATASET);
const listeners = new Set<() => void>();
const beforeChange = new Set<() => void>();

export const accommodationSession = () => state;
export function subscribeAccommodationSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function beforeAccommodationChange(listener: () => void): () => void {
  beforeChange.add(listener);
  return () => beforeChange.delete(listener);
}

export function chooseSessionAccommodation(action: AccommodationAction): void {
  const next = changeAccommodationSession(state, action);
  if (next === state) return;
  for (const listener of beforeChange) listener();
  endGuestCall();
  hideSkyeAlerts();
  activateAccommodationWorkspace(next.reference, next.active);
  refreshDemoData();
  refreshOperationsData();
  state = next;
  clearOutputs();
  refreshAccommodationAllocation();
  for (const listener of listeners) listener();
}

if (import.meta.hot) import.meta.hot.accept(() => location.reload());
