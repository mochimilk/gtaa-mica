import { useId, useMemo, useState } from "react";
import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Select, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow,
} from "@fluentui/react-components";
import { useDemo } from "./DemoContext";
import { accommodationImpact } from "./accommodation-evaluation";
import { DEFAULT_GATE_WAIT_PROFILE } from "./gate-wait-evaluation";

const minutes = (value: number | null) => value === null ? "N/A" : `${Number(value.toFixed(2))} min`;

export function AccommodationReview() {
  const { approvedDataset, acceptedOptionId, acceptedAssumptionId, chooseAccommodation, loading, error } = useDemo();
  const prepared = approvedDataset.prepared;
  const [open, setOpen] = useState(false), [selectedId, setSelectedId] = useState(acceptedOptionId ?? "");
  const [approved, setApproved] = useState(false);
  const [assumptionId, setAssumptionId] = useState(acceptedAssumptionId ?? DEFAULT_GATE_WAIT_PROFILE.default_assumption_id);
  const assumptionIdLabel = useId();
  const assumption = DEFAULT_GATE_WAIT_PROFILE.assumptions.find(item => item.id === assumptionId);
  if (!assumption) throw new Error("Unknown accommodation waiting assumption.");
  const impact = useMemo(() => prepared?.accommodation && selectedId
    ? accommodationImpact(prepared.snapshot, prepared.accommodation, prepared.variant, selectedId, assumption) : null,
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
        if (!open) document.getElementById("accommodation-trigger")?.focus({ preventScroll: true });
      } }}>
      <DialogSurface><DialogBody>
        <DialogTitle>Accommodate a late service request</DialogTitle>
        <DialogContent>
          <p>Keep the approved reference plan intact. Preview a direct placement or a bounded repair, then make an explicit session-only choice.</p>
          <p><strong>{request.visit.arrFlight}/{request.visit.depFlight}</strong>: {request.visit.origin} to Contoso to {request.visit.destination}.
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
            {" "}Showing {result.options.length} of {result.total_options_found} found alternatives, ordered by stand/identity, not by a resilience or financial score.
            Offline rule evaluation; no live solver or broader replanning.</p>
          {result.status === "no-acceptable-option-found" && <p role="status">
            No acceptable option found within this search. This is not proof of infeasibility.
            A planner could investigate a wider repair, a separately approved airline retiming, or a new profile-based plan.
          </p>}
          {result.options.map((option, index) => <p key={option.id}>
            <Button appearance={option.id === selectedId ? "primary" : "secondary"} data-ops-keep-selection=""
              onClick={() => { setSelectedId(option.id); setApproved(false); }}>
              Preview option {index + 1}: stand {row(option.target_stand_id)} ({option.kind === "direct" ? "direct fit" : "one stand change"})
            </Button>
          </p>)}
          <details>
            <summary>Direct-placement constraints: {result.blocked_stands.length} blocked stands, {result.excluded_stands.length} static exclusions</summary>
            {result.blocked_stands.map(item => <p key={item.stand_id}>
              Stand {row(item.stand_id)}: {item.blocking_stay_ids.map(flightsFor).join(", ")}.
              {" "}Reasons: {item.reasons.join(", ")}. {item.rule_paths.length ? `Rules: ${item.rule_paths.join(", ")}.` : ""}
            </p>)}
            {result.excluded_stands.map(item => <p key={item.stand_id}>Stand {row(item.stand_id)}: {item.reasons.join(", ")}.</p>)}
          </details>
          {impact && <>
            <p>Proposed incoming stand: {row(impact.view.option.target_stand_id)}.
              {" "}{impact.view.option.moves.length === 0 ? "No existing assignment changes." : impact.view.option.moves.map(move =>
                `${flightsFor(move.stay_id)}: ${row(move.from_stand_id)} to ${row(move.to_stand_id)}, same flight times.`).join(" ")}</p>
            <Field label={{ children: "Synthetic waiting assumption", htmlFor: assumptionIdLabel }}>
              <Select id={assumptionIdLabel} value={assumptionId} onChange={event => {
                if (!DEFAULT_GATE_WAIT_PROFILE.assumptions.some(item => item.id === event.target.value)) throw new Error("Unknown accommodation waiting assumption.");
                setAssumptionId(event.target.value); setApproved(false);
              }}>{DEFAULT_GATE_WAIT_PROFILE.assumptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
            </Field>
            <Table size="small" aria-label="Accommodation consequences">
              <TableHeader><TableRow><TableHeaderCell>Measure</TableHeaderCell><TableHeaderCell>Approved reference</TableHeaderCell><TableHeaderCell>Proposed choice</TableHeaderCell></TableRow></TableHeader>
              <TableBody>{[
                ["Existing assigned visits retained", assigned, assigned],
                ["Late request assigned", 0, 1],
                ["Existing unresolved visits", snapshot.visits.length - assigned, snapshot.visits.length - assigned],
                ["Existing stand reassignments", 0, impact.view.option.moves.length],
                ["Existing flight times changed / added tows", "0 / 0", "0 / 0"],
                [`Tight handovers (<${impact.bufferProfile.threshold_minutes} min)`, impact.beforeBuffers.summary.tight_count, impact.afterBuffers.summary.tight_count],
                ["Minimum scheduled stand buffer", minutes(impact.beforeBuffers.summary.minimum_minutes), minutes(impact.afterBuffers.summary.minimum_minutes)],
                [`Synthetic waiting, ${impact.commonExistingArrivals} common assessed existing arrivals`, minutes(impact.beforeCommonWait), minutes(impact.afterCommonWait)],
                ["Assessed arrivals (including incoming in proposal)", impact.beforeWaiting.summary.assessed_arrivals, impact.afterWaiting.summary.assessed_arrivals],
                ["Unassessed arrivals (not zero waiting)", impact.beforeWaiting.summary.unassessed_arrivals, impact.afterWaiting.summary.unassessed_arrivals],
                ["Incoming arrival waiting estimate", "Not in reference", impact.incomingWait === null ? "Unassessed" : minutes(impact.incomingWait)],
              ].map(([label, before, after]) => <TableRow key={label}>
                <TableCell>{label}</TableCell><TableCell>{before}</TableCell><TableCell>{after}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
            <p>Buffer handover populations change when a turn is added. Waiting totals above compare only the same assessed existing arrivals;
              the incoming arrival is separate. N/A means no common assessed population or no buffer measurement, not zero risk.
              The {impact.bufferProfile.threshold_minutes}-minute buffer threshold is reporting-only, not a hard operating minimum or a resilience objective.</p>
            <p>Required coordination: approve adding the service{impact.view.option.moves.length ? " and reassigning the listed existing turn with airline/ground-handling coordination" : " with the airline and airport planning team"}.
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
            Approved-plan capacity/atlas and paired review controls are hidden for the session amendment because their evidence would be stale.
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
