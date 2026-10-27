// Chart-neutral data model. Domain meaning (flights, registrations, tows,
// allocation rules) belongs to the host; the chart only draws intervals.

/** Epoch milliseconds (UTC). Display time zone is a chart prop. */
export type Millis = number;

/** One chart row, e.g. a stand or gate. The host decides what a row means. */
export interface TimelineRow {
  id: string;
  label: string;
  /** Optional grouping key (e.g. pier); a boundary is drawn where it changes. */
  group?: string;
}

/** Identity shared by one or more occupancies (e.g. one aircraft ground visit). */
export interface Visit {
  id: string;
  label?: string;
}

/** One interval on one row. A visit may have several (tows, split stays). */
export interface Occupancy {
  id: string;
  rowId: string;
  start: Millis;
  end: Millis;
  visitId?: string;
  label?: string;
  /** Open, uninterpreted tag for styling (e.g. "arr", "hold", "dep"). */
  kind?: string;
}

export type SelectionMode = "replace" | "toggle";

/** Edit/interaction intents emitted by the chart. The host decides what to apply. */
export type ChartIntent =
  | {
      type: "select";
      occupancyIds: string[];
      mode: SelectionMode;
    }
  /** A bar dragged to another row or time and dropped where the host allowed it. */
  | {
      type: "move";
      occupancyId: string;
      rowId: string;
      /**
       * How far the bar was dragged along the time axis, in steps of the
       * chart's `dragSnapMs`; 0 when it keeps its times.
       */
      shiftMs: number;
    };

/**
 * The host's verdict on dropping a bar on a row (and, with `dragSnapMs`, at a
 * shifted time), shown while it is dragged: a ghost of the bar where it would
 * land, marked allowed or blocked.
 */
export interface DropPreview {
  allowed: boolean;
  /** A bar that would trade places with the dragged one; its ghost shows on the dragged bar's row. */
  swapWithId?: string;
  /** Bars in the way, marked while the drop is blocked. */
  blockingIds?: readonly string[];
  /** Short description of the outcome, for the ghost's tooltip and screen readers. */
  label?: string;
  /**
   * How far the drop would really move the bar in time, when the host does
   * not follow the drag: 0 where a bar keeps its times on that row however it
   * was dragged. The ghost shows it, and the "move" intent carries it.
   * Defaults to the drag's own shift.
   */
  shiftMs?: number;
}

/**
 * How one end of a bar is drawn: rounded like its corners, tapered to a point
 * at mid-height, or zigzagged. What a shape means is the host's decision.
 */
export type BarEndShape = "round" | "taper" | "zigzag";

/** A bar's start (left) and end (right) shapes. */
export interface BarEnds {
  start: BarEndShape;
  end: BarEndShape;
}

/** Resolved geometry for one visible occupancy, passed to layers and accessors. */
export interface BarDatum {
  occupancy: Occupancy;
  visit?: Visit;
  row: TimelineRow;
  rowIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the interval extends beyond the visible domain on that side. */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** How its ends are drawn: the host's `barEnds`, round where the bar is clipped. */
  ends: BarEnds;
  selected: boolean;
  /** Not selected itself, but shares a visit with a selected occupancy. */
  linked: boolean;
}
