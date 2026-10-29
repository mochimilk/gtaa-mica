import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { Field, Input, Select } from "@fluentui/react-components";
import type { OperationsDataset } from "../operations/dataset";
import type { PlanVariant } from "../data-sources/preparedTypes";
import { useTimeline, useTimelineRegion } from "../stand-timeline";
import { formatUtcWithDay } from "../stand-timeline-demo/demoData";
import { evaluateCapacityQuery, parseCapacitySnapshot, type CapacityBlock, type PreparedCapacity } from "./capacity";

type DatasetProps = { dataset: OperationsDataset };
interface CapacityOptions {
  probeId: string;
  duration: string;
  start: string;
  end: string;
}
interface CapacityContextValue {
  capacity: PreparedCapacity;
  variant: PlanVariant;
  options: CapacityOptions;
  update: (changes: Partial<CapacityOptions>) => void;
  query: ReturnType<typeof evaluateCapacityQuery>;
}
const CapacityContext = createContext<CapacityContextValue | null>(null);
function useCapacity() {
  const value = useContext(CapacityContext);
  if (!value) throw new Error("Capacity controls require their feature provider.");
  return value;
}

export function CapacityProvider({ dataset, children }: PropsWithChildren<DatasetProps>) {
  const capacity = useMemo(() => parseCapacitySnapshot(dataset.overlays?.profiles.capacity), [dataset.overlays]);
  const plan = dataset.preparedPlan;
  if (!plan) throw new Error("Capacity requires a source-owned prepared plan.");
  const [options, setOptions] = useState<CapacityOptions>(() => {
    const probe = capacity.profile.probes.find(item => item.id === capacity.profile.default_probe_id);
    if (!probe) throw new Error("Unknown default capacity probe.");
    return {
      probeId: probe.id, duration: String(probe.default_duration_minutes),
      start: capacity.plan_window.start.slice(0, -1), end: capacity.plan_window.end.slice(0, -1),
    };
  });
  const query = useMemo(() => evaluateCapacityQuery(capacity, options.probeId, options.duration, options.start, options.end),
    [capacity, options]);
  return <CapacityContext.Provider value={{
    capacity, variant: plan.variant, options, query, update: changes => setOptions(current => ({ ...current, ...changes })),
  }}>{children}</CapacityContext.Provider>;
}

export function CapacityLayer({ dataset, isMatch }: DatasetProps & { isMatch?: (stayId: string) => boolean }) {
  const region = useTimelineRegion();
  const { rows, section, rowHeight, scale } = useTimeline();
  const { capacity, variant, options, query } = useCapacity();
  if (region !== "plot" || section !== "body" || !query.variants) return null;
  const rowIndex = new Map(rows.map((row, index) => [row.id, index]));
  const probe = capacity.profile.probes.find(item => item.id === options.probeId);
  return (
    <g className="timeline-overlays timeline-overlays--capacity" pointerEvents="none" aria-label="Single-turn feasible arrival-start ranges">
      {query.variants[variant].opportunities.map(item => {
        const index = rowIndex.get(item.rowId);
        if (index === undefined || item.latest < scale.domain[0] || item.earliest > scale.domain[1]) return null;
        const left = Math.max(0, scale.x(Math.max(item.earliest, scale.domain[0])));
        const right = Math.min(scale.width, scale.x(Math.min(item.latest, scale.domain[1])));
        const x = Math.max(0, Math.min(left, scale.width - 4));
        const width = Math.min(scale.width - x, Math.max(4, right - left));
        if (width <= 0) return null;
        const boundaries = [item.before, item.after].flatMap(block => block?.assignment_ids ?? []);
        const matches = !isMatch || !boundaries.length || boundaries.some(isMatch);
        const stand = dataset.timeline.rows.find(row => row.id === item.rowId)?.label ?? item.rowId;
        const label = `${stand}; ${probe?.label}; ${options.duration} minutes; feasible arrival starts ${formatUtcWithDay(item.earliest)} to ${formatUtcWithDay(item.latest)} UTC. One extra turn only, not additive capacity.`;
        return <rect key={item.id} data-timeline-overlay="capacity" data-capacity-id={item.id}
          x={x} y={index * rowHeight + rowHeight / 2 - 4} width={width} height={8} rx={2}
          opacity={matches ? 1 : 0.25} role="img" aria-label={label}><title>{label}</title></rect>;
      })}
    </g>
  );
}

export function CapacityReview({ dataset }: DatasetProps) {
  const { capacity, variant, options, query, update } = useCapacity();
  const probe = capacity.profile.probes.find(item => item.id === options.probeId);
  if (!probe) throw new Error("Selected capacity probe is unavailable.");
  const result = query.variants?.[variant];
  const labels = new Map(dataset.timeline.rows.map(row => [row.id, row.label]));
  const boundary = (block: CapacityBlock | null) => block
    ? `${block.assignment_ids.join(", ")}: ${block.reasons.join(", ")}${block.rule_paths.length ? ` (${block.rule_paths.join(", ")})` : ""}`
    : "Plan-window boundary";
  const selectedLabel = variant === "baseline" ? "Baseline" : "Tow options";
  return (
    <>
      <p>Source profile: {capacity.profile.id}. Metric: {capacity.metric_id}, version {capacity.metric_version}.
        Current plan: {selectedLabel}.</p>
      <p className="timeline-capacity-provenance">Request fingerprint: {capacity.variants[variant].request_fingerprint}</p>
      <p>Each range tests one additional turn against the fixed assignments, stand compatibility and directional neighbor rules.
        Ranges are independent, not additive slots, a joint allocation, observed availability or operational certification.
        Unassigned demand remains unassigned. No movements are proposed.</p>
      <div className="timeline-capacity-controls">
        <Field label="Aircraft/operator/sector probe">
          <Select value={options.probeId} onChange={(_, data) => {
            const selected = capacity.profile.probes.find(item => item.id === data.value);
            if (!selected) throw new Error("Unknown capacity probe.");
            update({ probeId: selected.id, duration: String(selected.default_duration_minutes) });
          }}>
            {capacity.profile.probes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </Select>
        </Field>
        <Field label="Occupancy duration (minutes)">
          <Input type="number" min={1} max={1440} step={1} value={options.duration}
            onChange={(_, data) => update({ duration: data.value })} />
        </Field>
        <Field label="Search start (UTC)">
          <Input type="datetime-local" value={options.start} onChange={(_, data) => update({ start: data.value })} />
        </Field>
        <Field label="Search end (UTC)">
          <Input type="datetime-local" value={options.end} onChange={(_, data) => update({ end: data.value })} />
        </Field>
      </div>
      <p>Probe: {probe.aircraft_id}; {probe.operating_airline_id}; arrival {probe.arrival_sector_id};
        departure {probe.departure_sector_id}. Same-stand separation: {probe.separation_minutes} minutes.
        Bands show inclusive feasible arrival-start ranges, not the full free occupancy interval.
        A point marks an exact-duration fit.</p>
      {query.error ? <p role="alert">{query.error}</p> : result && query.variants && (
        <>
          <p>{result.opportunities.length} independent feasible start ranges across {new Set(result.opportunities.map(item => item.rowId)).size} stands.
            {" "}{result.eligible_stands} statically eligible stands; {result.excluded_stands.length} excluded.
            Zero ranges means no fit for this probe, duration and search window, not zero airport capacity.</p>
          <p>Same query, separate fixed plans: baseline {query.variants.baseline.opportunities.length} ranges;
            tow options {query.variants["tow-options"].opportunities.length} ranges.
            Only {selectedLabel} is drawn.</p>
          <table className="timeline-overlay-evidence">
            <caption>Feasible starts and blocking evidence for {selectedLabel} (UTC)</caption>
            <thead><tr><th>Stand</th><th>Earliest start</th><th>Latest start</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{result.opportunities.map(item => <tr key={item.id}>
              <td>{labels.get(item.rowId)}</td><td>{formatUtcWithDay(item.earliest)}</td><td>{formatUtcWithDay(item.latest)}</td>
              <td>{boundary(item.before)}</td><td>{boundary(item.after)}</td>
            </tr>)}</tbody>
          </table>
          {result.excluded_stands.length > 0 && <table className="timeline-overlay-evidence">
            <caption>Statically excluded stands for this probe</caption>
            <thead><tr><th>Stand</th><th>Reasons</th></tr></thead>
            <tbody>{result.excluded_stands.map(item => <tr key={item.stand_id}>
              <td>{labels.get(item.stand_id)}</td><td>{item.reasons.join(", ")}</td>
            </tr>)}</tbody>
          </table>}
        </>
      )}
    </>
  );
}
