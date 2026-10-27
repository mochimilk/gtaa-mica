// Running late: the time a late stay's aircraft spends outside its bar (see
// StayDelay), which the chart draws as ghosts, and which other stays that
// time runs into. A ghost that overlaps another stay on its stand, or that
// stay's own ghost, clashes. A drawing rule for the synthetic demo, not an
// allocation rule: moves and swaps still check bars only.
import type { Millis, Occupancy } from "../stand-timeline";
import type { StayDelay } from "./adapter";

/** "start" reaches back from the bar's start (late in), "end" on from its end (late out). */
export type GhostSide = "start" | "end";

export const GHOST_SIDES: readonly GhostSide[] = ["start", "end"];

/** How far the ghost on `side` reaches, ms; 0 when there is none. */
export const ghostMs = (delay: StayDelay | undefined, side: GhostSide): Millis =>
  (side === "start" ? delay?.in : delay?.out) ?? 0;

/** The time the ghost on `side` covers, or null when there is none. */
export function ghostSpan(occupancy: Occupancy, delay: StayDelay | undefined, side: GhostSide): [Millis, Millis] | null {
  const ms = ghostMs(delay, side);
  if (!ms) return null;
  return side === "start" ? [occupancy.start - ms, occupancy.start] : [occupancy.end, occupancy.end + ms];
}

/** Stays each ghost runs into, keyed by `ghostKey`; ghosts that run into nothing are absent. */
export type GhostClashes = ReadonlyMap<string, readonly Occupancy[]>;

export const ghostKey = (occupancyId: string, side: GhostSide) => `${occupancyId}:${side}`;

/** Which ghosts run into another stay on their stand, as the stays sit now. */
export function ghostClashes(
  occupancies: readonly Occupancy[],
  delays: ReadonlyMap<string, StayDelay>,
): GhostClashes {
  // Everything each stay takes up on its stand: its bar and both ghosts.
  const reach = (o: Occupancy, delay: StayDelay | undefined): [Millis, Millis] => [
    o.start - ghostMs(delay, "start"),
    o.end + ghostMs(delay, "end"),
  ];
  const clashes = new Map<string, Occupancy[]>();
  for (const o of occupancies) {
    const delay = delays.get(o.id);
    if (!delay) continue;
    for (const side of GHOST_SIDES) {
      const span = ghostSpan(o, delay, side);
      if (!span) continue;
      const hit = occupancies.filter((other) => {
        if (other.id === o.id || other.rowId !== o.rowId) return false;
        const [start, end] = reach(other, delays.get(other.id));
        return span[0] < end && start < span[1];
      });
      if (hit.length > 0) clashes.set(ghostKey(o.id, side), hit);
    }
  }
  return clashes;
}

/** "55m", "1h 05m". */
export function formatDelay(ms: Millis): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
