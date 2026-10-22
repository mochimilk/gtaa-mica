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

/** Whole UTC days relative to the active date, defaulting to the original fixture. */
export const dayOffset = (t: number, date?: string) =>
  Math.floor((t - (date ? utcAt(date, "00:00") : DAY_START)) / 86_400_000);

/** Compact day marker, "" on the demo date, otherwise e.g. "−1d" / "+1d". */
export const dayOffsetLabel = (t: number, date?: string) => {
  const d = dayOffset(t, date);
  return d === 0 ? "" : `${d < 0 ? "−" : "+"}${Math.abs(d)}d`;
};

/** Compact time with a day marker when off the demo date, e.g. "22:30 −1d". */
export const formatUtcWithDay = (t: number, date?: string) => {
  const day = dayOffsetLabel(t, date);
  return day ? `${formatUtc(t)} ${day}` : formatUtc(t);
};

/** Full unambiguous UTC date and time, e.g. "2026-01-14 22:30 UTC". */
export const formatUtcFull = (t: number) =>
  `${new Date(t).toISOString().slice(0, 10)} ${formatUtc(t)} UTC`;
