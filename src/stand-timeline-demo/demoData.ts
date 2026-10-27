// Shared synthetic dataset for the chart demo and the operations panel.
// Built once from the synthetic fixture; nothing here is real operations data.
import { adaptSyntheticDay, utcAt } from "./adapter";
import {
  SYNTHETIC_DATE,
  SYNTHETIC_STANDS,
  SYNTHETIC_TURNS,
  SYNTHETIC_WINDOW,
} from "./syntheticFixture";

export const DEMO_DATA = adaptSyntheticDay(SYNTHETIC_DATE, SYNTHETIC_STANDS, SYNTHETIC_TURNS);

// DEMO_DATA is the board's shared, mutable state (stand changes rewrite it in
// place). A hot update would hand some importers a fresh copy while others
// keep the old one, and Skye's cursors and the chart would then work on
// different boards, so a change here reloads the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

export const DEMO_DOMAIN = [
  utcAt(SYNTHETIC_DATE, SYNTHETIC_WINDOW.from),
  utcAt(SYNTHETIC_DATE, SYNTHETIC_WINDOW.to),
] as const;

const utcTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** HH:MM in UTC, the demo's only display zone. */
export const formatUtc = (t: number) => utcTime.format(t);

const DAY_START = utcAt(SYNTHETIC_DATE, "00:00");

/** Whole UTC days between `t` and SYNTHETIC_DATE (0 on the demo date, −1 the day before). */
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
