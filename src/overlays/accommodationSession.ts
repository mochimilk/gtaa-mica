import type { OperationsDataset } from "../operations/dataset";
import { accommodateDataset, parseAccommodation } from "./accommodation";
import { parseGateWaitProfile } from "./profiles";

export interface AccommodationSession {
  readonly reference: OperationsDataset;
  readonly active: OperationsDataset;
  readonly accepted: { readonly optionId: string; readonly assumptionId: string } | null;
  readonly revision: number;
}

export type AccommodationAction =
  | { type: "accept"; optionId: string; assumptionId: string; confirmed: boolean }
  | { type: "restore" };

export function createAccommodationSession(reference: OperationsDataset): AccommodationSession {
  return { reference, active: reference, accepted: null, revision: 0 };
}

export function changeAccommodationSession(state: AccommodationSession, action: AccommodationAction): AccommodationSession {
  if (action.type === "restore") {
    return state.accepted ? { ...state, active: state.reference, accepted: null, revision: state.revision + 1 } : state;
  }
  if (!action.confirmed) throw new Error("Explicit review confirmation is required to accept accommodation.");
  const reference = state.reference;
  if (!reference.preparedPlan || !reference.overlays?.profiles.accommodation || reference.capabilities.editStands) {
    throw new Error("This reference has no validated session accommodation.");
  }
  const waiting = parseGateWaitProfile(reference.overlays.profiles["gate-wait"]);
  if (!waiting.assumptions.some(item => item.id === action.assumptionId)) {
    throw new Error("A known source-owned waiting assumption is required for acceptance.");
  }
  const evidence = parseAccommodation(reference.overlays.profiles.accommodation);
  const active = accommodateDataset(reference, evidence, action.optionId, action.assumptionId);
  if (state.accepted?.optionId === action.optionId && state.accepted.assumptionId === action.assumptionId) return state;
  return {
    reference, active, accepted: { optionId: action.optionId, assumptionId: action.assumptionId },
    revision: state.revision + 1,
  };
}
