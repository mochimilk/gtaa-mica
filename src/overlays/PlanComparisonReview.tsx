import { useMemo } from "react";
import type { OperationsDataset } from "../operations/dataset";
import { AccommodationMeasures } from "./AccommodationMeasures";
import { buildPlanComparison } from "./planComparison";

export function PlanComparisonReview({ dataset, assumptionId, referenceActive = true }: {
  dataset: OperationsDataset; assumptionId?: string; referenceActive?: boolean;
}) {
  const comparison = useMemo(() => buildPlanComparison(dataset, assumptionId), [dataset, assumptionId]);
  if (!comparison) return <p>Plan comparison is not assessed: this source has no matching prepared-plan companion.</p>;
  const { reference, alternative } = comparison;
  const label = (variant: typeof reference.variant) => variant === "baseline" ? "Baseline" : "Tow options";
  const beforeLabel = `${label(reference.variant)} (${referenceActive ? "active" : "approved"} reference)`, afterLabel = `${label(alternative.variant)} (comparison only)`;
  const rows: [string, number, number][] = [
    ["Source visits", reference.coverage.visits, alternative.coverage.visits],
    ["Assigned visits", reference.coverage.assignedVisits, alternative.coverage.assignedVisits],
    ["Unassigned visits", reference.coverage.unassignedVisits, alternative.coverage.unassignedVisits],
    ["Assigned flight legs", reference.coverage.assignedFlightLegs, alternative.coverage.assignedFlightLegs],
    ["Unassigned flight legs", reference.coverage.unassignedFlightLegs, alternative.coverage.unassignedFlightLegs],
    ["Flight legs outside the horizon", reference.coverage.contextFlightLegs, alternative.coverage.contextFlightLegs],
    ["Generated tow movements", reference.generatedMovements, alternative.generatedMovements],
  ];
  const standLabel = (id: string) => dataset.timeline.rows.find(row => row.id === id)?.label ?? id;
  const changes = comparison.changes;
  return <section data-plan-comparison="" aria-label="Read-only baseline-versus-tow comparison">
    <h3>Baseline versus tow options</h3>
    <p>{referenceActive ? `${beforeLabel} remains in the chart and flight lists.`
      : "The chart and lists show the session accommodation; both plans here are retained comparisons only."}
      {" "}{afterLabel} is inspected here only.
      Both are fixed prepared plans for the same demand and UTC horizon. This comparison does not apply or solve a plan.
      Accommodation decisions are independent of this comparison.</p>
    <table className="timeline-overlay-evidence" data-plan-comparison-coverage="">
      <caption>Same source demand; coverage and generated movements are not capacity guarantees</caption>
      <thead><tr><th>Measure</th><th>{beforeLabel}</th><th>{afterLabel}</th></tr></thead>
      <tbody>{rows.map(([name, before, after]) => <tr key={name}><th>{name}</th><td>{before}</td><td>{after}</td></tr>)}</tbody>
    </table>
    <p data-plan-comparison-consequences="">{comparison.retainedIds.length} previously assigned visits retained;
      {" "}{comparison.gainedIds.length} existing unassigned visits newly placed;
      {" "}{comparison.lostIds.length} previously assigned visits now unassigned;
      {" "}{comparison.changedIds.length} retained visits have changed assignments.
      Both plans retain the same source flight schedules; no new demand or retimed flights are introduced.</p>
    <AccommodationMeasures beforeBuffers={reference.buffers} afterBuffers={alternative.buffers}
      beforeWaiting={reference.waiting} afterWaiting={alternative.waiting}
      beforeCommonMinutes={comparison.beforeCommonMinutes} afterCommonMinutes={comparison.afterCommonMinutes}
      referenceLabel={beforeLabel} alternativeLabel={afterLabel}
      caption="Same buffer profile and synthetic waiting assumption for both fixed plans" />
    <p>{comparison.commonArrivals} arrivals have waiting contributions assessed in both plans.
      Waiting is compared only for that common population; an unassessed arrival is not zero waiting.
      {comparison.buffers ? ` Tight buffers are strictly below ${comparison.buffers.threshold_minutes} minutes.` : " Buffers are not assessed: no source profile."}
      {comparison.assumption ? ` Shared synthetic assumption: ${comparison.assumption.label}.` : " Waiting is not assessed: no source profile."}
      {" "}Scheduled buffers and illustrative waiting are not observed performance or a forecast.</p>
    {changes.length ? <details data-plan-comparison-changes=""><summary>Changed visits, assignments and exact UTC flight times</summary>
      {changes.map(change => <section key={change.visitId}>
        <h4>{change.kind === "newly-assigned" ? "Newly assigned" : change.kind === "now-unassigned" ? "Now unassigned" : "Changed assignment"}: {change.label}</h4>
        <ul>{change.flights.map(flight => <li key={flight.id}>
          {flight.direction}: {flight.label}, {flight.routeEnd}, {new Date(flight.estimate).toISOString()}
        </li>)}</ul>
        {([["Reference", change.beforeStays], ["Comparison", change.afterStays]] as const).map(([name, stays]) =>
          <section key={name}><h5>{name}</h5>{stays.length ? <ul>{stays.map(stay => <li key={stay.id}>
            {standLabel(stay.rowId)}: {stay.start} to {stay.end}; start: {stay.towIn ? "tow-in" : "arrival flight"};
            end: {stay.towOut ? "tow-out" : "departure flight"}
          </li>)}</ul> : <p>Unassigned; source flight times are retained.</p>}</section>)}
      </section>)}
    </details> : <p role="status">No visit assignment or tow-chain differences between these plans.</p>}
    <details className="timeline-capacity-provenance"><summary>Plan comparison provenance and boundaries</summary>
      <p>Airport: {comparison.airportId}; case: {comparison.caseId}; demand: {comparison.demandId}.
        UTC horizon: {comparison.horizon.map(time => new Date(time).toISOString()).join(" to ")}.</p>
      <p>Snapshot: {comparison.snapshotFingerprint}</p>
      <p>{beforeLabel}: request {reference.requestFingerprint}; solver status {reference.solverStatus}.</p>
      <p>{afterLabel}: request {alternative.requestFingerprint}; solver status {alternative.solverStatus}.</p>
      <p>Buffer profile: {comparison.buffers ? `${comparison.buffers.id} v${comparison.buffers.metric_version}` : "Not assessed"}.
        Waiting profile: {comparison.waiting ? `${comparison.waiting.id} v${comparison.waiting.metric_version}` : "Not assessed"};
        model: {comparison.waiting ? `${comparison.waiting.model_id} v${comparison.waiting.model_version}` : "Not assessed"}.</p>
      {comparison.assumption && <p>Shared assumption: {comparison.assumption.id};
        release-delay probability {comparison.assumption.release_delay_probability};
        conditional delay {comparison.assumption.expected_release_delay_minutes_given_delay} minutes.</p>}
      <p>Tow counts are generated movements, not proof of crew, tug, route or shared-gate feasibility.
        Capacity, Atlas and tow-window opportunities remain tied to the approved reference, not a session accommodation.
        No plan ranking, financial benefit or operational approval is inferred.</p>
    </details>
  </section>;
}
