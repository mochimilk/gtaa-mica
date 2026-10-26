import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Select, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, tokens,
} from "@fluentui/react-components";
import { useId } from "react";
import { useTimeline, useTimelineRegion } from "../stand-timeline";
import { formatUtcWithDay } from "../stand-timeline-demo/demoData";
import type { PreparedScenario } from "./dataset";
import type { PlanVariant } from "./preferences";
import type { BufferEvaluation, BufferEvidence, BufferResult } from "./buffer-evaluation";

const minutes = (value: number | null) => value === null ? "N/A" : `${Number(value.toFixed(2))} min`;

export function describeBuffer(item: BufferEvidence, snapshot: PreparedScenario): string {
  const row = snapshot.rows.find(row => row.id === item.rowId)?.label ?? item.rowId;
  const visit = (id: string) => {
    const turn = snapshot.visits.find(visit => visit.turnId === id);
    return turn ? `${turn.arrFlight}/${turn.depFlight}` : id;
  };
  return `${row}: ${visit(item.previous.visitId)} to ${visit(item.next.visitId)}, ${minutes(item.minutes)} buffer`;
}

export function BufferOverlay({
  result, snapshot, isMatch, onInspect,
}: {
  result: BufferResult;
  snapshot: PreparedScenario;
  isMatch?: (id: string) => boolean;
  onInspect: (id: string) => void;
}) {
  const region = useTimelineRegion();
  const { scale, rows, rowHeight } = useTimeline();
  if (region !== "plot" || result.availability !== "available") return null;
  return (
    <g aria-label="Tight scheduled stand handovers">
      {result.handovers.filter(item => item.tight).map(item => {
        const rowIndex = rows.findIndex(row => row.id === item.rowId);
        if (rowIndex < 0 || item.start >= scale.domain[1] || item.end < scale.domain[0]) return null;
        const left = scale.x(Math.max(item.start, scale.domain[0]));
        const right = scale.x(Math.min(item.end, scale.domain[1]));
        const width = Math.max(4, right - left);
        const x = left - (width - (right - left)) / 2;
        const y = rowIndex * rowHeight + 2;
        const label = describeBuffer(item, snapshot);
        const dimmed = isMatch && !isMatch(item.previous.id) && !isMatch(item.next.id);
        return (
          <g key={item.id} className="st-bar" role="button" tabIndex={0}
            data-buffer-id={item.id} aria-label={`Inspect ${label}`} opacity={dimmed ? 0.3 : 1}
            data-ops-keep-selection=""
            onClick={event => { event.stopPropagation(); onInspect(item.id); }}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onInspect(item.id);
              }
            }}>
            <title>{label}</title>
            <rect x={x} y={y} width={width} height={rowHeight - 4}
              fill={tokens.colorStatusWarningBackground1} fillOpacity={0.55}
              stroke={tokens.colorStatusWarningForeground1} strokeDasharray="3 2" />
            <rect className="st-bar-outline" x={x - 2} y={y - 1} width={width + 4} height={rowHeight - 2} />
          </g>
        );
      })}
    </g>
  );
}

export function BufferReview({
  snapshot, evaluation, variant, open, setOpen, showOverlay, setShowOverlay, setThreshold, selectedId, setSelectedId,
}: {
  snapshot: PreparedScenario;
  evaluation: BufferEvaluation;
  variant: PlanVariant;
  open: boolean;
  setOpen: (value: boolean) => void;
  showOverlay: boolean;
  setShowOverlay: (value: boolean) => void;
  setThreshold: (value: number) => void;
  selectedId: string;
  setSelectedId: (value: string) => void;
}) {
  const thresholdId = useId(), evidenceId = useId(), triggerId = useId();
  const baseline = evaluation.variants.baseline, alternative = evaluation.variants["tow-options"];
  const current = evaluation.variants[variant];
  const selected = current.buffers.handovers.find(item => item.id === selectedId);
  const choices = [...new Set([0, 5, 10, 15, 20, 30, 45, 60, evaluation.profile.threshold_minutes])].sort((a, b) => a - b);
  const rows: [string, string | number, string | number][] = [
    ["Assigned visits", baseline.assigned_visits, alternative.assigned_visits],
    ["Unassigned visits", baseline.unassigned_visits, alternative.unassigned_visits],
    ["Additional tows", baseline.generated_tows, alternative.generated_tows],
    ["Solver status", baseline.solver_status, alternative.solver_status],
    ["Buffer availability", baseline.buffers.availability, alternative.buffers.availability],
    ["Handovers", baseline.buffers.summary.handover_count, alternative.buffers.summary.handover_count],
    [`Gaps below ${evaluation.profile.threshold_minutes} min`, baseline.buffers.summary.tight_count, alternative.buffers.summary.tight_count],
    ["Minimum buffer", minutes(baseline.buffers.summary.minimum_minutes), minutes(alternative.buffers.summary.minimum_minutes)],
    ["Median buffer", minutes(baseline.buffers.summary.median_minutes), minutes(alternative.buffers.summary.median_minutes)],
    ["P10 buffer", minutes(baseline.buffers.summary.p10_minutes), minutes(alternative.buffers.summary.p10_minutes)],
    ["Overlapping occupancy pairs", baseline.buffers.summary.overlap_count, alternative.buffers.summary.overlap_count],
  ];
  const changes = evaluation.comparison;
  return (
    <>
      <Button id={triggerId} data-ops-keep-selection="" appearance={showOverlay ? "primary" : "secondary"}
        onClick={() => { setSelectedId(""); setOpen(true); }}>Buffers</Button>
      <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}
        surfaceMotion={{ onMotionFinish: () => {
          if (!open) {
            const marker = showOverlay && selectedId
              ? document.querySelector<SVGElement>(`[data-buffer-id="${CSS.escape(selectedId)}"]`) : null;
            (marker ?? document.getElementById(triggerId))?.focus({ preventScroll: true });
          }
        } }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Scheduled stand buffer review</DialogTitle>
            <DialogContent>
              <p>Reporting only. This does not change assignments, reserve padding or rerun the solver.</p>
              <Field label={{ children: "Tight below (minutes)", htmlFor: thresholdId }}>
                <Select id={thresholdId} value={String(evaluation.profile.threshold_minutes)}
                  onChange={(_, data) => setThreshold(Number(data.value))}>
                  {choices.map(value => <option key={value} value={value}>{value}</option>)}
                </Select>
              </Field>
              <Checkbox label="Show tight handovers on the chart" checked={showOverlay}
                onChange={(_, data) => setShowOverlay(data.checked === true)} />
              <p>Whole prepared plan, independent of chart filters. Zero-minute gaps count; overlaps are conflicts, not negative buffers.</p>
              <Table size="small" aria-label="Prepared plan buffer comparison">
                <TableHeader><TableRow>
                  <TableHeaderCell>Measurement</TableHeaderCell>
                  <TableHeaderCell>Baseline</TableHeaderCell>
                  <TableHeaderCell>Tow options</TableHeaderCell>
                </TableRow></TableHeader>
                <TableBody>{rows.map(([label, before, after]) => <TableRow key={label}>
                  <TableCell>{label}</TableCell><TableCell>{before}</TableCell><TableCell>{after}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
              <p>
                Same source demand and horizon: {evaluation.population_count} visits.
                {" "}{changes.gained_visit_ids.length} gained, {changes.lost_visit_ids.length} lost,
                {" "}{changes.changed_retained_visit_ids.length} retained visits changed,
                {" "}{changes.unchanged_retained_visits} retained visits unchanged.
                {" "}Changes include stand, timing and tow-pattern differences, not internal stay IDs.
              </p>
              {changes.assigned_sets_differ && <p role="note">
                Assigned populations differ. Buffer values are descriptive; this is not a same-assigned-population improvement.
              </p>}
              {changes.buffer_delta && <p>
                Tow options minus baseline: minimum {minutes(changes.buffer_delta.minimum_minutes)},
                {" "}median {minutes(changes.buffer_delta.median_minutes)}, P10 {minutes(changes.buffer_delta.p10_minutes)},
                {" "}tight handovers {changes.buffer_delta.tight_count}.
              </p>}
              {current.buffers.availability === "invalid" && <p role="alert">
                Overlapping occupancy makes this buffer assessment invalid. Summary values and the overlay are unavailable.
              </p>}
              {current.buffers.availability === "not-applicable" && <p>No eligible handovers in this horizon. N/A is not a zero-minute buffer.</p>}
              <Field label={{ children: `Inspect handover (${variant === "baseline" ? "Baseline" : "Tow options"})`, htmlFor: evidenceId }}>
                <Select id={evidenceId} value={selected?.id ?? ""} onChange={(_, data) => setSelectedId(data.value)}>
                  <option value="">Choose a handover</option>
                  {current.buffers.handovers.map(item => <option key={item.id} value={item.id}>{describeBuffer(item, snapshot)}</option>)}
                </Select>
              </Field>
              {selected && <p role="status">
                {describeBuffer(selected, snapshot)}.
                {" "}Release {formatUtcWithDay(selected.start, snapshot.plan_window.start.slice(0, 10))};
                {" "}next start {formatUtcWithDay(selected.end, snapshot.plan_window.start.slice(0, 10))} UTC.
                {" "}{selected.tight ? "Below" : "At or above"} the {evaluation.profile.threshold_minutes}-minute review threshold.
              </p>}
              <p>
                Metric {evaluation.metric.id} v{evaluation.metric.version}; derived, scoring-only.
                {" "}Profile {evaluation.profile.id}; threshold {evaluation.profile.threshold_minutes} min.
                {" "}P10 uses nearest rank; median averages the middle pair. No handovers are inferred at horizon edges.
                {" "}Same-visit returns are excluded. This is not predicted resilience or usable capacity.
              </p>
            </DialogContent>
            <DialogActions><Button appearance="primary" onClick={() => setOpen(false)}>Close</Button></DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
