// App-owned theme adapter: maps Fluent v9 tokens (provided by CoralProvider's
// FluentProvider, so light/dark and brand follow the app) onto the neutral
// chart's --st-* variables and per-bar accessors. The chart never imports Fluent.
import type { CSSProperties } from "react";
import { tokens } from "@fluentui/react-components";
import {
  ArrowCircleLeftRegular,
  ArrowCircleRightRegular,
  VehicleTruckProfileRegular,
} from "@fluentui/react-icons";
import {
  HOUR,
  MINUTE,
  describeClipping,
  useTimelineRegion,
  type BarDatum,
  type BarLabelSlots,
  type BarStyle,
  type TickLabel,
  type TimeAxisProps,
} from "../stand-timeline";
import type { StayEndpoints, StayPosition, TimelineTurn } from "./adapter";
import { airportLabel } from "./airports";

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
  "--st-radius": tokens.borderRadiusMedium,
  "--st-radius-small": tokens.borderRadiusSmall,
  // Explicit 8px, chosen to avoid ambiguity from Coral's overrides of Fluent radius tokens.
  "--st-bar-radius": "8px",
  "--st-stroke": tokens.strokeWidthThin,
  "--st-stroke-thick": tokens.strokeWidthThick,
  "--st-stroke-focus": tokens.strokeWidthThick,

  "--st-text": tokens.colorNeutralForeground1,
  "--st-text-muted": tokens.colorNeutralForeground3,
  "--st-border": tokens.colorNeutralStroke2,
  "--st-line": tokens.colorNeutralStroke3,
  "--st-line-strong": tokens.colorNeutralStroke2,
  "--st-grid-major": tokens.colorNeutralStroke2,
  "--st-grid-minor": tokens.colorNeutralStroke3,
  // Only the pinned stand column/corner get a surface, and it is Fluent's
  // translucent alpha background with blur (the same glass idiom Coral uses).
  "--st-pinned-bg": tokens.colorNeutralBackgroundAlpha2,
  "--st-pinned-backdrop": "blur(12px)",
  "--st-zone-bg": tokens.colorNeutralBackground3,
  "--st-selected": "var(--flight-outline)",
  "--st-linked": "var(--flight-outline)",
  "--st-focus": "var(--flight-outline)",
  // Scrollbars: the app-wide Coral-style treatment in src/index.css applies.
} as CSSProperties;

/**
 * Navy-to-teal carrier palette, scoped to the demo chart by demo.css (values
 * per light/dark mode live there). Four carriers keep a stable hue identity
 * across modes, deep navy-blue XA → blue XB → turquoise XC → aqua-mint XD,
 * each with its own text/icon colour and hatch stripe chosen for ≥ 4.5:1.
 */
interface CarrierPalette {
  fill: string;
  text: string;
  hatch: string;
}

const carrier = (key: string): CarrierPalette => ({
  fill: `var(--flight-${key})`,
  text: `var(--flight-${key}-text)`,
  hatch: `var(--flight-${key}-hatch)`,
});

export const CARRIER_PALETTE: Record<string, CarrierPalette> = {
  XA: carrier("xa"),
  XB: carrier("xb"),
  XC: carrier("xc"),
  XD: carrier("xd"),
  UAL: carrier("xa"),
  AAL: carrier("xb"),
  ASA: carrier("xb"),
  BAW: carrier("xb"),
  JAL: carrier("xb"),
  DLH: carrier("xa"),
  EVA: carrier("xa"),
  DAL: carrier("xc"),
  AFR: carrier("xc"),
  CES: carrier("xc"),
};

const FALLBACK: CarrierPalette = {
  fill: tokens.colorNeutralBackground3,
  text: tokens.colorNeutralForeground1,
  hatch: "transparent",
};

const hatchId = (carrier: string) => `demo-hatch-${carrier}`;

/**
 * Custom layer: hatch patterns for tow/hold stays, one per carrier. The pattern
 * has a solid carrier base; stripes move away from the label colour (darker
 * under white text, lighter under navy text) so contrast only increases. Colours
 * go through `style` because CSS variables don't resolve in SVG presentation
 * attributes.
 */
export function DemoPatternDefs() {
  if (useTimelineRegion() !== "plot") return null;
  return (
    <defs>
      {Object.entries(CARRIER_PALETTE).map(([carrier, p]) => (
        <pattern
          key={carrier}
          id={hatchId(carrier)}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={6} height={6} style={{ fill: p.fill }} />
          <line x1={0} y1={0} x2={0} y2={6} style={{ stroke: p.hatch, strokeWidth: 2 }} />
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
 * @param isMatch Optional host predicate (views/filters). When given, bars it
 *   rejects are DIMMED, never removed: they stay occupied, focusable and
 *   selectable. Selected bars and their linked visit stays always stay at
 *   full prominence. With an active selection, unrelated stays are grey too.
 */
export function makeDemoAccessors(
  turnsById: Map<string, TimelineTurn>,
  stayPosition: Map<string, StayPosition>,
  endpoints: Map<string, StayEndpoints>,
  isMatch?: (occupancyId: string) => boolean,
  hasSelection = false,
) {
  const turnOf = (bar: BarDatum) =>
    bar.occupancy.visitId ? turnsById.get(bar.occupancy.visitId) : undefined;
  const paletteOf = (bar: BarDatum) =>
    CARRIER_PALETTE[turnOf(bar)?.carrier ?? ""] ?? FALLBACK;
  const isDimmed = (bar: BarDatum) =>
    !bar.selected && !bar.linked && (hasSelection || (!!isMatch && !isMatch(bar.occupancy.id)));

  const barStyle = (bar: BarDatum): BarStyle => {
    const p = paletteOf(bar);
    const carrier = turnOf(bar)?.carrier;
    if (isDimmed(bar)) {
      // Context stays occupied/selectable, but is neutral grey with no labels.
      return {
        fill: "var(--flight-dim-surface)",
        stroke: "var(--flight-dim-stroke)",
        color: "var(--flight-dim-text)",
        className: "demo-bar--dimmed",
      };
    }
    // No default stroke: bars are fill only. Selected, linked and focus states
    // are drawn by the chart's separate outline, so they stay visible.
    return bar.occupancy.kind === "hold" && carrier && CARRIER_PALETTE[carrier]
      ? { fill: `url(#${hatchId(carrier)})`, stroke: "none", color: p.text }
      : { fill: p.fill, stroke: "none", color: p.text };
  };

  /*
   * Allocator label arrangement: inbound flight over origin (left),
   * registration (centre), outbound flight over destination (right).
   * Each side shows exactly the stay's recorded endpoint (see adapter
   * `endpoints`): a flight (circle arrow + flight over route endpoint), an
   * explicit tow (truck + "Tow-in"/"Tow-out"), or nothing. A missing flight
   * never produces a tow marker. Icons sit beside the whole text stack and
   * are decorative; `describe` (tooltip + accessible name) carries the meaning.
   * Aircraft type is deliberately not a label; it is in the tooltip/detail.
   */
  const labelSlots = (bar: BarDatum): BarLabelSlots | undefined => {
    if (isDimmed(bar)) return {}; // Suppress text and decorative endpoint icons.
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
              leading: <ArrowCircleLeftRegular aria-hidden />,
            }
          : s.kind === "tow"
            ? { primary: TOW_IN, leading: <VehicleTruckProfileRegular aria-hidden /> }
            : undefined,
      center: { primary: t.registration },
      end:
        e.kind === "flight"
          ? {
              primary: e.flight,
              secondary: e.destination,
              trailing: <ArrowCircleRightRegular aria-hidden />,
            }
          : e.kind === "tow"
            ? { primary: TOW_OUT, trailing: <VehicleTruckProfileRegular aria-hidden /> }
            : undefined,
    };
  };

  const labelColor = (bar: BarDatum) =>
    isDimmed(bar) ? "var(--flight-dim-text)" : paletteOf(bar).text;

  /** Full detail for the bar's accessible name and hover tooltip. */
  const describe = (bar: BarDatum, formatTime: (t: number) => string) => {
    const t = turnOf(bar);
    const o = bar.occupancy;
    const clip = describeClipping(bar);
    const where =
      `Stand ${bar.row.label} ${formatTime(o.start)}–${formatTime(o.end)} UTC` +
      (clip ? ` (${clip})` : "");
    if (!t) return `${o.id}, ${where}`;
    const ep = endpoints.get(o.id);
    const pos = stayPosition.get(o.id);
    const stayText = pos && pos.count > 1 ? `, stay ${pos.index + 1} of ${pos.count}` : "";
    const s = ep?.start ?? { kind: "none" };
    const e = ep?.end ?? { kind: "none" };
    const from = airportLabel(t.origin);
    const to = airportLabel(t.destination);
    const arrival =
      s.kind === "flight"
        ? `Arrival ${s.flight} from ${airportLabel(s.origin)}`
        : s.kind === "tow"
          ? `${TOW_IN} (visit arrived as ${t.arrFlight} from ${from})`
          : `No arrival flight or tow at this stand (visit arrived as ${t.arrFlight} from ${from})`;
    const departure =
      e.kind === "flight"
        ? `departure ${e.flight} to ${airportLabel(e.destination)}`
        : e.kind === "tow"
          ? `${TOW_OUT} (visit departs as ${t.depFlight} to ${to})`
          : `no departure flight or tow from this stand (visit departs as ${t.depFlight} to ${to})`;
    const dimmed = isDimmed(bar) ? ". Outside the current selection, view or filters; stand still occupied" : "";
    return (
      `${arrival}, ${departure}, ${t.registration}, ${t.aircraftType}, ` +
      `${where}${stayText} (synthetic)${dimmed}`
    );
  };

  return { barStyle, labelSlots, labelColor, describe };
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

/**
 * Single-row ruler used both top and bottom: a tick every quarter hour, the
 * whole hour as an unlabelled full-height boundary, and labels anchored to
 * their tick — ":15" ends just before it, "HH:30" is centred on it, ":45"
 * starts just after it. Minutes come from the chart's formatter, so labels
 * follow the chart's time zone.
 */
export const QUARTER_RULER = {
  stepMs: 15 * MINUTE,
  majorMs: HOUR,
  format: (t: number, formatTime: (t: number) => string): TickLabel | null => {
    const hhmm = formatTime(t);
    const mm = hhmm.slice(-2);
    if (mm === "00") return null;
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

/** Compact stand gutter: right-aligned stand IDs only. */
export const GUTTER_WIDTH = 72;
