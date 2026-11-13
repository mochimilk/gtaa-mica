import { createContext, useContext, useState, type PropsWithChildren } from "react";
import { Field, Select } from "@fluentui/react-components";
import type { OperationsDataset } from "../operations/dataset";
import { useTimeline, useTimelineRegion } from "../stand-timeline";
import { formatUtcWithDay } from "../stand-timeline-demo/demoData";
import { gateWaiting, standHandovers, type Handover } from "./handovers";
import { parseBufferProfile, parseGateWaitProfile } from "./profiles";

type DatasetProps = { dataset: OperationsDataset };
type LayerProps = DatasetProps & { isMatch?: (stayId: string) => boolean };

const BufferContext = createContext<{ threshold: number; setThreshold: (value: number) => void } | null>(null);
const WaitingContext = createContext<{ assumption: string; setAssumption: (value: string) => void } | null>(null);

function useBuffers() {
  const context = useContext(BufferContext);
  if (!context) throw new Error("Buffer controls require their feature provider.");
  return context;
}

function useWaiting() {
  const context = useContext(WaitingContext);
  if (!context) throw new Error("Waiting controls require their feature provider.");
  return context;
}

export function BufferProvider({ dataset, children }: PropsWithChildren<DatasetProps>) {
  const profile = parseBufferProfile(dataset.overlays?.profiles.buffers);
  const [threshold, setThreshold] = useState(profile.threshold_minutes);
  return <BufferContext.Provider value={{ threshold, setThreshold }}>{children}</BufferContext.Provider>;
}

export function WaitingProvider({ dataset, children }: PropsWithChildren<DatasetProps>) {
  const profile = parseGateWaitProfile(dataset.overlays?.profiles["gate-wait"]);
  const [assumption, setAssumption] = useState(profile.default_assumption_id);
  return <WaitingContext.Provider value={{ assumption, setAssumption }}>{children}</WaitingContext.Provider>;
}

function StandMarkers({ markers, kind, isMatch }: {
  markers: readonly { handover: Handover; start: number; end: number; label: string }[];
  kind: "buffers" | "gate-wait";
  isMatch?: (stayId: string) => boolean;
}) {
  const region = useTimelineRegion();
  const { rows, section, rowHeight, scale } = useTimeline();
  if (region !== "plot" || section !== "body") return null;
  const rowIndex = new Map(rows.map((row, position) => [row.id, position]));
  return (
    <g className={`timeline-overlays timeline-overlays--${kind}`} pointerEvents="none" aria-label={`${kind} annotations`}>
      {markers.map(marker => {
        const index = rowIndex.get(marker.handover.rowId);
        if (scale.x(marker.end) < 0 || scale.x(marker.start) >= scale.width) return null;
        const left = Math.max(0, scale.x(marker.start));
        const right = Math.min(scale.width, Math.max(scale.x(marker.end), left + 2));
        if (index === undefined || right <= left || left >= scale.width) return null;
        const matches = !isMatch || isMatch(marker.handover.previous.id) || isMatch(marker.handover.next.id);
        return (
          <rect key={marker.handover.id} data-timeline-overlay={kind}
            x={left} y={index * rowHeight + (kind === "buffers" ? 2 : rowHeight - 8)}
            width={right - left} height={6} rx={2} opacity={matches ? 1 : 0.25}
            role="img" aria-label={marker.label}>
            <title>{marker.label}</title>
          </rect>
        );
      })}
    </g>
  );
}

export function BufferLayer({ dataset, isMatch }: LayerProps) {
  const { threshold } = useBuffers();
  const result = standHandovers(dataset.timeline.occupancies, dataset.domain);
  const labels = new Map(dataset.timeline.rows.map(row => [row.id, row.label]));
  return <StandMarkers kind="buffers" isMatch={isMatch} markers={result.availability === "invalid" ? [] :
    result.handovers.filter(item => item.minutes < threshold).map(handover => ({
      handover, start: handover.start, end: handover.end,
      label: `${labels.get(handover.rowId)}: ${handover.minutes.toFixed(1)} minute scheduled buffer, below ${threshold} minutes`,
    }))} />;
}

export function WaitingLayer({ dataset, isMatch }: LayerProps) {
  const profile = parseGateWaitProfile(dataset.overlays?.profiles["gate-wait"]);
  const { assumption } = useWaiting();
  const selected = profile.assumptions.find(item => item.id === assumption);
  if (!selected) throw new Error("Selected waiting assumption is unavailable.");
  const result = gateWaiting(dataset, selected);
  return <StandMarkers kind="gate-wait" isMatch={isMatch} markers={result.contributions.filter(item => item.minutes > 0).map(item => ({
    handover: item.handover, start: item.handover.end, end: item.handover.end + item.minutes * 60_000,
    label: `${item.arrival.flight}: ${item.minutes.toFixed(1)} minutes illustrative waiting; ${selected.label}, not an actual delay`,
  }))} />;
}

function EvidenceTable({ dataset, items }: { dataset: OperationsDataset; items: readonly { handover: Handover; value: string }[] }) {
  const labels = new Map(dataset.timeline.rows.map(row => [row.id, row.label]));
  const visit = (id: string | undefined) => dataset.timeline.visits.find(item => item.id === id)?.label ?? id;
  return (
    <table className="timeline-overlay-evidence">
      <caption>Assigned stand handovers inside the plan window (UTC)</caption>
      <thead><tr><th>Stand</th><th>Previous visit</th><th>Next visit</th><th>Next start UTC</th><th>Minutes</th></tr></thead>
      <tbody>{items.map(({ handover, value }) => (
        <tr key={handover.id}>
          <td>{labels.get(handover.rowId)}</td><td>{visit(handover.previous.visitId)}</td>
          <td>{visit(handover.next.visitId)}</td><td>{formatUtcWithDay(handover.end)}</td><td>{value}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

export function BufferReview({ dataset }: DatasetProps) {
  const profile = parseBufferProfile(dataset.overlays?.profiles.buffers);
  const { threshold, setThreshold } = useBuffers();
  const result = standHandovers(dataset.timeline.occupancies, dataset.domain);
  const tight = result.handovers.filter(item => item.minutes < threshold);
  return (
    <>
      <p>Source profile: {profile.id}. Reporting only, not a stand safety rule or solver constraint.</p>
      <Field label="Highlight buffers shorter than (minutes)">
        <Select value={String(threshold)} onChange={(_, data) => setThreshold(Number(data.value))}>
          {[...new Set([0, 10, 20, 30, 60, 120, profile.threshold_minutes])].sort((a, b) => a - b).map(value =>
            <option key={value} value={value}>{value}{value === profile.threshold_minutes ? " (source profile)" : ""}</option>)}
        </Select>
      </Field>
      {result.availability === "invalid" ? <p role="alert">Overlapping assignments invalidate this analysis. No overlay evidence is displayed.</p> :
        <>
          <p>{result.handovers.length} complete handovers; {tight.length} below the selected threshold.
            No handover means unassessed, not evidence of sufficient separation.</p>
          <EvidenceTable dataset={dataset} items={tight.map(handover => ({ handover, value: handover.minutes.toFixed(1) }))} />
        </>}
    </>
  );
}

export function WaitingReview({ dataset }: DatasetProps) {
  const profile = parseGateWaitProfile(dataset.overlays?.profiles["gate-wait"]);
  const { assumption, setAssumption } = useWaiting();
  const selected = profile.assumptions.find(item => item.id === assumption);
  if (!selected) throw new Error("Selected waiting assumption is unavailable.");
  const result = gateWaiting(dataset, selected);
  return (
    <>
      <p>Source profile: {profile.id}. Model: {profile.model_id}, version {profile.model_version}.</p>
      <Field label="Illustrative release-delay assumption">
        <Select value={assumption} onChange={(_, data) => setAssumption(data.value)}>
          {profile.assumptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </Select>
      </Field>
      <p>Probability {selected.release_delay_probability}; conditional mean delay {selected.expected_release_delay_minutes_given_delay} minutes.
        Estimate = probability * max(0, conditional mean delay - scheduled gap).
        Not a measured delay, calibrated forecast or operational certification.</p>
      {result.availability === "invalid" ? <p role="alert">Overlapping assignments invalidate waiting estimates.</p> :
        <>
          <p>{result.assessed} assessed assigned arrivals; {result.unassessed} unassessed; {result.unassigned} unassigned;
            {" "}{result.context} assigned context arrivals outside the window.
            Total illustrative waiting: {result.totalMinutes === null ? "not applicable" : `${result.totalMinutes.toFixed(1)} minutes`}.</p>
          <EvidenceTable dataset={dataset} items={result.contributions.map(item => ({ handover: item.handover, value: item.minutes.toFixed(1) }))} />
        </>}
    </>
  );
}
