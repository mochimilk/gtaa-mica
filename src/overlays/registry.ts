import type { OperationsDataset } from "../operations/dataset";
import { validateOverlayData } from "./profiles";

export interface OverlayRegistration {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly reviewOnly?: boolean;
}

export const OVERLAY_REGISTRATIONS = [
  { id: "buffers", label: "Scheduled buffers", description: "Scheduled stand-release gaps, not minimum operational separation rules." },
  { id: "gate-wait", label: "Synthetic gate waiting", description: "Illustrative release-delay assumptions, not a forecast or actual delay." },
  { id: "capacity", label: "Single-turn capacity", description: "Feasible arrival starts for one additional turn against the fixed plan, not additive slots." },
  { id: "tow-windows", label: "One-way tow windows", description: "Destination-checked relocation start ranges, not scheduled movements or parking-and-return cycles." },
  { id: "accommodation", label: "Late-request accommodation", reviewOnly: true, description: "Read-only previews of a synthetic request and bounded whole-turn stand reassignments; nothing is accepted or applied." },
] as const satisfies readonly OverlayRegistration[];

export type OverlayId = typeof OVERLAY_REGISTRATIONS[number]["id"];

export function availableOverlays(
  dataset: OperationsDataset,
  registrations: readonly OverlayRegistration[] = OVERLAY_REGISTRATIONS,
): readonly OverlayRegistration[] {
  const ids = new Set<string>();
  for (const feature of registrations) {
    if (!feature.id.trim() || ids.has(feature.id)) throw new Error(`Duplicate or empty overlay registration: ${feature.id}`);
    ids.add(feature.id);
  }
  const data = dataset.overlays;
  if (!data) return [];
  validateOverlayData(data, dataset);
  for (const id of Object.keys(data.profiles)) {
    if (!ids.has(id)) throw new Error(`Overlay data has no toolbar registration: ${id}`);
  }
  return registrations.filter(feature => Object.hasOwn(data.profiles, feature.id));
}

export interface OverlaySelection {
  enabled: readonly string[];
  review: string | null;
}

export const EMPTY_OVERLAY_SELECTION: OverlaySelection = { enabled: [], review: null };

export function changeOverlaySelection(
  state: OverlaySelection,
  available: readonly OverlayRegistration[],
  action: { type: "toggle" | "inspect"; id: string } | { type: "reset" } | { type: "close" },
): OverlaySelection {
  const ids = new Set(available.map(feature => feature.id));
  const current = {
    enabled: state.enabled.filter(id => available.some(feature => feature.id === id && !feature.reviewOnly)),
    review: state.review && ids.has(state.review) ? state.review : null,
  };
  if (action.type === "reset") return EMPTY_OVERLAY_SELECTION;
  if (action.type === "close") return { ...current, review: null };
  if (!ids.has(action.id)) throw new Error(`Overlay is unavailable: ${action.id}`);
  if (action.type === "inspect") return { ...current, review: action.id };
  if (available.find(feature => feature.id === action.id)?.reviewOnly) throw new Error(`Feature is review-only: ${action.id}`);
  return {
    ...current,
    enabled: current.enabled.includes(action.id) ? current.enabled.filter(id => id !== action.id) : [...current.enabled, action.id],
  };
}
