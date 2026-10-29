// Compatibility entry point; all board records belong to the active dataset.
import { ACTIVE_DATASET } from "../operations/activeDataset";

export const DEMO_DATA = ACTIVE_DATASET.timeline;

// DEMO_DATA is the board's shared, mutable state (stand changes rewrite it in
// place). A hot update would hand some importers a fresh copy while others
// keep the old one, and Skye's cursors and the chart would then work on
// different boards, so a change here reloads the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

export const DEMO_DOMAIN = ACTIVE_DATASET.domain;

const utcTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** HH:MM in UTC, the demo's only display zone. */
export const formatUtc = (t: number) => utcTime.format(t);

const DAY_START = Date.parse(`${ACTIVE_DATASET.date}T00:00:00Z`);

/** Whole UTC days from the active dataset's reference date. */
export const dayOffset = (t: number) => Math.floor((t - DAY_START) / 86_400_000);

/** Compact day marker, "" on the demo date, otherwise e.g. "−1d" / "+1d". */
export const dayOffsetLabel = (t: number) => {
  const d = dayOffset(t);
  return d === 0 ? "" : `${d < 0 ? "−" : "+"}${Math.abs(d)}d`;
};

/** Compact time with a day marker when off the demo date, e.g. "22:30 −1d". */
export const formatUtcWithDay = (t: number) => {
  const day = dayOffsetLabel(t);
  return day ? `${formatUtc(t)} ${day}` : formatUtc(t);
};

/** Full unambiguous UTC date and time, e.g. "2026-01-14 22:30 UTC". */
export const formatUtcFull = (t: number) =>
  `${new Date(t).toISOString().slice(0, 10)} ${formatUtc(t)} UTC`;
