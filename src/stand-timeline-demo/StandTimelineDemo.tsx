import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import { ContentToolbar } from "../components/content-toolbar";
import { DateStepper } from "../components/date-stepper";
import {
  BarBackdrop,
  BarGhosts,
  BarLabels,
  BarLink,
  OccupancyBars,
  StandRows,
  StandTimeline,
  TimeAxis,
  TimeGrid,
  type BarEnds,
  type ChartIntent,
  type DropPreview,
  type Occupancy,
  type TimelineRow,
  type TimelineZoom,
} from "../stand-timeline";
import { DEMO_DATA as DATA, DEMO_DOMAIN as DOMAIN, formatUtcWithDay as fmt } from "./demoData";
import { airportLabel } from "./airports";
import { ghostClashes } from "./delays";
import { applySelection } from "./selection";
import { SYNTHETIC_DATE } from "./syntheticFixture";
import {
  BAR_BACKDROP_BLUR,
  BAR_BACKDROP_SATURATE,
  BAR_INSET,
  BAR_RADIUS,
  DemoPatternDefs,
  GUTTER_WIDTH,
  LABEL_METRICS,
  LABEL_PADDING,
  QUARTER_RULER,
  ROW_HEIGHT,
  fluentChartTheme,
  makeDemoAccessors,
  rulerFor,
  stayEnds,
  type FlightStyle,
} from "./theme";
import { useDemoZoom } from "./ZoomMenuRow";
import type { Pixels } from "../studio/drawings";
import "./demo.css";

const KIND_LABEL: Record<string, string> = {
  turn: "Turn",
  arr: "Arrival stay",
  hold: "Tow / hold",
  dep: "Departure stay",
};

/**
 * Each bar's ends in each style, by what starts and ends its stay: zigzagged
 * for a tow, round (aero) or tapered (classic) for a flight. One function per
 * style, so the chart lays its bars out again only when the style changes.
 */
const BAR_ENDS: Record<FlightStyle, (o: Occupancy) => BarEnds> = {
  aero: (o) => stayEnds(DATA.endpoints.get(o.id), "aero"),
  classic: (o) => stayEnds(DATA.endpoints.get(o.id), "classic"),
};

export interface StandTimelineDemoProps {
  /** Controlled selection. Omit both props to use the demo standalone. */
  selectedIds?: readonly string[];
  onIntent?: (intent: ChartIntent) => void;
  /**
   * Show the built-in selection detail strip under the chart (default true).
   * Hosts with their own selection details (e.g. GTAA's popover) can hide it.
   */
  showSelectionDetail?: boolean;
  /**
   * Optional host match predicate (e.g. views/filters). Non-matching bars are
   * dimmed but stay on the chart, occupied and selectable. Omit for no dimming.
   */
  isMatch?: (occupancyId: string) => boolean;
  /** Includes host selections with no chart occupancy, such as unassigned flights. */
  selectionActive?: boolean;
  /**
   * With exactly two stays selected, a dashed link flows from the first to the
   * second. Optional swap verdict for that pair; omit while it is unknown.
   */
  swapStatus?: "compatible" | "incompatible";
  /**
   * Of `selectedIds`, the stays Skye selected rather than the user: outlined
   * in Skye's colours. The user and Skye select side by side.
   */
  skyeIds?: readonly string[];
  /**
   * The dashed links to draw between selected stays, in place of the one
   * between exactly two: one per pair, so the user's and Skye's are never
   * joined to each other.
   */
  links?: readonly { fromId: string; toId: string; className?: string }[];
  /**
   * The stays to draw, when the host changes stands (a new array per change),
   * including any on `pinnedRows`. Defaults to the fixture's.
   */
  occupancies?: readonly Occupancy[];
  /**
   * Rows pinned above the stands, under the time ruler: stays waiting for a
   * stand, say. Their bars read as waiting (see demo.css), and their
   * accessible names say so instead of naming a stand.
   */
  pinnedRows?: readonly TimelineRow[];
  /** A pinned row's label in the stand column, in place of its name. */
  pinnedLabel?: (row: TimelineRow) => ReactNode;
  /** Makes bars draggable to other stands; see StandTimeline's previewDrop. */
  previewDrop?: (occupancyId: string, rowId: string, shiftMs: number) => DropPreview;
  /** With previewDrop, bars can be dragged in time too, in steps of this many ms; see StandTimeline. */
  dragSnapMs?: number;
  /**
   * Host chart layers drawn under the bars, e.g. a closed area's band. They
   * show blurred through the bars' glass, so they render twice (see
   * BarBackdrop): any ids in them must be their own (useId).
   */
  underlay?: ReactNode;
  /** Host chart layers drawn over the bars, e.g. that band's label. */
  overlay?: ReactNode;
  /** Optional controls rendered at the left of the header, before the title. */
  toolbarStart?: ReactNode;
  /** Optional controls rendered at the right of the header. */
  toolbar?: ReactNode;
  /** Optional content under the chart, e.g. the host's KPIs. The chart gives it the height it needs. */
  summary?: ReactNode;
  /**
   * The board's zoom, from useDemoZoom(), when the host shows its controls
   * (e.g. ZoomMenuRow in a menu). Without it the board keeps its own, which
   * pinching it still changes.
   */
  zoom?: TimelineZoom;
  /** How flights are drawn: aero (a flight's ends round; the default) or classic (tapered). Both zigzag a tow's. */
  flightStyle?: FlightStyle;
  /** Each aircraft type's drawing from the Studio, by type, shown in the middle of its aircraft's bars. */
  drawings?: ReadonlyMap<string, Pixels>;
}

export function StandTimelineDemo({
  selectedIds: controlledIds,
  onIntent: controlledOnIntent,
  showSelectionDetail = true,
  isMatch,
  selectionActive,
  swapStatus,
  skyeIds,
  links,
  occupancies = DATA.occupancies,
  pinnedRows,
  pinnedLabel,
  previewDrop,
  dragSnapMs,
  underlay,
  overlay,
  toolbarStart,
  toolbar,
  summary,
  zoom: hostZoom,
  flightStyle = "aero",
  drawings,
}: StandTimelineDemoProps = {}) {
  const ownZoom = useDemoZoom();
  const zoom = hostZoom ?? ownZoom;
  const [localIds, setLocalIds] = useState<string[]>([]);
  const controlled = controlledIds !== undefined;
  const selectedIds = controlled ? controlledIds : localIds;
  const hasSelection = selectionActive ?? selectedIds.length > 0;
  // A new `occupancies` array per stand change, so clashes follow moves and swaps.
  const clashes = useMemo(() => ghostClashes(occupancies, DATA.delays), [occupancies]);
  const skyeKey = skyeIds?.join("|") ?? "";
  const pinnedKey = pinnedRows?.map((row) => row.id).join("|") ?? "";
  const accessors = useMemo(
    () =>
      makeDemoAccessors(
        DATA.turnsById,
        DATA.stayPosition,
        DATA.endpoints,
        DATA.delays,
        clashes,
        isMatch,
        hasSelection,
        new Set(skyeKey ? skyeKey.split("|") : []),
        new Set(pinnedKey ? pinnedKey.split("|") : []),
        drawings,
      ),
    [clashes, isMatch, hasSelection, skyeKey, pinnedKey, drawings],
  );
  const renderLabel = useMemo(() => {
    if (!pinnedLabel) return undefined;
    const pinned = new Set(pinnedKey ? pinnedKey.split("|") : []);
    return (row: TimelineRow) =>
      pinned.has(row.id) ? pinnedLabel(row) : <span className="st-row-name">{row.label}</span>;
  }, [pinnedLabel, pinnedKey]);

  const onIntent = useCallback(
    (intent: ChartIntent) => {
      if (controlledOnIntent) controlledOnIntent(intent);
      else if (intent.type === "select") setLocalIds((cur) => applySelection(cur, intent));
    },
    [controlledOnIntent],
  );
  const clearSelection = () => onIntent({ type: "select", occupancyIds: [], mode: "replace" });

  const selected = useMemo(
    () => DATA.occupancies.filter((o) => selectedIds.includes(o.id)),
    [selectedIds],
  );

  return (
    <div className="demo-timeline">
      <ContentToolbar
        // The fixture is one day, so there is no day before or after to step to.
        label={<DateStepper date={SYNTHETIC_DATE} />}
        actionsStart={toolbarStart}
        actionsEnd={toolbar}
      />

      <StandTimeline
        style={fluentChartTheme}
        className="demo-chart"
        fillHeight
        rows={DATA.rows}
        pinnedRows={pinnedRows}
        visits={DATA.visits}
        occupancies={occupancies}
        previewDrop={previewDrop}
        dragSnapMs={dragSnapMs}
        domain={DOMAIN}
        timeZone="UTC"
        rowHeight={ROW_HEIGHT}
        barInset={BAR_INSET}
        barRadius={BAR_RADIUS}
        barEnds={BAR_ENDS[flightStyle]}
        zoom={zoom}
        labelWidth={GUTTER_WIDTH}
        selectedIds={selectedIds}
        onIntent={onIntent}
        ariaLabel="Synthetic stand occupancy timeline, times in UTC"
        fade
      >
        <DemoPatternDefs />
        {/* Synthetic piers only drive optional group dividers; no group-name column. */}
        <StandRows zebra={false} title={null} showGroup={false} labelAlign="end" renderLabel={renderLabel} />
        {/* The grid and the host's underlay show blurred and saturated through the glass bars. */}
        <BarBackdrop blur={BAR_BACKDROP_BLUR} saturate={BAR_BACKDROP_SATURATE}>
          <TimeGrid minorMs={QUARTER_RULER.stepMs} />
          {underlay}
        </BarBackdrop>
        <OccupancyBars
          barStyle={accessors.barStyle}
          renderBar={accessors.renderBar}
          describe={accessors.describe}
        />
        <BarLabels
          slots={accessors.labelSlots}
          color={accessors.labelColor}
          className={accessors.labelClassName}
          priority={["start", "end", "center"]}
          padding={LABEL_PADDING[flightStyle]}
          {...LABEL_METRICS}
        />
        {/* Late stays' ghosts, over the bars so a clash shows over the stay it runs into. */}
        <BarGhosts ghosts={accessors.ghosts} />
        {/* Selection order is kept, so the link points at the most recent pick. */}
        {(links ??
          (selectedIds.length === 2
            ? [{ fromId: selectedIds[0], toId: selectedIds[1], className: swapStatus ? `demo-link--${swapStatus}` : undefined }]
            : [])
        ).map((link) => (
          <BarLink key={`${link.fromId}>${link.toId}`} fromId={link.fromId} toId={link.toId} className={link.className} />
        ))}
        {overlay}
        <TimeAxis position="top" zoneLabel="UTC" {...rulerFor(zoom.hourWidth)} />
      </StandTimeline>
      {summary}

      {showSelectionDetail && (
      <section className="demo-detail" aria-live="polite" aria-label="Selection detail">
        {selected.length === 0 ? (
          <p className="demo-hint">
            Click a bar, or Tab to it and press Enter/Space, to select it. Shift-click toggles
            a bar in or out of the selection. Esc or clicking empty space clears it.
            Stays from the same visit are outlined with a dashed line.
          </p>
        ) : (
          <>
            <div className="demo-detail-head">
              <strong>
                {selected.length} selected
              </strong>
              <Button size="small" appearance="secondary" onClick={clearSelection}>
                Clear
              </Button>
            </div>
            {selected.map((o) => (
              <SelectedOccupancy key={o.id} occupancy={o} />
            ))}
          </>
        )}
      </section>
      )}
    </div>
  );
}

function SelectedOccupancy({ occupancy }: { occupancy: Occupancy }) {
  const turn = occupancy.visitId ? DATA.turnsById.get(occupancy.visitId) : undefined;
  const siblings = DATA.occupancies.filter((o) => o.visitId === occupancy.visitId);
  return (
    <div className="demo-detail-card">
      <div className="demo-detail-line">
        <span className="demo-chip">{occupancy.rowId}</span>
        <strong>
          {fmt(occupancy.start)}–{fmt(occupancy.end)} UTC
        </strong>
        <span>{KIND_LABEL[occupancy.kind ?? ""] ?? occupancy.kind}</span>
        {turn && (
          <span className="demo-muted">
            {turn.arrFlight} from {airportLabel(turn.origin)} / {turn.depFlight} to{" "}
            {airportLabel(turn.destination)} ·{" "}
            {turn.aircraftType} · {turn.registration}
          </span>
        )}
      </div>
      {siblings.length > 1 && (
        <div className="demo-detail-line demo-muted">
          Visit {occupancy.visitId}: {siblings.length} stays —{" "}
          {siblings.map((s) => `${s.rowId} ${fmt(s.start)}–${fmt(s.end)}`).join(" → ")}
        </div>
      )}
    </div>
  );
}
