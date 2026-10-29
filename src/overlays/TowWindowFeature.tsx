import { createContext, useContext, useId, useMemo, useState, type PropsWithChildren } from "react";
import { Checkbox, Field, Select } from "@fluentui/react-components";
import type { OperationsDataset } from "../operations/dataset";
import { useTimeline, useTimelineRegion } from "../stand-timeline";
import {
  evaluateTowWindows, parseTowWindows, towWindowSegments, TOW_STATUSES,
  type PreparedTowWindows, type TowAssessment,
} from "./towWindows";

type DatasetProps = { dataset: OperationsDataset };
const utc = (value: number) => new Date(value).toISOString();
interface TowContextValue {
  evidence: PreparedTowWindows;
  assessments: TowAssessment[];
  selectedId: string;
  select: (id: string) => void;
  onlySelected: boolean;
  setOnlySelected: (value: boolean) => void;
}
const TowContext = createContext<TowContextValue | null>(null);
function useTowWindows() {
  const value = useContext(TowContext);
  if (!value) throw new Error("Tow-window controls require their feature provider.");
  return value;
}

export function TowWindowProvider({ dataset, children }: PropsWithChildren<DatasetProps>) {
  const evidence = useMemo(() => parseTowWindows(dataset.overlays?.profiles["tow-windows"]), [dataset.overlays]);
  const assessments = useMemo(() => evaluateTowWindows(evidence, dataset), [evidence, dataset]);
  const [selectedId, setSelectedId] = useState(() => assessments.find(item => item.status === "available")?.id ?? assessments[0]?.id ?? "");
  const [onlySelected, setOnlySelected] = useState(false);
  return <TowContext.Provider value={{
    evidence, assessments, selectedId, onlySelected, setOnlySelected,
    select: id => {
      if (!assessments.some(item => item.id === id)) throw new Error("Unknown tow-window visit.");
      setSelectedId(id);
    },
  }}>{children}</TowContext.Provider>;
}

export function TowWindowLayer({ dataset, isMatch }: DatasetProps & { isMatch?: (stayId: string) => boolean }) {
  const region = useTimelineRegion(), { section, bars, scale } = useTimeline();
  const { assessments, selectedId, onlySelected } = useTowWindows();
  const patternId = useId();
  const segments = useMemo(() => towWindowSegments(assessments, dataset.domain), [assessments, dataset.domain]);
  if (region !== "plot" || section !== "body") return null;
  const byId = new Map(bars.map(bar => [bar.occupancy.id, bar]));
  return <g className="timeline-overlays timeline-overlays--tow-windows" pointerEvents="none"
    aria-label="Destination-checked one-way tow-start ranges">
    <defs>
      <pattern id={patternId} width={6} height={6} patternUnits="userSpaceOnUse">
        <path className="timeline-tow-hatch" d="M-1 1L1 -1M0 6L6 0M5 7L7 5" />
      </pattern>
    </defs>
    {segments.filter(segment => !onlySelected || segment.assessment.id === selectedId).map(segment => {
      const { assessment, earliest, latest } = segment;
      const bar = assessment.stayId ? byId.get(assessment.stayId) : undefined;
      if (!bar || latest < scale.domain[0] || earliest >= scale.domain[1]) return null;
      const left = Math.max(0, scale.x(Math.max(earliest, scale.domain[0])));
      const right = Math.min(scale.width, scale.x(Math.min(latest, scale.domain[1])));
      const x = Math.max(0, Math.min(left, scale.width - 2));
      const width = Math.min(scale.width - x, Math.max(2, right - left));
      if (width <= 0) return null;
      const y = bar.y + 2, height = Math.max(1, bar.height - 4);
      const label = `${assessment.label}: one-way tow may start ${utc(earliest)} to ${utc(latest)}. At least one destination is checked; no movement is scheduled.`;
      return <g key={segment.id} opacity={!isMatch || isMatch(bar.occupancy.id) ? 1 : 0.25} role="img" aria-label={label}>
        <title>{label}</title>
        <rect className="timeline-tow-background" x={x} y={y} width={width} height={height} />
        <rect data-timeline-overlay="tow-windows" data-source-stay-id={bar.occupancy.id}
          data-tow-visit-id={assessment.id} x={x} y={y} width={width} height={height} fill={`url(#${patternId})`}
          className="timeline-tow-band" />
      </g>;
    })}
  </g>;
}

export function TowWindowReview({ dataset }: DatasetProps) {
  const { evidence, assessments, selectedId, select, onlySelected, setOnlySelected } = useTowWindows();
  const plan = dataset.preparedPlan;
  if (!plan) throw new Error("Tow windows require a prepared plan.");
  const selected = assessments.find(item => item.id === selectedId);
  const labels = new Map(dataset.timeline.rows.map(row => [row.id, row.label]));
  const stay = dataset.timeline.occupancies.find(item => item.id === selected?.stayId);
  const variant = plan.variant === "baseline" ? "Baseline" : "Tow options";
  const time = utc;
  const assignment = (id: string) => {
    const item = dataset.timeline.occupancies.find(stay => stay.id === id);
    if (!item) throw new Error("Unknown tow-window blocking assignment.");
    return `${id} on ${labels.get(item.rowId)} until ${time(item.end)}`;
  };
  return <>
    <p>Current plan: {variant}. {assessments.filter(item => item.status === "available").length} of {assessments.length} visits
      have a destination-checked one-way window; {assessments.filter(item => item.status === "unassigned").length} remain unassigned.</p>
    <p>Each range tests one relocation independently against the unchanged rest of the plan.
      The destination must be compatible and available from tow arrival through departure.
      Opportunities are not a jointly feasible movement plan, added capacity or operational authorization.</p>
    <p>Same evidence, separate fixed plans: baseline {evidence.visits.filter(item => item.variants.baseline.destinations.length).length} visits
      with windows; tow options {evidence.visits.filter(item => item.variants["tow-options"].destinations.length).length}.
      Only {variant} is drawn.</p>
    <Field label="Visit assessment">
      <Select value={selectedId} onChange={(_, data) => select(data.value)}>
        {!assessments.length && <option value="">No visits in this source</option>}
        {assessments.map(item => <option key={item.id} value={item.id}>
          {item.label} - {TOW_STATUSES[item.status]}
        </option>)}
      </Select>
    </Field>
    <Checkbox label="Show selected visit only" checked={onlySelected}
      onChange={(_, data) => setOnlySelected(data.checked === true)} />
    <p>Hatched bands inside assigned stays show inclusive tow-start instants, not movement durations.
      Exact fits remain visible as points. Bands are clipped to the display horizon and dim with flight filters.
      Unassigned visits and existing movement chains are not offered as new relocations.</p>
    {selected && <>
      <h3>{selected.label}</h3>
      <p>{TOW_STATUSES[selected.status]}.</p>
      <p>Arrival handling: {selected.policy.arrival_handling_minutes} min.
        Departure handling: {selected.policy.departure_handling_minutes} min.
        Configured one-way travel: {evidence.default_tow_minutes} min.</p>
      {stay && <p>Current stand: {labels.get(stay.rowId)}. Arrival handling finishes
        {" "}{time(stay.start + selected.policy.arrival_handling_minutes * 60_000)}.
        Latest tow start before destination conflicts:
        {" "}{time(stay.end - (selected.policy.departure_handling_minutes + evidence.default_tow_minutes) * 60_000)}.
        Departure: {time(stay.end)}.</p>}
      {!!selected.destinations.length && <table className="timeline-overlay-evidence">
        <caption>Available departure destinations; all times UTC</caption>
        <thead><tr><th>Stand</th><th>Inclusive tow-start range</th><th>Destination constraints</th></tr></thead>
        <tbody>{selected.destinations.map(destination => <tr key={destination.stand_id}>
          <td>{labels.get(destination.stand_id)}</td>
          <td>{time(destination.earliest_start)} to {time(destination.latest_start)}</td>
          <td>{destination.blockers.length ? destination.blockers.map(blocker => <p key={blocker.assignment_id}>
            {assignment(blocker.assignment_id)}: {blocker.reasons.join(", ")}.
            {blocker.rule_paths.length ? ` Rules: ${blocker.rule_paths.join(", ")}.` : ""}
          </p>) : "No conflicting fixed assignment limits the handling-based start range."}
            <p>Occupied from tow arrival ({evidence.default_tow_minutes} min after the selected start) through departure.</p>
          </td>
        </tr>)}</tbody>
      </table>}
      {!!selected.exclusions.length && <details>
        <summary>Excluded destinations ({selected.exclusions.length})</summary>
        <table className="timeline-overlay-evidence">
          <caption>Static incompatibilities or assignments blocking the entire tow-start range</caption>
          <thead><tr><th>Stand</th><th>Reasons and rules</th><th>Blocking assignments</th></tr></thead>
          <tbody>{selected.exclusions.map(exclusion => <tr key={exclusion.stand_id}>
            <td>{labels.get(exclusion.stand_id)}</td>
            <td>{exclusion.reasons.join(", ")}{exclusion.rule_paths.length ? ` (${exclusion.rule_paths.join(", ")})` : ""}</td>
            <td>{exclusion.assignment_ids.length ? exclusion.assignment_ids.map(assignment).join("; ") : "Static exclusion"}</td>
          </tr>)}</tbody>
        </table>
      </details>}
    </>}
    <p>Earliest start is arrival plus arrival handling. Latest start is departure minus departure handling and one tow travel time.
      Destination conflicts can shorten or remove this range. Aircraft, airline, departure sector and directional adjacency rules are checked.
      These handling minima protect the tow decision; they do not impose a new minimum duration on ordinary turns.</p>
    <p>No solver is run, allocation changed or flight time moved. This analysis does not assess parking-and-return cycles,
      adjustments to existing tow chains, routes, crews, tugs or shared-gate resources.
      Missing boundaries are not invented or extended to horizon edges.</p>
    <p>{evidence.airport.name}; synthetic evidence v{evidence.schema_version}. Snapshot, case, demand, horizon and both request
      fingerprints verified on load.
      {Object.hasOwn(dataset.overlays?.profiles ?? {}, "capacity") &&
        " Airport and demand provenance agree with the source's capacity evidence."}</p>
    <p className="timeline-capacity-provenance">Request fingerprint: {evidence.variants[plan.variant].request_fingerprint}</p>
  </>;
}
