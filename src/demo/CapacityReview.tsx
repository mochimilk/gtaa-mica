import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Input, Select, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, tokens,
} from "@fluentui/react-components";
import { useId, useMemo } from "react";
import { useTimeline, useTimelineRegion } from "../stand-timeline";
import { formatUtcWithDay } from "../stand-timeline-demo/demoData";
import type { PreparedScenario } from "./dataset";
import type { PlanVariant } from "./preferences";
import type { CapacityBlock, CapacityOpportunity, CapacityProbe, PreparedCapacity, evaluateCapacityQuery } from "./capacity-evaluation";
import { atlasFrequency, atlasRate, atlasSegments, type AtlasMode, type PreparedAtlas } from "./atlas-evaluation";

export interface CapacityReviewState {
  open: boolean;
  show: boolean;
  probeId: string;
  duration: string;
  start: string;
  end: string;
  selectedId: string;
  allProbes: boolean;
  mode: AtlasMode;
  selectedStart: number | null;
}
export function initialCapacityReview(snapshot?: PreparedScenario, capacity?: PreparedCapacity): CapacityReviewState {
  return {
    open: false, show: false, selectedId: "", allProbes: false, mode: "current", selectedStart: null,
    probeId: capacity?.profile.default_probe_id ?? "",
    duration: String(capacity?.profile.probes.find(probe => probe.id === capacity.profile.default_probe_id)?.default_duration_minutes ?? 75),
    start: snapshot?.plan_window.start.slice(0, -1) ?? "", end: snapshot?.plan_window.end.slice(0, -1) ?? "",
  };
}
type Query = ReturnType<typeof evaluateCapacityQuery>;
const rowLabel = (snapshot: PreparedScenario, id: string) => snapshot.rows.find(row => row.id === id)?.label ?? id;
const rangeLabel = (item: CapacityOpportunity, snapshot: PreparedScenario) =>
  `${rowLabel(snapshot, item.rowId)}: ${formatUtcWithDay(item.earliest, snapshot.plan_window.start.slice(0, 10))} to ${formatUtcWithDay(item.latest, snapshot.plan_window.start.slice(0, 10))}`;

export interface CapacityLayer {
  probe: CapacityProbe;
  duration: number;
  color: string;
  opportunities: CapacityOpportunity[];
}
export const capacityColor = (index: number) => [tokens.colorPaletteGreenForeground2, tokens.colorPalettePurpleForeground2, tokens.colorPaletteTealForeground2][index % 3];
export function CapacityOverlay({ layers, snapshot, atlas, variant, mode, onInspect }: {
  layers: CapacityLayer[];
  snapshot: PreparedScenario;
  atlas?: PreparedAtlas;
  variant: PlanVariant;
  mode: AtlasMode;
  onInspect: (id: string, probe: CapacityProbe, start: number) => void;
}) {
  const region = useTimelineRegion();
  const { scale, rows, rowHeight } = useTimeline();
  const origin = Date.parse(snapshot.plan_window.start);
  const evidence = useMemo(() => layers.map(layer => ({
    ...layer, items: layer.opportunities.map(item => ({
      item, segments: atlas && mode !== "current" ? atlasSegments(atlas, variant, layer.probe.id, item, layer.duration, origin) : [],
    })),
  })), [layers, atlas, mode, variant, origin]);
  if (region !== "plot") return null;
  return <g aria-label="Single-turn feasible arrival-start ranges">
    {evidence.flatMap(layer => layer.items.map(({ item, segments }) => {
      const rowIndex = rows.findIndex(row => row.id === item.rowId);
      if (rowIndex < 0 || item.earliest > scale.domain[1] || item.latest < scale.domain[0]) return null;
      const left = scale.x(Math.max(item.earliest, scale.domain[0])), right = scale.x(Math.min(item.latest, scale.domain[1]));
      const bands = layers.filter(other => other.opportunities.some(otherItem => otherItem.rowId === item.rowId));
      const lane = bands.findIndex(other => other.probe.id === layer.probe.id);
      const height = Math.min(10, (rowHeight - 6) / bands.length);
      const width = Math.max(4, right - left), x = left - (width - (right - left)) / 2;
      const y = rowIndex * rowHeight + (rowHeight - bands.length * height) / 2 + lane * height;
      const label = `${layer.probe.label}; ${layer.duration} min; ${rangeLabel(item, snapshot)} UTC; feasible arrival starts for one extra turn, not additive slots`;
      const visibleSegments = segments.filter(segment => segment.end > scale.domain[0] && segment.start <= scale.domain[1]);
      const narrowRate = visibleSegments.length ? atlasRate(visibleSegments[0].frequency, mode) : null;
      return <g key={item.id} className="st-bar" data-capacity-id={item.id} role="button" tabIndex={0}
        aria-label={`Inspect ${label}`} data-ops-keep-selection=""
        onClick={event => {
          event.stopPropagation();
          const value = event.target instanceof Element ? event.target.getAttribute("data-atlas-start") : null;
          onInspect(item.id, layer.probe, value === null ? Math.max(item.earliest, scale.domain[0]) : Number(value));
        }}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault(); event.stopPropagation(); onInspect(item.id, layer.probe, Math.max(item.earliest, scale.domain[0]));
          }
        }}>
        <title>{label}</title>
        <rect x={x} y={y} width={width} height={height} fill={layer.color}
          fillOpacity={mode === "current" ? 0.18 : right - left < 4 ? (narrowRate === null ? 0 : narrowRate * 0.8) : 0} />
        {right - left >= 4 && visibleSegments.map(segment => {
          const start = Math.max(segment.start, scale.domain[0]), end = Math.min(segment.end, scale.domain[1], item.latest);
          const rate = atlasRate(segment.frequency, mode);
          return <rect key={segment.start} data-atlas-start={start} data-atlas-rate={rate ?? "na"}
            x={scale.x(start)} y={y} width={Math.max(0, scale.x(end) - scale.x(start))} height={height}
            fill={layer.color} fillOpacity={rate === null ? 0 : rate * 0.8}>
            <title>{mode}: {rate === null ? "N/A; no planned opportunities" : `${Math.round(rate * 100)}%`}. Inspect this segment's first start for daily evidence.</title>
          </rect>;
        })}
        <rect x={x} y={y} width={width} height={height} fill="none" stroke={layer.color} pointerEvents="none" />
        <rect className="st-bar-outline" x={x - 2} y={y - 2} width={width + 4} height={height + 4} pointerEvents="none" />
      </g>;
    }))}
  </g>;
}

export function CapacityReview({ snapshot, capacity, atlas, variant, state, setState, query, layers }: {
  snapshot: PreparedScenario;
  capacity: PreparedCapacity;
  variant: PlanVariant;
  state: CapacityReviewState;
  setState: (value: CapacityReviewState) => void;
  query: Query;
  atlas?: PreparedAtlas;
  layers: CapacityLayer[];
}) {
  const triggerId = useId(), probeId = useId(), durationId = useId(), startId = useId(), endId = useId(), evidenceId = useId(), modeId = useId();
  const current = query.variants?.[variant];
  const selected = current?.opportunities.find(item => item.id === state.selectedId);
  const probe = capacity.profile.probes.find(item => item.id === state.probeId);
  if (!probe) throw new Error(`Unknown capacity review probe: ${state.probeId}`);
  const inspectedStart = selected ? Math.max(selected.earliest, Math.min(selected.latest, state.selectedStart ?? selected.earliest)) : null;
  const frequency = atlas && selected && inspectedStart !== null
    ? atlasFrequency(atlas, variant, probe.id, selected.rowId, inspectedStart - Date.parse(snapshot.plan_window.start), Number(state.duration)) : null;
  const describeBoundary = (block: CapacityBlock | null) => block
    ? `${block.assignment_ids.map(id => {
      const stay = snapshot.variants[variant].stays.find(stay => stay.id === id);
      const visit = snapshot.visits.find(visit => visit.turnId === stay?.visitId);
      return `${stay ? rowLabel(snapshot, stay.rowId) : id} ${visit ? `${visit.arrFlight}/${visit.depFlight}` : id}`;
    }).join(", ")}. Reasons: ${block.reasons.join(", ")}.${block.rule_paths.length ? ` Rules: ${block.rule_paths.join(", ")}.` : ""}`
    : "Prepared horizon boundary; no invented predecessor or successor.";
  const before = query.variants?.baseline, after = query.variants?.["tow-options"];
  const standCount = (items: CapacityOpportunity[]) => new Set(items.map(item => item.rowId)).size;
  const assigned = (plan: PlanVariant) => new Set(snapshot.variants[plan].stays.map(stay => stay.visitId)).size;
  return <>
    <Button id={triggerId} data-ops-keep-selection="" appearance={state.show ? "primary" : "secondary"}
      onClick={() => setState({ ...state, open: true, selectedId: "" })}>Capacity</Button>
    <Dialog open={state.open} onOpenChange={(_, data) => setState({ ...state, open: data.open })}
      surfaceMotion={{ onMotionFinish: () => {
        if (state.open) return;
        const marker = state.show && state.selectedId
          ? document.querySelector<SVGElement>(`[data-capacity-id="${CSS.escape(state.selectedId)}"]`) : null;
        (marker ?? document.getElementById(triggerId))?.focus({ preventScroll: true });
      } }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Accommodation opportunity atlas</DialogTitle>
          <DialogContent>
            <p>Where could one additional turn fit without moving the current assignments?
              Colored borders show feasible arrival starts, not occupancy or additive turn slots.
              Colors identify aircraft, airline permissions and sectors; intensity shows the selected evidence.</p>
            <Checkbox checked={state.allProbes} label="Show all prepared probes"
              onChange={(_, data) => setState({ ...state, allProbes: data.checked === true, duration: String(probe.default_duration_minutes), selectedId: "" })} />
            {state.allProbes && <p>Each probe uses its own default occupancy duration. Select a probe below to inspect its requirements.</p>}
            {state.allProbes && <p>{layers.map(layer => `${layer.probe.label}: ${layer.opportunities.length} current-plan start ranges`).join("; ")}.
              These are alternatives, not additive flights.</p>}
            <p>{capacity.profile.probes.map((item, index) => <span key={item.id} style={{ color: capacityColor(index) }}>
              {index ? " | " : ""}{item.label} ({item.default_duration_minutes} min)
            </span>)}</p>
            {atlas && <>
              <Field label={{ children: "Opportunity evidence", htmlFor: modeId }}>
                <Select id={modeId} value={state.mode} onChange={event => {
                  const next = event.target.value;
                  if (next !== "current" && next !== "planned" && next !== "end_of_day" && next !== "retention") throw new Error("Unknown atlas mode.");
                  setState({ ...state, mode: next });
                }}>
                  <option value="current">Current plan only</option>
                  <option value="planned">Synthetic month: planned</option>
                  <option value="end_of_day">Synthetic month: end-of-day</option>
                  <option value="retention">Synthetic month: retention</option>
                </Select>
              </Field>
              <p>Synthetic timing replays: {atlas.days[0].date} to {atlas.days.at(-1)?.date}, {atlas.days.length}/{atlas.profile.day_count} complete days.
                Same demand mix and stand assignments, shifted/stretched banks; not observed actuals or independently solved days.
                Times align relative to the {capacity.plan_window.start.slice(11, 16)} UTC horizon start, not local clock time.</p>
              <p>Planned/end-of-day intensity = days accommodating this exact start and duration / assessed days.
                Retention = days still accommodating it at modeled end-of-day / days accommodating it as planned.
                Zero planned days means N/A, not 0%. Darker means higher recurrence, not a probability or proof of additional demand accommodation.</p>
            </>}
            <Field label={{ children: "Prepared capacity probe", htmlFor: probeId }}>
              <Select id={probeId} value={state.probeId} onChange={event => {
                const next = capacity.profile.probes.find(item => item.id === event.target.value);
                if (!next) throw new Error("Unknown prepared capacity probe.");
                setState({ ...state, probeId: next.id, duration: String(next.default_duration_minutes), selectedId: "" });
              }}>{capacity.profile.probes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
            </Field>
            <Field label={{ children: "Required occupancy (minutes)", htmlFor: durationId }}>
              <Input id={durationId} disabled={state.allProbes} type="number" min={1} max={1440} step={1} value={state.duration}
                onChange={(_, data) => setState({ ...state, duration: data.value, selectedId: "" })} />
            </Field>
            <Field label={{ children: "Search start (UTC)", htmlFor: startId }}>
              <Input id={startId} type="datetime-local" value={state.start}
                min={capacity.plan_window.start.slice(0, -1)} max={capacity.plan_window.end.slice(0, -1)}
                onChange={(_, data) => setState({ ...state, start: data.value, selectedId: "" })} />
            </Field>
            <Field label={{ children: "Search end (UTC)", htmlFor: endId }}>
              <Input id={endId} type="datetime-local" value={state.end}
                min={capacity.plan_window.start.slice(0, -1)} max={capacity.plan_window.end.slice(0, -1)}
                onChange={(_, data) => setState({ ...state, end: data.value, selectedId: "" })} />
            </Field>
            <p>{probe.operating_airline_id}; {probe.aircraft_id}; {probe.arrival_sector_id} to {probe.departure_sector_id}.
              {" "}{probe.separation_minutes} extra minutes of same-stand separation at each end.
              This is a review assumption, not the tight-buffer threshold or a historical delay prediction.</p>
            <Checkbox label="Show feasible arrival-start ranges on the chart" checked={state.show}
              onChange={(_, data) => setState({ ...state, show: data.checked === true })} />
            {query.error && <p role="alert">{query.error}</p>}
            {before && after && <>
              <Table size="small" aria-label="Prepared plan capacity comparison">
                <TableHeader><TableRow><TableHeaderCell>Measurement</TableHeaderCell><TableHeaderCell>Baseline</TableHeaderCell><TableHeaderCell>Tow options</TableHeaderCell></TableRow></TableHeader>
                <TableBody>{[
                  ["Assigned visits", assigned("baseline"), assigned("tow-options")],
                  ["Static-compatible stands", before.eligible_stands, after.eligible_stands],
                  ["Stands with a feasible start", standCount(before.opportunities), standCount(after.opportunities)],
                  ["Arrival-start ranges (not slots)", before.opportunities.length, after.opportunities.length],
                ].map(([label, a, b]) => <TableRow key={label}><TableCell>{label}</TableCell><TableCell>{a}</TableCell><TableCell>{b}</TableCell></TableRow>)}</TableBody>
              </Table>
              <p role="note">Alternatives are assessed individually against each fixed plan. They can conflict with each other.
                Do not sum ranges into flights, utilization or airport-wide capacity.
                {assigned("baseline") !== assigned("tow-options") && " Assigned visit populations differ; raw capacity counts are not a same-coverage improvement."}</p>
              <Field label={{ children: `Inspect arrival-start range (${variant === "baseline" ? "Baseline" : "Tow options"})`, htmlFor: evidenceId }}>
                <Select id={evidenceId} value={selected?.id ?? ""} onChange={event => setState({ ...state, selectedId: event.target.value, selectedStart: null })}>
                  <option value="">Select a range</option>
                  {current?.opportunities.map(item => <option key={item.id} value={item.id}>{rangeLabel(item, snapshot)}</option>)}
                </Select>
              </Field>
              {current?.opportunities.length === 0 && <p role="status">No feasible arrival starts for this probe, duration and window.</p>}
              {selected && <div role="status">
                <p>{rangeLabel(selected, snapshot)} UTC, both endpoints included.
                  {" "}Last possible release: {formatUtcWithDay(selected.latest + Number(state.duration) * 60_000, snapshot.plan_window.start.slice(0, 10))} UTC.
                  An exact-fit range has one start instant.</p>
                <p>Preceding blocking interval: {describeBoundary(selected.before)}</p>
                <p>Following blocking interval: {describeBoundary(selected.after)}</p>
                {frequency && inspectedStart !== null && <>
                  <p>Inspected arrival start: {new Date(inspectedStart).toISOString()}; occupancy {state.duration} minutes.
                    {" "}This is one exact start, not an aggregate over the range.</p>
                  <p>Planned recurrence: {frequency.planned_days}/{frequency.assessed_days} ({Math.round(frequency.planned_rate * 100)}%).
                    {" "}Modeled end-of-day recurrence: {frequency.end_of_day_days}/{frequency.assessed_days} ({Math.round(frequency.end_of_day_rate * 100)}%).
                    {" "}Retention: {frequency.retained_days}/{frequency.planned_days} ({frequency.retention_rate === null ? "N/A; no planned opportunities" : `${Math.round(frequency.retention_rate * 100)}%`}).
                    {" "}Newly available at end-of-day: {frequency.end_of_day_days - frequency.retained_days} days; not counted as retained.</p>
                  <Table size="small" aria-label="Synthetic daily opportunity evidence">
                    <TableHeader><TableRow><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Planned</TableHeaderCell><TableHeaderCell>Modeled end-of-day</TableHeaderCell></TableRow></TableHeader>
                    <TableBody>{frequency.days.map(day => <TableRow key={day.date}>
                      <TableCell>{day.date}</TableCell><TableCell>{day.planned ? "Available" : "Unavailable"}</TableCell>
                      <TableCell>{day.end_of_day ? "Available" : "Unavailable"}</TableCell>
                    </TableRow>)}</TableBody>
                  </Table>
                </>}
              </div>}
              <p>Static exclusions: {current?.excluded_stands.map(row => `${rowLabel(snapshot, row.stand_id)} (${row.reasons.join(", ")})`).join("; ") || "none"}.</p>
            </>}
            <p>Whole-plan evidence is independent of chart flight filters. Current static and occupancy-triggered stand rules only.
              Shared gates, staffing, passenger handling and tow travel are not validated. No opening-hours calendar is modeled.
              Assignments and solver objectives are unchanged.</p>
            <p>Metric {capacity.metric_id} v{capacity.metric_version}; profile {capacity.profile.id}.
              Prepared horizon: {capacity.plan_window.start} to {capacity.plan_window.end}.
              Source and rule fingerprints are retained in the prepared evidence.</p>
          </DialogContent>
          <DialogActions><Button appearance="primary" onClick={() => setState({ ...state, open: false })}>Close</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  </>;
}
