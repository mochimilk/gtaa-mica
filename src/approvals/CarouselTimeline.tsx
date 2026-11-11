// Baggage's view of one stand change, on the board's own chart: the carousels
// as rows in place of the stands, under the same time ruler, and every
// arrival's bags on them as bars, from the first bag off to the last
// (../operations/baggage). A bar is the bags on the belt, never the aircraft's
// turn: every bar says its flight and how many bags, one rule for them all, and,
// given room, where from and the hours they take. A late arrival's bags reach
// back to when they were due off, as a ghost, as the board draws a late stay; a
// carousel out of service is hatched for its hours, as the board hatches a
// closed area, and maintenance moved has its new hours filled in the brand's
// colour and its old ones dashed. The change's own bags stand out: where they
// came off before it (dashed), joined by a link to where they come off now,
// that bar filled in the brand's colour as a value that changes is on its card,
// and whatever they clash with there, in the board's conflict red. Bags that
// stay on their carousel are neutral. Everything else is dimmed,
// as the board dims what a selection leaves out. The chart frames the change
// as it opens, closer in than the board (bags take a quarter to three
// quarters of an hour, a stay hours), and pinching or Ctrl + scrolling zooms
// it as it does the board. It only shows: nothing here can be dragged. Below
// the last carousel, empty rows (no number, no bars) fill out whatever height
// is left, so the chart's grid runs to the pane's foot.
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BarGhosts,
  BarLabels,
  BarLink,
  HOUR,
  OccupancyBars,
  StandRows,
  StandTimeline,
  TimeAxis,
  TimeGrid,
  useTimeline,
  useTimelineRegion,
  useTimelineZoom,
  type BarDatum,
  type BarGhost,
  type BarLabelSlots,
  type BarStyle,
  type Occupancy,
  type TimelineRow,
  type Visit,
} from "../stand-timeline";
import { airportLabel } from "../stand-timeline-demo/airports";
import { SYNTHETIC_CAROUSELS } from "../stand-timeline-demo/baggageFixture";
import { DEMO_DOMAIN, formatUtc } from "../stand-timeline-demo/demoData";
import { formatDelay } from "../stand-timeline-demo/delays";
import {
  BAR_INSET,
  BAR_RADIUS,
  DemoPatternDefs,
  DIM_GRADIENT_ID,
  GUTTER_WIDTH,
  LABEL_METRICS,
  LABEL_PADDING,
  MAX_HOUR_WIDTH,
  QUARTER_RULER,
  ROW_HEIGHT,
  STATUS_PALETTE,
  fluentChartTheme,
  gradientId,
  rulerFor,
} from "../stand-timeline-demo/theme";
import { carouselOutages, type BagMove, type Reclaim } from "../operations/baggage";
import "../stand-timeline-demo/demo.css";
import "./approvals.css";

const ROWS: TimelineRow[] = SYNTHETIC_CAROUSELS.map((carousel) => ({
  id: carousel.code,
  label: carousel.code,
  group: carousel.area,
}));

/** Unlabelled, ungrouped rows to fill `count` rows' room under the carousels. */
const fillerRows = (count: number): TimelineRow[] =>
  Array.from({ length: count }, (_, i) => ({ id: `filler-${i}`, label: "" }));

/** Pixels per hour to start at: the shortest reclaim's bar (20 minutes, 93px) then fits its flight number over its bags. */
const HOUR_WIDTH = 280;

/** The labels' disclosure order, as the board's. */
const LABEL_PRIORITY = ["start", "end", "center"] as const;

const noIntent = () => {};

/** What a bar is in the change: its bags before, after, in their way, or anyone else's. */
type Part = "was" | "now" | "clash" | "other";

/**
 * `spotlit` while Skye talks a teammate through what the change does to its
 * bags (./spotlight): its bars, before and after, are outlined in the brand's
 * colour, as a selection is.
 */
export function CarouselTimeline({ move, spotlit = false }: { move: BagMove; spotlit?: boolean }) {
  const zoom = useTimelineZoom({ initialHourWidth: HOUR_WIDTH, maxHourWidth: MAX_HOUR_WIDTH });
  const hostRef = useRef<HTMLDivElement>(null);
  const { was, now, clashes, outage, others } = move;
  const focus = now ?? was;

  // As many empty rows as it takes to reach the chart's foot, as it resizes:
  // the room under the ruler, in rows, rounded up, less the carousels'.
  const [fillers, setFillers] = useState(0);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const ruler = host.querySelector<HTMLElement>(".st-header")?.offsetHeight ?? 0;
      setFillers(Math.max(0, Math.ceil((host.clientHeight - ruler) / ROW_HEIGHT) - ROWS.length));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const rows = useMemo(() => [...ROWS, ...fillerRows(fillers)], [fillers]);

  const { moved, own, occupancies, visits, parts, byId } = useMemo(() => {
    // Bags that stay where they were show once, where they are now.
    const moved = !!was && !!now && (was.carousel !== now.carousel || was.start !== now.start);
    const own = [moved ? was : undefined, now ?? was].filter((reclaim): reclaim is Reclaim => !!reclaim);
    const all = [...others, ...own];
    const clashIds = new Set(clashes.map((clash) => clash.id));
    const partOf = (reclaim: Reclaim): Part =>
      reclaim.id === now?.id ? "now" : reclaim.id === was?.id ? "was" : clashIds.has(reclaim.id) ? "clash" : "other";
    return {
      moved,
      own,
      occupancies: all.map(
        (reclaim): Occupancy => ({
          id: reclaim.id,
          rowId: reclaim.carousel,
          start: reclaim.start,
          end: reclaim.end,
          visitId: reclaim.stayId,
        }),
      ),
      visits: [...new Map(all.map((reclaim): [string, Visit] => [reclaim.stayId, { id: reclaim.stayId, label: reclaim.flight }])).values()],
      parts: new Map(all.map((reclaim) => [reclaim.id, partOf(reclaim)])),
      byId: new Map(all.map((reclaim) => [reclaim.id, reclaim])),
    };
  }, [was, now, clashes, others]);

  const accessors = useMemo(() => {
    const partOf = (bar: BarDatum) => parts.get(bar.occupancy.id) ?? "other";
    const dimmed = (bar: BarDatum) => partOf(bar) === "other";
    // In someone else's way, or on a carousel out of service then.
    const conflict = (bar: BarDatum) => partOf(bar) === "clash" || (partOf(bar) === "now" && (clashes.length > 0 || !!outage));
    const clashNames = clashes.map((clash) => `${clash.flight}'s`).join(", ");
    const spot = spotlit ? " bags-bar--spotlit" : "";
    return {
      barStyle: (bar: BarDatum): BarStyle => {
        if (partOf(bar) === "was") {
          return { fill: `url(#${DIM_GRADIENT_ID})`, stroke: "var(--flight-glass-mark)", className: `bags-bar--was${spot}` };
        }
        if (dimmed(bar)) {
          return {
            fill: `url(#${DIM_GRADIENT_ID})`,
            stroke: "var(--flight-dim-stroke)",
            color: "var(--flight-dim-text)",
            className: "demo-bar--dimmed",
          };
        }
        // Moved, and clear of anyone: a new value, as its card has it.
        if (partOf(bar) === "now" && moved && !conflict(bar)) {
          return {
            fill: "color-mix(in srgb, var(--colorBrandBackground) 60%, transparent)",
            stroke: "var(--colorBrandStroke1)",
            color: "var(--st-text)",
            className: `bags-bar--now${spot}`,
          };
        }
        const status = conflict(bar) ? "conflict" : "healthy";
        return {
          fill: `url(#${gradientId(status)})`,
          stroke: STATUS_PALETTE[status].edge,
          color: "var(--st-text)",
          className: partOf(bar) === "now" ? `bags-bar--now${spot}` : undefined,
        };
      },
      labelSlots: (bar: BarDatum): BarLabelSlots | undefined => {
        const reclaim = byId.get(bar.occupancy.id);
        if (!reclaim) return undefined;
        // The change's bags are drawn over those they clash with, so a clashing
        // bar's label shows only where enough of it shows before them; the
        // words over the chart name it either way. (No slots at all would
        // fall back to the visit's label.)
        if (now && partOf(bar) === "clash") {
          const room = reclaim.flight.length * LABEL_METRICS.charWidth + 2 * LABEL_PADDING.aero;
          if (((now.start - reclaim.start) / HOUR) * zoom.hourWidth < room) return {};
        }
        // Every bar its flight and bags, however narrow; where from and its hours given room.
        const flightBags = `${reclaim.flight} · ${reclaim.bags} bags`;
        const hours = `${formatUtc(reclaim.start)}–${formatUtc(reclaim.end)}`;
        return {
          start: {
            primary: flightBags,
            secondary: `${reclaim.origin} · ${hours}`,
            narrower: [
              { primary: flightBags, secondary: hours },
              { primary: reclaim.flight, secondary: `${reclaim.bags} bags` },
            ],
          },
        };
      },
      labelColor: (bar: BarDatum) => (dimmed(bar) ? "var(--flight-dim-text)" : "var(--st-text)"),
      labelClassName: (bar: BarDatum) => (dimmed(bar) ? "demo-labels--dimmed" : undefined),
      /** A late arrival's bags: back to when they were due off, as the board's ghost of a late stay. */
      ghosts: (bar: BarDatum, formatTime: (t: number) => string): BarGhost[] | undefined => {
        const reclaim = byId.get(bar.occupancy.id);
        if (!reclaim?.lateMs || partOf(bar) === "was") return undefined;
        return [
          {
            side: "start",
            ms: reclaim.lateMs,
            label: `Bags ${formatDelay(reclaim.lateMs)} late · ${formatTime(reclaim.start - reclaim.lateMs)} → ${formatTime(reclaim.start)}`,
            color: dimmed(bar) ? "var(--flight-dim-text)" : STATUS_PALETTE.healthy.mark,
            className: dimmed(bar) ? "demo-ghost--dimmed" : undefined,
          },
        ];
      },
      describe: (bar: BarDatum, formatTime: (t: number) => string) => {
        const reclaim = byId.get(bar.occupancy.id);
        if (!reclaim) return bar.occupancy.id;
        const part = partOf(bar);
        const role =
          part === "was"
            ? ", before the change"
            : part === "now"
              ? `, after the change${clashNames ? `, clashing with ${clashNames}` : ""}`
              : part === "clash"
                ? `, clashing with ${now?.flight}'s after the change`
                : "";
        const late = reclaim.lateMs ? `, ${formatDelay(reclaim.lateMs)} late (due off ${formatTime(reclaim.start - reclaim.lateMs)} UTC)` : "";
        const aircraft = reclaim.aircraftType ? ` on a ${reclaim.aircraftType}` : "";
        return `${reclaim.flight} from ${airportLabel(reclaim.origin)}${aircraft}, ${reclaim.bags} bags on carousel ${reclaim.carousel} ${formatTime(reclaim.start)}–${formatTime(reclaim.end)} UTC${late}${role} (synthetic)`;
      },
    };
  }, [parts, byId, clashes, outage, now, moved, zoom.hourWidth, spotlit]);

  // Frames the change: its bags, before and after, and what they clash with,
  // in the middle of the chart. At once as it opens, gliding from one change
  // to the next.
  const framed = useRef<string | null>(null);
  const focusKey = `${was?.id}@${was?.carousel}:${was?.start}|${now?.carousel}:${now?.start}`;
  useLayoutEffect(() => {
    const scroller = hostRef.current?.querySelector<HTMLElement>(".st-scroller");
    if (!scroller || !focus) return;
    const span = [...own, ...clashes];
    const middle = (Math.min(...span.map((reclaim) => reclaim.start)) + Math.max(...span.map((reclaim) => reclaim.end))) / 2;
    const rowsOf = span.map((reclaim) => ROWS.findIndex((row) => row.id === reclaim.carousel));
    const header = scroller.querySelector<HTMLElement>(".st-header")?.offsetHeight ?? 0;
    const left = ((middle - DEMO_DOMAIN[0]) / HOUR) * zoom.hourWidth - (scroller.clientWidth - GUTTER_WIDTH) / 2;
    const top = ((Math.min(...rowsOf) + Math.max(...rowsOf) + 1) / 2) * ROW_HEIGHT - (scroller.clientHeight - header) / 2;
    // From one change to another: framing the same one again is not a change.
    const glide = framed.current !== null && framed.current !== focusKey && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    framed.current = focusKey;
    // After the chart has laid out its width for the zoom.
    const frame = requestAnimationFrame(() => scroller.scrollTo({ left, top, behavior: glide ? "smooth" : "auto" }));
    return () => cancelAnimationFrame(frame);
    // Only as the change shown changes, not as the user scrolls or zooms.
  }, [focusKey]);

  return (
    <div ref={hostRef} className="demo-timeline bags-timeline">
      <StandTimeline
        style={fluentChartTheme}
        className="demo-chart"
        fillHeight
        rows={rows}
        visits={visits}
        occupancies={occupancies}
        domain={DEMO_DOMAIN}
        timeZone="UTC"
        rowHeight={ROW_HEIGHT}
        barInset={BAR_INSET}
        barRadius={BAR_RADIUS}
        zoom={zoom}
        labelWidth={GUTTER_WIDTH}
        selectedIds={focus ? [focus.id] : []}
        onIntent={noIntent}
        ariaLabel="Synthetic baggage carousels timeline, times in UTC"
        fade
      >
        <DemoPatternDefs />
        {/* The pane's header names the rows (Baggage carousels), so the corner stays empty. */}
        <StandRows zebra={false} title={null} showGroup={false} labelAlign="end" />
        <TimeGrid minorMs={QUARTER_RULER.stepMs} />
        <OutageBands />
        <OccupancyBars barStyle={accessors.barStyle} describe={accessors.describe} />
        <BarLabels
          slots={accessors.labelSlots}
          color={accessors.labelColor}
          className={accessors.labelClassName}
          priority={LABEL_PRIORITY}
          padding={LABEL_PADDING.aero}
          {...LABEL_METRICS}
        />
        <BarGhosts ghosts={accessors.ghosts} />
        {moved && was && now && (
          <BarLink fromId={was.id} toId={now.id} className={clashes.length > 0 || outage ? "demo-link--incompatible" : undefined} />
        )}
        <OutageLabels />
        <TimeAxis position="top" zoneLabel="UTC" {...rulerFor(zoom.hourWidth)} />
      </StandTimeline>
    </div>
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Each outage's box on the plot, where any of it shows, as things stand, and for maintenance moved, where it was. */
function useOutageBoxes() {
  const region = useTimelineRegion();
  const { rows, rowHeight, scale } = useTimeline();
  if (region !== "plot") return [];
  return carouselOutages().flatMap((outage) => {
    const index = rows.findIndex((row) => row.id === outage.carousel);
    const boxAt = (start: number, end: number) => {
      const x0 = clamp(scale.x(start), 0, scale.width);
      const x1 = clamp(scale.x(end), 0, scale.width);
      return x1 - x0 < 1 ? null : { x: x0, y: index * rowHeight + 2, width: x1 - x0, height: rowHeight - 4 };
    };
    if (index < 0) return [];
    const box = boxAt(outage.start, outage.end);
    const was = outage.movedFrom ? boxAt(outage.movedFrom.start, outage.movedFrom.end) : null;
    return box || was ? [{ outage, box, was }] : [];
  });
}

/** A carousel out of service, hatched for its hours under the bars, as the board's closed area is (operations.css). */
function OutageBands() {
  const hatchId = `bags-outage-hatch-${useId().replace(/[^\w-]/g, "")}`;
  const boxes = useOutageBoxes();
  if (boxes.length === 0) return null;
  return (
    <g className="ops-closure" pointerEvents="none" aria-hidden="true">
      <defs>
        <pattern id={hatchId} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="ops-closure-fill" width={8} height={8} />
          <line className="ops-closure-stripe" x1={0} y1={0} x2={0} y2={8} />
        </pattern>
      </defs>
      {boxes.map(({ outage, box, was }) => (
        <g key={`${outage.carousel}@${outage.from}`} className={outage.movedFrom ? "bags-outage--moved" : undefined}>
          {was && <rect className="bags-outage-was" {...was} rx={4} />}
          {box && <rect className="ops-closure-band" {...box} rx={4} fill={`url(#${hatchId})`} />}
        </g>
      ))}
    </g>
  );
}

/** Roughly how wide the label's 10px semibold text is per character, px; sizes its pill. */
const OUTAGE_CHAR_PX = 6;

/**
 * What each outage is, over the bars: "Belt maintenance 12:00–13:30", in a pill
 * at its start, in the brand's colour once moved, saying when it was.
 */
function OutageLabels() {
  const boxes = useOutageBoxes();
  return (
    <>
      {boxes.map(({ outage, box }) => {
        if (!box) return null;
        const was = outage.movedFrom ? `, was ${formatUtc(outage.movedFrom.start)}–${formatUtc(outage.movedFrom.end)}` : "";
        const text = `${outage.reason} ${outage.from}–${outage.to}${was}`;
        return (
          <g
            key={`${outage.carousel}@${outage.from}`}
            className={outage.movedFrom ? "ops-closure-label bags-outage-label--moved" : "ops-closure-label"}
            pointerEvents="none"
            role="img"
            aria-label={`Carousel ${outage.carousel}: ${text}`}
          >
            <rect x={box.x + 4} y={box.y + box.height / 2 - 8} width={text.length * OUTAGE_CHAR_PX + 12} height={16} rx={8} />
            <text x={box.x + 10} y={box.y + box.height / 2 + 3.5} aria-hidden="true">
              {text}
            </text>
          </g>
        );
      })}
    </>
  );
}
