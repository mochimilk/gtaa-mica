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
import type { GateWaitContribution, GateWaitEvaluation, GateWaitResult } from "./gate-wait-evaluation";

export type ReviewMetric = "buffers" | "gate-wait";

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
  result, waiting, showBuffers, showWaiting, snapshot, isMatch, onInspect,
}: {
  result: BufferResult;
  waiting: GateWaitResult;
  showBuffers: boolean;
  showWaiting: boolean;
  snapshot: PreparedScenario;
  isMatch?: (id: string) => boolean;
  onInspect: (id: string, metric: ReviewMetric) => void;
}) {
  const region = useTimelineRegion();
  const { scale, rows, rowHeight } = useTimeline();
  if (region !== "plot") return null;
  const markers: { handover: BufferEvidence; waiting?: GateWaitContribution }[] = [
    ...(showBuffers && result.availability === "available"
      ? result.handovers.filter(item => item.tight).map(handover => ({ handover })) : []),
    ...(showWaiting && waiting.availability === "available"
      ? waiting.contributions.filter(item => item.estimated_wait_minutes > 0).map(item => ({ handover: item.handover, waiting: item })) : []),
  ];
  return (
    <g aria-label="Stand buffer and synthetic waiting annotations">
      {markers.map(marker => {
        const item = marker.handover;
        const rowIndex = rows.findIndex(row => row.id === item.rowId);
        if (rowIndex < 0 || item.start >= scale.domain[1] || item.end < scale.domain[0]) return null;
        const left = scale.x(Math.max(item.start, scale.domain[0]));
        const right = scale.x(Math.min(item.end, scale.domain[1]));
        const width = marker.waiting ? 14 : Math.max(4, right - left);
        const x = marker.waiting ? right - 7 : left - (width - (right - left)) / 2;
        const y = rowIndex * rowHeight + (marker.waiting ? rowHeight - 17 : 2);
        const height = marker.waiting ? 14 : rowHeight - 4;
        const metric: ReviewMetric = marker.waiting ? "gate-wait" : "buffers";
        const label = marker.waiting
          ? `${marker.waiting.arrival_flight}: ${minutes(marker.waiting.estimated_wait_minutes)} predicted waiting, synthetic; ${describeBuffer(item, snapshot)}`
          : describeBuffer(item, snapshot);
        const dimmed = isMatch && !isMatch(item.previous.id) && !isMatch(item.next.id);
        return (
          <g key={`${metric}:${item.id}`} className="st-bar" role="button" tabIndex={0}
            data-buffer-id={marker.waiting ? undefined : item.id} data-wait-id={marker.waiting ? item.id : undefined}
            aria-label={`Inspect ${label}`} opacity={dimmed ? 0.3 : 1}
            data-ops-keep-selection=""
            onClick={event => { event.stopPropagation(); onInspect(item.id, metric); }}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onInspect(item.id, metric);
              }
            }}>
            <title>{label}</title>
            {marker.waiting ? <>
              <rect x={x} y={y} width={width} height={height} fill="transparent" />
              <circle cx={right} cy={y + 7} r={5} fill={tokens.colorBrandForeground1}
                stroke={tokens.colorNeutralBackground1} strokeWidth={2} />
            </> : <rect x={x} y={y} width={width} height={height}
              fill={tokens.colorStatusWarningBackground1} fillOpacity={0.55}
              stroke={tokens.colorStatusWarningForeground1} strokeDasharray="3 2" />}
            <rect className="st-bar-outline" x={x - 2} y={y - 1} width={width + 4} height={height + 2} />
          </g>
        );
      })}
    </g>
  );
}

export function PlanReview({
  snapshot, evaluation, variant, open, setOpen, showOverlay, setShowOverlay, setThreshold, selectedId, setSelectedId,
  gateEvaluation, metric, setMetric, showWaiting, setShowWaiting, setAssumption,
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
  gateEvaluation: GateWaitEvaluation;
  metric: ReviewMetric;
  setMetric: (value: ReviewMetric) => void;
  showWaiting: boolean;
  setShowWaiting: (value: boolean) => void;
  setAssumption: (value: string) => void;
}) {
  const thresholdId = useId(), evidenceId = useId(), triggerId = useId(), waitTriggerId = useId(), metricId = useId(), assumptionId = useId();
  const isWaiting = metric === "gate-wait";
  const baseline = evaluation.variants.baseline, alternative = evaluation.variants["tow-options"];
  const current = evaluation.variants[variant];
  const selected = current.buffers.handovers.find(item => item.id === selectedId);
  const currentWaiting = gateEvaluation.variants[variant].waiting;
  const selectedWaiting = currentWaiting.contributions.find(item => item.handover.id === selectedId);
  const beforeWait = gateEvaluation.variants.baseline.waiting;
  const afterWait = gateEvaluation.variants["tow-options"].waiting;
  const assumption = gateEvaluation.assumption;
  const choices = [...new Set([0, 5, 10, 15, 20, 30, 45, 60, evaluation.profile.threshold_minutes])].sort((a, b) => a - b);
  const metricRows: [string, string | number, string | number][] = isWaiting ? [
      ["Waiting availability", beforeWait.availability, afterWait.availability],
      ["Assigned arrivals in horizon", beforeWait.summary.assigned_arrivals_in_horizon, afterWait.summary.assigned_arrivals_in_horizon],
      ["Assessed arrivals", beforeWait.summary.assessed_arrivals, afterWait.summary.assessed_arrivals],
      ["Unassessed assigned arrivals", beforeWait.summary.unassessed_arrivals, afterWait.summary.unassessed_arrivals],
      ["Assigned context arrivals", beforeWait.summary.context_arrivals, afterWait.summary.context_arrivals],
      ["Arrivals with positive estimates", beforeWait.summary.arrivals_with_positive_estimate, afterWait.summary.arrivals_with_positive_estimate],
      ["Predicted waiting (synthetic)", minutes(beforeWait.summary.total_wait_minutes), minutes(afterWait.summary.total_wait_minutes)],
      ["Maximum arrival estimate", minutes(beforeWait.summary.maximum_arrival_wait_minutes), minutes(afterWait.summary.maximum_arrival_wait_minutes)],
    ] : [
    ["Buffer availability", baseline.buffers.availability, alternative.buffers.availability],
    ["Handovers", baseline.buffers.summary.handover_count, alternative.buffers.summary.handover_count],
    [`Gaps below ${evaluation.profile.threshold_minutes} min`, baseline.buffers.summary.tight_count, alternative.buffers.summary.tight_count],
    ["Minimum buffer", minutes(baseline.buffers.summary.minimum_minutes), minutes(alternative.buffers.summary.minimum_minutes)],
    ["Median buffer", minutes(baseline.buffers.summary.median_minutes), minutes(alternative.buffers.summary.median_minutes)],
    ["P10 buffer", minutes(baseline.buffers.summary.p10_minutes), minutes(alternative.buffers.summary.p10_minutes)],
    ["Overlapping occupancy pairs", baseline.buffers.summary.overlap_count, alternative.buffers.summary.overlap_count],
    ];
  const rows: [string, string | number, string | number][] = [
    ["Assigned visits", baseline.assigned_visits, alternative.assigned_visits],
    ["Unassigned visits", baseline.unassigned_visits, alternative.unassigned_visits],
    ["Additional tows", baseline.generated_tows, alternative.generated_tows],
    ["Solver status", baseline.solver_status, alternative.solver_status],
    ...metricRows,
  ];
  const changes = evaluation.comparison;
  return (
    <>
      <Button id={triggerId} data-ops-keep-selection="" appearance={showOverlay ? "primary" : "secondary"}
        onClick={() => { setMetric("buffers"); setSelectedId(""); setOpen(true); }}>Buffers</Button>
      <Button id={waitTriggerId} data-ops-keep-selection="" appearance={showWaiting ? "primary" : "secondary"}
        onClick={() => { setMetric("gate-wait"); setSelectedId(""); setOpen(true); }}>Gate waiting</Button>
      <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}
        surfaceMotion={{ onMotionFinish: () => {
          if (!open) {
            const visible = isWaiting ? showWaiting : showOverlay;
            const marker = visible && selectedId
              ? document.querySelector<SVGElement>(`[${isWaiting ? "data-wait-id" : "data-buffer-id"}="${CSS.escape(selectedId)}"]`) : null;
            (marker ?? document.getElementById(isWaiting ? waitTriggerId : triggerId))?.focus({ preventScroll: true });
          }
        } }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{isWaiting ? "Predicted gate-wait review" : "Scheduled stand buffer review"}</DialogTitle>
            <DialogContent>
              <p>Reporting only. This does not change assignments, reserve padding or rerun the solver.</p>
              <Field label={{ children: "Review metric", htmlFor: metricId }}>
                <Select id={metricId} value={metric} onChange={(_, data) => {
                  if (data.value === "buffers" || data.value === "gate-wait") { setMetric(data.value); setSelectedId(""); }
                }}>
                  <option value="buffers">Scheduled stand buffers</option>
                  <option value="gate-wait">Predicted waiting (synthetic)</option>
                </Select>
              </Field>
              {isWaiting ? <>
                <Field label={{ children: "Synthetic release-delay assumption", htmlFor: assumptionId }}>
                  <Select id={assumptionId} value={assumption.id} onChange={(_, data) => setAssumption(data.value)}>
                    {gateEvaluation.profile.assumptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </Select>
                </Field>
                <Checkbox label="Show positive waiting estimates on the chart" checked={showWaiting}
                  onChange={(_, data) => setShowWaiting(data.checked === true)} />
                <p>
                  Synthetic inputs, not six months of history: P(late stand release) = {assumption.release_delay_probability};
                  {" "}mean release delay when delayed = {minutes(assumption.expected_release_delay_minutes_given_delay)}.
                  {" "}These uniform assumptions apply to predecessor departures and tow releases.
                  {" "}Incoming arrivals remain at scheduled times.
                </p>
              </> : <><Field label={{ children: "Tight below (minutes)", htmlFor: thresholdId }}>
                <Select id={thresholdId} value={String(evaluation.profile.threshold_minutes)}
                  onChange={(_, data) => setThreshold(Number(data.value))}>
                  {choices.map(value => <option key={value} value={value}>{value}</option>)}
                </Select>
              </Field>
              <Checkbox label="Show tight handovers on the chart" checked={showOverlay}
                onChange={(_, data) => setShowOverlay(data.checked === true)} /></>}
              <p>Whole prepared plan, independent of chart filters. Zero-minute gaps count; overlaps are conflicts, not negative buffers.</p>
              <Table size="small" aria-label={isWaiting ? "Prepared plan waiting comparison" : "Prepared plan buffer comparison"}>
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
                Assigned populations differ. Metric values are descriptive; this is not a same-assigned-population improvement.
              </p>}
              {isWaiting && gateEvaluation.comparison.assessed_sets_differ && <p role="note">
                Assessed arrival sets differ. Waiting deltas are suppressed rather than treating missing estimates as zero.
              </p>}
              {isWaiting && gateEvaluation.comparison.wait_delta_minutes !== null && <p>
                Tow options minus baseline: {minutes(gateEvaluation.comparison.wait_delta_minutes)} predicted waiting under the same synthetic assumptions.
              </p>}
              {!isWaiting && changes.buffer_delta && <p>
                Tow options minus baseline: minimum {minutes(changes.buffer_delta.minimum_minutes)},
                {" "}median {minutes(changes.buffer_delta.median_minutes)}, P10 {minutes(changes.buffer_delta.p10_minutes)},
                {" "}tight handovers {changes.buffer_delta.tight_count}.
              </p>}
              {current.buffers.availability === "invalid" && <p role="alert">
                Overlapping occupancy makes this assessment invalid. Summary values and the overlay are unavailable.
              </p>}
              {isWaiting ? <p>
                First-on-stand arrivals and arrivals without a complete predecessor handover are unassessed, not zero-wait predictions.
                {" "}Assigned context arrivals outside the horizon are counted separately.
                {" "}This covers assigned arrival stands, including remote stands, not only passenger gates.
                {currentWaiting.availability === "not-applicable" && " No arrivals can be assessed; N/A is not zero waiting."}
              </p> : current.buffers.availability === "not-applicable" && <p>No eligible handovers in this horizon. N/A is not a zero-minute buffer.</p>}
              <Field label={{ children: `${isWaiting ? "Inspect arrival handover" : "Inspect handover"} (${variant === "baseline" ? "Baseline" : "Tow options"})`, htmlFor: evidenceId }}>
                <Select id={evidenceId} value={isWaiting ? selectedWaiting?.handover.id ?? "" : selected?.id ?? ""}
                  onChange={(_, data) => setSelectedId(data.value)}>
                  <option value="">Choose a handover</option>
                  {isWaiting ? currentWaiting.contributions.map(item => <option key={item.handover.id} value={item.handover.id}>
                    {describeBuffer(item.handover, snapshot)}; wait {minutes(item.estimated_wait_minutes)}
                  </option>) : current.buffers.handovers.map(item => <option key={item.id} value={item.id}>{describeBuffer(item, snapshot)}</option>)}
                </Select>
              </Field>
              {isWaiting && selectedWaiting && <p role="status">
                {describeBuffer(selectedWaiting.handover, snapshot)}.
                {" "}Arrival {selectedWaiting.arrival_flight}; preceding {selectedWaiting.predecessor_release_kind} release.
                {" "}{selectedWaiting.release_delay_probability} * max(0, {selectedWaiting.conditional_release_delay_minutes}
                {" - "}{selectedWaiting.gap_minutes}) = {minutes(selectedWaiting.estimated_wait_minutes)} predicted waiting.
                {" "}Arrival {formatUtcWithDay(selectedWaiting.handover.end, snapshot.plan_window.start.slice(0, 10))} UTC.
                {" "}This is a synthetic point estimate, not a scheduled hold.
              </p>}
              {!isWaiting && selected && <p role="status">
                {describeBuffer(selected, snapshot)}.
                {" "}Release {formatUtcWithDay(selected.start, snapshot.plan_window.start.slice(0, 10))};
                {" "}next start {formatUtcWithDay(selected.end, snapshot.plan_window.start.slice(0, 10))} UTC.
                {" "}{selected.tight ? "Below" : "At or above"} the {evaluation.profile.threshold_minutes}-minute review threshold.
              </p>}
              {isWaiting ? <p>
                Metric {gateEvaluation.metric.id} v{gateEvaluation.metric.version}; predicted, scoring-only.
                {" "}Profile {gateEvaluation.profile.id}; model {gateEvaluation.profile.model_id} v{gateEvaluation.profile.model_version};
                {" "}assumption {assumption.id}; source synthetic.
                {" "}Blue arrival dots are estimate markers, not duration bars.
                {" "}This is not a calibrated forecast, delay propagation, a taxi/queue simulation, observed savings or intentional hold optimization.
              </p> : <p>
                Metric {evaluation.metric.id} v{evaluation.metric.version}; derived, scoring-only.
                {" "}Profile {evaluation.profile.id}; threshold {evaluation.profile.threshold_minutes} min.
                {" "}P10 uses nearest rank; median averages the middle pair. No handovers are inferred at horizon edges.
                {" "}Same-visit returns are excluded. This is not predicted resilience or usable capacity.
              </p>}
            </DialogContent>
            <DialogActions><Button appearance="primary" onClick={() => setOpen(false)}>Close</Button></DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
