// Compact flight table shared by ArrivalList and DepartureList. Fluent v9
// Table primitives (native <table>) with role="grid" so rows can carry
// aria-selected and a roving tabindex: Tab enters the grid once, arrow keys,
// Home and End move between rows, Enter/Space selects. The row of a flight
// with no stand (and stay times) can be dragged onto a stand on the chart
// (see ./FlightDrag); the details popover's Assign stand does the same from
// the keyboard.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Badge,
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
import { isFlightSelected, useOperations } from "./OperationsContext";
import { alertsForFlight } from "./boardAlerts";
import { beginFlightDrag } from "./FlightDrag";
import type { OpsFlight } from "./operationsData";

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
 * Shared column definitions: one <colgroup> sizes header and body cells
 * alike (fixed table layout), so headings sit exactly over their values.
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
  const { selection, skyeSelection, selectFlight, acknowledged, assignStands } = useOperations();
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
    const headH = body?.closest("table")?.tHead?.offsetHeight ?? 0;
    const box = scroller.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < box.top + headH) scroller.scrollTop -= box.top + headH - r.top;
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

  return (
    <div className="ops-list">
      {/* Multiselectable: several chart stays (shift-select) can mark several rows. */}
      <Table
        size="extra-small"
        role="grid"
        aria-label={label}
        aria-multiselectable="true"
        className="ops-table"
      >
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="ops-head-row">
            <TableHeaderCell className="ops-cell">Flight</TableHeaderCell>
            <TableHeaderCell className="ops-cell">{routeHeader}</TableHeaderCell>
            <TableHeaderCell className="ops-cell" aria-label={`${timeHeaderLabel}, UTC, synthetic`}>
              <abbr title={`${timeHeaderLabel} (UTC, synthetic)`}>{timeHeader}</abbr>
            </TableHeaderCell>
            <TableHeaderCell className="ops-cell">Stand</TableHeaderCell>
            <TableHeaderCell className="ops-cell" aria-label="Alerts" />
          </TableRow>
        </TableHeader>
        <TableBody ref={bodyRef} onKeyDown={onKeyDown}>
          {flights.map((f) => {
            const selected = isFlightSelected(f, selection);
            const alerts = alertsForFlight(f.id, acknowledged);
            const warning = alerts.some((a) => a.severity === "warning");
            const day = dayOffsetLabel(f.estimate);
            const draggable = !f.standId && !!f.unplacedStay;
            return (
              <TableRow
                key={f.id}
                className={draggable ? "ops-row ops-row--draggable" : "ops-row"}
                data-flight-id={f.id}
                data-ops-draggable={draggable || undefined}
                aria-selected={selected}
                data-skye-selected={(!selected && isFlightSelected(f, skyeSelection)) || undefined}
                tabIndex={f.id === tabStopId ? 0 : -1}
                onFocus={() => setActiveId(f.id)}
                onClick={() => selectFlight(f)}
                onPointerDown={
                  draggable
                    ? (e) => beginFlightDrag(e, f, (stayId, standId) => assignStands([{ stayId, standId }]))
                    : undefined
                }
              >
                <TableCell className="ops-cell ops-flight">{f.flight}</TableCell>
                <TableCell className="ops-cell ops-muted" title={airportLabel(f.routeEnd)}>
                  {f.routeEnd}
                </TableCell>
                <TableCell className="ops-cell ops-time" title={formatUtcFull(f.estimate)}>
                  <span aria-hidden="true">
                    {formatUtc(f.estimate)}
                    {day && <span className="ops-day">{day}</span>}
                  </span>
                  <span className="ops-visually-hidden">{formatUtcFull(f.estimate)}</span>
                </TableCell>
                <TableCell className="ops-cell">
                  {f.standId ? (
                    <span className="ops-stand">{f.standId}</span>
                  ) : (
                    <Badge appearance="tint" color="warning" size="small" shape="rounded">
                      Unassigned
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="ops-cell ops-issue">
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
          })}
        </TableBody>
      </Table>
    </div>
  );
}
