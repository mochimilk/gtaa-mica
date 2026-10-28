// The board's KPIs, in a bar under its chart: what needs attention
// (conflicts, flights with no stand), how busy the stands are, and how much
// free stand time is left, each worked out from the board as it is now (see
// ./boardKpis). Collapsed, the default, the bar is one row of figures;
// expanded, each is a card, also saying how far it has moved from the plan's,
// most with a small chart. Synthetic demo figures, like the board's.
//
// Colour follows the board: a conflict's red and a waiting flight's orange
// are its bars' (demo.css, --flight-*), and the hourly stand use is in the
// healthy bars' blue. Text stays in neutral tokens: a status colour is only
// ever a chart's marks, which the column's label names, and every small chart
// has a title on each mark and a summary for screen readers.
import { useId, useMemo, useState, type ReactNode } from "react";
import { Tooltip } from "@fluentui/react-components";
import { ArrowDown12Filled, ArrowUp12Filled, ChevronDown20Regular, ChevronUp20Regular } from "@fluentui/react-icons";
import type { Millis } from "../stand-timeline";
import { DEMO_DOMAIN, formatUtc } from "../stand-timeline-demo/demoData";
import { standState } from "./allocation";
import { boardKpis, MIN_WINDOW_MINUTES, planKpis, type KpiSpan } from "./boardKpis";
import { useOpsBoard } from "./OperationsContext";
import { formatDuration } from "./operationsData";
import { KEEP_SELECTION_ATTR } from "./ViewsFiltersToolbar";
import "./operations.css";

const [FROM, TO] = DEMO_DOMAIN;
const HOUR = 3_600_000;
/** The small charts' size, px. */
const CHART = { width: 104, height: 28 };

const percent = (share: number) => `${Math.round(share * 100)}%`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * How far a figure is from the plan's: an arrow up or down and the size of
 * the difference (`text`), green when that is better, red when worse,
 * neutral when it is neither. Nothing while the figure matches the plan's.
 */
function Delta({ by, text, better }: { by: number; text: string; better?: "up" | "down" }) {
  if (by === 0) return null;
  const tone = !better ? "neutral" : (by > 0) === (better === "up") ? "good" : "bad";
  const Arrow = by > 0 ? ArrowUp12Filled : ArrowDown12Filled;
  const direction = by > 0 ? "Up" : "Down";
  return (
    <span className={`ops-kpi-delta ops-kpi-delta--${tone}`} title={`${direction} ${text} vs the plan`}>
      <Arrow aria-hidden="true" />
      <span className="ops-visually-hidden">{direction} </span>
      {text}
      <span className="ops-visually-hidden"> vs plan</span>
    </span>
  );
}

/**
 * One KPI, a column of the bar: its label and figure, and while the bar is
 * expanded, how far it is from the plan in the top-right corner and an
 * optional small chart beside the figure. `detail`, a line of context, is
 * the column's tooltip.
 */
function KpiTile({
  label,
  value,
  delta,
  detail,
  chart,
  expanded,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  detail: string;
  chart?: ReactNode;
  expanded: boolean;
}) {
  return (
    <div className="ops-kpi" role="group" aria-label={label} title={detail}>
      <div className="ops-kpi-label">{label}</div>
      <div className="ops-kpi-value">{value}</div>
      {expanded && delta}
      {expanded && chart && <div className="ops-kpi-chart">{chart}</div>}
    </div>
  );
}

/** Rows of overlapping spans; any more share the last. */
const SPAN_ROWS = 3;
const SPAN = { height: 6, gap: 3, minWidth: 6 };

/**
 * When things happen across the board's window, as a glance at the board
 * below: each row a faint 05:00–17:00 track, each span a capsule on it, and
 * spans that overlap on rows of their own. The rows sit centred in the chart.
 */
function DaySpans({ spans, tone, summary }: { spans: readonly KpiSpan[]; tone: "conflict" | "waiting"; summary: string }) {
  const x = (t: Millis) => ((Math.min(Math.max(t, FROM), TO) - FROM) / (TO - FROM)) * CHART.width;
  const rowEnds: Millis[] = [];
  const placed = spans.map((span) => {
    let row = rowEnds.findIndex((end) => end <= span.start);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = span.end;
    return { span, row: Math.min(row, SPAN_ROWS - 1) };
  });
  const rows = Math.max(2, Math.min(SPAN_ROWS, rowEnds.length));
  const top = (CHART.height - rows * SPAN.height - (rows - 1) * SPAN.gap) / 2;
  const rowY = (row: number) => top + row * (SPAN.height + SPAN.gap);
  return (
    <svg className={`ops-kpi-spans ops-kpi-spans--${tone}`} width={CHART.width} height={CHART.height} role="img" aria-label={summary}>
      {Array.from({ length: rows }, (_, row) => (
        <rect key={row} className="ops-kpi-track" x={0} y={rowY(row)} width={CHART.width} height={SPAN.height} rx={SPAN.height / 2} />
      ))}
      {placed.map(({ span, row }) => {
        const start = x(span.start);
        const width = Math.max(SPAN.minWidth, x(span.end) - start);
        const y = rowY(row);
        return (
          <rect key={span.id} className="ops-kpi-span" x={Math.min(start, CHART.width - width)} y={y} width={width} height={SPAN.height} rx={SPAN.height / 2}>
            <title>
              {span.label}
              {span.standId ? ` on ${span.standId}` : ""} · {formatUtc(span.start)}–{formatUtc(span.end)} UTC
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

/** A column `width` wide and `height` tall standing on the chart's floor, its top corners rounded. */
function column(x: number, width: number, height: number, radius = 2): string {
  const floor = CHART.height;
  const r = Math.min(radius, height, width / 2);
  const top = floor - height;
  return `M${x},${floor}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${floor}Z`;
}

/**
 * Stand use hour by hour: one column per hour on a full-height track, so each
 * reads as a meter, with the busiest hour in full colour and the rest quieter.
 */
function HourlyUse({ hours, busiest }: { hours: readonly { from: Millis; use: number }[]; busiest: number }) {
  const slot = CHART.width / hours.length;
  const summary = `Stand use by hour, ${formatUtc(FROM)} to ${formatUtc(TO)} UTC: busiest ${formatUtc(hours[busiest].from)}, ${percent(hours[busiest].use)}`;
  return (
    <svg className="ops-kpi-hours" width={CHART.width} height={CHART.height} role="img" aria-label={summary}>
      {hours.map((hour, index) => {
        const x = index * slot + 1;
        const width = slot - 2;
        return (
          <g key={hour.from}>
            <title>
              {formatUtc(hour.from)}–{formatUtc(hour.from + HOUR)} UTC · {percent(hour.use)} of open stand time in use
            </title>
            <path className="ops-kpi-hour-track" d={column(x, width, CHART.height)} />
            {hour.use > 0 && (
              <path
                className={index === busiest ? "ops-kpi-hour ops-kpi-hour--busiest" : "ops-kpi-hour"}
                d={column(x, width, Math.max(2, hour.use * CHART.height))}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function KpiStrip() {
  const { allocationVersion } = useOpsBoard();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const toggleLabel = expanded ? "Hide KPI details" : "Show KPI details";
  // Read on every stand change (allocationVersion re-renders this).
  const now = useMemo(() => boardKpis(standState()), [allocationVersion]);
  const plan = planKpis();

  const conflicts = now.conflicts.length;
  const firstConflict = now.conflicts[0];
  const holdBy = now.gateHoldMinutes - plan.gateHoldMinutes;
  const firstHold = now.holds[0];
  // Each wait, from when the aircraft is due until it gets on its stand.
  const holdSpans = now.holds.map(
    (hold): KpiSpan => ({ id: hold.stayId, start: hold.due, end: hold.due + hold.minutes * 60_000, label: hold.label, standId: hold.standId }),
  );
  const firstWaiting = now.waiting[0];
  const busiest = now.hourlyUse.reduce((best, hour, index, hours) => (hour.use > hours[best].use ? index : best), 0);
  const usePoints = Math.round(now.standUse * 100) - Math.round(plan.standUse * 100);
  const freeBy = now.freeMinutes - plan.freeMinutes;
  const windowsBy = now.windows - plan.windows;

  return (
    <section id={id} className="ops-kpis" aria-label="Board KPIs" data-expanded={expanded || undefined}>
      <KpiTile
        label="Conflicts"
        expanded={expanded}
        value={conflicts}
        delta={<Delta by={conflicts - plan.conflicts.length} text={`${Math.abs(conflicts - plan.conflicts.length)}`} better="down" />}
        detail={firstConflict ? `First ${formatUtc(firstConflict.start)} on ${firstConflict.standId}` : "None on the board"}
        chart={
          <DaySpans
            spans={now.conflicts}
            tone="conflict"
            summary={conflicts ? `${plural(conflicts, "conflict")}, the first at ${formatUtc(firstConflict.start)} UTC` : "No conflicts"}
          />
        }
      />
      <KpiTile
        label="Gate hold"
        expanded={expanded}
        value={now.gateHoldMinutes > 0 ? formatDuration(now.gateHoldMinutes) : "None"}
        delta={<Delta by={holdBy} text={formatDuration(Math.abs(holdBy))} better="down" />}
        detail={
          firstHold
            ? `${plural(now.holds.length, "aircraft", "aircraft")} would wait for a stand · first ${firstHold.label} on ${firstHold.standId} at ${formatUtc(firstHold.due)}`
            : "No aircraft waits for its stand"
        }
        chart={
          <DaySpans
            spans={holdSpans}
            tone="conflict"
            summary={
              firstHold
                ? `${plural(now.holds.length, "aircraft", "aircraft")} waiting for a stand, the first from ${formatUtc(firstHold.due)} UTC`
                : "No aircraft waits for its stand"
            }
          />
        }
      />
      <KpiTile
        label="Unassigned"
        expanded={expanded}
        value={now.noStand}
        delta={<Delta by={now.noStand - plan.noStand} text={`${Math.abs(now.noStand - plan.noStand)}`} better="down" />}
        detail={
          [
            firstWaiting && `First needs a stand ${formatUtc(firstWaiting.start)}`,
            now.untimed && `${now.untimed} without times`,
          ]
            .filter(Boolean)
            .join(" · ") || "Every flight has a stand"
        }
        chart={
          <DaySpans
            spans={now.waiting}
            tone="waiting"
            summary={`${plural(now.waiting.length, "stay")} waiting for a stand${firstWaiting ? `, the first from ${formatUtc(firstWaiting.start)} UTC` : ""}`}
          />
        }
      />
      <KpiTile
        label="Stand use"
        expanded={expanded}
        value={percent(now.standUse)}
        delta={<Delta by={usePoints} text={plural(Math.abs(usePoints), "pt")} />}
        detail={`Busiest ${formatUtc(now.hourlyUse[busiest].from)}–${formatUtc(now.hourlyUse[busiest].from + HOUR)} · ${percent(now.hourlyUse[busiest].use)}`}
        chart={<HourlyUse hours={now.hourlyUse} busiest={busiest} />}
      />
      <KpiTile
        label="Stand time"
        expanded={expanded}
        value={formatDuration(now.freeMinutes)}
        delta={<Delta by={freeBy} text={formatDuration(Math.abs(freeBy))} better="up" />}
        detail={
          `Free in ${plural(now.windows, "window")} of ${MIN_WINDOW_MINUTES / 60}h+` +
          (windowsBy ? ` (${windowsBy > 0 ? "+" : "−"}${Math.abs(windowsBy)})` : "")
        }
      />
      <Tooltip content={toggleLabel} relationship="label">
        <button
          {...KEEP_SELECTION_ATTR}
          type="button"
          className="ops-kpis-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown20Regular aria-hidden="true" /> : <ChevronUp20Regular aria-hidden="true" />}
        </button>
      </Tooltip>
    </section>
  );
}
