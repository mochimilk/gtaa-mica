import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  RegionContext,
  TimelineContext,
  createDragStore,
  createHoverStore,
  type RowAt,
  type TimelineContextValue,
  type TimelineRegion,
  type TimelineSection,
} from "./context";
import { HOUR, clipInterval, createTimeScale, type TimeScale } from "./geometry";
import type {
  BarDatum,
  BarEnds,
  ChartIntent,
  DropPreview,
  Millis,
  Occupancy,
  TimelineRow,
  Visit,
} from "./model";
import type { TimelineZoom } from "./zoom";
import "./stand-timeline.css";

export interface StandTimelineProps {
  rows: readonly TimelineRow[];
  /**
   * Rows pinned under the top ruler, such as a lane of stays waiting for a
   * row: they stay in view while `rows` scroll beneath them. Bars on them
   * are drawn, selected and dragged as on any row, to and from the others.
   */
  pinnedRows?: readonly TimelineRow[];
  /** The bars of both `rows` and `pinnedRows`; each goes on the row its `rowId` names. */
  occupancies: readonly Occupancy[];
  visits?: readonly Visit[];
  /** Visible time window [start, end) in epoch ms. */
  domain: readonly [Millis, Millis];
  /** IANA time zone used for labels. Shown on the axis. */
  timeZone?: string;
  /** Host-controlled selection. */
  selectedIds?: readonly string[];
  onIntent?: (intent: ChartIntent) => void;
  /**
   * Makes bars draggable to other rows. Called as a bar is dragged over each
   * row (and, with `dragSnapMs`, each time step); the chart shows the verdict
   * and, on a drop the host allowed, emits a "move" intent. The host decides
   * what the move does.
   */
  previewDrop?: (occupancyId: string, rowId: string, shiftMs: number) => DropPreview;
  /**
   * With `previewDrop`, bars can also be dragged along the time axis, in
   * steps of this many ms. Omit to keep dragged bars at their times.
   */
  dragSnapMs?: number;
  rowHeight?: number;
  labelWidth?: number;
  axisHeight?: number;
  /** Which time rulers to lay out; place a <TimeAxis position=…/> for each. */
  axes?: "top" | "bottom" | "both";
  /**
   * Drop the bottom ruler and fade the chart's lower edge out instead. The
   * fade only shows while rows continue below the visible area, easing out as
   * the user scrolls to the bottom. Fade length is the --st-fade-size variable.
   */
  fade?: boolean;
  /** Minimum pixels per hour; below this the chart scrolls horizontally. Ignored with `zoom`. */
  minHourWidth?: number;
  /**
   * Zoom along the time axis, from useTimelineZoom(): the plot is drawn at
   * its pixels per hour, and pinching a trackpad (or Ctrl/⌘ + scrolling)
   * over the chart zooms it about the pointer. Only time stretches or
   * shrinks; rows keep their height, and plain scrolling still pans.
   */
  zoom?: TimelineZoom;
  /** Vertical gap between a bar and its row boundary. */
  barInset?: number;
  /** Corner radius of the bars, px; their outlines, ghosts and backdrops follow it. */
  barRadius?: number;
  /**
   * How each bar's ends are drawn (see BarEndShape): round unless this says
   * otherwise, e.g. tapered or zigzagged for what starts and ends a stay. An
   * end cut off at the window's edge is drawn round, since what it marks is
   * out of view.
   */
  barEnds?: (occupancy: Occupancy) => Partial<BarEnds> | undefined;
  /** Optional max height; the axis stays pinned while rows scroll. */
  maxHeight?: number | string;
  /**
   * Fill the parent's height (the parent must give a definite height, e.g. a
   * flex item with min-height: 0). Rulers stay pinned top and bottom; only the
   * rows scroll vertically between them. Horizontal scroll stays shared.
   */
  fillHeight?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Root inline style; the usual place to set --st-* theme variables. */
  style?: CSSProperties;
  /** Layers, e.g. <StandRows/>, <TimeGrid/>, <OccupancyBars/>, <TimeAxis/>. */
  children?: ReactNode;
}

const NO_ROWS: readonly TimelineRow[] = [];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Pinch zoom: wheel deltaY (px) per doubling of the pixels per hour. A
 * trackpad pinch sends a few px per event; one notch of Ctrl + a mouse
 * wheel sends ~100, so each event is capped at WHEEL_ZOOM_MAX_STEP.
 */
const WHEEL_ZOOM_PX_PER_DOUBLING = 50;
const WHEEL_ZOOM_MAX_STEP = 25;
/** Wheel deltas in lines or pages, as px. */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

/**
 * The visible bars of each section, each laid out in its own section's
 * coordinates, none selected (see markSelection). A stay on a pinned row goes
 * there; one on no row is left out.
 */
function layoutBars(
  occupancies: readonly Occupancy[],
  visits: readonly Visit[] | undefined,
  sections: Record<TimelineSection, readonly TimelineRow[]>,
  scale: TimeScale,
  rowHeight: number,
  barInset: number,
  barEnds: StandTimelineProps["barEnds"],
): Record<TimelineSection, BarDatum[]> {
  const visitsById = new Map((visits ?? []).map((v) => [v.id, v]));
  const place = new Map<string, { section: TimelineSection; index: number }>();
  sections.body.forEach((row, index) => place.set(row.id, { section: "body", index }));
  sections.pinned.forEach((row, index) => place.set(row.id, { section: "pinned", index }));

  const out: Record<TimelineSection, BarDatum[]> = { pinned: [], body: [] };
  for (const o of occupancies) {
    const at = place.get(o.rowId);
    if (!at) continue;
    const c = clipInterval(o.start, o.end, scale.domain);
    if (!c) continue;
    const x0 = scale.x(c.start);
    const ends = barEnds?.(o);
    out[at.section].push({
      occupancy: o,
      visit: o.visitId ? visitsById.get(o.visitId) : undefined,
      row: sections[at.section][at.index],
      rowIndex: at.index,
      x: x0,
      y: at.index * rowHeight + barInset,
      width: Math.max(2, scale.x(c.end) - x0),
      height: rowHeight - 2 * barInset,
      clippedStart: c.clippedStart,
      clippedEnd: c.clippedEnd,
      ends: {
        start: (!c.clippedStart && ends?.start) || "round",
        end: (!c.clippedEnd && ends?.end) || "round",
      },
      selected: false,
      linked: false,
    });
  }
  // Row-major order gives a predictable Tab order through the bars.
  for (const bars of Object.values(out)) {
    bars.sort((a, b) => a.rowIndex - b.rowIndex || a.occupancy.start - b.occupancy.start);
  }
  return out;
}

/** Each laid-out bar's selected and linked copies, made once, so a bar keeps its object while its state does. */
const selectedBars = new WeakMap<BarDatum, BarDatum>();
const linkedBars = new WeakMap<BarDatum, BarDatum>();

function flagged(bar: BarDatum, flags: WeakMap<BarDatum, BarDatum>, selected: boolean): BarDatum {
  let copy = flags.get(bar);
  if (!copy) flags.set(bar, (copy = { ...bar, selected, linked: !selected }));
  return copy;
}

/**
 * The laid-out bars with `selectedIds` marked, and their siblings (stays of
 * the same visit, in either section) linked. A selection change only gives
 * new objects to the bars whose state changed, so layers that draw a bar at a
 * time (memoized on it) redraw just those.
 */
function markSelection(
  laidOut: Record<TimelineSection, BarDatum[]>,
  selectedIds: readonly string[] | undefined,
): Record<TimelineSection, BarDatum[]> {
  if (!selectedIds?.length) return laidOut;
  const selected = new Set(selectedIds);
  const linkedVisits = new Set<string>();
  for (const bars of Object.values(laidOut)) {
    for (const bar of bars) if (bar.occupancy.visitId && selected.has(bar.occupancy.id)) linkedVisits.add(bar.occupancy.visitId);
  }
  const mark = (bar: BarDatum) => {
    if (selected.has(bar.occupancy.id)) return flagged(bar, selectedBars, true);
    const visitId = bar.occupancy.visitId;
    return visitId && linkedVisits.has(visitId) ? flagged(bar, linkedBars, false) : bar;
  };
  return { pinned: laidOut.pinned.map(mark), body: laidOut.body.map(mark) };
}

export function StandTimeline({
  rows,
  pinnedRows = NO_ROWS,
  occupancies,
  visits,
  domain,
  timeZone = "UTC",
  selectedIds,
  onIntent,
  previewDrop,
  dragSnapMs,
  rowHeight = 28,
  labelWidth = 112,
  axisHeight = 30,
  axes = "top",
  fade = false,
  minHourWidth = 64,
  zoom,
  barInset = 4,
  barRadius = 3,
  barEnds,
  maxHeight,
  fillHeight = false,
  ariaLabel = "Stand occupancy timeline",
  className,
  style,
  children,
}: StandTimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedPlotRef = useRef<SVGSVGElement>(null);
  const bodyLabelsRef = useRef<HTMLDivElement>(null);
  const bodyPlotRef = useRef<SVGSVGElement>(null);
  const [drags] = useState(createDragStore);
  const [hover] = useState(createHoverStore);
  const [available, setAvailable] = useState(0);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // The observed content box shrinks when a scrollbar appears, so this also
    // catches scrollbars toggling as rows or the time window change.
    const update = () => setAvailable(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The fade (see .st-root--fade) is masked onto the body's labels and plot,
  // which scroll, so it is kept where the scroller's visible bottom is, from
  // the body's top (--st-fade-end). Its strength follows how much content is
  // left below: full when at least --st-fade-size remains, none at the bottom
  // or with no overflow (--st-fade-amount). Written straight to the two
  // elements, not inherited by the bars inside, so scrolling neither
  // re-renders nor restyles the bars.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const el = scrollerRef.current;
    if (!fade || !root || !el) return;
    const faded = () => [bodyLabelsRef.current, bodyPlotRef.current];
    let size = 0;
    const sync = () => {
      const remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
      const amount = size > 0 && remaining > 1 ? Math.min(1, remaining / size) : 0;
      const body = bodyPlotRef.current?.getBoundingClientRect();
      const end = body ? el.getBoundingClientRect().top + el.clientTop + el.clientHeight - body.top : 0;
      for (const target of faded()) {
        target?.style.setProperty("--st-fade-amount", String(amount));
        target?.style.setProperty("--st-fade-end", `${end}px`);
      }
    };
    const resize = () => {
      size = parseFloat(getComputedStyle(root).getPropertyValue("--st-fade-size")) || 0;
      sync();
    };
    resize();
    el.addEventListener("scroll", sync, { passive: true });
    // Watch the canvas too: rows added or removed (pinned ones too) change
    // the overflow and where the body starts.
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
      for (const target of faded()) {
        target?.style.removeProperty("--st-fade-amount");
        target?.style.removeProperty("--st-fade-end");
      }
    };
  }, [fade]);

  const [d0, d1] = domain;
  const hours = (d1 - d0) / HOUR;
  const viewWidth = Math.max(0, Math.floor(available - labelWidth));
  // Zoomed, rounded rather than ceiled, so a fitted plot is no wider than its view.
  const minPlotWidth = zoom ? Math.round(hours * zoom.hourWidth) : Math.ceil(hours * minHourWidth);
  const plotWidth = Math.max(minPlotWidth, viewWidth);
  const plotHeight = rows.length * rowHeight;
  const pinnedHeight = pinnedRows.length * rowHeight;

  const scale = useMemo(
    () => createTimeScale([d0, d1], plotWidth),
    [d0, d1, plotWidth],
  );

  // The zoom bounds itself by the fit: the domain across the visible plot.
  const zoomLink = zoom?.link;
  useLayoutEffect(() => {
    zoomLink?.layout(viewWidth, hours > 0 ? viewWidth / hours : 0);
  }, [zoomLink, viewWidth, hours]);

  // Before each zoom, note the time at its centre and where that is in the
  // scroller's view; once the zoom is drawn, scroll it back there. The time
  // is read off the scale and scroll position the user saw, so it is taken
  // before the plot changes width (and the browser clamps the scroll).
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const held = useRef<{ t: Millis; at: number } | null>(null);
  useLayoutEffect(() => {
    if (!zoomLink) return;
    return zoomLink.attach((clientX) => {
      const el = scrollerRef.current;
      if (!el) return;
      const left = el.getBoundingClientRect().left + el.clientLeft;
      const at = clientX === undefined
        ? (labelWidth + el.clientWidth) / 2
        : clamp(clientX - left, labelWidth, el.clientWidth);
      const { domain: [t0, t1], width } = scaleRef.current;
      held.current = { t: t0 + ((el.scrollLeft + at - labelWidth) / width) * (t1 - t0), at };
    });
  }, [zoomLink, labelWidth]);
  // After every render, so a hold never outlives the zoom it was taken for.
  useLayoutEffect(() => {
    const hold = held.current;
    const el = scrollerRef.current;
    held.current = null;
    if (hold && el) el.scrollLeft = labelWidth + scale.x(hold.t) - hold.at;
  });

  // A trackpad pinch arrives as wheel events with ctrlKey set, as does Ctrl
  // + a mouse wheel. Over the chart they zoom it, a frame's worth at a time,
  // instead of the page. Other wheel events scroll the chart as usual.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomable = !!zoom;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !zoomable) return;
    let factor = 1;
    let clientX = 0;
    let frame = 0;
    const apply = () => {
      frame = 0;
      zoomRef.current?.zoomBy(factor, clientX);
      factor = 1;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? WHEEL_PAGE_PX : 1;
      const step = clamp(e.deltaY * unit, -WHEEL_ZOOM_MAX_STEP, WHEEL_ZOOM_MAX_STEP);
      factor *= 2 ** (-step / WHEEL_ZOOM_PX_PER_DOUBLING);
      clientX = e.clientX;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    // Not passive, so it can keep the page from zooming.
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame);
    };
  }, [zoomable]);

  const formatTime = useMemo(() => {
    const f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return (t: Millis) => f.format(t);
  }, [timeZone]);

  const laidOut = useMemo(
    () => layoutBars(occupancies, visits, { pinned: pinnedRows, body: rows }, scale, rowHeight, barInset, barEnds),
    [occupancies, visits, pinnedRows, rows, scale, rowHeight, barInset, barEnds],
  );
  const bars = useMemo(() => markSelection(laidOut, selectedIds), [laidOut, selectedIds]);
  const allBars = useMemo(() => [...bars.pinned, ...bars.body], [bars]);

  const emit = useCallback(
    (intent: ChartIntent) => onIntent?.(intent),
    [onIntent],
  );

  // The pinned rows where they show, then the body's below them; past
  // either end, the nearest row (over the top ruler, the first pinned one).
  const rowAt = useCallback(
    (clientY: number): RowAt | null => {
      const pinned = pinnedRows.length > 0 ? pinnedPlotRef.current?.getBoundingClientRect() : undefined;
      if (pinned && (clientY < pinned.bottom || rows.length === 0)) {
        const index = clamp(Math.floor((clientY - pinned.top) / rowHeight), 0, pinnedRows.length - 1);
        return { section: "pinned", index, row: pinnedRows[index] };
      }
      const body = bodyPlotRef.current?.getBoundingClientRect();
      if (!body || rows.length === 0) return null;
      const index = clamp(Math.floor((clientY - body.top) / rowHeight), 0, rows.length - 1);
      return { section: "body", index, row: rows[index] };
    },
    [pinnedRows, rows, rowHeight],
  );

  // What both sections share; each then has its own rows, bars and height.
  const shared = useMemo(
    () => ({ scale, allBars, rowHeight, barRadius, labelWidth, axisHeight, plotWidth, timeZone, formatTime, emit, previewDrop, dragSnapMs, rowAt, drags, hover }),
    [scale, allBars, rowHeight, barRadius, labelWidth, axisHeight, plotWidth, timeZone, formatTime, emit, previewDrop, dragSnapMs, rowAt, drags, hover],
  );
  const ctx = useMemo<TimelineContextValue>(
    () => ({ ...shared, section: "body", rows, bars: bars.body, plotHeight }),
    [shared, rows, bars, plotHeight],
  );
  const pinnedCtx = useMemo<TimelineContextValue>(
    () => ({ ...shared, section: "pinned", rows: pinnedRows, bars: bars.pinned, plotHeight: pinnedHeight }),
    [shared, pinnedRows, bars, pinnedHeight],
  );

  const region = (r: TimelineRegion) => (
    <RegionContext.Provider value={r}>{children}</RegionContext.Provider>
  );

  const hasSelection = (selectedIds?.length ?? 0) > 0;
  const clearOnEmptyClick = () => {
    if (hasSelection) emit({ type: "select", occupancyIds: [], mode: "replace" });
  };
  const showTopAxis = axes !== "bottom";
  const showBottomAxis = axes !== "top" && !fade;

  return (
    <TimelineContext.Provider value={ctx}>
      <div
        ref={rootRef}
        className={[
          "st-root",
          maxHeight !== undefined || fillHeight ? "st-root--vscroll" : "",
          fillHeight ? "st-root--fill" : "",
          fade ? "st-root--fade" : "",
          className ?? "",
        ].join(" ")}
        style={style}
        role="group"
        aria-label={ariaLabel}
      >
        <div className="st-scroller" ref={scrollerRef} style={{ maxHeight }}>
          <div className="st-canvas" style={{ width: labelWidth + plotWidth }}>
            {showTopAxis && (
              <div className="st-header" style={{ height: axisHeight }}>
                <div className="st-corner" style={{ width: labelWidth }}>
                  {region("corner")}
                </div>
                <svg className="st-axis" width={plotWidth} height={axisHeight} aria-hidden="true">
                  {region("axis")}
                </svg>
              </div>
            )}
            {pinnedRows.length > 0 && (
              // Its own labels and plot, pinned under the top ruler while the body scrolls beneath.
              <TimelineContext.Provider value={pinnedCtx}>
                <div
                  className="st-pinned"
                  style={{ "--st-pinned-top": showTopAxis ? `${axisHeight}px` : "0px" } as CSSProperties}
                >
                  <div className="st-labels" style={{ width: labelWidth }}>
                    {region("labels")}
                  </div>
                  <svg
                    ref={pinnedPlotRef}
                    className="st-plot st-plot--pinned"
                    width={plotWidth}
                    height={pinnedHeight}
                    onClick={clearOnEmptyClick}
                  >
                    {region("plot")}
                  </svg>
                </div>
              </TimelineContext.Provider>
            )}
            <div className="st-body">
              <div ref={bodyLabelsRef} className="st-labels" style={{ width: labelWidth }}>
                {region("labels")}
              </div>
              <svg ref={bodyPlotRef} className="st-plot" width={plotWidth} height={plotHeight} onClick={clearOnEmptyClick}>
                {region("plot")}
              </svg>
            </div>
            {showBottomAxis && (
              <div className="st-footer" style={{ height: axisHeight }}>
                <div className="st-corner st-corner--bottom" style={{ width: labelWidth }}>
                  {region("cornerBottom")}
                </div>
                <svg className="st-axis st-axis--bottom" width={plotWidth} height={axisHeight} aria-hidden="true">
                  {region("axisBottom")}
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>
    </TimelineContext.Provider>
  );
}
