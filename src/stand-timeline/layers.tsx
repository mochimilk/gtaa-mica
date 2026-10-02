import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useTimeline, useTimelineRegion } from "./context";
import { HOUR, MINUTE, crisp, fitLabel, timeTicks } from "./geometry";
import type { BarDatum, Millis, TimelineRow } from "./model";

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
  /** Accessible name and hover tooltip. */
  describe?: (bar: BarDatum, formatTime: (t: Millis) => string) => string;
}

/** Plain bar. Clipping to the visible window is conveyed in text (see `describeClipping`), not by end shapes. */
export function DefaultBar({ bar, style }: { bar: BarDatum; style: BarStyle }) {
  const css: CSSProperties = { fill: style.fill, stroke: style.stroke };
  return (
    // rx attribute is a fallback; CSS --st-bar-radius wins where supported.
    <rect className="st-bar-rect" x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={3} style={css} />
  );
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

export function OccupancyBars({ barStyle, renderBar, describe = defaultDescribe }: OccupancyBarsProps) {
  const region = useTimelineRegion();
  const { bars, emit, formatTime } = useTimeline();
  if (region !== "plot") return null;

  const select = (id: string, toggle: boolean) =>
    emit({ type: "select", occupancyIds: [id], mode: toggle ? "toggle" : "replace" });

  return (
    <g>
      {bars.map((bar) => {
        const style = barStyle?.(bar) ?? {};
        const label = describe(bar, formatTime);
        const id = bar.occupancy.id;
        return (
          <g
            key={id}
            className={[
              "st-bar",
              bar.selected ? "st-bar--selected" : "",
              bar.linked ? "st-bar--linked" : "",
              style.className ?? "",
            ].join(" ")}
            style={style.color ? { color: style.color } : undefined}
            role="button"
            tabIndex={0}
            aria-pressed={bar.selected}
            aria-label={label}
            data-occupancy-id={id}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              select(id, e.shiftKey || e.metaKey || e.ctrlKey);
            }}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                select(id, e.shiftKey);
              } else if (e.key === "Escape") {
                emit({ type: "select", occupancyIds: [], mode: "replace" });
              }
            }}
          >
            <title>{label}</title>
            {renderBar ? renderBar(bar, style) : <DefaultBar bar={bar} style={style} />}
            <rect
              className="st-bar-outline"
              x={bar.x - 1.5}
              y={bar.y - 1.5}
              width={bar.width + 3}
              height={bar.height + 3}
              rx={4}
            />
          </g>
        );
      })}
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
}

interface PlacedSlot {
  name: BarLabelSlotName;
  x: number;
  width: number;
  primary: string;
  secondary?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
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
  const names = order.filter((n) => slots[n]?.primary);
  const textOf = (n: BarLabelSlotName) => {
    const s = slots[n]!;
    return {
      primary: s.primary,
      secondary: twoLines ? s.secondary : undefined,
      leading: s.leading,
      trailing: s.trailing,
      leadW: s.leading ? iconBlockWidth(icon) : 0,
      trailW: s.trailing ? iconBlockWidth(icon) : 0,
    };
  };
  const widthOf = (n: BarLabelSlotName) => {
    const t = textOf(n);
    const textW = Math.ceil(Math.max(t.primary.length, t.secondary?.length ?? 0) * charWidth);
    return t.leadW + textW + t.trailW;
  };

  for (let k = names.length; k > 0; k--) {
    const chosen = new Set(names.slice(0, k));
    const placed: PlacedSlot[] = [];
    let left = 0;
    let right = w;
    if (chosen.has("start")) {
      const sw = widthOf("start");
      placed.push({ name: "start", x: 0, width: sw, ...textOf("start") });
      left = sw + gap;
    }
    if (chosen.has("end")) {
      const ew = widthOf("end");
      placed.push({ name: "end", x: w - ew, width: ew, ...textOf("end") });
      right = w - ew - gap;
    }
    if (chosen.has("center")) {
      const cw = widthOf("center");
      const x = Math.min(Math.max((w - cw) / 2, left), right - cw);
      if (x < left) continue;
      placed.push({ name: "center", x, width: cw, ...textOf("center") });
    } else if (left > right + gap) {
      continue; // start and end would collide
    }
    if (placed.every((p) => p.x >= 0 && p.x + p.width <= w)) return placed;
  }

  const first = names[0];
  if (!first) return [];
  const t = textOf(first);
  const textW = w - t.leadW - t.trailW;
  if (textW <= 0) return [];
  const primary = fitLabel(t.primary, textW, charWidth);
  if (!primary) return [];
  const secondary = t.secondary ? fitLabel(t.secondary, textW, charWidth) || undefined : undefined;
  return [{ ...t, name: first, x: 0, width: w, primary, secondary }];
}

export function BarLabels({
  slots,
  text,
  color,
  priority = DEFAULT_PRIORITY,
  charWidth = 7,
  linePitch = 14,
  slotGap = 8,
  iconSize = 16,
  iconGap = 3,
  iconMargin = 0,
}: BarLabelsProps) {
  const region = useTimelineRegion();
  const { bars } = useTimeline();
  if (region !== "plot") return null;

  return (
    <g pointerEvents="none" aria-hidden="true">
      {bars.map((bar) => {
        let barSlots = slots?.(bar);
        if (!barSlots) {
          const raw = text ? text(bar) : (bar.occupancy.label ?? bar.visit?.label);
          if (!raw) return null;
          barSlots = { start: { primary: raw } };
        }
        const padLeft = 5;
        const padRight = 5;
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
          <g key={bar.occupancy.id}>
            {placed.map((p) => {
              const anchor = p.name === "end" ? "end" : p.name === "center" ? "middle" : "start";
              const textX0 = p.leadW;
              const textW = p.width - p.leadW - p.trailW;
              const tx =
                anchor === "end" ? textX0 + textW : anchor === "middle" ? textX0 + textW / 2 : textX0;
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
              // Each slot gets its own nested <svg>, which clips it to its allotted width.
              return (
                <svg
                  key={p.name}
                  x={bar.x + padLeft + p.x}
                  y={bar.y}
                  width={Math.max(0, Math.min(p.width, w - p.x))}
                  height={bar.height}
                >
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
      })}
    </g>
  );
}
