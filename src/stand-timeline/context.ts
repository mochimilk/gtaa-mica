import { createContext, useContext } from "react";
import type { TimeScale } from "./geometry";
import type { BarDatum, ChartIntent, Millis, TimelineRow } from "./model";

/**
 * The root renders its children once per region; each layer draws only in the
 * regions it cares about. Custom layers use `useTimelineRegion()` the same way.
 */
export type TimelineRegion =
  | "corner"
  | "axis"
  | "labels"
  | "plot"
  | "cornerBottom"
  | "axisBottom";

export interface TimelineContextValue {
  scale: TimeScale;
  rows: readonly TimelineRow[];
  bars: readonly BarDatum[];
  rowHeight: number;
  labelWidth: number;
  axisHeight: number;
  plotWidth: number;
  plotHeight: number;
  timeZone: string;
  formatTime: (t: Millis) => string;
  emit: (intent: ChartIntent) => void;
}

export const TimelineContext = createContext<TimelineContextValue | null>(null);
export const RegionContext = createContext<TimelineRegion | null>(null);

export function useTimeline(): TimelineContextValue {
  const ctx = useContext(TimelineContext);
  if (!ctx) throw new Error("useTimeline must be used inside <StandTimeline>");
  return ctx;
}

export function useTimelineRegion(): TimelineRegion | null {
  return useContext(RegionContext);
}
