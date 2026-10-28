import { useId, useMemo, useRef, useState } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Select, makeStyles,
} from "@fluentui/react-components";
import { useOperations } from "../operations/OperationsContext";
import { formatUtcWithDay } from "../stand-timeline-demo/demoData";
import { AccommodationReview, type AccommodationReviewRequest } from "./AccommodationReview";
import { useDemo } from "./DemoContext";
import { DecisionMeasures } from "./DecisionMeasures";
import { buildDecisionBrief, type DecisionTarget } from "./decision-brief";
import { DEFAULT_GATE_WAIT_PROFILE } from "./gate-wait-evaluation";
import type { PreparedStay } from "./dataset";
import { accommodationChoices } from "./accommodation-choices";

const useStyles = makeStyles({
  surface: { width: "min(960px, calc(100vw - 48px))", maxWidth: "960px", overflowWrap: "anywhere" },
});
const variantLabel = (variant: "baseline" | "tow-options") => variant === "baseline" ? "Baseline" : "Tow options";

export function PlanDecisionReview() {
  const { approvedDataset, acceptedOptionId, acceptedAssumptionId } = useDemo();
  const { dataset, selectFlight, clearSelection } = useOperations();
  const prepared = approvedDataset.prepared;
  const otherVariant = prepared?.variant === "baseline" ? "tow-options" : "baseline";
  const [open, setOpen] = useState(false);
  const [choiceId, setChoiceId] = useState(acceptedOptionId ? `late:${acceptedOptionId}` : `variant:${otherVariant}`);
  const [assumptionId, setAssumptionId] = useState(acceptedAssumptionId ??
    prepared?.reviewProfiles?.waiting.default_assumption_id ?? DEFAULT_GATE_WAIT_PROFILE.default_assumption_id);
  const [reviewRequest, setReviewRequest] = useState<AccommodationReviewRequest | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const choiceLabelId = useId(), assumptionLabelId = useId();
  const styles = useStyles();
  const repairChoices = useMemo(() => prepared?.accommodation
    ? accommodationChoices(prepared.snapshot, prepared.accommodation, prepared.variant,
      [acceptedOptionId, choiceId.startsWith("late:") ? choiceId.slice(5) : null].flatMap(id => id ? [id] : [])) : [],
  [prepared, acceptedOptionId, choiceId]);
  const choices = useMemo((): { id: string; label: string; target: DecisionTarget }[] => [
    { id: `variant:${otherVariant}`, label: variantLabel(otherVariant), target: { kind: "variant", variant: otherVariant } },
    ...repairChoices.map(({ option, label }) => ({
      id: `late:${option.id}`, label,
      target: { kind: "accommodation" as const, optionId: option.id },
    })),
  ], [otherVariant, repairChoices]);
  const choice = choices.find(item => item.id === choiceId);
  const brief = useMemo(() => prepared?.reviewProfiles && choice
    ? buildDecisionBrief(prepared.snapshot, prepared.variant, choice.target, assumptionId, prepared.accommodation, prepared.reviewProfiles) : null,
  [prepared, choice, assumptionId]);
  if (!prepared?.reviewProfiles) return null;
  if (!choice || !brief) throw new Error("Unknown decision-brief selection.");
  const selectedRepair = brief.option ? repairChoices.find(item => item.option.id === brief.option?.id) : null;
  if (brief.option && !selectedRepair) throw new Error("Selected repair is missing from comparison representatives.");
  const { snapshot, reviewProfiles } = prepared;
  const time = (value: string) => `${formatUtcWithDay(Date.parse(value), snapshot.plan_window.start.slice(0, 10))} UTC`;
  const row = (id: string) => {
    const found = snapshot.rows.find(item => item.id === id);
    if (!found) throw new Error(`Unknown decision-brief stand: ${id}`);
    return found.label;
  };
  const closeThen = (action: () => void) => { pendingAction.current = action; setOpen(false); };
  const inspectStand = (id: string) => closeThen(() => {
    const label = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    if (!label) throw new Error(`Decision-brief stand is not present in the chart: ${id}`);
    clearSelection();
    label.scrollIntoView({ block: "center", inline: "nearest" });
    label.focus({ preventScroll: true });
  });
  const stays = (items: PreparedStay[], emptyLabel: string) => items.length ? items.map(stay => <p key={stay.id}>
    <Button appearance="transparent" onClick={() => inspectStand(stay.rowId)} aria-label={`Inspect stand ${row(stay.rowId)} in active chart`}>
      Stand {row(stay.rowId)}
    </Button>: {time(stay.start)} to {time(stay.end)}{stay.towIn ? "; tow in" : ""}{stay.towOut ? "; tow out" : ""}.
  </p>) : <p>{emptyLabel}</p>;
  const addedServices = brief.gainedIds.length + brief.addedIds.length;
  return <>
    <AccommodationReview reviewRequest={reviewRequest} onCompare={request => {
      setChoiceId(`late:${request.optionId}`); setAssumptionId(request.assumptionId); setOpen(true);
    }} />
    <Button id="decision-brief-trigger" data-ops-keep-selection="" onClick={() => setOpen(true)}>Compare plans</Button>
    <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}
      surfaceMotion={{ onMotionFinish: () => {
        if (!open) {
          const action = pendingAction.current; pendingAction.current = null;
          document.getElementById("decision-brief-trigger")?.focus({ preventScroll: true });
          action?.();
        }
      } }}>
      <DialogSurface className={styles.surface}><DialogBody>
        <DialogTitle>Plan decision brief</DialogTitle>
        <DialogContent>
          <p>What does this alternative accommodate, and what must change? This is a read-only comparison for the same synthetic airport day,
            not a new solver run, a day-to-day ranking, or approval.</p>
          <p><strong>Reference:</strong> {approvedDataset.label}, {variantLabel(prepared.variant)}.
            {" "}{time(snapshot.plan_window.start)} to {time(snapshot.plan_window.end)}. Treated as the approved reference for this prototype.</p>
          <Field label={{ children: "Alternative to compare", htmlFor: choiceLabelId }}>
            <Select id={choiceLabelId} value={choiceId} onChange={event => {
              if (!choices.some(item => item.id === event.target.value)) throw new Error("Unknown decision-brief alternative.");
              setChoiceId(event.target.value);
            }}>{choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
          </Field>
          <Field label={{ children: "Synthetic waiting assumption", htmlFor: assumptionLabelId }}>
            <Select id={assumptionLabelId} value={assumptionId} onChange={event => {
              if (!reviewProfiles.waiting.assumptions.some(item => item.id === event.target.value)) throw new Error("Unknown decision-brief waiting assumption.");
              setAssumptionId(event.target.value);
            }}>{reviewProfiles.waiting.assumptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
          </Field>
          <p role="status">{acceptedOptionId
            ? choiceId === `late:${acceptedOptionId}` ? "The selected accommodation is active in the chart. The retained reference is unchanged."
              : "A different session accommodation is active in the chart. This selection is only a comparison preview."
            : "The reference remains active in the chart. Selecting an alternative does not apply it."}</p>
          <h3>Measured consequences</h3>
          {selectedRepair && <p>{selectedRepair.equivalentCount} other feasible alternatives have the
            same reported summary under both synthetic waiting assumptions. Equivalent measurements do not imply identical stand coordination
            or a measured passenger/cost benefit. Compare plans reviews the same representative repairs as Late request; it does not generate another plan.</p>}
          <p><strong>{addedServices} additional service{addedServices === 1 ? "" : "s"} accommodated.</strong>
            {" "}Retains {brief.retainedIds.length} of {brief.before.assignedVisitIds.size} previously assigned visits;
            {" "}{brief.lostIds.length} lost; {brief.changedIds.length} retained visits have changed assignments.
            {" "}{brief.originalUnresolvedAfter} original demand visits remain unresolved.
            {" "}{brief.retimedFlightIds.length} existing flight times changed.
            {" "}Generated tows: {brief.before.plan.generated_movement_count} to {brief.after.plan.generated_movement_count}.</p>
          {brief.lostIds.length > 0 && <p role="alert">This alternative leaves previously assigned demand unassigned. It is not a protected repair or an improvement recommendation.</p>}
          <DecisionMeasures brief={brief} />
          <details>
            <summary>What changed? {brief.changes.length} visits</summary>
            <p>Flight and stand buttons inspect the <strong>active chart</strong>, which may not be the selected alternative.
              Proposed stand/time details below describe the alternative. Inspection never applies it or invents occupancy.
              Flights absent from the active dataset have details here but no chart link. Filters may dim, never remove, their active bars.</p>
            {brief.changes.map(change => <section key={change.visitId} aria-label={`${change.kind}: ${change.visit.arrFlight}/${change.visit.depFlight}`}>
              <h4>{change.kind}: {change.visit.arrFlight}/{change.visit.depFlight}</h4>
              <p>{change.visit.origin} via the airport to {change.visit.destination}; {change.visit.carrier}, {change.visit.aircraftType}.</p>
              <strong>Reference</strong>{stays(change.beforeStays, change.kind === "New service" ? "Not in reference demand." : "Unassigned.")}
              <strong>Alternative</strong>{stays(change.afterStays, "Unassigned.")}
              {change.flights.map(flight => <p key={flight.id}>
                {flight.direction}: {flight.flight}, {flight.routeEnd}, {time(flight.scheduled)}.{" "}
                <Button appearance="transparent" disabled={!dataset.flightsById.has(flight.id)}
                  aria-label={`Inspect ${flight.flight} in active plan`} onClick={() => closeThen(() => {
                    const activeFlight = dataset.flightsById.get(flight.id);
                    if (!activeFlight) throw new Error(`Flight is absent from the active decision-brief dataset: ${flight.id}`);
                    selectFlight(activeFlight);
                  })}>{dataset.flightsById.has(flight.id) ? "Inspect in active plan" : "Not in active plan"}</Button>
              </p>)}
            </section>)}
            {!brief.changes.length && <p>No assignment or coverage changes.</p>}
          </details>
          <h3>Human judgment</h3>
          <p>Is the additional service worth the listed assignment, handover and synthetic-waiting consequences?
            Confirm airline/ground-handler coordination, staffing, shared gates, passenger handling, stand opening calendars
            and tow crews/routes before any operational approval. These resources and financial benefits are not certified or priced here.</p>
          <p>{brief.option
            ? "This bounded option retains existing assigned visits and times, adds no tows and relaxes no checked stand rules. Approval remains an explicit choice in Late request."
            : "These are prepared solver outputs, not resilience profiles: the current objective prioritizes represented flight legs, then fewer generated tows. Inspect any lost demand and changed assignments before choosing a plan."}
            {" "}No universal capacity percentage, revenue uplift or overall resilience score is inferred.
            Accommodating one request is not proof of sustainable extra demand across a month.</p>
          <details>
            <summary>Rules, assumptions and evidence</summary>
            <p>Offline whole-plan checks: stand identity, physical aircraft compatibility, airline and sector permissions,
              same-stand overlap and occupancy-triggered adjacency restrictions. These are authored synthetic rules, not airport certification.</p>
            <p>Buffer metric {brief.metricVersions.buffers.id} v{brief.metricVersions.buffers.version}; profile {brief.bufferProfile.id}.
              Waiting metric {brief.metricVersions.waiting.id} v{brief.metricVersions.waiting.version};
              model {brief.waitingProfile.model_id} v{brief.waitingProfile.model_version}, profile {brief.waitingProfile.id}.</p>
            <p>Waiting assumption: {brief.assumption.label}. Release-delay probability {brief.assumption.release_delay_probability};
              conditional mean delay {brief.assumption.expected_release_delay_minutes_given_delay} minutes.
              {brief.metricVersions.waiting.definition} Synthetic estimates, not observed performance or calibrated probabilities.</p>
            <p>Demand: {snapshot.demand_id}. Reference solver status: {brief.referenceSource.solverStatus}.
              Reference request fingerprint: {brief.referenceSource.requestFingerprint}.</p>
            {brief.alternativeSource.kind === "solver" ? <p>Alternative solver status: {brief.alternativeSource.solverStatus}.
              Request fingerprint: {brief.alternativeSource.requestFingerprint}.</p> : <p>
              Bounded accommodation, not a new solver run. Evidence {brief.alternativeSource.evidenceId};
              option {brief.alternativeSource.optionId}. Source snapshot, airport and demand fingerprints verified on load.
            </p>}
            <p>This brief does not compare different demand days or recompute historical recurrence for the alternative.</p>
          </details>
        </DialogContent>
        <DialogActions>
          {brief.option && <Button appearance="primary" onClick={() => {
            const option = brief.option;
            if (!option) throw new Error("No accommodation decision selected.");
            closeThen(() => setReviewRequest({ optionId: option.id, assumptionId }));
          }}>Review accommodation decision</Button>}
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </>;
}
