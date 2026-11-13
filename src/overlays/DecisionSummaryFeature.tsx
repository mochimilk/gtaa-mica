import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { Field, Select } from "@fluentui/react-components";
import type { OperationsDataset } from "../operations/dataset";
import { useAccommodationSession } from "../operations/useAccommodationSession";
import { useAccommodationReviewState } from "../requests/AccommodationFeature";
import { AccommodationMeasures } from "./AccommodationMeasures";
import { buildDecisionSummary } from "./decisionSummary";
import { parseGateWaitProfile } from "./profiles";
import { PlanComparisonReview } from "./PlanComparisonReview";

type DatasetProps = { dataset: OperationsDataset };
const DecisionContext = createContext<{
  assumptionId: string | undefined; selectAssumption: (id: string) => void;
} | null>(null);

export function DecisionSummaryProvider({ dataset, children }: PropsWithChildren<DatasetProps>) {
  const profiles = dataset.overlays!.profiles;
  const waiting = Object.hasOwn(profiles, "gate-wait") ? parseGateWaitProfile(profiles["gate-wait"]) : null;
  const [assumptionId, setAssumptionId] = useState(waiting?.default_assumption_id);
  return <DecisionContext.Provider value={{ assumptionId, selectAssumption: id => {
    if (!waiting?.assumptions.some(item => item.id === id)) throw new Error("Unknown decision-review waiting assumption.");
    setAssumptionId(id);
  } }}>{children}</DecisionContext.Provider>;
}

export function DecisionSummaryReview({ dataset }: DatasetProps) {
  const { accepted } = useAccommodationSession();
  const state = useContext(DecisionContext), accommodation = useAccommodationReviewState();
  if (!state) throw new Error("Decision review requires its source provider.");
  if (Object.hasOwn(dataset.overlays!.profiles, "accommodation") && !accommodation) {
    throw new Error("Decision review requires the registered accommodation provider.");
  }
  const assumptionId = accommodation ? accommodation.waiting ? accommodation.assumptionId : undefined : state.assumptionId;
  const selectedId = accommodation?.selectedId ?? null;
  const summary = useMemo(() => buildDecisionSummary(dataset, { assumptionId, accommodationOptionId: selectedId }),
    [dataset, assumptionId, selectedId]);
  const { reference, preview } = summary;
  const format = (value: number | null | undefined) => value == null ? "Not assessed" : Number(value.toFixed(2)).toString();
  const utc = (value: number) => new Date(value).toISOString();
  return <div data-decision-summary="">
    <p>Selected reference: {summary.source.variant === "baseline" ? "Baseline" : "Tow options"}.
      {" "}UTC horizon: {summary.source.horizon.map(utc).join(" to ")}.
      {accepted ? " The chart and lists show the session accommodation; this summary retains the approved reference."
        : " The chart and flight lists retain this reference."}
      {" "}This is not a solver run, plan ranking or approval.</p>
    <PlanComparisonReview dataset={dataset} assumptionId={assumptionId} referenceActive={!accepted} />
    <h3>Reference coverage</h3>
    <table className="timeline-overlay-evidence" data-decision-coverage="">
      <caption>All source visits and flight legs, including context outside the horizon</caption>
      <thead><tr><th>Measure</th><th>Reference</th></tr></thead>
      <tbody>{([
        ["Assigned visits", `${reference.coverage.assignedVisits} of ${reference.coverage.visits}`],
        ["Existing unassigned visits", reference.coverage.unassignedVisits],
        ["Assigned flight legs", `${reference.coverage.assignedFlightLegs} of ${reference.coverage.flightLegs}`],
        ["Unassigned flight legs", reference.coverage.unassignedFlightLegs],
        ["Flight legs outside the horizon", reference.coverage.contextFlightLegs],
      ] as const).map(([label, value]) => <tr key={label}><th>{label}</th><td>{value}</td></tr>)}</tbody>
    </table>
    <h3>Reference buffers and synthetic waiting</h3>
    {summary.profiles.waiting && <Field label="Synthetic waiting assumption">
      <Select data-decision-assumption="" value={assumptionId} onChange={(_, data) =>
        (accommodation ? accommodation.selectAssumption : state.selectAssumption)(data.value)}>
        {summary.profiles.waiting.assumptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </Select>
    </Field>}
    {summary.assumption && <p>Illustrative model: {summary.assumption.release_delay_probability} release-delay probability,
      {" "}{summary.assumption.expected_release_delay_minutes_given_delay} minutes conditional delay.
      {accommodation && " This choice is shared with the late request."}
      {" "}The same assumption is used in the prepared-plan comparison. Chart-overlay options remain independent.
      These are synthetic estimates, not actual delay or a forecast.</p>}
    <table className="timeline-overlay-evidence" data-decision-measures="">
      <caption>Source-defined metrics; missing profiles and missing predecessors are not zero delay</caption>
      <thead><tr><th>Measure</th><th>Reference</th></tr></thead>
      <tbody>{([
        ["Scheduled stand handovers", reference.buffers?.handovers],
        ["Tight handovers", reference.buffers?.tight],
        ["Minimum scheduled buffer (minutes)", reference.buffers?.minimum],
        ["Assessed assigned arrivals", reference.waiting?.assessed],
        ["Unassessed assigned arrivals", reference.waiting?.unassessed],
        ["Unassigned arrivals in horizon", reference.waiting?.unassigned],
        ["Assigned context arrivals", reference.waiting?.context],
        ["Illustrative waiting across assessed arrivals (minutes)", reference.waiting?.totalMinutes],
      ] as const).map(([label, value]) => <tr key={label}><th>{label}</th><td>{format(value)}</td></tr>)}</tbody>
    </table>
    {summary.profiles.buffers
      ? <p>Tight buffers are strictly below the source threshold of {summary.profiles.buffers.threshold_minutes} minutes.</p>
      : <p>Buffer measures are not assessed: no source buffer profile.</p>}
    {!summary.profiles.waiting && <p>Waiting is not assessed: no source synthetic waiting profile.</p>}
    <h3>Reference-only capacity opportunities</h3>
    {reference.capacity ? <>
      <p>Full-horizon, source-default probe durations and separations, independent of chart filters and Capacity review controls.
        Each band offers arrival-start choices for one extra turn; bands, stands and probes are not additive bookable slots.</p>
      <table className="timeline-overlay-evidence" data-decision-capacity="">
        <caption>Independent single-turn queries against the unchanged reference</caption>
        <thead><tr><th>Probe</th><th>Duration / separation (minutes)</th><th>Stands with bands</th><th>Feasible-start bands</th><th>Static exclusions</th></tr></thead>
        <tbody>{reference.capacity.map(probe => <tr key={probe.id}>
          <th>{probe.label}</th><td>{probe.durationMinutes} / {probe.separationMinutes}</td>
          <td>{probe.stands}</td><td>{probe.bands}</td><td>{probe.excludedStands}</td>
        </tr>)}</tbody>
      </table>
    </> : <p>Not assessed: no source capacity evidence.</p>}
    <h3>Reference-only one-way tow opportunities</h3>
    {reference.tow ? <>
      <p>{reference.tow.visitsWithWindows} of {reference.tow.totalVisits} visits have destination-checked windows;
        {" "}{reference.tow.destinationChoices} destination choices. Choices may overlap: they are independent opportunities,
        not scheduled movements or a jointly feasible plan. Parking-and-return cycles, routes, crews and tugs are not assessed.</p>
      <details><summary>Tow assessment populations</summary>
        <table className="timeline-overlay-evidence"><thead><tr><th>Status</th><th>Visits</th></tr></thead>
          <tbody>{reference.tow.statuses.map(item => <tr key={item.id}><th>{item.label}</th><td>{item.count}</td></tr>)}</tbody>
        </table>
      </details>
    </> : <p>Not assessed: no source tow-window evidence.</p>}
    <h3>Separate accommodation comparison</h3>
    {summary.accommodation ? <>
      <p>{summary.accommodation.request.label}: {summary.accommodation.request.start} to {summary.accommodation.request.end}.
        {" "}{summary.accommodation.count} independent alternatives for the current plan; deterministic order, not a ranking.
        This is new service, not existing unassigned demand.</p>
      {summary.accommodation.status === "no-acceptable-option-found"
        ? <p role="status">No acceptable direct or one-turn repair option found. This bounded search does not prove infeasibility.</p>
        : <Field label="Request option comparison">
          <Select data-decision-accommodation="" value={selectedId ?? ""} onChange={(_, data) => {
            if (!accommodation) throw new Error("Accommodation preview selection is unavailable.");
            accommodation.select(data.value || null);
            if (data.value) {
              const index = summary.accommodation!.options.findIndex(option => option.id === data.value);
              accommodation.setPage(Math.floor(index / accommodation.evidence.profile.max_displayed_options));
            }
          }}>
            <option value="">No option comparison; keep active workspace</option>
            {summary.accommodation.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
        </Field>}
    </> : <p>Not assessed: no source accommodation evidence.</p>}
    {preview ? <section data-decision-preview="" aria-label="Separate hypothetical accommodation comparison">
      <h4>{preview.label}</h4>
      <p>{preview.addedVisits} new service; {preview.retainedVisits} previously assigned visits retained;
        {" "}{preview.lostVisits} lost; {preview.changedVisits} existing visits reassigned;
        {" "}{preview.newlyAssignedExistingVisits} existing unassigned visits newly placed;
        {" "}{preview.unresolvedOriginalVisits} original visits remain unassigned;
        {" "}{preview.retimedFlightIds.length} existing flight times changed. No added tows.
        Changing this preview does not accept or replace a session choice.
        Hypothetical totals: {preview.coverage.assignedVisits} of {preview.coverage.visits} visits assigned,
        {" "}{preview.coverage.assignedFlightLegs} of {preview.coverage.flightLegs} flight legs assigned.</p>
      <AccommodationMeasures beforeBuffers={reference.buffers} afterBuffers={preview.buffers}
        beforeWaiting={reference.waiting} afterWaiting={preview.waiting}
        beforeCommonMinutes={preview.beforeCommonMinutes} afterCommonMinutes={preview.afterCommonMinutes}
        incomingMinutes={preview.incomingMinutes} />
      <p>{preview.commonArrivals} existing arrivals are assessed in both views. Only that common population is compared;
        incoming waiting is separate. Reference capacity and tow opportunities above are not recalculated or reused for this preview.</p>
      <details><summary>Changed visits and exact UTC flight times</summary>
        {preview.changes.map(change => <section key={change.visitId}>
          <h5>{change.kind === "new-service" ? "New service" : "Whole-turn reassignment"}: {change.label}</h5>
          <p>Reference: {change.beforeStand ?? "Not in reference demand"}. Preview: {change.afterStand}.
            {" "}{utc(change.start)} to {utc(change.end)}.</p>
          <ul>{change.flights.map(flight => <li key={flight.id}>
            {flight.direction}: {flight.label}, {flight.routeEnd}, {utc(flight.estimate)}
          </li>)}</ul>
        </section>)}
      </details>
    </section> : <p role="status">No accommodation preview selected. The active workspace is unchanged.</p>}
    <h3>Human decision, not an overall score</h3>
    <p>Confirm airline and ground-handler coordination, shared gates, staffing, passenger handling and stand calendars.
      No financial benefit, universal capacity percentage or resilience score is inferred. Opportunities are independent,
      not a jointly executable plan. Apply, replace or undo an option from the Late request tab.</p>
    <details className="timeline-capacity-provenance"><summary>Source and model provenance</summary>
      <p>Airport: {summary.source.airportId}; case: {summary.source.caseId}; demand: {summary.source.demandId}.
        Summary: {summary.profile.id}, v{summary.profile.metric_version}.</p>
      <p>Request fingerprint: {summary.source.requestFingerprint}</p>
      <p>Snapshot fingerprint: {summary.source.snapshotFingerprint ?? "No prepared analysis sidecars"}</p>
      <p>Airport fingerprint: {summary.source.airportFingerprint ?? "Not available"};
        demand fingerprint: {summary.source.demandFingerprint ?? "Not available"}.</p>
      <p>Buffer profile: {summary.profiles.buffers?.id ?? "Unavailable"}.
        Waiting profile: {summary.profiles.waiting?.id ?? "Unavailable"};
        model: {summary.profiles.waiting ? `${summary.profiles.waiting.model_id} v${summary.profiles.waiting.model_version}` : "Unavailable"}.</p>
      {preview && <p>Bounded accommodation evidence: {preview.evidenceId}; independent option: {preview.optionId}.</p>}
    </details>
  </div>;
}
