import type { OperationsDataset } from "../operations/dataset";
import type { Occupancy, TimelineRow } from "../stand-timeline/model";
import { previewAccommodation, type PreparedAccommodation } from "../overlays/accommodation";

const HOUR = 60 * 60_000;
export const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);
export const utcTime = (time: number) => new Date(time).toISOString().slice(11, 16);

export interface RequestTurn {
  id: string;
  standId: string;
  stand: string;
  aircraftType?: string;
  start: number;
  end: number;
  minutes: number;
  arrival: { label: string; route: string };
  departure: { label: string; route: string };
}

export function requestTurn(evidence: PreparedAccommodation): RequestTurn {
  const { request } = evidence;
  const start = Date.parse(request.start), end = Date.parse(request.end);
  return {
    id: request.stay_id, standId: "", stand: "Not assigned", start, end, minutes: (end - start) / 60_000,
    aircraftType: request.visit.aircraftType,
    arrival: { label: request.visit.arrFlight, route: request.visit.origin },
    departure: { label: request.visit.depFlight, route: request.visit.destination },
  };
}

export function buildRequestDecision(reference: OperationsDataset, evidence: PreparedAccommodation, optionId: string) {
  const preview = previewAccommodation(reference, evidence, optionId);
  const stand = (id: string) => {
    const row = reference.timeline.rows.find(item => item.id === id);
    if (!row) throw new Error(`Unknown request stand: ${id}`);
    return row.label;
  };
  const describe = (stay: Occupancy): RequestTurn => {
    if (stay.id === evidence.request.stay_id) return {
      ...requestTurn(evidence), standId: stay.rowId, stand: stand(stay.rowId),
    };
    const ends = reference.timeline.endpoints.get(stay.id);
    const turn = stay.visitId ? reference.timeline.turnsById.get(stay.visitId) : undefined;
    return {
      id: stay.id, standId: stay.rowId, stand: stand(stay.rowId), aircraftType: turn?.aircraftType,
      start: stay.start, end: stay.end, minutes: (stay.end - stay.start) / 60_000,
      arrival: ends?.start.kind === "flight"
        ? { label: ends.start.flight, route: ends.start.origin }
        : { label: ends?.start.kind === "tow" ? "Tow-in" : "Context start", route: "" },
      departure: ends?.end.kind === "flight"
        ? { label: ends.end.flight, route: ends.end.destination }
        : { label: ends?.end.kind === "tow" ? "Tow-out" : "Context end", route: "" },
    };
  };
  const incomingStay = preview.timeline.occupancies.find(stay => stay.id === evidence.request.stay_id)!;
  const moves = preview.option.moves.map(move => {
    const before = reference.timeline.occupancies.find(stay => stay.id === move.stay_id)!;
    const after = preview.timeline.occupancies.find(stay => stay.id === move.stay_id)!;
    return { before: describe(before), after: describe(after), contact: move.to_stand_contact };
  });
  const incoming = describe(incomingStay);
  const changes = [...moves.map(move => move.after), incoming];
  const domain = [Math.min(...changes.map(turn => turn.start)) - HOUR,
    Math.max(...changes.map(turn => turn.end)) + HOUR] as const;
  const neighbors = changes.map(turn => {
    const others = preview.timeline.occupancies.filter(stay => stay.rowId === turn.standId && stay.id !== turn.id);
    const previous = others.filter(stay => stay.end <= turn.start).sort((a, b) => b.end - a.end || a.id.localeCompare(b.id))[0];
    const next = others.filter(stay => stay.start >= turn.end).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))[0];
    return {
      turn, previous: previous ? describe(previous) : null, next: next ? describe(next) : null,
      beforeMinutes: previous ? (turn.start - previous.end) / 60_000 : null,
      afterMinutes: next ? (next.start - turn.end) / 60_000 : null,
    };
  });
  const rows: TimelineRow[] = [], occupancies: Occupancy[] = [];
  type Bar = { turn: RequestTurn; phase: "Reference" | "With option"; kind: "unchanged" | "incoming" | "reassigned" | "released" };
  const bars = new Map<string, Bar>();
  const movedIds = new Set(moves.map(move => move.after.id));
  for (const standId of new Set(changes.map(turn => turn.standId))) {
    for (const phase of ["Reference", "With option"] as const) {
      const rowId = JSON.stringify([standId, phase]);
      rows.push({ id: rowId, label: `${stand(standId)} · ${phase}` });
      const stays = phase === "Reference" ? reference.timeline.occupancies : preview.timeline.occupancies;
      for (const stay of stays.filter(stay => stay.rowId === standId && stay.start < domain[1] && stay.end > domain[0])) {
        const id = JSON.stringify([stay.id, phase]), turn = describe(stay);
        occupancies.push({ ...stay, id, rowId, label: `${turn.arrival.label} / ${turn.departure.label}` });
        bars.set(id, {
          turn, phase, kind: stay.id === incoming.id ? "incoming" : movedIds.has(stay.id)
            ? phase === "Reference" ? "released" : "reassigned" : "unchanged",
        });
      }
    }
  }
  return { incoming, moves, neighbors, chart: { rows, occupancies, bars, domain } };
}
