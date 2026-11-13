// Compact flight table shared by ArrivalList and DepartureList. One
// role="grid" so rows can carry aria-selected and a roving tabindex: Tab
// enters the grid once, arrow keys, Home and End move between rows,
// Enter/Space selects. Its column headings and rows are two Fluent v9 Tables
// (native <table>) on one set of columns: the headings sit above the scroll
// region (OverflowScroll's header) so no row scrolls beneath them, and
// explicit roles make the pair one grid. The row of a flight with no stand
// (and stay times) can be dragged onto a stand on the chart (see
// ./FlightDrag); the details popover's Assign stand does the same from the
// keyboard.
import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@fluentui/react-components";
import { InfoRegular, WarningRegular } from "@fluentui/react-icons";
import { airportLabel } from "../stand-timeline-demo/airports";
import { dayOffsetLabel, formatUtc, formatUtcFull } from "../stand-timeline-demo/demoData";
import { isFlightSelected, useOpsActions, useOpsBoard, useOpsSelections } from "./OperationsContext";
import { alertsForFlight } from "./boardAlerts";
import { beginFlightDrag } from "./FlightDrag";
import type { OpsFlight } from "./operationsData";
import { OverflowScroll } from "./OverflowScroll";
import { ACTIVE_DATASET } from "./activeDataset";

export interface FlightListProps {
  flights: readonly OpsFlight[];
  /** Accessible table name, e.g. "Arrivals". */
  label: string;
  /** Column header for the route endpoint ("From" / "To"). */
  routeHeader: string;
  /** Short time column header ("ETA" / "ETD") and its spelled-out name. */
  timeHeader: string;
  timeHeaderLabel: string;
  emptyMessage: string;
}

/**
 * Shared column definitions: the same <colgroup> sizes the heading and body
 * tables alike (fixed layout, equal widths), so headings sit exactly over
 * their values.
 * The four data columns have no width, so they split the width left after
 * the compact icon column equally. The table's min-width (operations.css)
 * keeps each of them wide enough for the widest data cell.
 */
const COLUMNS: { key: string; width?: string }[] = [
  { key: "flight" },
  { key: "route" },
  { key: "time" },
  { key: "stand" },
  // 16px icon + the cell's padding; --ops-icon-col is defined on the table.
  { key: "issue", width: "var(--ops-icon-col)" },
];

export function FlightList({
  flights,
  label,
  routeHeader,
  timeHeader,
  timeHeaderLabel,
  emptyMessage,
}: FlightListProps) {
  const displayedTimeHeader = ACTIVE_DATASET.capabilities.fixtureAnalyses ? timeHeader : timeHeader.replace(/^E/, "S");
  const displayedTimeLabel = ACTIVE_DATASET.capabilities.fixtureAnalyses ? timeHeaderLabel : timeHeaderLabel.replace(/^Estimated/, "Scheduled");
  const { selection, skyeSelection } = useOpsSelections();
  const { selectFlight, assignStands } = useOpsActions();
  const { acknowledged, allocationVersion } = useOpsBoard();
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Keep the first selected row visible, e.g. after selecting a bar on the chart.
  // Scrolls only this list's own scroll container (never the panel, page or the
  // other groups), and does nothing while the group is collapsed.
  useEffect(() => {
    const body = bodyRef.current;
    const row = body?.querySelector<HTMLElement>("tr[aria-selected='true']");
    const scroller = body?.closest<HTMLElement>(".ops-group-scroll");
    if (!row || !scroller || scroller.offsetParent === null) return;
    const box = scroller.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < box.top) scroller.scrollTop -= box.top - r.top;
    else if (r.bottom > box.bottom) scroller.scrollTop += r.bottom - box.bottom;
  }, [selection]);

  if (flights.length === 0) return <p className="ops-empty">{emptyMessage}</p>;

  // Roving tabindex target: last focused row, else the first selected row, else the first row.
  const tabStopId =
    (activeId && flights.some((f) => f.id === activeId) && activeId) ||
    flights.find((f) => isFlightSelected(f, selection))?.id ||
    flights[0].id;

  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const rows = [...e.currentTarget.querySelectorAll<HTMLTableRowElement>("tr[data-flight-id]")];
    const i = rows.indexOf(document.activeElement as HTMLTableRowElement);
    if (i < 0) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const f = flights[i];
      if (f) selectFlight(f);
      return;
    }
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? rows.length - 1
      : e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1)
      : e.key === "ArrowUp" ? Math.max(0, i - 1)
      : -1;
    if (next >= 0 && rows[next]) {
      e.preventDefault();
      rows[next].focus();
    }
  };

  const columns = (
    <colgroup>
      {COLUMNS.map((c) => (
        <col key={c.key} style={c.width ? { width: c.width } : undefined} />
      ))}
    </colgroup>
  );

  // The tables are only layout (role="presentation"); their sections, rows
  // and cells carry the grid's roles.
  const headings = (
    <Table size="extra-small" role="presentation" className="ops-table">
      {columns}
      <TableHeader role="rowgroup">
        <TableRow role="row" className="ops-head-row">
          <TableHeaderCell role="columnheader" className="ops-cell">Flight</TableHeaderCell>
          <TableHeaderCell role="columnheader" className="ops-cell">{routeHeader}</TableHeaderCell>
          <TableHeaderCell
            role="columnheader"
            className="ops-cell"
            aria-label={`${displayedTimeLabel}, UTC, synthetic`}
          >
            <abbr title={`${displayedTimeLabel} (UTC, synthetic)`}>{displayedTimeHeader}</abbr>
          </TableHeaderCell>
          <TableHeaderCell role="columnheader" className="ops-cell">Stand</TableHeaderCell>
          <TableHeaderCell role="columnheader" className="ops-cell" aria-label="Alerts" />
        </TableRow>
      </TableHeader>
    </Table>
  );

  return (
    // Multiselectable: several chart stays (shift-select) can mark several rows.
    <div className="ops-list" role="grid" aria-label={label} aria-multiselectable="true">
      <OverflowScroll className="ops-group-scroll" header={headings}>
        <Table size="extra-small" role="presentation" className="ops-table">
          {columns}
          <TableBody role="rowgroup" ref={bodyRef} onKeyDown={onKeyDown}>
            {flights.map((f) => (
              <FlightRow
                key={f.id}
                flight={f}
                version={allocationVersion}
                selected={isFlightSelected(f, selection)}
                skyeSelected={isFlightSelected(f, skyeSelection)}
                tabStop={f.id === tabStopId}
                acknowledged={acknowledged}
                onActive={setActiveId}
                selectFlight={selectFlight}
                assignStands={assignStands}
              />
            ))}
          </TableBody>
        </Table>
      </OverflowScroll>
    </div>
  );
}

interface FlightRowProps {
  flight: OpsFlight;
  /** The stands' version: flights change in place when a stand does, so this redraws the row. */
  version: number;
  selected: boolean;
  skyeSelected: boolean;
  tabStop: boolean;
  acknowledged: ReadonlySet<string>;
  onActive: (flightId: string) => void;
  selectFlight: (flight: OpsFlight) => void;
  assignStands: ReturnType<typeof useOpsActions>["assignStands"];
}

/**
 * One flight's row. Memoized on what it shows, so a pick on the board or in
 * a list redraws the rows whose selection changed, not the hundred others.
 */
const FlightRow = memo(function FlightRow({
  flight: f,
  selected,
  skyeSelected,
  tabStop,
  acknowledged,
  onActive,
  selectFlight,
  assignStands,
}: FlightRowProps) {
  const alerts = alertsForFlight(f.id, acknowledged);
  const warning = alerts.some((a) => a.severity === "warning");
  const day = dayOffsetLabel(f.estimate);
  const draggable = ACTIVE_DATASET.capabilities.editStands && !f.standId && !!f.unplacedStay;
  return (
    <TableRow
      role="row"
      className={draggable ? "ops-row ops-row--draggable" : "ops-row"}
      data-flight-id={f.id}
      data-ops-draggable={draggable || undefined}
      aria-selected={selected}
      data-skye-selected={(!selected && skyeSelected) || undefined}
      tabIndex={tabStop ? 0 : -1}
      onFocus={() => onActive(f.id)}
      onClick={() => selectFlight(f)}
      onPointerDown={
        draggable ? (e) => beginFlightDrag(e, f, (stayId, standId) => assignStands([{ stayId, standId }])) : undefined
      }
    >
      <TableCell role="gridcell" className="ops-cell ops-flight">{f.flight}</TableCell>
      <TableCell role="gridcell" className="ops-cell ops-muted" title={airportLabel(f.routeEnd)}>
        {f.routeEnd}
      </TableCell>
      <TableCell role="gridcell" className="ops-cell ops-time" title={formatUtcFull(f.estimate)}>
        <span aria-hidden="true">
          {formatUtc(f.estimate)}
          {day && <span className="ops-day">{day}</span>}
        </span>
        <span className="ops-visually-hidden">{formatUtcFull(f.estimate)}</span>
      </TableCell>
      <TableCell role="gridcell" className="ops-cell">
        {f.standId ? (
          <span className="ops-stand">{f.standId}</span>
        ) : (
          <>
            <span className="ops-muted" aria-hidden="true">
              -
            </span>
            <span className="ops-visually-hidden">No stand</span>
          </>
        )}
      </TableCell>
      <TableCell role="gridcell" className="ops-cell ops-issue">
        {alerts.length > 0 && (
          <>
            {warning ? (
              <WarningRegular className="ops-issue--warning" aria-hidden />
            ) : (
              <InfoRegular className="ops-issue--info" aria-hidden />
            )}
            <span className="ops-visually-hidden">
              {alerts.length} open alert{alerts.length > 1 ? "s" : ""}
            </span>
          </>
        )}
      </TableCell>
    </TableRow>
  );
});
