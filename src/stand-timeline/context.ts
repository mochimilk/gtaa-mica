import { createContext, useContext } from "react";
import type { TimeScale } from "./geometry";
import type { BarDatum, ChartIntent, DropPreview, Millis, TimelineRow } from "./model";

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

/**
 * Which block of rows a "labels" or "plot" region draws: the rows pinned
 * under the top ruler (`pinnedRows`), or the body, which scrolls beneath them.
 */
export type TimelineSection = "pinned" | "body";

/** A row by where it is: its section and its place there. */
export interface RowRef {
  section: TimelineSection;
  index: number;
}

/** A row by where it is, with the row itself. */
export interface RowAt extends RowRef {
  row: TimelineRow;
}

/** One bar being dragged, by one pointer. */
export interface BarDrag {
  id: string;
  /** The row it was taken from. */
  from: RowRef;
  /** The row it would be dropped on. */
  to: RowAt;
  /** How far it has been dragged in time, ms; 0 keeps its times. */
  shiftMs: number;
  /** The host's verdict there; null while it would land where it started. */
  preview: DropPreview | null;
}

/** The bars being dragged now, by pointer, shared by both sections so a bar can go from one to the other. */
export interface DragStore {
  get(): ReadonlyMap<number, BarDrag>;
  set(pointerId: number, drag: BarDrag | null): void;
  subscribe(listener: () => void): () => void;
}

export function createDragStore(): DragStore {
  let drags: ReadonlyMap<number, BarDrag> = new Map();
  const listeners = new Set<() => void>();
  return {
    get: () => drags,
    set(pointerId, drag) {
      const next = new Map(drags);
      if (drag) next.set(pointerId, drag);
      else next.delete(pointerId);
      drags = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The bar under the pointer and the one with keyboard focus, by occupancy id. */
export interface BarHover {
  hoveredId: string | null;
  focusedId: string | null;
}

/**
 * The bars hovered and focused now, shared by both sections and every layer,
 * so a layer drawn apart from the bars (their labels, say) can follow them.
 */
export interface HoverStore {
  get(): BarHover;
  set(change: Partial<BarHover>): void;
  subscribe(listener: () => void): () => void;
}

export function createHoverStore(): HoverStore {
  let hover: BarHover = { hoveredId: null, focusedId: null };
  const listeners = new Set<() => void>();
  return {
    get: () => hover,
    set(change) {
      const next = { ...hover, ...change };
      if (next.hoveredId === hover.hoveredId && next.focusedId === hover.focusedId) return;
      hover = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface TimelineContextValue {
  scale: TimeScale;
  /** The section being drawn: its rows are `rows`, its bars `bars`, its height `plotHeight`. */
  section: TimelineSection;
  /** The rows of the section being drawn. */
  rows: readonly TimelineRow[];
  /** The visible bars on those rows, in that section's own coordinates. */
  bars: readonly BarDatum[];
  /** The visible bars of both sections, each in its own section's coordinates. */
  allBars: readonly BarDatum[];
  rowHeight: number;
  /** The bars' corner radius, px; see StandTimelineProps.barRadius. */
  barRadius: number;
  labelWidth: number;
  axisHeight: number;
  plotWidth: number;
  /** Height of the section being drawn. */
  plotHeight: number;
  timeZone: string;
  formatTime: (t: Millis) => string;
  emit: (intent: ChartIntent) => void;
  /** Set when bars can be dragged to other rows; see StandTimelineProps.previewDrop. */
  previewDrop?: (occupancyId: string, rowId: string, shiftMs: number) => DropPreview;
  /** Set when dragged bars can move in time too; see StandTimelineProps.dragSnapMs. */
  dragSnapMs?: number;
  /**
   * The row at a height on screen (clientY), in either section: a pinned row
   * where they show, a body row below them, the nearest row past either end.
   * Null before the chart is laid out.
   */
  rowAt: (clientY: number) => RowAt | null;
  /** The bars being dragged now. */
  drags: DragStore;
  /** The bars hovered and focused now. */
  hover: HoverStore;
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
