import type { ChartIntent } from "../stand-timeline";

/** Host-side selection reducer: the chart only proposes, the host decides. */
export function applySelection(
  current: readonly string[],
  intent: Extract<ChartIntent, { type: "select" }>,
): string[] {
  if (intent.mode === "replace") return intent.occupancyIds;
  const next = new Set(current);
  for (const id of intent.occupancyIds) {
    if (next.has(id)) next.delete(id);
    else next.add(id);
  }
  return [...next];
}
