import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { Field, Input, Select } from "@fluentui/react-components";
import type { OperationsDataset } from "../operations/dataset";
import type { PlanVariant } from "../data-sources/preparedTypes";
import { useTimeline, useTimelineRegion } from "../stand-timeline";
import { formatUtcWithDay } from "../stand-timeline-demo/demoData";
import { evaluateCapacityQuery, parseCapacitySnapshot, type CapacityBlock, type CapacityOpportunity, type PreparedCapacity } from "./capacity";
import { ATLAS_MODES, atlasRate, atlasSegments, isAtlasMode, parseAtlas,
  type AtlasFrequencySummary, type AtlasInspection, type AtlasMode, type PreparedAtlas } from "./atlas";
import { CapacityAtlasReview } from "./CapacityAtlasReview";

type DatasetProps = { dataset: OperationsDataset };
interface CapacityOptions {
  probeId: string;
  duration: string;
  start: string;
  end: string;
  mode: AtlasMode;
}
interface CapacityContextValue {
  capacity: PreparedCapacity;
  variant: PlanVariant;
  options: CapacityOptions;
  update: (changes: Partial<CapacityOptions>) => void;
  query: ReturnType<typeof evaluateCapacityQuery>;
  atlas: PreparedAtlas | null;
  bands: { id: string; item: CapacityOpportunity;
    earliest: number; latest: number; frequency: AtlasFrequencySummary | null }[];
  inspection: AtlasInspection | null;
  inspect: (value: AtlasInspection) => void;
}
const CapacityContext = createContext<CapacityContextValue | null>(null);
function useCapacity() {
  const value = useContext(CapacityContext);
  if (!value) throw new Error("Capacity controls require their feature provider.");
  return value;
}

export function CapacityProvider({ dataset, children }: PropsWithChildren<DatasetProps>) {
  const capacity = useMemo(() => parseCapacitySnapshot(dataset.overlays?.profiles.capacity), [dataset.overlays]);
  const atlas = useMemo(() => {
    const data = dataset.overlays?.companions;
    return data && Object.hasOwn(data, "capacity-atlas") ? parseAtlas(data["capacity-atlas"]) : null;
  }, [dataset.overlays]);
  const plan = dataset.preparedPlan;
  if (!plan) throw new Error("Capacity requires a source-owned prepared plan.");
  const [options, setOptions] = useState<CapacityOptions>(() => {
    const probe = capacity.profile.probes.find(item => item.id === capacity.profile.default_probe_id);
    if (!probe) throw new Error("Unknown default capacity probe.");
    return {
      probeId: probe.id, duration: String(probe.default_duration_minutes),
      start: capacity.plan_window.start.slice(0, -1), end: capacity.plan_window.end.slice(0, -1),
      mode: "current",
    };
  });
  const query = useMemo(() => evaluateCapacityQuery(capacity, options.probeId, options.duration, options.start, options.end),
    [capacity, options]);
  const [inspection, inspect] = useState<AtlasInspection | null>(null);
  const bands = useMemo<CapacityContextValue["bands"]>(() => {
    const items = query.variants?.[plan.variant].opportunities ?? [];
    if (options.mode === "current") return items.map(item => ({
      id: item.id, item, earliest: item.earliest, latest: item.latest, frequency: null,
    }));
    if (!atlas) throw new Error("Atlas frequency modes are unavailable for this source.");
    return items.flatMap(item => atlasSegments(atlas, plan.variant, options.probeId, item, Number(options.duration),
      Date.parse(capacity.plan_window.start)).map((segment, index) => ({
        id: `${item.id}:${index}`, item, earliest: segment.start, latest: segment.end - 1, frequency: segment.frequency,
      })));
  }, [query, plan.variant, options.mode, options.probeId, options.duration, atlas, capacity.plan_window.start]);
  return <CapacityContext.Provider value={{
    capacity, atlas, bands, variant: plan.variant, options, query, inspection, inspect,
    update: changes => {
      if (changes.mode !== undefined && (!isAtlasMode(changes.mode) || (changes.mode !== "current" && !atlas))) {
        throw new Error("Unknown or unavailable capacity view mode.");
      }
      if (["probeId", "duration", "start", "end"].some(key => Object.hasOwn(changes, key))) inspect(null);
      setOptions(current => ({ ...current, ...changes }));
    },
  }}>{children}</CapacityContext.Provider>;
}

export function CapacityLayer({ dataset, isMatch }: DatasetProps & { isMatch?: (stayId: string) => boolean }) {
  const region = useTimelineRegion();
  const { rows, section, rowHeight, scale } = useTimeline();
  const { capacity, options, query, bands } = useCapacity();
  if (region !== "plot" || section !== "body" || !query.variants) return null;
  const rowIndex = new Map(rows.map((row, index) => [row.id, index]));
  const probe = capacity.profile.probes.find(item => item.id === options.probeId);
  return (
    <g className="timeline-overlays timeline-overlays--capacity" pointerEvents="none" aria-label={`${ATLAS_MODES[options.mode]} on current feasible arrival starts`}>
      {bands.map(band => {
        const { item } = band;
        const index = rowIndex.get(item.rowId);
        if (index === undefined || band.latest < scale.domain[0] || band.earliest > scale.domain[1]) return null;
        const left = Math.max(0, scale.x(Math.max(band.earliest, scale.domain[0])));
        const right = Math.min(scale.width, scale.x(Math.min(band.latest + (band.frequency ? 1 : 0), scale.domain[1])));
        const marker = !band.frequency || item.earliest === item.latest;
        const x = Math.max(0, Math.min(left, scale.width - (marker ? 4 : 0)));
        const width = Math.min(scale.width - x, Math.max(marker ? 4 : 0, right - left));
        if (width <= 0) return null;
        const boundaries = [item.before, item.after].flatMap(block => block?.assignment_ids ?? []);
        const matches = !isMatch || !boundaries.length || boundaries.some(isMatch);
        const stand = dataset.timeline.rows.find(row => row.id === item.rowId)?.label ?? item.rowId;
        const rate = band.frequency && options.mode !== "current" ? atlasRate(band.frequency, options.mode) : null;
        const frequencyLabel = band.frequency ? ` ${ATLAS_MODES[options.mode]}: ${rate === null ? "Not assessed; zero planned days" : `${(rate * 100).toFixed(1)}%`}.
          Planned ${band.frequency.planned_days}/${band.frequency.assessed_days}; modeled end-of-day ${band.frequency.end_of_day_days}/${band.frequency.assessed_days};
          retained ${band.frequency.retained_days}/${band.frequency.planned_days}.` : "";
        const label = `${stand}; ${probe?.label}; ${options.duration} minutes; feasible arrival starts ${formatUtcWithDay(band.earliest)} to ${formatUtcWithDay(band.latest)} UTC. One extra turn only, not additive capacity.${frequencyLabel}`;
        return <rect key={band.id} data-timeline-overlay="capacity" data-capacity-id={item.id} data-atlas-mode={options.mode}
          x={x} y={index * rowHeight + rowHeight / 2 - 4} width={width} height={8} rx={2}
          style={band.frequency ? {
            fillOpacity: rate === null ? 0.12 : 0.1 + 0.8 * rate, strokeDasharray: rate === null ? "2 2" : undefined,
            strokeWidth: !marker && rate !== null ? 0 : undefined,
          } : undefined}
          opacity={matches ? 1 : 0.25} role="img" aria-label={label}><title>{label}</title></rect>;
      })}
    </g>
  );
}

export function CapacityReview({ dataset }: DatasetProps) {
  const { capacity, variant, options, query, update, atlas, inspection, inspect } = useCapacity();
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
        {atlas && <Field label="Capacity view">
          <Select data-capacity-mode="" value={options.mode} onChange={(_, data) => {
            if (!isAtlasMode(data.value)) throw new Error("Unknown capacity view mode.");
            update({ mode: data.value });
          }}>
            {Object.entries(ATLAS_MODES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
        </Field>}
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
      {!atlas && <p>Frequency modes are not assessed: this source has no matching Atlas evidence.</p>}
      {query.error ? <p role="alert">{query.error}</p> : result && query.variants && (
        <>
          <p>{result.opportunities.length} independent feasible start ranges across {new Set(result.opportunities.map(item => item.rowId)).size} stands.
            {" "}{result.eligible_stands} statically eligible stands; {result.excluded_stands.length} excluded.
            Zero ranges means no fit for this probe, duration and search window, not zero airport capacity.</p>
          <p>Same query, separate fixed plans: baseline {query.variants.baseline.opportunities.length} ranges;
            tow options {query.variants["tow-options"].opportunities.length} ranges.
            Only {selectedLabel} is drawn.</p>
          {atlas && options.mode !== "current" && <CapacityAtlasReview atlas={atlas} variant={variant}
            probeId={options.probeId} duration={Number(options.duration)} opportunities={result.opportunities}
            mode={options.mode} inspection={inspection} onInspect={inspect} labels={labels} />}
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
