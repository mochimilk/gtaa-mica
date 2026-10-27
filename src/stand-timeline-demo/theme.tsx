// App-owned theme adapter: maps Fluent v9 tokens (provided by CoralProvider's
// FluentProvider, so light/dark and brand follow the app) onto the neutral
// chart's --st-* variables and per-bar accessors. The chart never imports Fluent.
import type { CSSProperties } from "react";
import { Badge, tokens } from "@fluentui/react-components";
import {
  ArrowCircleLeftRegular,
  ArrowCircleRightRegular,
  VehicleTruckProfileRegular,
} from "@fluentui/react-icons";
import {
  DefaultBar,
  HOUR,
  MINUTE,
  describeClipping,
  useTimeline,
  useTimelineRegion,
  type BarDatum,
  type BarEnds,
  type BarEndShape,
  type BarGhost,
  type BarLabelSlot,
  type BarLabelSlots,
  type BarStyle,
  type Occupancy,
  type TickLabel,
  type TimeAxisProps,
} from "../stand-timeline";
import type { StayDelay, StayEndpoints, StayPosition } from "./adapter";
import { airportLabel } from "./airports";
import { GHOST_SIDES, formatDelay, ghostKey, ghostMs, type GhostClashes } from "./delays";
import { AIRCRAFT_SIZE, type StandSize, type SyntheticTurn } from "./syntheticFixture";

/** Chart theme: typography, spacing, strokes and neutral colours from Fluent tokens. */
export const fluentChartTheme = {
  "--st-font-family": tokens.fontFamilyBase,
  "--st-font-size": tokens.fontSizeBase200,
  "--st-font-size-small": tokens.fontSizeBase100,
  "--st-line-height": tokens.lineHeightBase200,
  "--st-font-weight": tokens.fontWeightRegular,
  "--st-font-weight-strong": tokens.fontWeightSemibold,
  "--st-space-xxs": tokens.spacingHorizontalXXS,
  "--st-space-xs": tokens.spacingHorizontalXS,
  "--st-space-s": tokens.spacingHorizontalS,
  // Square chart frame: it sits flush under the content toolbar.
  "--st-radius": "0",
  "--st-radius-small": tokens.borderRadiusSmall,
  "--st-stroke": tokens.strokeWidthThin,
  "--st-stroke-thick": tokens.strokeWidthThick,
  "--st-stroke-focus": tokens.strokeWidthThick,

  "--st-text": tokens.colorNeutralForeground1,
  "--st-text-muted": tokens.colorNeutralForeground3,
  "--st-tick-text": tokens.colorNeutralForeground3,
  "--st-row-text": tokens.colorNeutralForeground3,
  "--st-border": tokens.colorNeutralStroke2,
  "--st-line": tokens.colorNeutralStroke3,
  "--st-line-strong": tokens.colorNeutralStroke2,
  // Time dividers stay faint: Stroke3 is Fluent's lightest neutral stroke, so
  // the quarter-hour lines thin it further rather than picking another token.
  "--st-grid-major": tokens.colorNeutralStroke3,
  "--st-grid-minor": `color-mix(in srgb, ${tokens.colorNeutralStroke3} 60%, transparent)`,
  "--st-tick": tokens.colorNeutralStroke3,
  "--st-tick-major": tokens.colorNeutralStroke1,
  // Only the pinned stand column/corner get a surface: colorNeutralBackground4
  // at 85%, with blur (the same glass idiom Coral uses).
  "--st-pinned-bg": `color-mix(in srgb, ${tokens.colorNeutralBackground4} 85%, transparent)`,
  "--st-pinned-backdrop": "blur(40px)",
  "--st-zone-bg": tokens.colorNeutralBackground3,
  "--st-selected": "var(--flight-outline)",
  "--st-linked": "var(--flight-outline)",
  "--st-focus": "var(--flight-outline)",
  "--st-link": "var(--flight-outline)",
  "--st-drop-allowed": tokens.colorPaletteGreenForeground1,
  "--st-drop-blocked": tokens.colorPaletteRedForeground1,
  // Delay ghosts: a clashing one in the conflict red its bar has (demo.css),
  // with that red's paired text on its pill.
  "--st-ghost-clash": "var(--flight-conflict)",
  "--st-ghost-pill-bg": tokens.colorNeutralBackgroundInverted,
  "--st-ghost-pill-text": tokens.colorNeutralForegroundInverted,
  "--st-ghost-pill-clash-text": "var(--flight-conflict-text)",
  // Scrollbars: the app-wide Coral-style treatment in src/index.css applies.
} as CSSProperties;

/**
 * Status palette, scoped to the demo chart by demo.css (values per light/dark
 * mode live there). Only a stay that needs attention takes a colour:
 *   healthy: neutral glass, so the board stays quiet and Skye's purple (her
 *     cursors' aura, her selections) stands out on it: faint white, fading
 *     left to right as the coloured bars do, over the blurred grid (BarBackdrop), inside
 *     Fluent's Stroke 1 at rest; the size tag says narrowbody or widebody,
 *   conflict: red, a late stay whose delay runs into another stay on its
 *     stand (the clashes the Alerts list as conflicts; see ./delays),
 *   waiting: orange, a stay with no stand, in the No stand lane.
 * A coloured bar's fill is its colour, fading left to right from
 * BAR_FADE.from to BAR_FADE.to opacity, inside a full-opacity border of it.
 * Every bar's labels use the neutral text colour.
 */
export type FlightStatus = "healthy" | "conflict" | "waiting";

/** A bar's fill: a gradient from its left end to its right, its stops as [colour, opacity]. */
type FillStops = readonly (readonly [string, number])[];

interface StatusPalette {
  /** The border at rest; hover and selection draw the chart's outline over it. */
  edge: string;
  /** The colour of the bar's delay ghosts and tow/hold stripes. */
  mark: string;
  fill: FillStops;
}

/** How much of the status colour a coloured bar's fill shows, at its left end and its right. Its border stays solid. */
const BAR_FADE = { from: 0.3, to: 0.22 };

/** A coloured bar: a fade of its colour, inside a border of it. */
const faded = (status: FlightStatus): StatusPalette => {
  const color = `var(--flight-${status})`;
  return { edge: color, mark: color, fill: [[color, BAR_FADE.from], [color, BAR_FADE.to]] };
};

/**
 * A healthy bar: neutral glass, white fading left to right (its opacities per
 * mode in demo.css: a dark board needs far less white than a light one),
 * inside Fluent's Stroke 1 at rest; its ghosts and stripes in a
 * stronger neutral, so they still read.
 */
const GLASS: StatusPalette = {
  edge: "var(--flight-glass-edge)",
  mark: "var(--flight-glass-mark)",
  fill: [["var(--flight-glass-from)", 1], ["var(--flight-glass-to)", 1]],
};

/** A dimmed bar's fill: the glass at its faintest, still frosting what is behind it. */
const DIM_FILL: FillStops = [["var(--flight-dim-glass-from)", 1], ["var(--flight-dim-glass-to)", 1]];
const DIM_GRADIENT_ID = "demo-gradient-dimmed";

/**
 * Background blur under the bars, px (BarBackdrop): frosted glass, the grid
 * behind softened but still there. Much more spreads a 1px line so thin it
 * vanishes inside the bar while it stays sharp beside it.
 */
export const BAR_BACKDROP_BLUR = 2;
/** How saturated what shows through the bars is (BarBackdrop): 180%, as acrylic glass lifts what is behind it. */
export const BAR_BACKDROP_SATURATE = 1.8;
/**
 * Tow/hold stripes, in the bar's mark colour over the fill. Neutral labels
 * keep ≥ 4.5:1 over them in both modes.
 */
const HATCH_OPACITY = 0.3;
/**
 * The aircraft type in a bar's middle (Figma GTAA-Dash 151:3938), px, for
 * fitting: a 4px gap, then the two-letter size tag with its 6px insets and
 * border. The type itself counts as its characters.
 */
const TYPE_CHIP = { height: 20, gap: 4, sizeTag: 32 };

/** The size tag: narrowbody or widebody. */
const SIZE_TAG: Record<StandSize, string> = { narrow: "NB", wide: "WB" };

export const STATUS_PALETTE: Record<FlightStatus, StatusPalette> = {
  healthy: GLASS,
  conflict: faded("conflict"),
  waiting: faded("waiting"),
};

const hatchId = (status: FlightStatus) => `demo-hatch-${status}`;
const gradientId = (status: FlightStatus) => `demo-gradient-${status}`;

/**
 * Custom layer: per-status defs, and the dimmed bars' fill. The fill gradients
 * use bounding-box units, so they span each bar whatever its size. Hatch patterns for tow/hold stays
 * are stripes only, in the bar's mark colour at HATCH_OPACITY, drawn over its
 * fill. Colours go through `style` because CSS variables don't resolve in SVG
 * presentation attributes. Drawn once, in the body's plot: bars in the
 * pinned rows' plot use the same ids, as one document they can reach.
 */
export function DemoPatternDefs() {
  const region = useTimelineRegion();
  const { section } = useTimeline();
  if (region !== "plot" || section !== "body") return null;
  const palettes = Object.entries(STATUS_PALETTE) as [FlightStatus, StatusPalette][];
  const fills: [string, FillStops][] = [
    ...palettes.map(([status, p]): [string, FillStops] => [gradientId(status), p.fill]),
    [DIM_GRADIENT_ID, DIM_FILL],
  ];
  return (
    <defs>
      {fills.map(([id, stops]) => (
        <linearGradient key={id} id={id} x1={0} y1={0} x2={1} y2={0}>
          {stops.map(([color, opacity], i) => (
            <stop key={i} offset={i / (stops.length - 1)} style={{ stopColor: color, stopOpacity: opacity }} />
          ))}
        </linearGradient>
      ))}
      {palettes.map(([status, p]) => (
        <pattern
          key={status}
          id={hatchId(status)}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={6} style={{ stroke: p.mark, strokeOpacity: HATCH_OPACITY, strokeWidth: 2 }} />
        </pattern>
      ))}
    </defs>
  );
}

// Tow endpoint wording, used on the bar and in its description. The truck is a
// provisional demo icon, not an established allocator symbol.
const TOW_IN = "Tow-in";
const TOW_OUT = "Tow-out";

/**
 * How flights are drawn, on the board and in the flight card, as chosen in
 * the View menu's Timeline row. Aero, the default, is the original look,
 * every end round, with the arrival, departure and tow icons; Classic shapes
 * each end of a bar by what happens there (END_SHAPE) and leaves the icons out.
 */
export type FlightStyle = "classic" | "aero";

/** Each style's name, as the View menu shows it. */
export const FLIGHT_STYLE_LABEL: Record<FlightStyle, string> = { classic: "Classic", aero: "Aero" };

/**
 * In classic, each end of a stay's bar, by what happens there: a flight
 * tapers it, its arrival to the left and its departure to the right; a tow
 * zigzags it; with neither it stays round. The flight card's box takes the
 * same shape.
 */
export const END_SHAPE: Record<StayEndpoints["start"]["kind"], BarEndShape> = {
  flight: "taper",
  tow: "zigzag",
  none: "round",
};

/** A stay's end shapes, from its recorded endpoints; round where there are none. */
export const stayEnds = (ep: StayEndpoints | undefined): BarEnds => ({
  start: END_SHAPE[ep?.start.kind ?? "none"],
  end: END_SHAPE[ep?.end.kind ?? "none"],
});

/**
 * @param delays How late each running-late stay is; drawn as ghosts.
 * @param clashes Which of those ghosts run into another stay; drawn red.
 * @param isMatch Optional host predicate (views/filters). When given, bars it
 *   rejects are DIMMED, never removed: they stay occupied, focusable and
 *   selectable. Selected bars and their linked visit stays always stay at
 *   full prominence. With an active selection, unrelated stays are grey too.
 */
export function makeDemoAccessors(
  turnsById: Map<string, SyntheticTurn>,
  stayPosition: Map<string, StayPosition>,
  endpoints: Map<string, StayEndpoints>,
  delays: ReadonlyMap<string, StayDelay>,
  clashes: GhostClashes,
  isMatch?: (occupancyId: string) => boolean,
  hasSelection = false,
  /** Stays Skye has selected: outlined in her colours, not the user's (demo-bar--skye). */
  skyeIds: ReadonlySet<string> = new Set(),
  /** Rows of stays waiting for a stand (the chart's pinned rows), described as waiting rather than by stand. */
  waitingRows: ReadonlySet<string> = new Set(),
  /** Aero labels a bar's ends with icons; classic leaves them out. */
  flightStyle: FlightStyle = "aero",
) {
  const icons = flightStyle === "aero";
  const turnOf = (bar: BarDatum) =>
    bar.occupancy.visitId ? turnsById.get(bar.occupancy.visitId) : undefined;
  /** A stay's flights, e.g. "XB210/211", or the one flight of a one-flight visit. */
  const stayName = (o: Occupancy) => {
    const t = o.visitId ? turnsById.get(o.visitId) : undefined;
    if (!t) return o.id;
    return t.arrFlight && t.depFlight ? `${t.arrFlight}/${t.depFlight.slice(t.carrier.length)}` : t.arrFlight || t.depFlight;
  };
  /** Waiting in the No stand lane; else in conflict when either of its delays runs into another stay; else healthy. */
  const statusOf = (bar: BarDatum): FlightStatus =>
    waitingRows.has(bar.row.id)
      ? "waiting"
      : GHOST_SIDES.some((side) => clashes.has(ghostKey(bar.occupancy.id, side)))
        ? "conflict"
        : "healthy";
  const paletteOf = (bar: BarDatum) => STATUS_PALETTE[statusOf(bar)];
  const isDimmed = (bar: BarDatum) =>
    !bar.selected && !bar.linked && (hasSelection || (!!isMatch && !isMatch(bar.occupancy.id)));

  const barStyle = (bar: BarDatum): BarStyle => {
    const p = paletteOf(bar);
    if (isDimmed(bar)) {
      // Context stays occupied/selectable, drawn as a disabled control: the
      // faintest glass, its outline and labels in the muted dim colours.
      return {
        fill: `url(#${DIM_GRADIENT_ID})`,
        stroke: "var(--flight-dim-stroke)",
        color: "var(--flight-dim-text)",
        className: "demo-bar--dimmed",
      };
    }
    // Glass, or a fade of the status colour, inside its edge. Selected, linked
    // and focus states are drawn by the chart's separate outline, so they stay visible.
    const className = bar.selected && skyeIds.has(bar.occupancy.id) ? "demo-bar--skye" : undefined;
    const fill = `url(#${gradientId(statusOf(bar))})`;
    return { fill, stroke: p.edge, color: "var(--st-text)", className };
  };

  /** Glass or gradient bar, plus a stripes-only hatch overlay for tow/hold stays. */
  const renderBar = (bar: BarDatum, style: BarStyle) => {
    const hatched = bar.occupancy.kind === "hold" && !isDimmed(bar);
    return (
      <>
        <DefaultBar bar={bar} style={style} />
        {hatched && (
          <DefaultBar bar={bar} style={{ fill: `url(#${hatchId(statusOf(bar))})`, stroke: "none" }} />
        )}
      </>
    );
  };

  /*
   * Allocator label arrangement: inbound flight over origin (left),
   * aircraft type (centre), outbound flight over destination (right).
   * Each side shows exactly the stay's recorded endpoint (see adapter
   * `endpoints`): a flight (flight over route endpoint), an explicit tow
   * ("Tow-in"/"Tow-out"), or nothing. A missing flight never produces a tow
   * marker. In aero, a circle arrow or truck sits beside the whole text
   * stack; icons are decorative, and `describe` (the accessible name) carries
   * the meaning.
   * The centre is the aircraft type (typeSlot), with its size class, rather
   * than the registration, since stand fit depends on
   * type; the registration is in the accessible name and the selection details.
   * Dimmed bars keep the same labels in the muted --flight-dim-text colour.
   */
  const labelSlots = (bar: BarDatum): BarLabelSlots | undefined => {
    const t = turnOf(bar);
    const ep = endpoints.get(bar.occupancy.id);
    if (!t || !ep) return undefined;
    const { start: s, end: e } = ep;
    return {
      start:
        s.kind === "flight"
          ? {
              primary: s.flight,
              secondary: s.origin,
              leading: icons ? <ArrowCircleLeftRegular aria-hidden /> : undefined,
            }
          : s.kind === "tow"
            ? { primary: TOW_IN, leading: icons ? <VehicleTruckProfileRegular aria-hidden /> : undefined }
            : undefined,
      center: t.aircraftType ? typeSlot(bar, t.aircraftType) : undefined,
      end:
        e.kind === "flight"
          ? {
              primary: e.flight,
              secondary: e.destination,
              trailing: icons ? <ArrowCircleRightRegular aria-hidden /> : undefined,
            }
          : e.kind === "tow"
            ? { primary: TOW_OUT, trailing: icons ? <VehicleTruckProfileRegular aria-hidden /> : undefined }
            : undefined,
    };
  };

  /**
   * The aircraft type in the middle (Figma GTAA-Dash 151:3938, less its
   * emblem, which the flight card shows instead): the type, then its size
   * class as a small Fluent Badge ("NB"/"WB"), 4px apart. Short of room it
   * sheds the size tag first and keeps the type (the slot's `narrower` form).
   * On a dimmed bar both take the dimmed bar's muted colours.
   */
  const typeSlot = (bar: BarDatum, type: string): BarLabelSlot => {
    const size = AIRCRAFT_SIZE[type];
    const chip = (showSize: boolean) => (
      <span className={isDimmed(bar) ? "demo-type demo-type--dimmed" : "demo-type"}>
        <span className="demo-type-name">{type}</span>
        {showSize && size && (
          <Badge size="small" shape="rounded" className="demo-type-size">
            {SIZE_TAG[size]}
          </Badge>
        )}
      </span>
    );
    const { height, gap, sizeTag } = TYPE_CHIP;
    const typeOnly = { primary: type, html: { node: chip(false), height, padding: 0 } };
    if (!size) return typeOnly;
    return { primary: type, html: { node: chip(true), height, padding: gap + sizeTag }, narrower: [typeOnly] };
  };

  const labelColor = (bar: BarDatum) => (isDimmed(bar) ? "var(--flight-dim-text)" : "var(--st-text)");
  /** Dimmed bars' labels keep their own muted colour, not the rest state's 80% (demo.css). */
  const labelClassName = (bar: BarDatum) => (isDimmed(bar) ? "demo-labels--dimmed" : undefined);

  /** The stays a ghost runs into, e.g. "XB210/211"; "" when none. */
  const clashText = (o: Occupancy, side: "start" | "end") =>
    (clashes.get(ghostKey(o.id, side)) ?? []).map(stayName).join(", ");

  /**
   * A late stay's ghosts: back from the bar to its scheduled on-block when it
   * reaches the stand late, on from the bar to its expected off-block when it
   * leaves late. In the bar's mark colour (neutral for a healthy stay), red when it runs into another stay.
   * Hovering shows how late, and scheduled → expected.
   */
  const ghosts = (bar: BarDatum, formatTime: (t: number) => string): BarGhost[] | undefined => {
    const o = bar.occupancy;
    const delay = delays.get(o.id);
    if (!delay) return undefined;
    const dimmed = isDimmed(bar);
    return GHOST_SIDES.flatMap((side): BarGhost[] => {
      const ms = ghostMs(delay, side);
      if (!ms) return [];
      const into = clashText(o, side);
      const [scheduled, expected] = side === "start" ? [o.start - ms, o.start] : [o.end, o.end + ms];
      const label =
        `Delayed ${side === "start" ? "in" : "out"} ${formatDelay(ms)} · ` +
        `${formatTime(scheduled)} → ${formatTime(expected)}` +
        (into ? ` · overlaps ${into}` : "");
      return [
        {
          side,
          ms,
          label,
          clash: !!into,
          color: dimmed ? "var(--flight-dim-text)" : paletteOf(bar).mark,
          className: dimmed ? "demo-ghost--dimmed" : undefined,
        },
      ];
    });
  };

  /** ", 55m late off the stand (expected 09:15, overlaps XB210/211)" for each late end; "" when on time. */
  const describeDelay = (o: Occupancy, formatTime: (t: number) => string) => {
    const delay = delays.get(o.id);
    return GHOST_SIDES.map((side) => {
      const ms = ghostMs(delay, side);
      if (!ms) return "";
      const into = clashText(o, side);
      const when =
        side === "start" ? `scheduled ${formatTime(o.start - ms)} UTC` : `expected ${formatTime(o.end + ms)} UTC`;
      return `, ${formatDelay(ms)} late ${side === "start" ? "onto" : "off"} the stand (${when}${into ? `, overlaps ${into}` : ""})`;
    }).join("");
  };

  /** Full detail for the bar's accessible name. */
  const describe = (bar: BarDatum, formatTime: (t: number) => string) => {
    const t = turnOf(bar);
    const o = bar.occupancy;
    const clip = describeClipping(bar);
    const when = `${formatTime(o.start)}–${formatTime(o.end)} UTC`;
    const where =
      (waitingRows.has(bar.row.id) ? `${bar.row.label}, waiting for one ${when}` : `Stand ${bar.row.label} ${when}`) +
      (clip ? ` (${clip})` : "") +
      describeDelay(o, formatTime);
    if (!t) return `${o.id}, ${where}`;
    const ep = endpoints.get(o.id);
    const pos = stayPosition.get(o.id);
    const stayText = pos && pos.count > 1 ? `, stay ${pos.index + 1} of ${pos.count}` : "";
    const s = ep?.start ?? { kind: "none" };
    const e = ep?.end ?? { kind: "none" };
    // A one-flight visit (a flight that had no stand) has no flight on its other side.
    const arrivedAs = t.arrFlight ? ` (visit arrived as ${t.arrFlight} from ${airportLabel(t.origin)})` : "";
    const departsAs = t.depFlight ? ` (visit departs as ${t.depFlight} to ${airportLabel(t.destination)})` : "";
    const arrival =
      s.kind === "flight"
        ? `Arrival ${s.flight} from ${airportLabel(s.origin)}`
        : s.kind === "tow"
          ? `${TOW_IN}${arrivedAs}`
          : `No arrival flight or tow at this stand${arrivedAs}`;
    const departure =
      e.kind === "flight"
        ? `departure ${e.flight} to ${airportLabel(e.destination)}`
        : e.kind === "tow"
          ? `${TOW_OUT}${departsAs}`
          : `no departure flight or tow from this stand${departsAs}`;
    const dimmed = isDimmed(bar) ? ". Outside the current selection, view or filters; stand still occupied" : "";
    const aircraft = [t.registration, t.aircraftType || "aircraft type not recorded"].filter(Boolean).join(", ");
    return `${arrival}, ${departure}, ${aircraft}, ${where}${stayText} (synthetic)${dimmed}`;
  };

  return { barStyle, renderBar, labelSlots, labelColor, labelClassName, ghosts, describe };
}

/**
 * Label metrics for the SVG layout, matching the Fluent tokens applied above
 * (fontSizeBase200 = 12px). Use a conservative width for the synthetic uppercase
 * identifiers; Fluent semibold glyphs are wider than the old 7px average.
 */
// iconMargin 2 = Fluent spacingHorizontalXXS (2px); SVG geometry needs the number.
export const LABEL_METRICS = {
  charWidth: 9,
  linePitch: 14,
  slotGap: 8,
  iconSize: 16,
  iconGap: 3,
  iconMargin: 2,
};
export const ROW_HEIGHT = 40;
export const BAR_INSET = 3;
// Explicit 8px, chosen to avoid ambiguity from Coral's overrides of Fluent radius tokens.
export const BAR_RADIUS = 8;

/**
 * Single-row ruler used both top and bottom: a tick every quarter hour, the
 * whole hour as an unlabelled full-height boundary, and labels anchored to
 * their tick — ":15" ends just before it, "HH:30" is centred on it, ":45"
 * starts just after it. Minutes come from the chart's formatter, so labels
 * follow the chart's time zone. With a finer step (rulerFor), only the
 * quarters are labelled.
 */
export const QUARTER_RULER = {
  stepMs: 15 * MINUTE,
  majorMs: HOUR,
  format: (t: number, formatTime: (t: number) => string): TickLabel | null => {
    const hhmm = formatTime(t);
    const mm = hhmm.slice(-2);
    if (mm === "00" || Number(mm) % 15 !== 0) return null;
    if (mm === "30") return { text: hhmm, anchor: "middle" };
    return { text: `:${mm}`, anchor: mm === "15" ? "end" : "start" };
  },
  labelOffset: 1,
  // If space runs short, keep the full HH:30 labels over the quarter labels.
  labelPriority: (t: number) => (t % HOUR === 30 * MINUTE ? 1 : 0),
  minLabelGap: 6,
  charWidth: 8,
} satisfies TimeAxisProps;

/**
 * With these anchors, ":15" (~24px, ending at its tick) and "HH:30" (~40px,
 * centred a quarter-hour later) need a quarter ≥ ~27px (≥108px/h) to keep the
 * 6px gap. 168px/h (42px per quarter) keeps the verified readable density;
 * narrower containers scroll horizontally.
 */
export const MIN_HOUR_WIDTH = 168;

/**
 * As far as the board zooms in: 16px a minute, so a 5-minute drag step
 * (App.tsx, DRAG_SNAP_MS) is 80px and an hour about a screen's width.
 */
export const MAX_HOUR_WIDTH = 960;

/** From this many px per hour, the ruler ticks every 5 minutes (40px apart), not every quarter. */
const FIVE_MINUTE_TICKS_FROM = 480;

/** The ruler for a zoom: QUARTER_RULER, with unlabelled 5-minute ticks between quarters once there is room. */
export const rulerFor = (hourWidth: number) =>
  hourWidth >= FIVE_MINUTE_TICKS_FROM ? { ...QUARTER_RULER, stepMs: 5 * MINUTE } : QUARTER_RULER;

/** Compact stand gutter: right-aligned stand IDs only. */
export const GUTTER_WIDTH = 72;
