import type { Occupancy } from "../stand-timeline";
import type { OperationsDataset } from "../operations/dataset";
import type { ReleaseAssumption } from "./profiles";

export interface Handover {
  id: string;
  rowId: string;
  previous: Occupancy;
  next: Occupancy;
  start: number;
  end: number;
  minutes: number;
}

/** Occupied-union frontier from feature/solver; nested stays cannot create false gaps. */
export function standHandovers(stays: readonly Occupancy[], domain: readonly [number, number]) {
  const [start, end] = domain;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("Invalid overlay horizon.");
  const rows = new Map<string, Occupancy[]>();
  const ids = new Set<string>();
  for (const stay of stays) {
    if (!stay.id || ids.has(stay.id) || !stay.rowId || !stay.visitId ||
        !Number.isFinite(stay.start) || !Number.isFinite(stay.end) || stay.start >= stay.end) {
      throw new Error(`Invalid overlay stay: ${stay.id}`);
    }
    ids.add(stay.id);
    if (stay.start >= end || stay.end < start) continue;
    const row = rows.get(stay.rowId) ?? [];
    row.push(stay);
    rows.set(stay.rowId, row);
  }
  const handovers: Handover[] = [];
  let overlap = false;
  for (const [rowId, row] of rows) {
    row.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
    let frontier: Occupancy | undefined;
    for (const next of row) {
      if (frontier && next.start < frontier.end && Math.max(start, next.start) < Math.min(end, frontier.end, next.end)) overlap = true;
      if (frontier && frontier.end <= next.start && next.start >= start && frontier.visitId !== next.visitId) {
        handovers.push({
          id: JSON.stringify([rowId, frontier.id, next.id]), rowId, previous: frontier, next,
          start: frontier.end, end: next.start, minutes: (next.start - frontier.end) / 60_000,
        });
      }
      if (!frontier || next.end > frontier.end) frontier = next;
    }
  }
  return { handovers, availability: overlap ? "invalid" : handovers.length ? "available" : "not-applicable" } as const;
}

export function gateWaiting(dataset: {
  domain: OperationsDataset["domain"];
  arrivals: OperationsDataset["arrivals"];
  timeline: Pick<OperationsDataset["timeline"], "occupancies" | "endpoints">;
}, assumption: ReleaseAssumption) {
  if (!Number.isFinite(assumption.release_delay_probability) || assumption.release_delay_probability < 0 ||
      assumption.release_delay_probability > 1 || !Number.isFinite(assumption.expected_release_delay_minutes_given_delay) ||
      assumption.expected_release_delay_minutes_given_delay < 0 || assumption.expected_release_delay_minutes_given_delay > 240) {
    throw new Error("Invalid synthetic waiting assumption.");
  }
  const buffers = standHandovers(dataset.timeline.occupancies, dataset.domain);
  const arrivals = dataset.arrivals.filter(flight => flight.occupancyId &&
    flight.estimate >= dataset.domain[0] && flight.estimate < dataset.domain[1]);
  const byStay = new Map(arrivals.map(flight => [flight.occupancyId, flight]));
  const contributions = buffers.availability === "invalid" ? [] : buffers.handovers.flatMap(handover => {
    const arrival = byStay.get(handover.next.id);
    if (!arrival || dataset.timeline.endpoints.get(handover.next.id)?.start.kind !== "flight") return [];
    return [{
      handover, arrival,
      minutes: assumption.release_delay_probability *
        Math.max(0, assumption.expected_release_delay_minutes_given_delay - handover.minutes),
    }];
  });
  return {
    availability: buffers.availability === "invalid" ? "invalid" : contributions.length ? "available" : "not-applicable",
    contributions, assessed: contributions.length, unassessed: arrivals.length - contributions.length,
    unassigned: dataset.arrivals.filter(flight => !flight.standId &&
      flight.estimate >= dataset.domain[0] && flight.estimate < dataset.domain[1]).length,
    context: dataset.arrivals.filter(flight => flight.occupancyId &&
      (flight.estimate < dataset.domain[0] || flight.estimate >= dataset.domain[1])).length,
    totalMinutes: contributions.length && buffers.availability !== "invalid"
      ? contributions.reduce((sum, item) => sum + item.minutes, 0) : null,
  };
}
