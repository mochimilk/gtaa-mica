import type { OperationsDataset, OpsFlight } from "../operations/dataset";
import type { Occupancy } from "../stand-timeline";
import { parseBufferProfile, parseDecisionReviewProfile, parseGateWaitProfile, validateOverlayData } from "./profiles";
import { parseCapacitySnapshot, queryCapacity } from "./capacity";
import { evaluateTowWindows, parseTowWindows, TOW_STATUSES } from "./towWindows";
import { accommodationImpact, accommodationOptionLabel, parseAccommodation, validateAccommodationCapacity } from "./accommodation";
import { gateWaiting, standHandovers } from "./handovers";

function coverage(flights: readonly OpsFlight[], stays: readonly Occupancy[], visitIds: readonly string[], domain: readonly [number, number]) {
  const visits = new Set(visitIds), assigned = new Set(stays.map(stay => stay.visitId));
  if (visits.size !== visitIds.length || [...assigned].some(id => !id || !visits.has(id))) {
    throw new Error("Decision coverage has duplicate or unknown visits.");
  }
  const assignedFlights = flights.filter(flight => !!flight.occupancyId).length;
  return {
    visits: visits.size, assignedVisits: assigned.size, unassignedVisits: visits.size - assigned.size,
    flightLegs: flights.length, assignedFlightLegs: assignedFlights, unassignedFlightLegs: flights.length - assignedFlights,
    contextFlightLegs: flights.filter(flight => flight.estimate < domain[0] || flight.estimate >= domain[1]).length,
  };
}

const waitingMeasures = (result: ReturnType<typeof gateWaiting> | null) => result ? {
  availability: result.availability, assessed: result.assessed, unassessed: result.unassessed,
  unassigned: result.unassigned, context: result.context, totalMinutes: result.totalMinutes,
} : null;

export interface DecisionChange {
  visitId: string;
  label: string;
  kind: "reassigned" | "new-service";
  beforeStand: string | null;
  afterStand: string;
  start: number;
  end: number;
  flights: { id: string; label: string; direction: OpsFlight["direction"]; routeEnd: string; estimate: number }[];
}

/** Combines validated reference evidence; never creates or activates a replacement dataset. */
export function buildDecisionSummary(dataset: OperationsDataset, options: {
  assumptionId?: string; accommodationOptionId?: string | null;
} = {}) {
  const data = dataset.overlays;
  if (!data || !Object.hasOwn(data.profiles, "decision-review")) throw new Error("Decision review is unavailable for this source.");
  validateOverlayData(data, dataset);
  const profile = parseDecisionReviewProfile(data.profiles["decision-review"]), plan = dataset.preparedPlan!;
  const optional = <T>(id: string, parse: (value: unknown) => T): T | null =>
    Object.hasOwn(data.profiles, id) ? parse(data.profiles[id]) : null;
  const buffers = optional("buffers", parseBufferProfile), waiting = optional("gate-wait", parseGateWaitProfile);
  const capacity = optional("capacity", parseCapacitySnapshot), tow = optional("tow-windows", parseTowWindows);
  const accommodation = optional("accommodation", parseAccommodation);
  const bindings = [capacity, tow, accommodation].filter(item => item !== null);
  if (new Set(bindings.map(item => JSON.stringify([
    item.snapshot_fingerprint, item.airport_fingerprint, item.demand_fingerprint,
    item.variants.baseline.request_fingerprint, item.variants["tow-options"].request_fingerprint,
  ]))).size > 1) throw new Error("Decision evidence has different source provenance. Regenerate its sidecars together.");
  if (capacity && accommodation) validateAccommodationCapacity(accommodation, capacity);

  const assumption = waiting?.assumptions.find(item => item.id === (options.assumptionId ?? waiting.default_assumption_id)) ?? null;
  if ((waiting && !assumption) || (!waiting && options.assumptionId !== undefined)) {
    throw new Error("Unknown or unavailable decision-review waiting assumption.");
  }
  if (options.accommodationOptionId != null && !accommodation) throw new Error("Accommodation evidence is unavailable for this decision preview.");
  const gaps = standHandovers(dataset.timeline.occupancies, dataset.domain);
  if (gaps.availability === "invalid") throw new Error("Decision review cannot assess overlapping reference occupancy.");
  const visitIds = dataset.timeline.visits.map(visit => visit.id);
  const referenceCoverage = coverage(dataset.flights, dataset.timeline.occupancies, visitIds, dataset.domain);
  const beforeWaiting = assumption ? gateWaiting({
    domain: dataset.domain, timeline: dataset.timeline, arrivals: dataset.flights.filter(flight => flight.direction === "arrival"),
  }, assumption) : null;
  const accommodationPlan = accommodation?.variants[plan.variant] ?? null;
  const impact = accommodation && options.accommodationOptionId != null
    ? accommodationImpact(dataset, accommodation, options.accommodationOptionId, buffers, assumption) : null;
  const standLabel = (id: string) => {
    const stand = dataset.timeline.rows.find(row => row.id === id);
    if (!stand) throw new Error(`Unknown decision stand: ${id}`);
    return stand.label;
  };
  const preview = impact && accommodation ? (() => {
    const view = impact.preview, originalIds = new Set(visitIds);
    const beforeAssigned = new Set(dataset.timeline.occupancies.map(stay => stay.visitId));
    const afterAssigned = new Set(view.timeline.occupancies.map(stay => stay.visitId));
    const originalFlights = new Map(dataset.flights.map(flight => [flight.id, flight]));
    const movedVisitIds = new Set(view.option.moves.map(move =>
      dataset.timeline.occupancies.find(stay => stay.id === move.stay_id)!.visitId));
    const flightDetails = (visitId: string) => view.flights.filter(flight => flight.visitId === visitId).map(flight => ({
      id: flight.id, label: flight.flight, direction: flight.direction, routeEnd: flight.routeEnd, estimate: flight.estimate,
    }));
    const changes: DecisionChange[] = view.option.moves.map(move => {
      const stay = dataset.timeline.occupancies.find(stay => stay.id === move.stay_id)!;
      const visit = dataset.timeline.visits.find(visit => visit.id === stay.visitId)!;
      const flights = flightDetails(visit.id);
      return {
        visitId: visit.id, label: flights.map(flight => flight.label).join("/"), kind: "reassigned",
        beforeStand: standLabel(move.from_stand_id), afterStand: standLabel(move.to_stand_id),
        start: stay.start, end: stay.end, flights,
      };
    });
    const request = accommodation.request;
    changes.push({
      visitId: request.visit.turnId, label: `${request.visit.arrFlight}/${request.visit.depFlight}`, kind: "new-service",
      beforeStand: null, afterStand: standLabel(view.option.target_stand_id),
      start: Date.parse(request.start), end: Date.parse(request.end), flights: flightDetails(request.visit.turnId),
    });
    return {
      kind: "accommodation-comparison" as const, optionId: view.option.id, evidenceId: accommodation.id,
      label: accommodationOptionLabel(dataset, view.option),
      coverage: coverage(view.flights, view.timeline.occupancies, [...visitIds, request.visit.turnId], dataset.domain),
      retainedVisits: [...beforeAssigned].filter(id => afterAssigned.has(id)).length,
      lostVisits: [...beforeAssigned].filter(id => !afterAssigned.has(id)).length,
      newlyAssignedExistingVisits: [...afterAssigned].filter(id => originalIds.has(id!) && !beforeAssigned.has(id)).length,
      addedVisits: [...afterAssigned].filter(id => !originalIds.has(id!)).length,
      changedVisits: movedVisitIds.size,
      retimedFlightIds: view.flights.filter(flight => {
        const original = originalFlights.get(flight.id);
        return original && original.estimate !== flight.estimate;
      }).map(flight => flight.id),
      unresolvedOriginalVisits: visitIds.filter(id => !afterAssigned.has(id)).length,
      buffers: buffers ? impact.afterBuffers : null, waiting: waitingMeasures(impact.afterWaiting),
      commonArrivals: impact.commonArrivals, beforeCommonMinutes: impact.beforeCommonMinutes,
      afterCommonMinutes: impact.afterCommonMinutes, incomingMinutes: impact.incomingMinutes, changes,
    };
  })() : null;
  const towAssessments = tow ? evaluateTowWindows(tow, dataset) : null;
  return {
    profile, source: {
      airportId: dataset.airportId, datasetId: dataset.id, caseId: plan.caseId, demandId: plan.demandId,
      variant: plan.variant, requestFingerprint: plan.requestFingerprint, horizon: [...dataset.domain],
      snapshotFingerprint: bindings[0]?.snapshot_fingerprint ?? null,
      airportFingerprint: bindings[0]?.airport_fingerprint ?? null, demandFingerprint: bindings[0]?.demand_fingerprint ?? null,
    },
    profiles: { buffers, waiting }, assumption,
    reference: {
      coverage: referenceCoverage,
      buffers: buffers ? {
        handovers: gaps.handovers.length, tight: gaps.handovers.filter(item => item.minutes < buffers.threshold_minutes).length,
        minimum: gaps.handovers.length ? Math.min(...gaps.handovers.map(item => item.minutes)) : null,
      } : null,
      waiting: waitingMeasures(beforeWaiting),
      capacity: capacity ? capacity.profile.probes.map(probe => {
        const result = queryCapacity(capacity, plan.variant, probe.id, probe.default_duration_minutes, dataset.domain[0], dataset.domain[1]);
        return {
          id: probe.id, label: probe.label, durationMinutes: probe.default_duration_minutes, separationMinutes: probe.separation_minutes,
          bands: result.opportunities.length, stands: new Set(result.opportunities.map(item => item.rowId)).size,
          excludedStands: result.excluded_stands.length,
        };
      }) : null,
      tow: towAssessments ? {
        totalVisits: towAssessments.length,
        visitsWithWindows: towAssessments.filter(item => item.status === "available").length,
        destinationChoices: towAssessments.reduce((sum, item) => sum + item.destinations.length, 0),
        statuses: Object.entries(TOW_STATUSES).map(([id, label]) => ({
          id, label, count: towAssessments.filter(item => item.status === id).length,
        })),
      } : null,
    },
    accommodation: accommodation && accommodationPlan ? {
      status: accommodationPlan.status, search: accommodationPlan.search, count: accommodationPlan.total_options_found,
      options: accommodationPlan.options.map(option => ({ id: option.id, label: accommodationOptionLabel(dataset, option) })),
      request: {
        label: `${accommodation.request.visit.arrFlight}/${accommodation.request.visit.depFlight}`,
        start: accommodation.request.start, end: accommodation.request.end,
      },
    } : null,
    preview,
  };
}

export type DecisionSummary = ReturnType<typeof buildDecisionSummary>;
