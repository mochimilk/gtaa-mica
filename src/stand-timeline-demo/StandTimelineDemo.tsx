import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import {
  BarLabels,
  OccupancyBars,
  StandRows,
  StandTimeline,
  TimeAxis,
  TimeGrid,
  type ChartIntent,
  type Occupancy,
} from "../stand-timeline";
import { DEMO_DATA as DATA, DEMO_DOMAIN as DOMAIN, formatUtcWithDay as fmt } from "./demoData";
import { airportLabel } from "./airports";
import { applySelection } from "./selection";
import { SYNTHETIC_DATE } from "./syntheticFixture";
import {
  BAR_INSET,
  DemoPatternDefs,
  GUTTER_WIDTH,
  LABEL_METRICS,
  MIN_HOUR_WIDTH,
  QUARTER_RULER,
  ROW_HEIGHT,
  fluentChartTheme,
  makeDemoAccessors,
} from "./theme";
import "./demo.css";

const KIND_LABEL: Record<string, string> = {
  turn: "Turn",
  arr: "Arrival stay",
  hold: "Tow / hold",
  dep: "Departure stay",
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
  /** Optional controls rendered at the right of the header. */
  toolbar?: ReactNode;
  /** Optional status line rendered under the subtitle. */
  notice?: ReactNode;
}

export function StandTimelineDemo({
  selectedIds: controlledIds,
  onIntent: controlledOnIntent,
  showSelectionDetail = true,
  isMatch,
  selectionActive,
  toolbar,
  notice,
}: StandTimelineDemoProps = {}) {
  const [localIds, setLocalIds] = useState<string[]>([]);
  const controlled = controlledIds !== undefined;
  const selectedIds = controlled ? controlledIds : localIds;
  const hasSelection = selectionActive ?? selectedIds.length > 0;
  const accessors = useMemo(
    () => makeDemoAccessors(DATA.turnsById, DATA.stayPosition, DATA.endpoints, isMatch, hasSelection),
    [isMatch, hasSelection],
  );

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
      <header className="demo-header">
        <div>
          <h1 className="demo-title">Stand occupancy · {SYNTHETIC_DATE}</h1>
          <p className="demo-subtitle">
            Generic stand-timeline starter. Not an ARIS or GateView replica.
          </p>
          {notice && <div className="demo-notice">{notice}</div>}
        </div>
        {toolbar && <div className="demo-toolbar">{toolbar}</div>}
      </header>

      <StandTimeline
        style={fluentChartTheme}
        className="demo-chart"
        fillHeight
        rows={DATA.rows}
        visits={DATA.visits}
        occupancies={DATA.occupancies}
        domain={DOMAIN}
        timeZone="UTC"
        rowHeight={ROW_HEIGHT}
        barInset={BAR_INSET}
        minHourWidth={MIN_HOUR_WIDTH}
        labelWidth={GUTTER_WIDTH}
        axes="both"
        selectedIds={selectedIds}
        onIntent={onIntent}
        ariaLabel="Synthetic stand occupancy timeline, times in UTC"
      >
        <DemoPatternDefs />
        {/* Synthetic piers only drive optional group dividers; no group-name column. */}
        <StandRows zebra={false} title={null} showGroup={false} labelAlign="end" />
        <TimeGrid minorMs={QUARTER_RULER.stepMs} />
        <OccupancyBars barStyle={accessors.barStyle} describe={accessors.describe} />
        <BarLabels
          slots={accessors.labelSlots}
          color={accessors.labelColor}
          priority={["start", "end", "center"]}
          {...LABEL_METRICS}
        />
        <TimeAxis position="top" zoneLabel="UTC" {...QUARTER_RULER} />
        <TimeAxis position="bottom" zoneLabel="UTC" {...QUARTER_RULER} />
      </StandTimeline>

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
