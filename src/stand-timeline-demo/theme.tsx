// App-owned theme adapter: maps Fluent v9 tokens (provided by CoralProvider's
// FluentProvider, so light/dark and brand follow the app) onto the neutral
// chart's --st-* variables and per-bar accessors. The chart never imports Fluent.
import type { CSSProperties } from "react";
import { tokens } from "@fluentui/react-components";
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
import type { SyntheticTurn } from "./syntheticFixture";
import type { Pixels } from "../studio/drawings";
import { PixelArt } from "../studio/PixelArt";

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
 * Bar palettes, scoped to the demo chart by demo.css (values per light/dark
 * mode live there). A stay that needs attention takes its status's colour:
 *   conflict: red, a late stay whose delay runs into another stay on its
 *     stand (the clashes the Alerts list as conflicts; see ./delays),
 *   waiting: orange, a stay with no stand, in the No stand lane.
 * A coloured bar's fill is its colour, fading left to right from
 * BAR_FADE.from to BAR_FADE.to opacity, inside a full-opacity border of it,
 * its labels in the neutral text colour.
 * Any other stay is healthy, and takes its aircraft type's tone
 * (AIRCRAFT_TONE), as the EBC stand plan reference colours its bars, here in
 * the hue of the Glow chosen in Settings: pale, mid or deep, solid, its labels
 * in the tone's own text colour.
 * A type with no tone stays neutral glass: faint white, fading left to right
 * as the coloured bars do, over the grid, inside Fluent's Stroke 1 at rest.
 */
export type FlightStatus = "healthy" | "conflict" | "waiting";

/** A healthy stay's colour, by its aircraft type (AIRCRAFT_TONE). */
export type AircraftTone = "pale" | "mid" | "deep";

/** A bar's palette: its status's, or a healthy stay's aircraft tone. */
type PaletteKey = FlightStatus | AircraftTone;

/** A bar's fill: a gradient from its left end to its right, its stops as [colour, opacity]. */
type FillStops = readonly (readonly [string, number])[];

interface BarPalette {
  /** The border at rest; hover and selection draw the chart's outline over it. */
  edge: string;
  /** The colour of the bar's delay ghosts. */
  mark: string;
  /** The colour of its tow/hold stripes, drawn at HATCH_OPACITY. */
  hatch: string;
  fill: FillStops;
  /** Its labels' colour, and its aircraft drawing's. */
  text: string;
}

/** How much of the status colour a coloured bar's fill shows, at its left end and its right. Its border stays solid. */
const BAR_FADE = { from: 0.3, to: 0.22 };

/** A coloured bar: a fade of its colour, inside a border of it. */
const faded = (status: FlightStatus): BarPalette => {
  const color = `var(--flight-${status})`;
  return {
    edge: color,
    mark: color,
    hatch: color,
    fill: [[color, BAR_FADE.from], [color, BAR_FADE.to]],
    text: "var(--st-text)",
  };
};

/**
 * A healthy bar with no tone: neutral glass, white fading left to right (its
 * opacities per mode in demo.css: a dark board needs far less white than a
 * light one), inside Fluent's Stroke 1 at rest; its ghosts and stripes in a
 * stronger neutral, so they still read.
 */
const GLASS: BarPalette = {
  edge: "var(--flight-glass-edge)",
  mark: "var(--flight-glass-mark)",
  hatch: "var(--flight-glass-mark)",
  fill: [["var(--flight-glass-from)", 1], ["var(--flight-glass-to)", 1]],
  text: "var(--st-text)",
};

/**
 * A healthy bar in its aircraft's tone: solid, inside an edge of it, its
 * labels and stripes in the tone's own colours (demo.css); its delay ghosts
 * in the glass's neutral, which reads on and off any tone.
 */
const toned = (tone: AircraftTone): BarPalette => {
  const color = `var(--flight-${tone})`;
  return {
    edge: `var(--flight-${tone}-edge)`,
    mark: "var(--flight-glass-mark)",
    hatch: `var(--flight-${tone}-hatch)`,
    fill: [[color, 1], [color, 1]],
    text: `var(--flight-${tone}-text)`,
  };
};

/**
 * Each aircraft type's tone: the A320 family pale, the 737s and E-Jets mid,
 * widebodies deep. A type not listed stays neutral glass.
 */
export const AIRCRAFT_TONE: Readonly<Partial<Record<string, AircraftTone>>> = {
  A319: "pale",
  A320: "pale",
  A321: "pale",
  B738: "mid",
  B38M: "mid",
  E195: "mid",
  B788: "deep",
  B789: "deep",
  B77W: "deep",
  A339: "deep",
};

/** A dimmed bar's fill, whatever its tone or status: the glass at its faintest, still frosting what is behind it. */
const DIM_FILL: FillStops = [["var(--flight-dim-glass-from)", 1], ["var(--flight-dim-glass-to)", 1]];
/** The dimmed bars' fill's id, for `url(#…)`; DemoPatternDefs draws it. */
export const DIM_GRADIENT_ID = "demo-gradient-dimmed";

/**
 * Tow/hold stripes, in the bar's mark colour over the fill. Neutral labels
 * keep ≥ 4.5:1 over them in both modes.
 */
const HATCH_OPACITY = 0.3;
/**
 * An aircraft type's drawing in its bars' middle, px square. Between the
 * sizes where each of its pixels is a whole number of device pixels (9px,
 * 18px at 1x), so at some display scales a row or column of its pixels
 * comes out a device pixel wider than the rest.
 */
const DRAWING_SIZE = 14;
/** Room, px, on each side of the drawing for its glow (demo.css), which the bar's label box would clip. */
const DRAWING_GLOW = 3;

export const STATUS_PALETTE: Record<FlightStatus, BarPalette> = {
  healthy: GLASS,
  conflict: faded("conflict"),
  waiting: faded("waiting"),
};

export const TONE_PALETTE: Record<AircraftTone, BarPalette> = {
  pale: toned("pale"),
  mid: toned("mid"),
  deep: toned("deep"),
};

const PALETTES: Record<PaletteKey, BarPalette> = { ...STATUS_PALETTE, ...TONE_PALETTE };

const hatchId = (key: PaletteKey) => `demo-hatch-${key}`;
/** A status's or tone's fill's id, for `url(#…)`; DemoPatternDefs draws it. */
export const gradientId = (key: PaletteKey) => `demo-gradient-${key}`;

/**
 * Custom layer: per-status and per-tone defs, and the dimmed bars' fill. The fill gradients
 * use bounding-box units, so they span each bar whatever its size. Hatch patterns for tow/hold stays
 * are stripes only, in the bar's hatch colour at HATCH_OPACITY, drawn over its
 * fill. Colours go through `style` because CSS variables don't resolve in SVG
 * presentation attributes. Drawn once, in the body's plot: bars in the
 * pinned rows' plot use the same ids, as one document they can reach.
 */
export function DemoPatternDefs() {
  const region = useTimelineRegion();
  const { section } = useTimeline();
  if (region !== "plot" || section !== "body") return null;
  const palettes = Object.entries(PALETTES) as [PaletteKey, BarPalette][];
  const fills: [string, FillStops][] = [
    ...palettes.map(([key, p]): [string, FillStops] => [gradientId(key), p.fill]),
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
      {palettes.map(([key, p]) => (
        <pattern
          key={key}
          id={hatchId(key)}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={6} style={{ stroke: p.hatch, strokeOpacity: HATCH_OPACITY, strokeWidth: 2 }} />
        </pattern>
      ))}
    </defs>
  );
}

// Tow endpoint wording, used on the bar and in its description.
const TOW_IN = "Tow-in";
const TOW_OUT = "Tow-out";

/**
 * How flights are drawn, on the board and in the flight card, as chosen in
 * Settings' Timeline. Each shapes the ends of a bar by what happens
 * there (END_SHAPE): Aero, the default, rounds a flight's; Classic tapers
 * them. Both zigzag a tow's, and neither draws icons.
 */
export type FlightStyle = "classic" | "aero";

/** Each style's name, as Settings shows it. */
export const FLIGHT_STYLE_LABEL: Record<FlightStyle, string> = { classic: "Classic", aero: "Aero" };

/**
 * Each end of a stay's bar, by what happens there: a flight rounds it in aero
 * and tapers it in classic, its arrival to the left and its departure to the
 * right; a tow zigzags it in both; with neither it stays round. The flight
 * card's box takes the same shape.
 */
export const END_SHAPE: Record<FlightStyle, Record<StayEndpoints["start"]["kind"], BarEndShape>> = {
  aero: { flight: "round", tow: "zigzag", none: "round" },
  classic: { flight: "taper", tow: "zigzag", none: "round" },
};

/** A stay's end shapes in a style, from its recorded endpoints; round where there are none. */
export const stayEnds = (ep: StayEndpoints | undefined, style: FlightStyle): BarEnds => ({
  start: END_SHAPE[style][ep?.start.kind ?? "none"],
  end: END_SHAPE[style][ep?.end.kind ?? "none"],
});

/**
 * Space between a bar's end and its labels, px, in from where a shaped end
 * begins (BarLabels' padding): aero's round ends keep its text well clear of
 * the curve; classic's taper already does.
 */
export const LABEL_PADDING: Record<FlightStyle, number> = { aero: 8, classic: 5 };

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
  /** Each aircraft type's drawing from the Studio, by type; drawn in the middle of the bars of every aircraft of it. */
  drawings: ReadonlyMap<string, Pixels> = new Map(),
) {
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
  /** Its status's palette; a healthy stay's, its aircraft type's tone, or the glass when the type has none. */
  const keyOf = (bar: BarDatum): PaletteKey => {
    const status = statusOf(bar);
    return status === "healthy" ? (AIRCRAFT_TONE[turnOf(bar)?.aircraftType ?? ""] ?? status) : status;
  };
  const paletteOf = (bar: BarDatum) => PALETTES[keyOf(bar)];
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
    // Its aircraft's tone, the glass, or a fade of the status colour, inside
    // its edge. Selected, linked and focus states are drawn by the chart's
    // separate outline, so they stay visible.
    const className = bar.selected && skyeIds.has(bar.occupancy.id) ? "demo-bar--skye" : undefined;
    const fill = `url(#${gradientId(keyOf(bar))})`;
    return { fill, stroke: p.edge, color: p.text, className };
  };

  /** Toned, glass or gradient bar, plus a stripes-only hatch overlay for tow/hold stays. */
  const renderBar = (bar: BarDatum, style: BarStyle) => {
    const hatched = bar.occupancy.kind === "hold" && !isDimmed(bar);
    return (
      <>
        <DefaultBar bar={bar} style={style} />
        {hatched && (
          <DefaultBar bar={bar} style={{ fill: `url(#${hatchId(keyOf(bar))})`, stroke: "none" }} />
        )}
      </>
    );
  };

  /*
   * Allocator label arrangement: inbound flight over origin (left), the
   * aircraft type's drawing (centre), outbound flight over destination (right).
   * Each side shows exactly the stay's recorded endpoint (see adapter
   * `endpoints`): a flight (flight over route endpoint), an explicit tow
   * ("Tow-in"/"Tow-out"), or nothing. A missing flight never produces a tow
   * marker. The bar's end shapes (END_SHAPE) are decorative; `describe` (the
   * accessible name) carries the meaning.
   * The centre is the aircraft type's drawing from the Studio (drawingSlot),
   * empty when it has none; the type itself and the registration are in the
   * accessible name and the selection details.
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
          ? { primary: s.flight, secondary: s.origin }
          : s.kind === "tow"
            ? { primary: TOW_IN }
            : undefined,
      center: drawingSlot(bar, drawings.get(t.aircraftType)),
      end:
        e.kind === "flight"
          ? { primary: e.flight, secondary: e.destination }
          : e.kind === "tow"
            ? { primary: TOW_OUT }
            : undefined,
    };
  };

  /**
   * The aircraft type's drawing in the middle, at DRAWING_SIZE, glowing a
   * little; none when it has none. The first label a bar too short sheds.
   * One colour, its labels' (labelColor): its tone's, or muted on a dimmed
   * bar as they are.
   */
  const drawingSlot = (bar: BarDatum, pixels: Pixels | undefined): BarLabelSlot | undefined => {
    if (!pixels) return undefined;
    const node = (
      <PixelArt pixels={pixels} size={DRAWING_SIZE} className="demo-drawing" style={{ color: labelColor(bar) }} />
    );
    return {
      primary: "",
      html: {
        node,
        height: DRAWING_SIZE + 2 * DRAWING_GLOW,
        padding: DRAWING_SIZE + 2 * DRAWING_GLOW,
      },
    };
  };

  const labelColor = (bar: BarDatum) => (isDimmed(bar) ? "var(--flight-dim-text)" : paletteOf(bar).text);
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
          caption: side === "start" ? `Late in, was ${formatTime(scheduled)}` : `Late out, to ${formatTime(expected)}`,
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
export const LABEL_METRICS = {
  charWidth: 9,
  linePitch: 14,
  slotGap: 8,
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
