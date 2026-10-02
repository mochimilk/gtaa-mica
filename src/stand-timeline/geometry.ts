import type { Millis } from "./model";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export interface TimeScale {
  domain: readonly [Millis, Millis];
  width: number;
  x(t: Millis): number;
}

export function createTimeScale(
  domain: readonly [Millis, Millis],
  width: number,
): TimeScale {
  const [d0, d1] = domain;
  const k = width / Math.max(1, d1 - d0);
  return { domain, width, x: (t) => (t - d0) * k };
}

/** Tick times aligned to multiples of `stepMs` since the epoch, inside the domain. */
export function timeTicks(
  domain: readonly [Millis, Millis],
  stepMs: number,
): Millis[] {
  const ticks: Millis[] = [];
  for (let t = Math.ceil(domain[0] / stepMs) * stepMs; t <= domain[1]; t += stepMs) {
    ticks.push(t);
  }
  return ticks;
}

export function clipInterval(
  start: Millis,
  end: Millis,
  domain: readonly [Millis, Millis],
): { start: Millis; end: Millis; clippedStart: boolean; clippedEnd: boolean } | null {
  if (end <= domain[0] || start >= domain[1] || end <= start) return null;
  return {
    start: Math.max(start, domain[0]),
    end: Math.min(end, domain[1]),
    clippedStart: start < domain[0],
    clippedEnd: end > domain[1],
  };
}

/** Truncate text with an ellipsis to roughly fit `widthPx`. Returns "" if nothing useful fits. */
export function fitLabel(text: string, widthPx: number, charPx: number): string {
  const max = Math.floor(widthPx / charPx);
  if (text.length <= max) return text;
  if (max < 3) return "";
  return text.slice(0, max - 1).trimEnd() + "…";
}

/** Snap a coordinate to the pixel grid for crisp 1px lines. */
export function crisp(v: number): number {
  return Math.round(v) + 0.5;
}
