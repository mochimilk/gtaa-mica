// Zoom along a chart's time axis. The host makes one with useTimelineZoom()
// and hands it to <StandTimeline zoom>, which draws at its pixels per hour
// and zooms it when the user pinches over the plot. The host's own controls
// (a slider, buttons) read and set the same zoom from anywhere on the page.
// Only time stretches or shrinks: rows keep their height.
import { useMemo, useState, useSyncExternalStore } from "react";
import { HOUR } from "./geometry";

/** Asked for in place of pixels per hour: keep the whole domain in view, however the chart resizes. */
const FITTED = 0;

interface ZoomState {
  /** Pixels per hour asked for, or FITTED. */
  requested: number;
  /** The plot's visible width, px: the chart's, less the row labels. */
  viewWidth: number;
  /** Pixels per hour at which the whole domain fills `viewWidth`. */
  fitHourWidth: number;
}

/** The chart's side of a zoom. StandTimeline uses it; hosts need not. */
export interface ZoomLink {
  get(): ZoomState;
  subscribe(listener: () => void): () => void;
  /** The chart reports where it is laid out: its visible plot width and the zoom that fits its domain there. */
  layout(viewWidth: number, fitHourWidth: number): void;
  /**
   * The chart's hook, run just before each zoom with where it centres (a
   * clientX, or none for the middle of the visible plot), so the chart can
   * keep the time there in place. Returns a detach function.
   */
  attach(hold: (clientX?: number) => void): () => void;
  /** Asks for `requested` pixels per hour (or FITTED), centred on `clientX`. */
  request(requested: number, clientX?: number): void;
}

export function createZoomLink(initialHourWidth: number): ZoomLink {
  let state: ZoomState = { requested: initialHourWidth, viewWidth: 0, fitHourWidth: 0 };
  let hold: ((clientX?: number) => void) | null = null;
  const listeners = new Set<() => void>();
  const set = (next: ZoomState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    layout(viewWidth, fitHourWidth) {
      if (viewWidth !== state.viewWidth || fitHourWidth !== state.fitHourWidth) {
        set({ ...state, viewWidth, fitHourWidth });
      }
    },
    attach(next) {
      hold = next;
      return () => {
        if (hold === next) hold = null;
      };
    },
    request(requested, clientX) {
      if (requested === state.requested) return;
      hold?.(clientX);
      set({ ...state, requested });
    },
  };
}

export interface TimelineZoomOptions {
  /** Pixels per hour to start at. However few, the plot still fills the chart's width. */
  initialHourWidth: number;
  /** The most pixels per hour zooming in reaches. */
  maxHourWidth: number;
}

export interface TimelineZoom {
  /** Pixels per hour the chart is drawn at: from `fitHourWidth` up to `maxHourWidth`. */
  hourWidth: number;
  /**
   * Pixels per hour at which the whole domain just fills the plot: as far
   * out as zooming goes. 0 until the chart is laid out.
   */
  fitHourWidth: number;
  maxHourWidth: number;
  /** True while the whole domain is in view. */
  fitted: boolean;
  /** How much time the plot shows across its visible width, ms. 0 until the chart is laid out. */
  visibleMs: number;
  /**
   * Zooms to `hourWidth` pixels per hour, kept within the bounds above,
   * holding the time at `clientX` (by default, the middle of the visible
   * plot) where it is on screen.
   */
  zoomTo(hourWidth: number, clientX?: number): void;
  /** Zooms by `factor` (2 doubles the pixels per hour), as zoomTo does. */
  zoomBy(factor: number, clientX?: number): void;
  /** Zooms out to the whole domain, which then stays in view as the chart resizes. */
  fit(): void;
  /** The chart's side of the zoom; see ZoomLink. */
  link: ZoomLink;
}

type ZoomControls = Pick<TimelineZoom, "zoomTo" | "zoomBy" | "fit">;
type ZoomView = Pick<TimelineZoom, "hourWidth" | "fitHourWidth" | "maxHourWidth" | "fitted" | "visibleMs">;

/** Pixels per hour drawn for `state`: what was asked for, within the fit and `max`. */
const drawnHourWidth = (state: ZoomState, max: number) =>
  Math.max(state.fitHourWidth, Math.min(state.requested, max));

/** What a zoom shows in `state`. */
export function zoomView(state: ZoomState, maxHourWidth: number): ZoomView {
  const hourWidth = drawnHourWidth(state, maxHourWidth);
  return {
    hourWidth,
    fitHourWidth: state.fitHourWidth,
    maxHourWidth,
    fitted: state.fitHourWidth > 0 && hourWidth <= state.fitHourWidth,
    visibleMs: hourWidth > 0 ? (state.viewWidth / hourWidth) * HOUR : 0,
  };
}

/** The zoom's methods, each reading `link` as it is when called. */
export function zoomControls(link: ZoomLink, maxHourWidth: number): ZoomControls {
  const zoomTo = (hourWidth: number, clientX?: number) => {
    const fit = link.get().fitHourWidth;
    // At (or below) the fit, ask to stay fitted rather than for a width the next resize would undo.
    link.request(hourWidth <= fit * (1 + 1e-6) ? FITTED : Math.min(hourWidth, maxHourWidth), clientX);
  };
  return {
    zoomTo,
    zoomBy: (factor, clientX) => zoomTo(drawnHourWidth(link.get(), maxHourWidth) * factor, clientX),
    fit: () => link.request(FITTED),
  };
}

/**
 * A zoom for <StandTimeline zoom>. Its methods are stable, and read the zoom
 * as it is when called, so several calls before a render each build on the last.
 */
export function useTimelineZoom({ initialHourWidth, maxHourWidth }: TimelineZoomOptions): TimelineZoom {
  const [link] = useState(() => createZoomLink(initialHourWidth));
  const state = useSyncExternalStore(link.subscribe, link.get);
  const controls = useMemo(() => zoomControls(link, maxHourWidth), [link, maxHourWidth]);
  return useMemo(
    () => ({ ...controls, ...zoomView(state, maxHourWidth), link }),
    [controls, state, maxHourWidth, link],
  );
}
