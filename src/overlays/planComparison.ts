import type { OperationsDataset } from "../operations/dataset";
import { validatePlanComparisonDataset } from "../data-sources/planComparison";
import { parseBufferProfile, parseGateWaitProfile, validateOverlayData } from "./profiles";
import { decisionPlanMeasures } from "./decisionSummary";
import { commonWaiting, gateWaiting } from "./handovers";
import type { PreparedPlan } from "../data-sources/preparedTypes";

const signature = (stays: PreparedPlan["stays"]) => JSON.stringify(stays.map(stay => [
  stay.rowId, Date.parse(stay.start), Date.parse(stay.end), stay.arrivalFlightId ?? null,
  stay.departureFlightId ?? null, stay.towIn, stay.towOut,
]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

/** Compares two fixed plans from one source; neither is registered as the active board. */
export function buildPlanComparison(dataset: OperationsDataset, assumptionId?: string) {
  const data = dataset.overlays;
  if (!data?.companions || !Object.hasOwn(data.companions, "plan-comparison")) return null;
  validateOverlayData(data, dataset);
  const { evidence, plans } = validatePlanComparisonDataset(data.companions["plan-comparison"], dataset, data.profiles);
  const snapshot = evidence.snapshot, referenceVariant = dataset.preparedPlan!.variant;
  const alternativeVariant = referenceVariant === "baseline" ? "tow-options" : "baseline";
  const buffers = Object.hasOwn(data.profiles, "buffers") ? parseBufferProfile(data.profiles.buffers) : null;
  const waiting = Object.hasOwn(data.profiles, "gate-wait") ? parseGateWaitProfile(data.profiles["gate-wait"]) : null;
  const assumption = waiting?.assumptions.find(item => item.id === (assumptionId ?? waiting.default_assumption_id)) ?? null;
  if ((waiting && !assumption) || (!waiting && assumptionId !== undefined)) throw new Error("Unknown or unavailable plan-comparison waiting assumption.");
  const beforePlan = snapshot.variants[referenceVariant], afterPlan = snapshot.variants[alternativeVariant];
  const assigned = (plan: PreparedPlan) => new Set(plan.stays.map(stay => stay.visitId));
  const beforeIds = assigned(beforePlan), afterIds = assigned(afterPlan);
  const retainedIds = [...beforeIds].filter(id => afterIds.has(id));
  const gainedIds = [...afterIds].filter(id => !beforeIds.has(id));
  const lostIds = [...beforeIds].filter(id => !afterIds.has(id));
  const staysFor = (plan: PreparedPlan, id: string) => plan.stays.filter(stay => stay.visitId === id)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.rowId.localeCompare(b.rowId));
  const changedIds = retainedIds.filter(id => signature(staysFor(beforePlan, id)) !== signature(staysFor(afterPlan, id)));
  const changes = [...new Set([...gainedIds, ...lostIds, ...changedIds])].sort().map(visitId => {
    const flights = snapshot.flights.filter(flight => flight.visitId === visitId);
    return {
      visitId, label: flights.map(flight => flight.flight).join("/"),
      kind: gainedIds.includes(visitId) ? "newly-assigned" as const : lostIds.includes(visitId) ? "now-unassigned" as const : "changed-assignment" as const,
      flights: flights.map(flight => ({ id: flight.id, label: flight.flight, direction: flight.direction,
        routeEnd: flight.routeEnd, estimate: Date.parse(flight.scheduled) })),
      beforeStays: staysFor(beforePlan, visitId), afterStays: staysFor(afterPlan, visitId),
    };
  });
  const beforeWaiting = assumption ? gateWaiting(plans[referenceVariant], assumption) : null;
  const afterWaiting = assumption ? gateWaiting(plans[alternativeVariant], assumption) : null;
  const measure = (variant: typeof referenceVariant) => ({
    variant, requestFingerprint: snapshot.variants[variant].request_fingerprint,
    solverStatus: snapshot.variants[variant].solver_status,
    generatedMovements: snapshot.variants[variant].generated_movement_count,
    ...decisionPlanMeasures(plans[variant], buffers, assumption),
  });
  return {
    reference: measure(referenceVariant), alternative: measure(alternativeVariant),
    retainedIds, gainedIds, lostIds, changedIds, changes,
    ...commonWaiting(beforeWaiting, afterWaiting),
    assumption, buffers, waiting, snapshotFingerprint: evidence.snapshot_fingerprint,
    airportId: dataset.airportId, caseId: snapshot.case_id, demandId: snapshot.demand_id,
    horizon: dataset.domain,
  };
}
export type PlanComparison = NonNullable<ReturnType<typeof buildPlanComparison>>;
