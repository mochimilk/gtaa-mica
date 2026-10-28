import { accommodationView, type PreparedAccommodation } from "./accommodation-evaluation";
import { BUFFER_METRIC, calculatePreparedBuffers, DEFAULT_BUFFER_PROFILE } from "./buffer-evaluation";
import { calculateWaiting, commonWaiting, DEFAULT_GATE_WAIT_PROFILE, GATE_WAIT_METRIC } from "./gate-wait-evaluation";
import type { PreparedPlan, PreparedReviewProfiles, PreparedScenario, PreparedStay } from "./dataset";
import type { PlanVariant } from "./preferences";

export type DecisionTarget = { kind: "variant"; variant: PlanVariant } | { kind: "accommodation"; optionId: string };
type Scenario = Omit<PreparedScenario, "variants">;
type Plan = Pick<PreparedPlan, "stays" | "covered_flight_count" | "generated_movement_count">;

const signature = (stays: readonly PreparedStay[]) => JSON.stringify(stays.map(stay => [
  stay.rowId, Date.parse(stay.start), Date.parse(stay.end), stay.arrivalFlightId ?? null,
  stay.departureFlightId ?? null, stay.towIn, stay.towOut,
]).map(value => JSON.stringify(value)).sort());

function measure(scenario: Scenario, plan: Plan) {
  const assignedVisitIds = new Set(plan.stays.map(stay => stay.visitId));
  const originalVisitIds = new Set(scenario.visits.map(visit => visit.turnId));
  if ([...assignedVisitIds].some(id => !originalVisitIds.has(id))) throw new Error("Unknown decision-brief visit.");
  return { scenario, plan, assignedVisitIds, unassignedVisits: scenario.visits.length - assignedVisitIds.size };
}

export function buildDecisionBrief(
  snapshot: PreparedScenario, referenceVariant: PlanVariant, target: DecisionTarget,
  assumptionId: string, evidence?: PreparedAccommodation,
  profiles: PreparedReviewProfiles = { buffers: DEFAULT_BUFFER_PROFILE, waiting: DEFAULT_GATE_WAIT_PROFILE },
) {
  const assumption = profiles.waiting.assumptions.find(item => item.id === assumptionId);
  if (!assumption) throw new Error("Unknown decision-brief waiting assumption.");
  const base = snapshot.variants[referenceVariant];
  if (!base) throw new Error("Unknown decision-brief reference plan.");
  const view = target.kind === "accommodation" ? (() => {
    if (!evidence) throw new Error("No validated accommodation evidence for this decision brief.");
    return accommodationView(snapshot, evidence, referenceVariant, target.optionId);
  })() : null;
  const alternativePlan = target.kind === "variant" ? snapshot.variants[target.variant] : view?.plan;
  if (!alternativePlan) throw new Error("Unknown decision-brief alternative.");
  const before = measure(snapshot, base), after = measure(view?.scenario ?? snapshot, alternativePlan);
  const originalIds = new Set(snapshot.visits.map(visit => visit.turnId));
  const retainedIds = [...before.assignedVisitIds].filter(id => after.assignedVisitIds.has(id));
  const gainedIds = [...after.assignedVisitIds].filter(id => originalIds.has(id) && !before.assignedVisitIds.has(id));
  const lostIds = [...before.assignedVisitIds].filter(id => !after.assignedVisitIds.has(id));
  const addedIds = [...after.assignedVisitIds].filter(id => !originalIds.has(id));
  const staysFor = (plan: Plan, id: string) => plan.stays.filter(stay => stay.visitId === id);
  const changedIds = retainedIds.filter(id => signature(staysFor(base, id)) !== signature(staysFor(alternativePlan, id)));
  const beforeFlights = new Map(snapshot.flights.map(flight => [flight.id, flight]));
  const retimedFlightIds = after.scenario.flights.filter(flight => {
    const original = beforeFlights.get(flight.id);
    return original && Date.parse(original.scheduled) !== Date.parse(flight.scheduled);
  }).map(flight => flight.id);
  const changes = [...addedIds, ...gainedIds, ...lostIds, ...changedIds].map(visitId => {
    const visit = after.scenario.visits.find(item => item.turnId === visitId);
    if (!visit) throw new Error(`Unknown decision-brief changed visit: ${visitId}`);
    return {
      visitId, visit,
      kind: addedIds.includes(visitId) ? "New service" : gainedIds.includes(visitId) ? "Newly assigned"
        : lostIds.includes(visitId) ? "Now unassigned" : "Changed assignment",
      flights: after.scenario.flights.filter(flight => flight.visitId === visitId),
      beforeStays: staysFor(base, visitId), afterStays: staysFor(alternativePlan, visitId),
    };
  });
  const beforeBuffers = calculatePreparedBuffers(base.stays, snapshot.plan_window);
  const afterBuffers = calculatePreparedBuffers(alternativePlan.stays, snapshot.plan_window);
  const beforeWaiting = calculateWaiting(snapshot, base, beforeBuffers, assumption);
  const afterWaiting = calculateWaiting(after.scenario, alternativePlan, afterBuffers, assumption);
  const common = commonWaiting(beforeWaiting, afterWaiting);
  const incoming = view && evidence ? afterWaiting.contributions.find(item => item.arrival_id === evidence.request.flights[0].id) : null;
  return {
    target, option: view?.option ?? null, before, after, beforeBuffers, afterBuffers, beforeWaiting, afterWaiting, common,
    retainedIds, gainedIds, lostIds, addedIds, changedIds, retimedFlightIds, changes,
    originalUnresolvedAfter: snapshot.visits.filter(visit => !after.assignedVisitIds.has(visit.turnId)).length,
    incomingWait: incoming?.estimated_wait_minutes ?? null,
    assumption, bufferProfile: profiles.buffers, waitingProfile: profiles.waiting,
    metricVersions: { buffers: BUFFER_METRIC, waiting: GATE_WAIT_METRIC },
    referenceSource: { variant: referenceVariant, requestFingerprint: base.request_fingerprint, solverStatus: base.solver_status },
    alternativeSource: target.kind === "variant"
      ? { kind: "solver" as const, variant: target.variant, requestFingerprint: snapshot.variants[target.variant].request_fingerprint,
        solverStatus: snapshot.variants[target.variant].solver_status }
      : { kind: "bounded-accommodation" as const, evidenceId: evidence!.id, optionId: target.optionId },
  };
}

export type DecisionBrief = ReturnType<typeof buildDecisionBrief>;
