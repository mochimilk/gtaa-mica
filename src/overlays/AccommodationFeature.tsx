import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { Button, Field, Select } from "@fluentui/react-components";
import type { OperationsDataset } from "../operations/dataset";
import { parseBufferProfile, parseGateWaitProfile } from "./profiles";
import { accommodationImpact, accommodationOptionLabel, parseAccommodation } from "./accommodation";

type DatasetProps = { dataset: OperationsDataset };
function useAccommodationState(dataset: OperationsDataset) {
  const profiles = dataset.overlays?.profiles;
  const evidence = useMemo(() => parseAccommodation(profiles?.accommodation), [profiles]);
  const buffers = useMemo(() => profiles && Object.hasOwn(profiles, "buffers") ? parseBufferProfile(profiles.buffers) : null, [profiles]);
  const waiting = useMemo(() => profiles && Object.hasOwn(profiles, "gate-wait") ? parseGateWaitProfile(profiles["gate-wait"]) : null, [profiles]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [assumptionId, setAssumptionId] = useState(waiting?.default_assumption_id ?? "");
  const assumption = waiting?.assumptions.find(item => item.id === assumptionId) ?? null;
  if (waiting && !assumption) throw new Error("Unknown accommodation waiting assumption.");
  const impact = useMemo(() => selectedId ? accommodationImpact(dataset, evidence, selectedId, buffers, assumption) : null,
    [dataset, evidence, selectedId, buffers, assumption]);
  return {
    evidence, buffers, waiting, assumption, assumptionId, page, setPage, selectedId, impact,
    select: (id: string | null) => {
      if (id !== null && !evidence.variants[dataset.preparedPlan!.variant].options.some(option => option.id === id)) {
        throw new Error("Unknown accommodation preview option.");
      }
      setSelectedId(id);
    },
    selectAssumption: (id: string) => {
      if (!waiting?.assumptions.some(item => item.id === id)) throw new Error("Unknown accommodation waiting assumption.");
      setAssumptionId(id);
    },
  };
}
const AccommodationContext = createContext<ReturnType<typeof useAccommodationState> | null>(null);
export function AccommodationProvider({ dataset, children }: PropsWithChildren<DatasetProps>) {
  const state = useAccommodationState(dataset);
  return <AccommodationContext.Provider value={state}>{children}</AccommodationContext.Provider>;
}

export function AccommodationReview({ dataset }: DatasetProps) {
  const state = useContext(AccommodationContext);
  if (!state || !dataset.preparedPlan) throw new Error("Accommodation review requires its source provider and prepared plan.");
  const { evidence, buffers, waiting, assumption, impact, selectedId, page } = state;
  const { request } = evidence, result = evidence.variants[dataset.preparedPlan.variant];
  const pageSize = evidence.profile.max_displayed_options;
  const pages = Math.ceil(result.options.length / pageSize), offset = page * pageSize;
  const row = (id: string) => {
    const stand = dataset.timeline.rows.find(row => row.id === id);
    if (!stand) throw new Error(`Unknown accommodation stand: ${id}`);
    return stand.label;
  };
  const flightPair = (id: string) => {
    const stay = dataset.timeline.occupancies.find(stay => stay.id === id);
    const visit = dataset.timeline.visits.find(visit => visit.id === stay?.visitId);
    if (!visit) throw new Error("Unknown accommodation affected visit.");
    return visit.label;
  };
  const number = (value: number | null | undefined) => value === null || value === undefined ? "Not assessed" : Number(value.toFixed(2)).toString();
  const assigned = new Set(dataset.timeline.occupancies.map(stay => stay.visitId)).size;
  const assignedLegs = dataset.flights.filter(flight => !!flight.occupancyId).length;
  return <>
    <p>Current plan: {dataset.preparedPlan.variant === "baseline" ? "Baseline" : "Tow options"}.
      Read-only decision preview; nothing is accepted or applied.</p>
    <p><strong>{request.visit.arrFlight}/{request.visit.depFlight}</strong>: {request.visit.origin} via this airport to {request.visit.destination}.
      {" "}{request.probe.operating_airline_id}, {request.probe.aircraft_id},
      {" "}{request.probe.arrival_sector_id} arrival / {request.probe.departure_sector_id} departure.
      {" "}{request.start} to {request.end} ({(Date.parse(request.end) - Date.parse(request.start)) / 60_000} minutes).</p>
    <p>Synthetic story: reference deemed approved at {evidence.approved_at}; request received at {evidence.received_at}.
      These are authored assumptions, not an actual approval audit. This is new service, not one of the
      {" "}{dataset.noStandStays.length} existing unassigned visits.</p>
    <p>Every alternative retains all {assigned} existing assigned visits and {assignedLegs} assigned flight legs,
      every flight time and all existing unassigned demand. At most one complete, single-stay turn is reassigned
      in its entirety before arrival. This is not a mid-stay tow; no added movements are scheduled.
      Existing tow chains and boundary-context stays are protected.</p>
    <p>Search: {result.search === "direct-placement" ? "Direct fits found; repairs were not needed or searched."
      : "No direct fit; searched one-whole-turn stand reassignments."}
      {" "}Baseline: {evidence.variants.baseline.total_options_found} alternatives;
      tow options: {evidence.variants["tow-options"].total_options_found}.
      Only the current plan's alternatives are offered. Ordering is deterministic, not a financial, resilience or passenger-experience ranking.</p>
    {result.status === "no-acceptable-option-found" ? <p role="status">
      No acceptable option found within the direct/one-turn search. This is not proof of infeasibility.
      Wider repair, separately approved retiming or replanning is outside this review.
    </p> : <>
      <p>Showing alternatives {offset + 1}-{Math.min(offset + pageSize, result.options.length)} of {result.total_options_found}.</p>
      <div className="timeline-accommodation-choices">
        {result.options.slice(offset, offset + pageSize).map(option => <Button key={option.id}
          data-accommodation-option={option.id} appearance={selectedId === option.id ? "primary" : "secondary"}
          aria-pressed={selectedId === option.id} onClick={() => state.select(option.id)}>
          Preview: {accommodationOptionLabel(dataset, option)}
        </Button>)}
      </div>
      {pages > 1 && <div className="timeline-accommodation-pagination">
        <Button disabled={page === 0} onClick={() => state.setPage(page - 1)}>Previous alternatives</Button>
        <span>Page {page + 1} of {pages}</span>
        <Button disabled={page + 1 >= pages} onClick={() => state.setPage(page + 1)}>Next alternatives</Button>
      </div>}
    </>}
    <details>
      <summary>Direct-placement constraints: {result.blocked_stands.length} blocked stands, {result.excluded_stands.length} static exclusions</summary>
      <table className="timeline-overlay-evidence">
        <caption>Constraints against the unchanged reference, before any hypothetical repair</caption>
        <thead><tr><th>Stand</th><th>Assignments</th><th>Reasons and rules</th></tr></thead>
        <tbody>
          {result.blocked_stands.map(item => <tr key={item.stand_id}>
            <td>{row(item.stand_id)}</td><td>{item.blocking_stay_ids.map(flightPair).join(", ")}</td>
            <td>{item.reasons.join(", ")}{item.rule_paths.length ? ` (${item.rule_paths.join(", ")})` : ""}</td>
          </tr>)}
          {result.excluded_stands.map(item => <tr key={item.stand_id}>
            <td>{row(item.stand_id)}</td><td>Static exclusion</td><td>{item.reasons.join(", ")}</td>
          </tr>)}
        </tbody>
      </table>
    </details>
    {waiting ? <Field label="Synthetic waiting assumption">
      <Select value={state.assumptionId} onChange={(_, data) => state.selectAssumption(data.value)}>
        {waiting.assumptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </Select>
    </Field> : <p>Waiting is not assessed: this source has no synthetic waiting profile.</p>}
    {assumption && <p>Illustrative model: {assumption.release_delay_probability} release-delay probability;
      {" "}{assumption.expected_release_delay_minutes_given_delay} minutes conditional delay. This is not a forecast or actual delay.</p>}
    {buffers ? <p>Tight scheduled buffer: strictly below {buffers.threshold_minutes} minutes, from {buffers.id}.</p>
      : <p>Tight-buffer counts are not assessed: this source has no buffer profile.</p>}
    {impact ? <section data-accommodation-preview="" aria-label="Hypothetical accommodation consequences">
      <h3>Preview only: incoming stand {row(impact.preview.option.target_stand_id)}</h3>
      {impact.preview.option.moves.length ? impact.preview.option.moves.map(move => <p key={move.stay_id}>
        {flightPair(move.stay_id)}: {row(move.from_stand_id)} to {row(move.to_stand_id)}
        {" "}({move.to_stand_contact ? "contact" : "non-contact"}); same arrival and departure times.
      </p>) : <p>Direct placement; no existing assignment changes.</p>}
      <p>Two incoming legs are represented only in this hypothetical comparison. The chart and flight lists still show
        the unchanged reference; {dataset.noStandStays.length} existing unassigned visits remain unassigned.</p>
      <table className="timeline-overlay-evidence">
        <caption>Reference versus independent preview; scheduled gaps and illustrative waiting, not operational performance</caption>
        <thead><tr><th>Measure</th><th>Reference</th><th>Preview</th></tr></thead>
        <tbody>
          <tr><th>Scheduled stand handovers</th><td>{impact.beforeBuffers.handovers}</td><td>{impact.afterBuffers.handovers}</td></tr>
          <tr><th>Tight handovers</th><td>{number(impact.beforeBuffers.tight)}</td><td>{number(impact.afterBuffers.tight)}</td></tr>
          <tr><th>Minimum scheduled buffer (minutes)</th><td>{number(impact.beforeBuffers.minimum)}</td><td>{number(impact.afterBuffers.minimum)}</td></tr>
          <tr><th>Assessed assigned arrivals</th><td>{number(impact.beforeWaiting?.assessed)}</td><td>{number(impact.afterWaiting?.assessed)}</td></tr>
          <tr><th>Unassessed assigned arrivals</th><td>{number(impact.beforeWaiting?.unassessed)}</td><td>{number(impact.afterWaiting?.unassessed)}</td></tr>
          <tr><th>Waiting for common existing arrivals (minutes)</th><td>{number(impact.beforeCommonMinutes)}</td><td>{number(impact.afterCommonMinutes)}</td></tr>
          <tr><th>Incoming illustrative waiting (minutes)</th><td>Not in reference</td><td>{number(impact.incomingMinutes)}</td></tr>
        </tbody>
      </table>
      <p>{impact.commonArrivals} existing arrivals are assessed in both views; the common-population waiting row compares
        only those arrivals. A missing modeled predecessor is not zero risk or zero delay.
        No capacity or tow-window evidence is reused as current evidence for a preview.</p>
      <Button onClick={() => state.select(null)}>Clear preview</Button>
    </section> : <p role="status">No alternative selected. Preview an option to inspect its consequences; nothing will be applied.</p>}
    <p>Stand compatibility, airline, sector and bidirectional adjacency rules were checked offline for each complete alternative.
      Options are independent, not a jointly applicable plan. No solver runs here and no acceptance, retiming or allocation edit is available.
      Routes, crews, equipment, shared-gate resources and operational authorization are not certified.</p>
    <p>Source profile: {evidence.profile.id}; synthetic evidence v{evidence.schema_version}.
      Exact snapshot, airport, scenario, demand, horizon, both requests and source probe verified on load.</p>
    <p className="timeline-capacity-provenance">Request fingerprint: {result.request_fingerprint}</p>
  </>;
}
