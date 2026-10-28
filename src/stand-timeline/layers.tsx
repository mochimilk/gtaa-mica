import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  useTimeline,
  useTimelineRegion,
  type BarDrag,
  type HoverStore,
  type RowAt,
  type RowRef,
  type TimelineSection,
} from "./context";
import {
  HOUR,
  MINUTE,
  ROUND_ENDS,
  barEndDepth,
  barPath,
  crisp,
  fitLabel,
  linkRoute,
  roundedPath,
  timeTicks,
} from "./geometry";
import type { BarDatum, BarEnds, ChartIntent, Millis, TimelineRow } from "./model";
import { rowsViewport } from "./viewport";

/* ------------------------------------------------------------------ axis */

/** Label anchoring relative to its tick: "start" begins just after it, "end" finishes just before it. */
export type TickAnchor = "start" | "middle" | "end";

export interface TickLabel {
  text: string;
  /** Per-tick anchor; overrides the axis `labelAlign`. */
  anchor?: TickAnchor;
}

export interface TimeAxisProps {
  /** Which ruler this is. The chart must enable it via `axes` ("top" | "bottom" | "both"). */
  position?: "top" | "bottom";
  /** Interval between ticks. */
  stepMs?: number;
  /** Ticks on multiples of this interval are boundaries drawn the full axis height. */
  majorMs?: number;
  /**
   * Tick label: a string, a `{ text, anchor }` for per-tick anchoring, or
   * null/"" for a tick without a label.
   */
  format?: (t: Millis, formatTime: (t: Millis) => string) => string | TickLabel | null;
  /** Default anchor for labels that don't specify one. */
  labelAlign?: "start" | "center" | "end";
  /** Horizontal distance from the tick for "start"/"end" anchored labels, px. */
  labelOffset?: number;
  /** Show the time-zone badge in this ruler's corner. */
  showZone?: boolean;
  /**
   * Higher-priority labels are placed first when labels would collide; lower
   * ones that would overlap them (or the plot edges) are dropped, never shifted.
   */
  labelPriority?: (t: Millis) => number;
  /** Minimum horizontal gap between neighbouring labels, px. */
  minLabelGap?: number;
  /** Approximate glyph width of tick labels, px, used for collision checks. */
  charWidth?: number;
  /** Length of non-boundary ticks, px. */
  tickLength?: number;
  /** Text for the time-zone badge; defaults to the chart's `timeZone`. */
  zoneLabel?: string;
}

const ALIGN_TO_ANCHOR: Record<NonNullable<TimeAxisProps["labelAlign"]>, TickAnchor> = {
  start: "start",
  center: "middle",
  end: "end",
};

export function TimeAxis({
  position = "top",
  stepMs = HOUR,
  majorMs = HOUR,
  format,
  labelAlign = "start",
  labelOffset = 4,
  showZone = true,
  labelPriority,
  minLabelGap = 6,
  charWidth = 8,
  tickLength = 6,
  zoneLabel,
}: TimeAxisProps) {
  const region = useTimelineRegion();
  const { scale, axisHeight, plotWidth, formatTime, timeZone } = useTimeline();
  const bottom = position === "bottom";

  if (region === (bottom ? "cornerBottom" : "corner")) {
    if (!showZone) return null;
    return (
      <span className="st-zone" title={`Times shown in ${zoneLabel ?? timeZone}`}>
        {zoneLabel ?? timeZone}
      </span>
    );
  }
  if (region !== (bottom ? "axisBottom" : "axis")) return null;

  const ticks = timeTicks(scale.domain, stepMs).map((t) => {
    const raw = format ? format(t, formatTime) : formatTime(t);
    const label = typeof raw === "string" ? { text: raw } : raw;
    const text = label?.text ?? "";
    const anchor = label?.anchor ?? ALIGN_TO_ANCHOR[labelAlign];
    const x = scale.x(t);
    // Text x pinned to the timestamp (offset only for start/end anchors).
    const tx = anchor === "start" ? x + labelOffset : anchor === "end" ? x - labelOffset : x;
    const w = text.length * charWidth;
    const left = anchor === "start" ? tx : anchor === "end" ? tx - w : tx - w / 2;
    return { t, x, tx, text, anchor, left, right: left + w };
  });

  // Greedy placement by priority, then time; labels are never moved off their tick.
  const placed: { left: number; right: number }[] = [];
  const shown = new Set<Millis>();
  const order = ticks
    .filter((k) => k.text)
    .sort((a, b) => (labelPriority?.(b.t) ?? 0) - (labelPriority?.(a.t) ?? 0) || a.t - b.t);
  for (const k of order) {
    if (k.left < 0 || k.right > plotWidth) continue;
    const collides = placed.some(
      (p) => k.left < p.right + minLabelGap && k.right > p.left - minLabelGap,
    );
    if (collides) continue;
    placed.push(k);
    shown.add(k.t);
  }

  // Minor ticks point toward the plot: down from a top ruler, up from a bottom one.
  const tickY1 = bottom ? 0 : axisHeight - tickLength;
  const tickY2 = bottom ? tickLength : axisHeight;
  const labelY = bottom
    ? tickLength + (axisHeight - tickLength) / 2 - 1
    : (axisHeight - tickLength) / 2 + 1;
  return (
    <g>
      {ticks.map((k) => {
        const x = crisp(k.x);
        const major = k.t % majorMs === 0;
        return (
          <g key={k.t}>
            <line
              className={major ? "st-tick st-tick--major" : "st-tick"}
              x1={x}
              x2={x}
              y1={major ? 0 : tickY1}
              y2={major ? axisHeight : tickY2}
            />
            {shown.has(k.t) && (
              <text
                className="st-tick-label"
                x={k.tx}
                y={labelY}
                textAnchor={k.anchor}
                dominantBaseline="central"
              >
                {k.text}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ grid */

export interface TimeGridProps {
  majorMs?: number;
  /** Set to null to hide minor lines. */
  minorMs?: number | null;
}

export function TimeGrid({ majorMs = HOUR, minorMs = 30 * MINUTE }: TimeGridProps) {
  const region = useTimelineRegion();
  const { scale, plotHeight } = useTimeline();
  if (region !== "plot") return null;

  const minor = minorMs
    ? timeTicks(scale.domain, minorMs).filter((t) => t % majorMs !== 0)
    : [];
  return (
    <g pointerEvents="none">
      {minor.map((t) => (
        <line key={t} className="st-grid-minor" x1={crisp(scale.x(t))} x2={crisp(scale.x(t))} y1={0} y2={plotHeight} />
      ))}
      {timeTicks(scale.domain, majorMs).map((t) => (
        <line key={t} className="st-grid-major" x1={crisp(scale.x(t))} x2={crisp(scale.x(t))} y1={0} y2={plotHeight} />
      ))}
    </g>
  );
}

/* ------------------------------------------------------------- backdrop */

export interface BarBackdropProps {
  /** Blur radius in px, as CSS blur(): the Gaussian's standard deviation. */
  blur: number;
  /**
   * How saturated what shows through is, as CSS saturate(): 1 (the default)
   * leaves it as it is, 1.8 is 180%. Greys stay grey.
   */
  saturate?: number;
  /** The layers behind the bars to blur, e.g. <TimeGrid />. */
  children: ReactNode;
}

/**
 * A frosted-glass backdrop for the bars, as CSS backdrop-filter would give an
 * HTML element (SVG has none): `children` are drawn sharp except under the
 * bars, where a copy blurred by `blur` px (and saturated by `saturate`, as
 * acrylic glass does) shows instead, clipped to each bar's shape, ends and
 * all. Wrap the layers that sit behind the bars and place it before
 * OccupancyBars; give the bars a translucent fill so the blur shows through.
 * Children render twice, so any ids they carry must be their own (useId), and
 * they should not be interactive.
 */
export function BarBackdrop({ blur, saturate = 1, children }: BarBackdropProps) {
  const region = useTimelineRegion();
  const { bars, barRadius, plotWidth, plotHeight } = useTimeline();
  const uid = useId().replace(/[^\w-]/g, "");
  if (region !== "plot") return <>{children}</>;

  const shapes = bars.map((bar) => <path key={bar.occupancy.id} d={barPath(bar, bar.ends, barRadius)} />);
  const area = { x: 0, y: 0, width: plotWidth, height: plotHeight };
  return (
    <>
      <defs>
        <mask id={`${uid}-out`} maskUnits="userSpaceOnUse" {...area}>
          <rect {...area} fill="white" />
          <g fill="black">{shapes}</g>
        </mask>
        <clipPath id={`${uid}-in`}>{shapes}</clipPath>
        <filter id={`${uid}-blur`} filterUnits="userSpaceOnUse" {...area}>
          <feGaussianBlur stdDeviation={blur} />
          {/* In sRGB, as CSS saturate() works. */}
          {saturate !== 1 && <feColorMatrix type="saturate" values={String(saturate)} colorInterpolationFilters="sRGB" />}
        </filter>
      </defs>
      <g mask={`url(#${uid}-out)`}>{children}</g>
      <g clipPath={`url(#${uid}-in)`} pointerEvents="none" aria-hidden="true">
        <g filter={`url(#${uid}-blur)`}>{children}</g>
      </g>
    </>
  );
}

/* ------------------------------------------------------------------ rows */

export interface StandRowsProps {
  /** Corner title above the stand column; null for none. */
  title?: string | null;
  renderLabel?: (row: TimelineRow) => ReactNode;
  /** Default label shows `row.group` next to the name. */
  showGroup?: boolean;
  /** "end" right-aligns labels against the plot edge. */
  labelAlign?: "start" | "end";
  zebra?: boolean;
}

function isGroupEnd(rows: readonly TimelineRow[], i: number) {
  return i < rows.length - 1 && rows[i + 1].group !== rows[i].group;
}

export function StandRows({
  title = "Stand",
  renderLabel,
  showGroup = true,
  labelAlign = "start",
  zebra = true,
}: StandRowsProps) {
  const region = useTimelineRegion();
  const { rows, rowHeight, plotWidth } = useTimeline();

  if (region === "corner") return title ? <span className="st-corner-title">{title}</span> : null;

  if (region === "labels") {
    return rows.map((row, i) => (
      <div
        key={row.id}
        className={[
          "st-row-label",
          labelAlign === "end" ? "st-row-label--end" : "",
          zebra && i % 2 ? "st-row-label--alt" : "",
          isGroupEnd(rows, i) ? "st-row-label--group-end" : "",
        ].join(" ")}
        style={{ height: rowHeight }}
        data-row-id={row.id}
        title={row.group ? `${row.label} · ${row.group}` : row.label}
      >
        {renderLabel ? (
          renderLabel(row)
        ) : (
          <>
            <span className="st-row-name">{row.label}</span>
            {showGroup && row.group && <span className="st-row-group">{row.group}</span>}
          </>
        )}
      </div>
    ));
  }

  if (region !== "plot") return null;
  return (
    <g pointerEvents="none">
      {/* No base band: rows are transparent. Zebra adds only a translucent tint. */}
      {zebra &&
        rows.map((row, i) =>
          i % 2 ? (
            <rect
              key={row.id}
              className="st-row-band--alt"
              x={0}
              y={i * rowHeight}
              width={plotWidth}
              height={rowHeight}
            />
          ) : null,
        )}
      {rows.map((row, i) => {
        const y = (i + 1) * rowHeight - 0.5;
        return (
          <line
            key={row.id}
            className={isGroupEnd(rows, i) ? "st-row-boundary st-row-boundary--group" : "st-row-boundary"}
            x1={0}
            x2={plotWidth}
            y1={y}
            y2={y}
          />
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ bars */

export interface BarStyle {
  fill?: string;
  /** Opacity of the fill only, 0–1; the stroke keeps full opacity. */
  fillOpacity?: number;
  stroke?: string;
  /** Foreground paired with `fill`; available to renderBar as currentColor. */
  color?: string;
  className?: string;
}

export interface OccupancyBarsProps {
  /** Per-bar colour/class accessor. */
  barStyle?: (bar: BarDatum) => BarStyle;
  /** Replace the bar visual; the chart keeps hit-testing, focus and selection outline. */
  renderBar?: (bar: BarDatum, style: BarStyle) => ReactNode;
  /** Accessible name. There is no hover tooltip; hosts show details on selection. */
  describe?: (bar: BarDatum, formatTime: (t: Millis) => string) => string;
}

/**
 * Plain bar, its ends shaped as `bar.ends` says. A clipped end is drawn round;
 * clipping to the visible window is conveyed in text (see `describeClipping`).
 */
export function DefaultBar({ bar, style }: { bar: BarDatum; style: BarStyle }) {
  const { barRadius } = useTimeline();
  const css: CSSProperties = { fill: style.fill, fillOpacity: style.fillOpacity, stroke: style.stroke };
  return <path className="st-bar-rect" d={barPath(bar, bar.ends, barRadius)} style={css} />;
}

/** Text describing whether a bar extends beyond the visible window ("" if not). */
export function describeClipping(bar: BarDatum): string {
  if (bar.clippedStart && bar.clippedEnd) return "extends beyond both edges of the visible window";
  if (bar.clippedStart) return "starts before the visible window";
  if (bar.clippedEnd) return "continues after the visible window";
  return "";
}

function defaultDescribe(bar: BarDatum, formatTime: (t: Millis) => string) {
  const o = bar.occupancy;
  const name = o.label ?? bar.visit?.label ?? o.id;
  const clip = describeClipping(bar);
  return `${name}, ${bar.row.label}, ${formatTime(o.start)}–${formatTime(o.end)}${clip ? `, ${clip}` : ""}`;
}

/** How far a press on a bar must travel before it becomes a drag, px. */
const DRAG_THRESHOLD = 5;
/** Sideways travel ignored while dragging, px, so a drag straight up or down keeps its times. */
const TIME_DEADZONE = 12;
/** Distance from the scroll region's edges where a drag scrolls it, px. */
const AUTOSCROLL_EDGE = 32;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** How far `p` reaches into the autoscroll band at either end of [lo, hi]; 0 between them. */
const intoEdge = (p: number, lo: number, hi: number) =>
  p < lo + AUTOSCROLL_EDGE ? p - (lo + AUTOSCROLL_EDGE) : p > hi - AUTOSCROLL_EDGE ? p - (hi - AUTOSCROLL_EDGE) : 0;

const sameRow = (a: RowRef, b: RowRef) => a.section === b.section && a.index === b.index;

/** Drags under way per chart, so its dragging state lasts until the last one ends. */
const chartDrags = new WeakMap<Element, number>();

function markDragging(root: Element, by: 1 | -1) {
  const count = Math.max(0, (chartDrags.get(root) ?? 0) + by);
  chartDrags.set(root, count);
  root.classList.toggle("st-root--dragging", count > 0);
}

/**
 * Dragging bars, when the host gives `previewDrop`: to another row, in either
 * section (from the pinned rows to the body and back), and with `dragSnapMs`
 * along the time axis as well, so a bar can go anywhere on the plot. A press
 * becomes a drag once it moves DRAG_THRESHOLD; where the bar would land is
 * previewed, the region scrolls near its edges, Escape cancels, and a drop
 * the host allowed emits a "move" intent. Listeners sit on the window, so a
 * drag carries on wherever the pointer goes, and synthetic pointer events
 * (Skye's cursors) drive it the same way.
 *
 * Each pointer drags on its own, so several bars can be dragged at once (Skye
 * working with several cursors). Only the primary pointer scrolls the region:
 * one scroller cannot follow several pointers. The drags are the chart's,
 * not this section's, so the section a bar is dragged into draws its ghost.
 */
function useBarDrag() {
  const { emit, previewDrop, scale, dragSnapMs, rowAt, drags: store } = useTimeline();
  const drags = useSyncExternalStore(store.subscribe, store.get);
  const latest = useRef({ emit, previewDrop, scale, dragSnapMs, rowAt });
  latest.current = { emit, previewDrop, scale, dragSnapMs, rowAt };
  const stops = useRef(new Map<number, () => void>());
  useEffect(() => () => [...stops.current.values()].forEach((stop) => stop()), []);

  // Stable, so the bars it is handed to (OccupancyBar) can skip re-rendering.
  const begin = useCallback((event: ReactPointerEvent<SVGGElement>, id: string, from: RowRef) => {
    if (!latest.current.previewDrop || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const svg = event.currentTarget.ownerSVGElement;
    const root = svg?.closest(".st-root");
    if (!svg || !root) return;
    const plotSvg: SVGSVGElement = svg;
    const chart: Element = root;
    const { pointerId, clientX: x0, clientY: y0, isPrimary } = event;
    stops.current.get(pointerId)?.();
    const scroller = svg.closest<HTMLElement>(".st-scroller");
    // Where the bar was taken hold of, in plot coordinates, so a scroll
    // during the drag does not count as moving it in time. Both sections'
    // plots line up, so this holds over either.
    const grabX = x0 - svg.getBoundingClientRect().left;
    let active = false;
    let pointer = { x: x0, y: y0 };
    let to: RowAt | null = null;
    let shift = 0;
    let frame = 0;

    const preview = (force = false) => {
      const { previewDrop: verdict, scale: x, dragSnapMs: snap, rowAt: locate } = latest.current;
      const at = locate(pointer.y);
      if (!at) return;
      let nextShift = 0;
      if (snap) {
        // Measured with the pointer held over the plot, so a bar cannot be
        // dragged out of the window altogether.
        const dx = clamp(pointer.x - plotSvg.getBoundingClientRect().left, 0, x.width) - grabX;
        if (Math.abs(dx) >= TIME_DEADZONE) {
          const ms = (dx / x.width) * (x.domain[1] - x.domain[0]);
          nextShift = Math.round(ms / snap) * snap || 0;
        }
      }
      if (to && sameRow(at, to) && nextShift === shift && !force) return;
      to = at;
      shift = nextShift;
      const still = sameRow(at, from) && shift === 0;
      store.set(pointerId, {
        id,
        from,
        to: at,
        shiftMs: shift,
        preview: still ? null : (verdict?.(id, at.row.id, shift) ?? null),
      });
    };

    // Scrolls while the pointer rests near the body's edges: top and bottom,
    // and left and right when bars move in time. Over the pinned rows it does
    // not scroll up: they are somewhere to drop, not an edge.
    const autoscroll = () => {
      frame = 0;
      if (!active || !scroller || !isPrimary) return;
      const view = rowsViewport(scroller);
      const pinned = scroller.querySelector(".st-pinned")?.getBoundingClientRect();
      const overPinned = !!pinned && pointer.y >= pinned.top && pointer.y < pinned.bottom;
      const by = overPinned ? 0 : intoEdge(pointer.y, view.top, view.bottom);
      const bx = latest.current.dragSnapMs ? intoEdge(pointer.x, view.left, view.right) : 0;
      if (by === 0 && bx === 0) return;
      scroller.scrollTop += clamp(by / 3, -12, 12);
      scroller.scrollLeft += clamp(bx / 3, -12, 12);
      preview();
      frame = requestAnimationFrame(autoscroll);
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (!active) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < DRAG_THRESHOLD) return;
        active = true;
        markDragging(chart, 1);
        preview(true);
      } else {
        preview();
      }
      if (!frame) frame = requestAnimationFrame(autoscroll);
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
      if (frame) cancelAnimationFrame(frame);
      if (active) markDragging(chart, -1);
      active = false;
      store.set(pointerId, null);
      if (stops.current.get(pointerId) === stop) stops.current.delete(pointerId);
    };

    const finish = (drop: boolean) => {
      const wasActive = active;
      const target = to;
      const shiftMs = shift;
      stop();
      if (!wasActive) return;
      // The click that ends a drag must neither select nor clear.
      const swallow = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (!drop || !target || (sameRow(target, from) && shiftMs === 0)) return;
      const verdict = latest.current.previewDrop?.(id, target.row.id, shiftMs);
      if (verdict?.allowed) {
        // The host may keep the bar's times (or snap them) however it was dragged.
        latest.current.emit({ type: "move", occupancyId: id, rowId: target.row.id, shiftMs: verdict.shiftMs ?? shiftMs });
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === pointerId) finish(true);
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === pointerId) finish(false);
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    stops.current.set(pointerId, stop);
  }, [store]);

  return { drags, begin, enabled: !!previewDrop };
}

export function OccupancyBars({ barStyle, renderBar, describe = defaultDescribe }: OccupancyBarsProps) {
  const region = useTimelineRegion();
  const { bars, barRadius, emit, formatTime, section, hover } = useTimeline();
  const { drags, begin, enabled } = useBarDrag();
  if (region !== "plot") return null;

  const active = [...drags.values()];
  const dragging = new Set(active.filter((drag) => drag.preview).map((drag) => drag.id));
  const blocking = new Set(
    active.flatMap((drag) => (drag.preview && !drag.preview.allowed ? (drag.preview.blockingIds ?? []) : [])),
  );

  return (
    <g className={enabled ? "st-bars st-bars--draggable" : "st-bars"}>
      {bars.map((bar) => (
        <OccupancyBar
          key={bar.occupancy.id}
          bar={bar}
          barStyle={barStyle}
          renderBar={renderBar}
          describe={describe}
          barRadius={barRadius}
          formatTime={formatTime}
          section={section}
          hover={hover}
          emit={emit}
          begin={begin}
          dragging={dragging.has(bar.occupancy.id)}
          blocking={blocking.has(bar.occupancy.id)}
        />
      ))}
      {[...drags].map(([pointerId, drag]) => (
        <DropGhosts key={pointerId} drag={drag} />
      ))}
    </g>
  );
}

interface OccupancyBarProps extends OccupancyBarsProps {
  bar: BarDatum;
  describe: NonNullable<OccupancyBarsProps["describe"]>;
  barRadius: number;
  formatTime: (t: Millis) => string;
  section: TimelineSection;
  hover: HoverStore;
  emit: (intent: ChartIntent) => void;
  begin: (event: ReactPointerEvent<SVGGElement>, id: string, from: RowRef) => void;
  dragging: boolean;
  blocking: boolean;
}

/**
 * One bar. Memoized: the chart gives a bar a new object only when it is laid
 * out again or its selection changes, so a click or a drag step redraws the
 * bars it touches, not every bar.
 */
const OccupancyBar = memo(function OccupancyBar({
  bar,
  barStyle,
  renderBar,
  describe,
  barRadius,
  formatTime,
  section,
  hover,
  emit,
  begin,
  dragging,
  blocking,
}: OccupancyBarProps) {
  const style = barStyle?.(bar) ?? {};
  const label = describe(bar, formatTime);
  const id = bar.occupancy.id;
  const select = (toggle: boolean) => emit({ type: "select", occupancyIds: [id], mode: toggle ? "toggle" : "replace" });
  return (
    <g
      className={[
        "st-bar",
        bar.selected ? "st-bar--selected" : "",
        bar.linked ? "st-bar--linked" : "",
        dragging ? "st-bar--dragging" : "",
        blocking ? "st-bar--blocking" : "",
        style.className ?? "",
      ].join(" ")}
      style={style.color ? { color: style.color } : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={bar.selected}
      aria-label={label}
      data-occupancy-id={id}
      onPointerDown={(e: ReactPointerEvent<SVGGElement>) => begin(e, id, { section, index: bar.rowIndex })}
      // Shared with layers drawn apart from the bars (BarLabels marks their labels).
      onPointerEnter={() => hover.set({ hoveredId: id })}
      onPointerLeave={() => hover.get().hoveredId === id && hover.set({ hoveredId: null })}
      onFocus={(e) => e.currentTarget.matches(":focus-visible") && hover.set({ focusedId: id })}
      onBlur={() => hover.get().focusedId === id && hover.set({ focusedId: null })}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        select(e.shiftKey || e.metaKey || e.ctrlKey);
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select(e.shiftKey);
        } else if (e.key === "Escape") {
          emit({ type: "select", occupancyIds: [], mode: "replace" });
        }
      }}
    >
      {renderBar ? renderBar(bar, style) : <DefaultBar bar={bar} style={style} />}
      {/* 1.5px outside the bar, its edges parallel to the bar's. */}
      <path className="st-bar-outline" d={barPath(bar, bar.ends, barRadius, 1.5)} />
    </g>
  );
});

/** "+1h 30m", "−15m": how far a drag moves a bar in time. */
function formatShift(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${ms < 0 ? "−" : "+"}${h ? `${h}h ${String(m).padStart(2, "0")}` : m}m`;
}

/**
 * Where a dragged bar would land, drawn by the section it lands in: its ghost
 * on the row under the pointer, moved in time with the drag (or as the host
 * keeps it) and allowed or blocked, with its new times above it when they
 * change; and, for a swap, the other bar's ghost on the dragged bar's own
 * row, drawn by the section that row is in.
 */
function DropGhosts({ drag }: { drag: BarDrag }) {
  const { scale, formatTime, allBars, rowHeight, barRadius, section } = useTimeline();
  const bar = allBars.find((entry) => entry.occupancy.id === drag.id);
  const preview = drag.preview;
  if (!bar || !preview) return null;
  const landsHere = drag.to.section === section;
  const other =
    preview.swapWithId && drag.from.section === section
      ? allBars.find((entry) => entry.occupancy.id === preview.swapWithId)
      : undefined;
  if (!landsHere && !other) return null;
  const inset = bar.y - bar.rowIndex * rowHeight;
  // Shaped as the bar it stands for.
  const ghost = (x: number, width: number, rowIndex: number, ends: BarEnds, key: string) => (
    <path
      key={key}
      className="st-drop-rect"
      d={barPath({ x, y: rowIndex * rowHeight + inset, width, height: bar.height }, ends, barRadius)}
    />
  );
  const shiftMs = preview.shiftMs ?? drag.shiftMs;
  // From the stay's own times, so a bar cut off at the window edge lands at its true length.
  const start = bar.occupancy.start + shiftMs;
  const end = bar.occupancy.end + shiftMs;
  const x0 = clamp(scale.x(start), 0, scale.width);
  const x1 = clamp(scale.x(end), 0, scale.width);
  const top = drag.to.index * rowHeight + inset;
  return (
    <g className={preview.allowed ? "st-drop st-drop--allowed" : "st-drop st-drop--blocked"} pointerEvents="none">
      {preview.label && <title>{preview.label}</title>}
      {landsHere && ghost(x0, Math.max(2, x1 - x0), drag.to.index, bar.ends, "moved")}
      {other && ghost(other.x, other.width, drag.from.index, other.ends, "swapped")}
      {landsHere && shiftMs !== 0 && (
        <Pill
          className="st-drop-time"
          text={`${formatTime(start)}–${formatTime(end)} ${formatShift(shiftMs)}`}
          x={Math.max(x0, 2)}
          // Above the ghost, or below it on the first row, where there is no room above.
          y={drag.to.index === 0 ? top + bar.height + 2 : top - 16}
        />
      )}
    </g>
  );
}

/** Roughly how wide a pill's small semibold text is per character, px; sizes the pill. */
const PILL_CHAR_PX = 6;

const pillWidth = (text: string) => text.length * PILL_CHAR_PX + 12;

/**
 * Small text in a solid pill with its top-left at (x, y), coloured by
 * `className`: a dragged bar's new times (st-drop-time), a ghost's label
 * (st-ghost-pill).
 */
function Pill({ text, x, y, className }: { text: string; x: number; y: number; className: string }) {
  return (
    <g className={`st-pill ${className}`}>
      <rect x={x} y={y} width={pillWidth(text)} height={15} rx={7.5} />
      <text x={x + 6} y={y + 11}>
        {text}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ ghosts */

/** A see-through extension reaching out from one end of a bar, e.g. a delay. */
export interface BarGhost {
  /** "start" reaches back in time from the bar's start, "end" on from its end. */
  side: "start" | "end";
  /** How far it reaches, ms. */
  ms: Millis;
  /** Shown in a pill while the ghost is hovered, e.g. "Delayed out 40m · 08:20 → 09:00". */
  label: string;
  /** Drawn red, as running into something. The host decides what counts. */
  clash?: boolean;
  /** Its colour when it does not clash; --st-ghost by default. */
  color?: string;
  className?: string;
}

export interface BarGhostsProps {
  /** The ghosts reaching out from a bar, if any. */
  ghosts: (bar: BarDatum, formatTime: (t: Millis) => string) => readonly BarGhost[] | undefined;
}

/**
 * See-through extensions of bars, joined to the bar they come out of:
 * reaching back from its start or on from its end, dashed and in the bar's
 * colour, or red where the host marks a clash. Each one tucks under its bar,
 * which is masked out of it, so it fills in beside the bar's end, whatever
 * its shape, and the two read as one shape, rounded and dashed only at the
 * ghost's far end. (That assumes bars drawn in DefaultBar's shape.) Hovering
 * one shows its label in a pill; clicking it selects its bar. Place it after
 * the bars and their labels, so a clash shows over the bar it runs into.
 * Decorative: the host's `describe` must say the same in text.
 */
export function BarGhosts({ ghosts }: BarGhostsProps) {
  const region = useTimelineRegion();
  const { bars, barRadius, scale, emit, formatTime } = useTimeline();
  // Mask ids, unique to this chart.
  const uid = useId().replace(/[^\w-]/g, "");
  if (region !== "plot") return null;

  return (
    <g className="st-ghosts" aria-hidden="true">
      {bars.flatMap((bar, index) =>
        (ghosts(bar, formatTime) ?? []).map((ghost) => {
          const { id, start, end } = bar.occupancy;
          const before = ghost.side === "start";
          // From the stay's own times, so a ghost of a bar cut off at the window edge still lines up.
          const edge = scale.x(before ? start : end);
          const reach = scale.x(before ? start - ghost.ms : end + ghost.ms);
          const [x0, x1] = (before ? [reach, edge] : [edge, reach]).map((x) => clamp(x, 0, scale.width));
          if (x1 - x0 < 2) return null;
          // Far enough under the bar that the ghost's own inner corners sit behind the bar's end (each
          // at most half its height round), never past the bar's middle.
          const tuck = Math.min(bar.height, bar.width / 2);
          const shape = before ? { x: x0, width: x1 - x0 + tuck } : { x: x0 - tuck, width: x1 - x0 + tuck };
          const ghostPath = barPath({ ...shape, y: bar.y, height: bar.height }, ROUND_ENDS, barRadius);
          const maskId = `st-ghost-${uid}-${index}-${ghost.side}`;
          const width = pillWidth(ghost.label);
          return (
            <g
              key={`${id}-${ghost.side}`}
              className={["st-ghost", ghost.clash ? "st-ghost--clash" : "", ghost.className ?? ""].join(" ")}
              style={ghost.color && !ghost.clash ? { color: ghost.color } : undefined}
              data-ghost-of={id}
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                const toggle = e.shiftKey || e.metaKey || e.ctrlKey;
                emit({ type: "select", occupancyIds: [id], mode: toggle ? "toggle" : "replace" });
              }}
            >
              {/* The ghost's own shape, less its bar: its outline stays inside it, flush with the bar's edges. */}
              <mask
                id={maskId}
                maskUnits="userSpaceOnUse"
                x={shape.x - 4}
                y={bar.y - 4}
                width={shape.width + 8}
                height={bar.height + 8}
              >
                <path d={ghostPath} fill="white" />
                <path d={barPath(bar, bar.ends, barRadius)} fill="black" />
              </mask>
              <path className="st-ghost-rect" d={ghostPath} mask={`url(#${maskId})`} />
              {/* Masks do not change what takes the pointer: only the ghost itself does, never its bar. */}
              <rect className="st-ghost-hit" x={x0} y={bar.y} width={x1 - x0} height={bar.height} />
              <Pill
                className="st-ghost-pill"
                text={ghost.label}
                // Lined up with the ghost's outer end, kept on the plot.
                x={clamp(before ? x1 - width : x0, 2, Math.max(2, scale.width - width - 2))}
                // Above the ghost, or below it on the first row, where there is no room above.
                y={bar.rowIndex === 0 ? bar.y + bar.height + 2 : bar.y - 17}
              />
            </g>
          );
        }),
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ link */

export interface BarLinkProps {
  /** Occupancy the link starts from. */
  fromId: string;
  /** Occupancy the link points to; dashes flow toward it. */
  toId: string;
  /** Host status class, e.g. for a compatible/incompatible swap. */
  className?: string;
  /** Corner radius of the elbows, px. */
  cornerRadius?: number;
  /** Radius of the dots marking both ends, px. */
  endRadius?: number;
}

/**
 * Dashed elbow connector between two bars, drawn above them. Decorative only:
 * the host conveys the relationship in text. Renders nothing unless both bars
 * are visible. Dashes flow from `fromId` to `toId` unless reduced motion is set.
 */
export function BarLink({ fromId, toId, className, cornerRadius = 8, endRadius = 4 }: BarLinkProps) {
  const region = useTimelineRegion();
  const { bars } = useTimeline();
  if (region !== "plot") return null;
  const a = bars.find((b) => b.occupancy.id === fromId);
  const b = bars.find((b) => b.occupancy.id === toId);
  if (!a || !b || a === b) return null;

  const points = linkRoute(a, b);
  const [start, end] = [points[0], points[points.length - 1]];
  return (
    <g className={["st-link", className ?? ""].join(" ")} pointerEvents="none" aria-hidden="true">
      <path className="st-link-path" d={roundedPath(points, cornerRadius)} />
      <circle className="st-link-end" cx={start[0]} cy={start[1]} r={endRadius} />
      <circle className="st-link-end" cx={end[0]} cy={end[1]} r={endRadius} />
    </g>
  );
}

/* ------------------------------------------------------------------ labels */

export type BarLabelSlotName = "start" | "center" | "end";

/** One label position: a primary line and an optional second line beneath it. */
export interface BarLabelSlot {
  primary: string;
  secondary?: string;
  /**
   * Optional decorative icons beside the whole text stack (vertically centred),
   * before (`leading`) or after (`trailing`) it. Any SVG-renderable node sized
   * at 1em; the chart sizes it to `iconSize` and reserves
   * `iconMargin + iconSize + iconMargin + iconGap` for it when fitting. It is
   * shown only together with its text, never on its own. Keep it aria-hidden;
   * the bar's `describe` text carries the meaning.
   */
  leading?: ReactNode;
  trailing?: ReactNode;
  /**
   * Optional host HTML drawn in place of the slot's text and icons, e.g. a
   * design-system tag. It sits in a <foreignObject> `height` px tall,
   * vertically centred and aligned like the slot's text; the chart never
   * styles it. Fitting counts `primary` plus `padding` px, so HTML with no
   * text (e.g. a picture) may have an empty `primary`. It is never
   * truncated: when it does not fit whole, it is left out.
   */
  html?: BarLabelHtml;
  /**
   * Optional narrower forms of this slot, widest first, e.g. the same tag
   * with fewer parts. When this is the lowest-priority slot shown and does not
   * fit, each is tried in turn before the slot is left out. A form whose
   * `html` carries no text may have an empty `primary`; it fits as `padding`.
   */
  narrower?: readonly BarLabelSlot[];
}

export interface BarLabelHtml {
  node: ReactNode;
  height: number;
  padding: number;
}

export type BarLabelSlots = Partial<Record<BarLabelSlotName, BarLabelSlot>>;

export interface BarLabelsProps {
  /**
   * Structured labels: `start` is left-aligned, `center` centred, `end`
   * right-aligned. Takes precedence over `text`.
   */
  slots?: (bar: BarDatum) => BarLabelSlots | undefined;
  /** Simple single label (rendered as the `start` slot). */
  text?: (bar: BarDatum) => string | undefined;
  color?: (bar: BarDatum) => string | undefined;
  /**
   * Extra classes for a bar's labels, beside the state classes the chart
   * gives them (.st-bar-labels--selected, --linked, --hovered, --focused).
   */
  className?: (bar: BarDatum) => string | undefined;
  /**
   * Disclosure order when space is short. The longest prefix of this list
   * (restricted to slots the bar actually has) that fits untruncated is shown.
   */
  priority?: readonly BarLabelSlotName[];
  /**
   * Approximate average glyph width in px, used for fitting and ellipsis
   * truncation. Match it to --st-font-size; text is also hard-clipped per slot.
   */
  charWidth?: number;
  /** Vertical distance between the two lines; two lines need bar height ≥ 2 × pitch. */
  linePitch?: number;
  /** Minimum horizontal gap between slots. */
  slotGap?: number;
  /** Rendered size of slot icons, px. */
  iconSize?: number;
  /** Gap between an icon block and its text stack, px. */
  iconGap?: number;
  /** Horizontal margin on both sides of each icon, inside its reserved block, px. */
  iconMargin?: number;
  /** Space between each end of a bar and its labels, px, in from where a shaped end begins, as from a round one. */
  padding?: number;
}

interface PlacedSlot {
  name: BarLabelSlotName;
  x: number;
  width: number;
  primary: string;
  secondary?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  html?: BarLabelHtml;
  /** Width reserved per icon: margin + size + margin + gap (0 without an icon). */
  leadW: number;
  trailW: number;
}

export interface SlotIconMetrics {
  size: number;
  gap: number;
  /** Margin on the left and right of the icon. */
  margin?: number;
}

/** Width one icon reserves in a slot: margin + size + margin, then the text gap. */
function iconBlockWidth(icon: SlotIconMetrics): number {
  return icon.size + 2 * (icon.margin ?? 0) + icon.gap;
}

const DEFAULT_PRIORITY: readonly BarLabelSlotName[] = ["start", "end", "center"];

/**
 * Pure label layout inside an inner width `w`. Slots never overlap:
 * 1. Try the longest prefix of `order` whose untruncated slots fit side by side
 *    (start flush left, end flush right, centre centred, nudged into the free gap).
 *    The prefix's last slot tries its `narrower` forms before it is dropped.
 * 2. Otherwise show only the first slot, its text ellipsis-truncated to the
 *    width left after its icons.
 * 3. Show nothing if not even a few characters fit; an icon is never shown alone.
 * Slot widths include icons (size + gap) so text and icons never overlap.
 */
export function layoutLabelSlots(
  slots: BarLabelSlots,
  order: readonly BarLabelSlotName[],
  w: number,
  twoLines: boolean,
  charWidth: number,
  gap: number,
  icon: SlotIconMetrics = { size: 16, gap: 3 },
): PlacedSlot[] {
  const names = order.filter((n) => slots[n]?.primary || slots[n]?.html);
  const textOf = (s: BarLabelSlot) => {
    // Host HTML replaces the text and icons, so it has no second line or icon widths.
    if (s.html) return { primary: s.primary, html: s.html, leadW: 0, trailW: 0 };
    return {
      primary: s.primary,
      secondary: twoLines ? s.secondary : undefined,
      leading: s.leading,
      trailing: s.trailing,
      leadW: s.leading ? iconBlockWidth(icon) : 0,
      trailW: s.trailing ? iconBlockWidth(icon) : 0,
    };
  };
  const widthOf = (s: BarLabelSlot) => {
    const t = textOf(s);
    const textW = Math.ceil(Math.max(t.primary.length, t.secondary?.length ?? 0) * charWidth);
    return t.leadW + textW + t.trailW + (t.html?.padding ?? 0);
  };

  /** These slots, each in the form given, side by side; null when they do not fit. */
  const place = (forms: ReadonlyMap<BarLabelSlotName, BarLabelSlot>): PlacedSlot[] | null => {
    const placed: PlacedSlot[] = [];
    let left = 0;
    let right = w;
    const start = forms.get("start");
    if (start) {
      const sw = widthOf(start);
      placed.push({ name: "start", x: 0, width: sw, ...textOf(start) });
      left = sw + gap;
    }
    const end = forms.get("end");
    if (end) {
      const ew = widthOf(end);
      placed.push({ name: "end", x: w - ew, width: ew, ...textOf(end) });
      right = w - ew - gap;
    }
    const center = forms.get("center");
    if (center) {
      const cw = widthOf(center);
      const x = Math.min(Math.max((w - cw) / 2, left), right - cw);
      if (x < left) return null;
      placed.push({ name: "center", x, width: cw, ...textOf(center) });
    } else if (left > right + gap) {
      return null; // start and end would collide
    }
    return placed.every((p) => p.x >= 0 && p.x + p.width <= w) ? placed : null;
  };

  for (let k = names.length; k > 0; k--) {
    const shown = names.slice(0, k);
    const last = shown[k - 1];
    for (const form of [slots[last]!, ...(slots[last]!.narrower ?? [])]) {
      const placed = place(new Map(shown.map((n) => [n, n === last ? form : slots[n]!])));
      if (placed) return placed;
    }
  }

  const first = names[0];
  if (!first) return [];
  const t = textOf(slots[first]!);
  if (t.html) return widthOf(slots[first]!) <= w ? [{ ...t, name: first, x: 0, width: w }] : [];
  const textW = w - t.leadW - t.trailW;
  if (textW <= 0) return [];
  const primary = fitLabel(t.primary, textW, charWidth);
  if (!primary) return [];
  const secondary = t.secondary ? fitLabel(t.secondary, textW, charWidth) || undefined : undefined;
  return [{ ...t, name: first, x: 0, width: w, primary, secondary }];
}

export function BarLabels(props: BarLabelsProps) {
  const region = useTimelineRegion();
  const { bars, hover } = useTimeline();
  if (region !== "plot") return null;
  return (
    <g pointerEvents="none" aria-hidden="true">
      {bars.map((bar) => (
        <BarLabel key={bar.occupancy.id} bar={bar} hover={hover} {...props} />
      ))}
    </g>
  );
}

/**
 * One bar's labels. The labels are their own layer, above every bar, so CSS
 * can't reach them from their bar's :hover or :focus-visible; each follows
 * the shared store for its own bar alone, so the pointer crossing the board
 * redraws the labels it leaves and enters, not all of them. Memoized as the
 * bars are (OccupancyBar).
 */
const BarLabel = memo(function BarLabel({
  bar,
  hover,
  slots,
  text,
  color,
  className,
  priority = DEFAULT_PRIORITY,
  charWidth = 7,
  linePitch = 14,
  slotGap = 8,
  iconSize = 16,
  iconGap = 3,
  iconMargin = 0,
  padding = 5,
}: BarLabelsProps & { bar: BarDatum; hover: HoverStore }) {
  const id = bar.occupancy.id;
  const hovered = useSyncExternalStore(hover.subscribe, () => hover.get().hoveredId === id);
  const focused = useSyncExternalStore(hover.subscribe, () => hover.get().focusedId === id);

  let barSlots = slots?.(bar);
  if (!barSlots) {
    const raw = text ? text(bar) : (bar.occupancy.label ?? bar.visit?.label);
    if (!raw) return null;
    barSlots = { start: { primary: raw } };
  }
  // `padding` in from the bar's end, or from where a shaped end begins, as from a round one.
  const padLeft = padding + barEndDepth(bar.ends.start, bar.height);
  const padRight = padding + barEndDepth(bar.ends.end, bar.height);
  const w = bar.width - padLeft - padRight;
  if (w <= 0) return null;
  const twoLines = bar.height >= 2 * linePitch;
  const placed = layoutLabelSlots(barSlots, priority, w, twoLines, charWidth, slotGap, {
    size: iconSize,
    gap: iconGap,
    margin: iconMargin,
  });
  if (placed.length === 0) return null;
  const fill = color?.(bar);
  const mid = bar.height / 2;
  const iconY = (bar.height - iconSize) / 2;

  return (
    <g
      className={[
        "st-bar-labels",
        bar.selected ? "st-bar-labels--selected" : "",
        bar.linked ? "st-bar-labels--linked" : "",
        hovered ? "st-bar-labels--hovered" : "",
        focused ? "st-bar-labels--focused" : "",
        className?.(bar) ?? "",
      ].join(" ")}
    >
      {placed.map((p) => {
        const anchor = p.name === "end" ? "end" : p.name === "center" ? "middle" : "start";
        const textX0 = p.leadW;
        const textW = p.width - p.leadW - p.trailW;
        const tx = anchor === "end" ? textX0 + textW : anchor === "middle" ? textX0 + textW / 2 : textX0;
        const hasSecond = !!p.secondary;
        const iconBox = (x: number, node: ReactNode) => (
          <svg
            className="st-bar-label-icon"
            x={x}
            y={iconY}
            width={iconSize}
            height={iconSize}
            style={{ fontSize: iconSize, color: fill }}
            aria-hidden="true"
          >
            {node}
          </svg>
        );
        const slotW = Math.max(0, Math.min(p.width, w - p.x));
        // Each slot gets its own nested <svg>, which clips it to its allotted width.
        if (p.html) {
          return (
            <svg key={p.name} x={bar.x + padLeft + p.x} y={bar.y} width={slotW} height={bar.height}>
              <foreignObject x={0} y={(bar.height - p.html.height) / 2} width={slotW} height={p.html.height}>
                <div className={`st-bar-label-html st-bar-label-html--${p.name}`}>{p.html.node}</div>
              </foreignObject>
            </svg>
          );
        }
        return (
          <svg key={p.name} x={bar.x + padLeft + p.x} y={bar.y} width={slotW} height={bar.height}>
            {/* Icons sit inset by iconMargin within their reserved block. */}
            {p.leading && iconBox(iconMargin, p.leading)}
            {p.trailing && iconBox(p.width - iconMargin - iconSize, p.trailing)}
            <text
              className="st-bar-label st-bar-label--primary"
              x={tx}
              y={hasSecond ? mid - linePitch / 2 : mid}
              textAnchor={anchor}
              dominantBaseline="central"
              style={{ fill }}
            >
              {p.primary}
            </text>
            {hasSecond && (
              <text
                className="st-bar-label st-bar-label--secondary"
                x={tx}
                y={mid + linePitch / 2}
                textAnchor={anchor}
                dominantBaseline="central"
                style={{ fill }}
              >
                {p.secondary}
              </text>
            )}
          </svg>
        );
      })}
    </g>
  );
});
