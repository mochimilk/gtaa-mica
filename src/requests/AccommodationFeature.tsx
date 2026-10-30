import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { Button, Field, Select } from "@fluentui/react-components";
import type { OperationsDataset } from "../operations/dataset";
import { useAccommodationSession } from "../operations/useAccommodationSession";
import { parseBufferProfile, parseGateWaitProfile } from "../overlays/profiles";
import { accommodationImpact, accommodationOptionLabel, parseAccommodation } from "../overlays/accommodation";
import { AccommodationMeasures } from "../overlays/AccommodationMeasures";
import { useRequests } from "./RequestContext";
import { buildRequestDecision, requestTurn } from "./requestDecision";
import { RequestOption, TurnCard } from "./RequestOption";

type DatasetProps = { dataset: OperationsDataset };
function useAccommodationState(dataset: OperationsDataset) {
  const { accepted } = useAccommodationSession();
  const profiles = dataset.overlays?.profiles;
  const evidence = useMemo(() => parseAccommodation(profiles?.accommodation), [profiles]);
  const buffers = useMemo(() => profiles && Object.hasOwn(profiles, "buffers") ? parseBufferProfile(profiles.buffers) : null, [profiles]);
  const waiting = useMemo(() => profiles && Object.hasOwn(profiles, "gate-wait") ? parseGateWaitProfile(profiles["gate-wait"]) : null, [profiles]);
  const [selectedId, setSelectedId] = useState<string | null>(accepted?.optionId ?? null);
  const [page, setPage] = useState(() => accepted ? Math.floor(Math.max(0,
    evidence.variants[dataset.preparedPlan!.variant].options.findIndex(option => option.id === accepted.optionId),
  ) / evidence.profile.max_displayed_options) : 0);
  const [assumptionId, setAssumptionId] = useState(accepted?.assumptionId ?? waiting?.default_assumption_id ?? "");
  const assumption = waiting?.assumptions.find(item => item.id === assumptionId) ?? null;
  if (waiting && !assumption) throw new Error("Unknown accommodation waiting assumption.");
  const impact = useMemo(() => selectedId ? accommodationImpact(dataset, evidence, selectedId, buffers, assumption) : null,
    [dataset, evidence, selectedId, buffers, assumption]);
  return {
    evidence, buffers, waiting, assumption, assumptionId, page, setPage, selectedId, impact,
    select: (id: string | null) => {
      if (id !== null && !evidence.variants[dataset.preparedPlan!.variant].options.some(option => option.id === id)) {
        throw new Error("Unknown request option.");
      }
      setSelectedId(id);
    },
    selectAssumption: (id: string) => {
      if (!waiting?.assumptions.some(item => item.id === id)) throw new Error("Unknown request waiting assumption.");
      setAssumptionId(id);
    },
  };
}
const AccommodationContext = createContext<ReturnType<typeof useAccommodationState> | null>(null);
export function useAccommodationReviewState() {
  return useContext(AccommodationContext);
}
export function AccommodationProvider({ dataset, children }: PropsWithChildren<DatasetProps>) {
  const state = useAccommodationState(dataset);
  return <AccommodationContext.Provider value={state}>{children}</AccommodationContext.Provider>;
}

export function AccommodationReview({ dataset }: DatasetProps) {
  const state = useAccommodationReviewState();
  const { accepted } = useAccommodationSession();
  const { decide } = useRequests();
  if (!state || !dataset.preparedPlan) throw new Error("Accommodation requires its source provider and prepared plan.");
  const { evidence, buffers, waiting, assumption, impact, selectedId, page } = state;
  const result = evidence.variants[dataset.preparedPlan.variant], pageSize = evidence.profile.max_displayed_options;
  const offset = page * pageSize, pages = Math.ceil(result.options.length / pageSize);
  const decision = useMemo(() => selectedId ? buildRequestDecision(dataset, evidence, selectedId) : null, [dataset, evidence, selectedId]);
  const acceptedOption = accepted && result.options.find(option => option.id === accepted.optionId);
  const label = (id: string) => {
    const row = dataset.timeline.rows.find(item => item.id === id);
    if (!row) throw new Error(`Unknown request stand: ${id}`);
    return row.label;
  };
  const optionLabel = (option: typeof result.options[number]) => option.moves.length
    ? option.moves.map(move => {
      const stay = dataset.timeline.occupancies.find(stay => stay.id === move.stay_id)!;
      const visit = dataset.timeline.visits.find(visit => visit.id === stay.visitId)!;
      return `Reassign ${visit.label}: ${label(move.from_stand_id)} → ${label(move.to_stand_id)} (${move.to_stand_contact ? "contact" : "non-contact"}); incoming → ${label(option.target_stand_id)}`;
    }).join("; ")
    : `Assign incoming turn to ${label(option.target_stand_id)} (${option.target_stand_contact ? "contact" : "non-contact"}); no reassignment`;
  return <div className="request-review">
    {accepted && acceptedOption && <section data-accommodation-active="" className="request-applied" aria-label="Applied accommodation">
      <strong>Request applied: {accommodationOptionLabel(dataset, acceptedOption)}</strong>
      <Button onClick={() => decide({ type: "restore" })}>Undo accommodation</Button>
      <p>Buffers and synthetic waiting reflect the amended board. Capacity, Atlas and tow-window analyses need fresh evidence.</p>
    </section>}
    <h3>Incoming turn</h3>
    <TurnCard turn={requestTurn(evidence)} label="Incoming service request" />
    <p className="request-note">Late request · all times UTC · new service, not existing unassigned demand.</p>
    <h3>Select an option</h3>
    {result.status === "no-acceptable-option-found" ? <p role="status">
      No direct fit or one-turn reassignment found. Broader replanning may still be possible.
    </p> : <>
      <p className="request-note">{result.total_options_found} feasible alternatives, not a ranking. Select one to compare its timing and gaps.</p>
      <div className="timeline-accommodation-choices">
        {result.options.slice(offset, offset + pageSize).map(option => <Button key={option.id}
          data-accommodation-option={option.id} appearance={selectedId === option.id ? "primary" : "secondary"}
          aria-pressed={selectedId === option.id} onClick={() => state.select(option.id)}>
          {optionLabel(option)}
        </Button>)}
      </div>
      {pages > 1 && <div className="timeline-accommodation-pagination">
        <Button disabled={page === 0} onClick={() => state.setPage(page - 1)}>Previous options</Button>
        <span>Page {page + 1} of {pages}</span>
        <Button disabled={page + 1 >= pages} onClick={() => state.setPage(page + 1)}>Next options</Button>
      </div>}
    </>}
    {decision && impact ? <>
      <RequestOption key={selectedId} decision={decision} threshold={buffers?.threshold_minutes} />
      <div className="request-option-actions">
        <span>Stand assignments only; no retiming or added tows.</span>
        <Button appearance="primary" data-accommodation-accept=""
          disabled={!assumption || (accepted?.optionId === selectedId && accepted.assumptionId === state.assumptionId)}
          onClick={() => decide({ type: "accept", optionId: selectedId!, assumptionId: state.assumptionId })}>
          {accepted ? "Replace applied option" : "Apply option"}
        </Button>
        <Button onClick={() => state.select(null)}>Clear selection</Button>
      </div>
    </> : <p role="status">No option selected. {accepted ? "The applied option remains on the board." : "The board is unchanged."}</p>}
    <details className="request-details">
      <summary>More consequences and waiting assumptions</summary>
      {waiting ? <Field label="Synthetic waiting assumption">
        <Select value={state.assumptionId} onChange={(_, data) => state.selectAssumption(data.value)}>
          {waiting.assumptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </Select>
      </Field> : <p role="status">No waiting profile. Application is unavailable without a source-owned assumption.</p>}
      {assumption && <p>Illustrative waiting: {assumption.label}. Not a forecast or actual delay.</p>}
      {impact && <AccommodationMeasures {...impact} alternativeLabel="Selected option"
        caption="Original reference versus selected option; common existing arrivals compared like for like" />}
      <p>Every selection is independent of the current session choice. Replacement starts from the original reference;
        all existing unassigned demand, flight times and tow chains are retained.</p>
    </details>
    <details className="request-details">
      <summary>Checks and source evidence</summary>
      <p>Stand compatibility, airline, sector and bidirectional adjacency checked offline.
        Crews, shared gates, equipment, passenger handling and operational authorization are not certified.</p>
      <p>{result.blocked_stands.length} direct-placement conflicts; {result.excluded_stands.length} static exclusions.
        Search: {result.search}. Source profile: {evidence.profile.id}; evidence v{evidence.schema_version}.</p>
      <p>Synthetic reference approval: {evidence.approved_at}; request received: {evidence.received_at}.
        These are story assumptions, not an actual audit.</p>
      <p className="timeline-capacity-provenance">Request fingerprint: {result.request_fingerprint}</p>
    </details>
  </div>;
}
