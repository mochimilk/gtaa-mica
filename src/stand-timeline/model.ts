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
export type ChartIntent = {
  type: "select";
  occupancyIds: string[];
  mode: SelectionMode;
};

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
  selected: boolean;
  /** Not selected itself, but shares a visit with a selected occupancy. */
  linked: boolean;
}
