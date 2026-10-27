import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Select,
} from "@fluentui/react-components";
import { useDemo } from "./DemoContext";
import { buildDecisionBrief } from "./decision-brief";
import { DecisionMeasures } from "./DecisionMeasures";
import { DEFAULT_GATE_WAIT_PROFILE } from "./gate-wait-evaluation";
import { accommodationChoices } from "./accommodation-choices";

export interface AccommodationReviewRequest { optionId: string; assumptionId: string }

export function AccommodationReview({ onCompare, reviewRequest }: {
  onCompare: (request: AccommodationReviewRequest) => void;
  reviewRequest: AccommodationReviewRequest | null;
}) {
  const { approvedDataset, acceptedOptionId, acceptedAssumptionId, chooseAccommodation, loading, error } = useDemo();
  const prepared = approvedDataset.prepared;
  const [open, setOpen] = useState(false), [selectedId, setSelectedId] = useState(acceptedOptionId ?? "");
  const [approved, setApproved] = useState(false);
  const [assumptionId, setAssumptionId] = useState(acceptedAssumptionId ?? DEFAULT_GATE_WAIT_PROFILE.default_assumption_id);
  const assumptionIdLabel = useId();
  const pendingComparison = useRef<AccommodationReviewRequest | null>(null);
  const choices = useMemo(() => prepared?.accommodation
    ? accommodationChoices(prepared.snapshot, prepared.accommodation, prepared.variant, [acceptedOptionId, selectedId].flatMap(id => id ? [id] : [])) : [],
  [prepared, acceptedOptionId, selectedId]);
  useEffect(() => {
    if (reviewRequest) {
      setSelectedId(reviewRequest.optionId); setAssumptionId(reviewRequest.assumptionId);
      setApproved(false); setOpen(true);
    }
  }, [reviewRequest]);
  const assumption = DEFAULT_GATE_WAIT_PROFILE.assumptions.find(item => item.id === assumptionId);
  if (!assumption) throw new Error("Unknown accommodation waiting assumption.");
  const brief = useMemo(() => prepared?.accommodation && selectedId
    ? buildDecisionBrief(prepared.snapshot, prepared.variant, { kind: "accommodation", optionId: selectedId }, assumption.id, prepared.accommodation) : null,
  [prepared, selectedId, assumption]);
  if (!prepared?.accommodation) return null;
  const { snapshot, variant, accommodation: evidence } = prepared;
  const { request } = evidence, result = evidence.variants[variant], base = snapshot.variants[variant];
  const assigned = new Set(base.stays.map(stay => stay.visitId)).size;
  const row = (id: string) => snapshot.rows.find(item => item.id === id)?.label ?? id;
  const flightsFor = (id: string) => {
    const stay = base.stays.find(item => item.id === id);
    const visit = snapshot.visits.find(item => item.turnId === stay?.visitId);
    if (!stay || !visit) throw new Error(`Unknown accommodation source stay: ${id}`);
    return `${visit.arrFlight}/${visit.depFlight}`;
  };
  const close = () => { setOpen(false); setApproved(false); };
  return <>
    <Button id="accommodation-trigger" data-ops-keep-selection="" appearance={acceptedOptionId ? "primary" : "secondary"}
      onClick={() => { setOpen(true); setApproved(false); }}>Late request</Button>
    <Dialog open={open} onOpenChange={(_, data) => { setOpen(data.open); setApproved(false); }}
      surfaceMotion={{ onMotionFinish: () => {
        if (!open) {
          const pending = pendingComparison.current;
          pendingComparison.current = null;
          if (pending) onCompare(pending);
          else document.getElementById("accommodation-trigger")?.focus({ preventScroll: true });
        }
      } }}>
      <DialogSurface><DialogBody>
        <DialogTitle>Accommodate a late service request</DialogTitle>
        <DialogContent>
          <p>Keep the approved reference plan intact. Preview a direct placement or a bounded repair, then make an explicit session-only choice.</p>
          <p><strong>{request.visit.arrFlight}/{request.visit.depFlight}</strong>: {request.visit.origin} via the airport to {request.visit.destination}.
            {" "}{request.probe.operating_airline_id}, {request.probe.aircraft_id},
            {" "}{request.probe.arrival_sector_id} to {request.probe.departure_sector_id}.
            {" "}{request.start} to {request.end} ({(Date.parse(request.end) - Date.parse(request.start)) / 60_000} minutes).</p>
          <p>Synthetic story timeline: reference plan treated as approved at {evidence.approved_at}; airline service request received at {evidence.received_at}.
            This request arrived after approval. It is not one of the {snapshot.visits.length - assigned} existing unresolved visits.</p>
          <p role="status">{acceptedOptionId
            ? `A session accommodation is active; decision reviewed with ${DEFAULT_GATE_WAIT_PROFILE.assumptions.find(item => item.id === acceptedAssumptionId)?.label}. The original reference remains available; choices replace, rather than accumulate on, that reference.`
            : "Request pending assessment/decision. Previewing leaves the chart and approved reference unchanged."}</p>
          {error && <p role="alert">{error}</p>}
          <p>Protections: retain all {assigned} assigned visits and every existing flight time; no added tows.
            Repair may relocate at most one complete, single-stay turn.
            Existing tow chains and boundary-context stays are protected.
            Aircraft, airline, sector and adjacency permissions are never relaxed.</p>
          <p>Search: {result.search === "direct-placement" ? "Direct fit found; repairs were not needed or searched." : "No direct fit. Tested one-whole-turn stand relocations."}
            {" "}Showing {choices.length} representatives from all {result.total_options_found} rule-valid alternatives.
            Contact/non-contact strategies are represented first, followed by distinct reported measurements and affected turns.
            Equivalent cosmetic placements are not used to fill the list. An active choice is retained even if it is not a representative.
            This is not a resilience, passenger-experience or financial ranking.
            Offline rule evaluation; no live solver or broader replanning.</p>
          {result.status === "no-acceptable-option-found" && <p role="status">
            No acceptable option found within this search. This is not proof of infeasibility.
            A planner could investigate a wider repair, a separately approved airline retiming, or a new profile-based plan.
          </p>}
          {choices.map(({ option, label, equivalentCount }) => <div key={option.id}>
            <p>
            <Button appearance={option.id === selectedId ? "primary" : "secondary"} data-ops-keep-selection=""
              onClick={() => { setSelectedId(option.id); setApproved(false); }}>
              Preview: {label}
            </Button>
            </p>
            {equivalentCount > 0 && <p>{equivalentCount} other feasible alternatives have the same reported summary under both synthetic waiting assumptions.
              Stand location and coordination can still differ; no passenger or cost advantage has been measured.</p>}
          </div>)}
          <details>
            <summary>Direct-placement constraints: {result.blocked_stands.length} blocked stands, {result.excluded_stands.length} static exclusions</summary>
            {result.blocked_stands.map(item => <p key={item.stand_id}>
              Stand {row(item.stand_id)}: {item.blocking_stay_ids.map(flightsFor).join(", ")}.
              {" "}Reasons: {item.reasons.join(", ")}. {item.rule_paths.length ? `Rules: ${item.rule_paths.join(", ")}.` : ""}
            </p>)}
            {result.excluded_stands.map(item => <p key={item.stand_id}>Stand {row(item.stand_id)}: {item.reasons.join(", ")}.</p>)}
          </details>
          {brief?.option && <>
            <p>Proposed incoming stand: {row(brief.option.target_stand_id)}.
              {" "}{brief.option.moves.length === 0 ? "No existing assignment changes." : brief.option.moves.map(move =>
                `${flightsFor(move.stay_id)}: ${row(move.from_stand_id)} to ${row(move.to_stand_id)}, same flight times.`).join(" ")}</p>
            <Field label={{ children: "Synthetic waiting assumption", htmlFor: assumptionIdLabel }}>
              <Select id={assumptionIdLabel} value={assumptionId} onChange={event => {
                if (!DEFAULT_GATE_WAIT_PROFILE.assumptions.some(item => item.id === event.target.value)) throw new Error("Unknown accommodation waiting assumption.");
                setAssumptionId(event.target.value); setApproved(false);
              }}>{DEFAULT_GATE_WAIT_PROFILE.assumptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
            </Field>
            <DecisionMeasures brief={brief} label="Accommodation consequences" />
            <p><Button onClick={() => {
              pendingComparison.current = { optionId: selectedId, assumptionId }; close();
            }}>Open executive brief</Button></p>
            <p>Required coordination: approve adding the service{brief.option.moves.length ? " and reassigning the listed existing turn with airline/ground-handling coordination" : " with the airline and airport planning team"}.
              No flight retiming is proposed. Staffing, shared gates, passenger handling and tow resources are not certified.
              No price, revenue gain or overall resilience score is calculated.</p>
            <Checkbox checked={approved} label="I approve this session-only accommodation and the listed coordination."
              onChange={(_, data) => setApproved(data.checked === true)} />
            <p><Button appearance="primary" disabled={!approved || loading || selectedId === acceptedOptionId}
              onClick={() => { if (chooseAccommodation(selectedId, assumptionId)) close(); }}>
              {acceptedOptionId ? "Replace session choice" : "Accept accommodation"}
            </Button></p>
          </>}
          <p>Accepting updates the chart, flight lists and unassigned alerts together. The original reference is never overwritten.
            Approved-plan capacity/atlas, tow-window and chart-metric review controls are hidden for the session amendment because their evidence would be stale.
            Restore the reference to use those reviews. Acceptance resets selections/filters and is cleared by reload or dataset/plan switching.</p>
          <p>Evidence {evidence.profile.id}, schema {evidence.schema_version}; snapshot and source fingerprints verified.
            This is a prototype decision rehearsal, not operational authorization.</p>
        </DialogContent>
        <DialogActions>
          {acceptedOptionId && <Button disabled={loading} onClick={() => { if (chooseAccommodation(null)) close(); }}>Restore approved reference</Button>}
          <Button onClick={close}>Close</Button>
        </DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </>;
}
