import {
  useCallback,
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
  type TimelineContextValue,
  type TimelineRegion,
} from "./context";
import { HOUR, clipInterval, createTimeScale } from "./geometry";
import type {
  BarDatum,
  ChartIntent,
  Millis,
  Occupancy,
  TimelineRow,
  Visit,
} from "./model";
import "./stand-timeline.css";

export interface StandTimelineProps {
  rows: readonly TimelineRow[];
  occupancies: readonly Occupancy[];
  visits?: readonly Visit[];
  /** Visible time window [start, end) in epoch ms. */
  domain: readonly [Millis, Millis];
  /** IANA time zone used for labels. Shown on the axis. */
  timeZone?: string;
  /** Host-controlled selection. */
  selectedIds?: readonly string[];
  onIntent?: (intent: ChartIntent) => void;
  rowHeight?: number;
  labelWidth?: number;
  axisHeight?: number;
  /** Which time rulers to lay out; place a <TimeAxis position=…/> for each. */
  axes?: "top" | "bottom" | "both";
  /** Minimum pixels per hour; below this the chart scrolls horizontally. */
  minHourWidth?: number;
  /** Vertical gap between a bar and its row boundary. */
  barInset?: number;
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

export function StandTimeline({
  rows,
  occupancies,
  visits,
  domain,
  timeZone = "UTC",
  selectedIds,
  onIntent,
  rowHeight = 28,
  labelWidth = 112,
  axisHeight = 30,
  axes = "top",
  minHourWidth = 64,
  barInset = 4,
  maxHeight,
  fillHeight = false,
  ariaLabel = "Stand occupancy timeline",
  className,
  style,
  children,
}: StandTimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setAvailable(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [d0, d1] = domain;
  const minPlotWidth = Math.ceil(((d1 - d0) / HOUR) * minHourWidth);
  const plotWidth = Math.max(minPlotWidth, Math.floor(available - labelWidth));
  const plotHeight = rows.length * rowHeight;

  const scale = useMemo(
    () => createTimeScale([d0, d1], plotWidth),
    [d0, d1, plotWidth],
  );

  const formatTime = useMemo(() => {
    const f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return (t: Millis) => f.format(t);
  }, [timeZone]);

  const bars = useMemo(() => {
    const selected = new Set(selectedIds);
    const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
    const visitsById = new Map((visits ?? []).map((v) => [v.id, v]));
    const linkedVisits = new Set<string>();
    for (const o of occupancies) {
      if (o.visitId && selected.has(o.id)) linkedVisits.add(o.visitId);
    }

    const out: BarDatum[] = [];
    for (const o of occupancies) {
      const i = rowIndex.get(o.rowId);
      if (i === undefined) continue;
      const c = clipInterval(o.start, o.end, scale.domain);
      if (!c) continue;
      const x0 = scale.x(c.start);
      const isSelected = selected.has(o.id);
      out.push({
        occupancy: o,
        visit: o.visitId ? visitsById.get(o.visitId) : undefined,
        row: rows[i],
        rowIndex: i,
        x: x0,
        y: i * rowHeight + barInset,
        width: Math.max(2, scale.x(c.end) - x0),
        height: rowHeight - 2 * barInset,
        clippedStart: c.clippedStart,
        clippedEnd: c.clippedEnd,
        selected: isSelected,
        linked: !isSelected && !!o.visitId && linkedVisits.has(o.visitId),
      });
    }
    // Row-major order gives a predictable Tab order through the bars.
    out.sort(
      (a, b) => a.rowIndex - b.rowIndex || a.occupancy.start - b.occupancy.start,
    );
    return out;
  }, [occupancies, visits, rows, selectedIds, scale, rowHeight, barInset]);

  const emit = useCallback(
    (intent: ChartIntent) => onIntent?.(intent),
    [onIntent],
  );

  const ctx = useMemo<TimelineContextValue>(
    () => ({
      scale,
      rows,
      bars,
      rowHeight,
      labelWidth,
      axisHeight,
      plotWidth,
      plotHeight,
      timeZone,
      formatTime,
      emit,
    }),
    [scale, rows, bars, rowHeight, labelWidth, axisHeight, plotWidth, plotHeight, timeZone, formatTime, emit],
  );

  const region = (r: TimelineRegion) => (
    <RegionContext.Provider value={r}>{children}</RegionContext.Provider>
  );

  const hasSelection = (selectedIds?.length ?? 0) > 0;

  return (
    <TimelineContext.Provider value={ctx}>
      <div
        className={[
          "st-root",
          maxHeight !== undefined || fillHeight ? "st-root--vscroll" : "",
          fillHeight ? "st-root--fill" : "",
          className ?? "",
        ].join(" ")}
        style={style}
        role="group"
        aria-label={ariaLabel}
      >
        <div className="st-scroller" ref={scrollerRef} style={{ maxHeight }}>
          <div className="st-canvas" style={{ width: labelWidth + plotWidth }}>
            {axes !== "bottom" && (
              <div className="st-header" style={{ height: axisHeight }}>
                <div className="st-corner" style={{ width: labelWidth }}>
                  {region("corner")}
                </div>
                <svg className="st-axis" width={plotWidth} height={axisHeight} aria-hidden="true">
                  {region("axis")}
                </svg>
              </div>
            )}
            <div className="st-body">
              <div className="st-labels" style={{ width: labelWidth }}>
                {region("labels")}
              </div>
              <svg
                className="st-plot"
                width={plotWidth}
                height={plotHeight}
                onClick={() => {
                  if (hasSelection) emit({ type: "select", occupancyIds: [], mode: "replace" });
                }}
              >
                {region("plot")}
              </svg>
            </div>
            {axes !== "top" && (
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
