import type { TimelineInterval, TimelineWindow } from "./contracts.ts";

const MILLISECONDS_PER_MINUTE = 60_000;

export interface ParsedInterval {
    startMs: number;
    endMs: number;
}

export interface TimelineGeometry {
    left: number;
    width: number;
    clippedStart: boolean;
    clippedEnd: boolean;
}

export interface TimelineScale {
    window: ParsedInterval;
    width: number;
    pxPerMinute: number;
    xForTime(timeMs: number): number;
    timeForX(x: number): number;
    geometry(interval: TimelineInterval): TimelineGeometry | null;
    contains(interval: TimelineInterval, x: number): boolean;
}

export function parseInterval(interval: TimelineInterval): ParsedInterval | null {
    const startMs = Date.parse(interval.startUtc);
    const endMs = Date.parse(interval.endUtc);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? { startMs, endMs }
        : null;
}

export function requireInterval(interval: TimelineInterval, name = "interval"): ParsedInterval {
    const parsed = parseInterval(interval);
    if (parsed === null) {
        throw new RangeError(`${name} must contain finite UTC timestamps with endUtc after startUtc.`);
    }
    return parsed;
}

export function createTimelineScale(window: TimelineWindow, pxPerMinute: number): TimelineScale {
    const parsedWindow = requireInterval(window, "window");
    if (!window.timeZone.trim()) {
        throw new RangeError("window.timeZone is required.");
    }
    if (!Number.isFinite(pxPerMinute) || pxPerMinute <= 0) {
        throw new RangeError("pxPerMinute must be positive and finite.");
    }

    const width = ((parsedWindow.endMs - parsedWindow.startMs) / MILLISECONDS_PER_MINUTE) * pxPerMinute;
    const xForTime = (timeMs: number) =>
        ((timeMs - parsedWindow.startMs) / MILLISECONDS_PER_MINUTE) * pxPerMinute;
    const timeForX = (x: number) =>
        parsedWindow.startMs + (x / pxPerMinute) * MILLISECONDS_PER_MINUTE;
    const geometry = (interval: TimelineInterval): TimelineGeometry | null => {
        const parsed = parseInterval(interval);
        if (parsed === null) {
            return null;
        }
        const left = Math.max(0, xForTime(parsed.startMs));
        const right = Math.min(width, xForTime(parsed.endMs));
        return right > left
            ? {
                left,
                width: right - left,
                clippedStart: parsed.startMs < parsedWindow.startMs,
                clippedEnd: parsed.endMs > parsedWindow.endMs,
            }
            : null;
    };

    return {
        window: parsedWindow,
        width,
        pxPerMinute,
        xForTime,
        timeForX,
        geometry,
        contains: (interval, x) => {
            const value = geometry(interval);
            return value !== null && x >= value.left && x < value.left + value.width;
        },
    };
}

export function snapDelta(deltaMs: number, snapMinutes: number): number {
    if (!Number.isFinite(deltaMs)) {
        throw new RangeError("deltaMs must be finite.");
    }
    if (!Number.isFinite(snapMinutes) || snapMinutes <= 0) {
        throw new RangeError("snapMinutes must be positive and finite.");
    }
    const snapMs = snapMinutes * MILLISECONDS_PER_MINUTE;
    return Math.round(deltaMs / snapMs) * snapMs;
}

export function shiftInterval(interval: TimelineInterval, deltaMs: number): TimelineInterval {
    const parsed = requireInterval(interval);
    if (!Number.isFinite(deltaMs)) {
        throw new RangeError("deltaMs must be finite.");
    }
    return {
        startUtc: new Date(parsed.startMs + deltaMs).toISOString(),
        endUtc: new Date(parsed.endMs + deltaMs).toISOString(),
    };
}

export function autoScrollDelta(
    pointerPosition: number,
    viewportSize: number,
    margin = 80,
    maximumSpeed = 20,
): number {
    if (![pointerPosition, viewportSize, margin, maximumSpeed].every(Number.isFinite)
        || viewportSize <= 0
        || margin <= 0
        || maximumSpeed < 0) {
        throw new RangeError("Auto-scroll inputs must be finite with positive viewport and margin.");
    }
    if (pointerPosition < margin) {
        return -maximumSpeed * Math.min(1, (margin - pointerPosition) / margin);
    }
    if (pointerPosition > viewportSize - margin) {
        return maximumSpeed * Math.min(1, (pointerPosition - (viewportSize - margin)) / margin);
    }
    return 0;
}
