import { Field, Input, Select } from "@fluentui/react-components";
import type { PlanVariant } from "../data-sources/preparedTypes";
import type { CapacityOpportunity } from "./capacity";
import { ATLAS_MODES, atlasRate, inspectAtlas, type AtlasInspection, type AtlasMode, type PreparedAtlas } from "./atlas";

export function CapacityAtlasReview({ atlas, variant, probeId, duration, opportunities, mode, inspection, onInspect, labels }: {
  atlas: PreparedAtlas; variant: PlanVariant; probeId: string; duration: number;
  opportunities: readonly CapacityOpportunity[]; mode: Exclude<AtlasMode, "current">;
  inspection: AtlasInspection | null; onInspect: (value: AtlasInspection) => void; labels: ReadonlyMap<string, string>;
}) {
  const result = inspectAtlas(atlas, variant, probeId, duration, opportunities, inspection);
  const frequency = result.frequency;
  const percent = (rate: number | null) => rate === null ? "Not assessed (zero planned days)" : `${(rate * 100).toFixed(1)}%`;
  return <section data-capacity-atlas-review="" aria-label="Synthetic capacity recurrence">
    <h3>{ATLAS_MODES[mode]}</h3>
    <p>{atlas.days.length} deterministic synthetic timing replays of the same assigned day, labeled
      {" "}{atlas.days[0].date} through {atlas.days.at(-1)!.date}. Dates label experiments, not historical operations.
      Uniform timing shifts and scales preserve assignments; unassigned demand stays unassigned.
      The plotted times remain relative to this reference horizon, not the replay calendar dates.</p>
    <p>Only current-plan feasible arrival starts are colored. This is not a map of all opportunities found in the replays.
      Darker green means a higher fraction; a dashed band means retention is not assessed because no replay planned that opportunity.
      Measured zero remains a visible band. Frequency is not a forecast, calibrated probability or guaranteed bookable capacity.</p>
    {result.selected ? <div className="timeline-capacity-controls">
      <Field label="Inspect current feasible range">
        <Select data-atlas-band="" value={result.selected.id} onChange={(_, data) => {
          const item = opportunities.find(item => item.id === data.value);
          if (!item) throw new Error("Unknown Atlas inspection range.");
          onInspect({ bandId: item.id, start: new Date(item.earliest).toISOString().slice(0, -1) });
        }}>
          {opportunities.map(item => <option key={item.id} value={item.id}>
            {labels.get(item.rowId)}: {new Date(item.earliest).toISOString()} to {new Date(item.latest).toISOString()}
          </option>)}
        </Select>
      </Field>
      <Field label="Inspect arrival start (UTC)">
        <Input data-atlas-start="" type="datetime-local" step="0.001" value={result.start}
          onChange={(_, data) => onInspect({ bandId: result.selected!.id, start: data.value })} />
      </Field>
    </div> : null}
    {result.error && <p role="alert">{result.error}</p>}
    {frequency && <>
      <p data-atlas-rate="">Selected measure: {percent(atlasRate(frequency, mode))}.
        Planned: {frequency.planned_days}/{frequency.assessed_days} ({percent(frequency.planned_rate)});
        modeled end-of-day: {frequency.end_of_day_days}/{frequency.assessed_days} ({percent(frequency.end_of_day_rate)});
        retained: {frequency.retained_days}/{frequency.planned_days} ({percent(frequency.retention_rate)}).</p>
      <p>Retention counts the same start and duration fitting both phases, divided only by days where it fit the planned phase.
        No planned fits means an unknown retention rate, not zero.</p>
      <details><summary>Per-replay evidence for this exact arrival start</summary>
        <table className="timeline-overlay-evidence">
          <caption>Independent timing experiments, not observed daily operations</caption>
          <thead><tr><th>Replay label</th><th>Planned fit</th><th>Modeled end-of-day fit</th><th>Retained</th></tr></thead>
          <tbody>{frequency.days.map(day => <tr key={day.date}>
            <th>{day.date}</th><td>{day.planned ? "Yes" : "No"}</td><td>{day.end_of_day ? "Yes" : "No"}</td>
            <td>{day.planned && day.end_of_day ? "Yes" : "No"}</td>
          </tr>)}</tbody>
        </table>
      </details>
    </>}
    <details className="timeline-capacity-provenance"><summary>Replay assumptions and provenance</summary>
      <p>Profile: {atlas.profile.id}; seed: {atlas.profile.seed}; schema v{atlas.schema_version}.
        Metric: {atlas.metric_id} v{atlas.metric_version}.</p>
      <p>Planned shift (minutes): {atlas.profile.planned_shift_minutes.join(" to ")};
        planned scale (basis points): {atlas.profile.planned_scale_basis_points.join(" to ")}.
        Modeled outcome shift: {atlas.profile.outcome_shift_minutes.join(" to ")};
        outcome scale: {atlas.profile.outcome_scale_basis_points.join(" to ")}.</p>
      <p>Capacity fingerprint: {atlas.capacity_fingerprint}</p>
      <p>Snapshot: {atlas.snapshot_fingerprint}. Both plan requests and all probe/stand assessments verified on load.
        No monthly demand, weather, staffing or operational calendar forecast is inferred.</p>
    </details>
  </section>;
}
