import type { Millis, Occupancy } from "../stand-timeline";
import type { DemoTimelineData } from "../stand-timeline-demo/adapter";
import type { StandSize } from "../stand-timeline-demo/syntheticFixture";
import { validateOverlayData, type OverlayData } from "../overlays/profiles";
import type { PlanVariant } from "../data-sources/preparedTypes";

export type FlightDirection = "arrival" | "departure";

export interface UnplacedStay {
  stayId: string;
  start: Millis;
  end: Millis;
}

export interface OpsFlight {
  id: string;
  direction: FlightDirection;
  flight: string;
  /** Origin for arrivals, destination for departures. */
  routeEnd: string;
  estimate: Millis;
  registration?: string;
  aircraftType?: string;
  visitId?: string;
  occupancyId?: string;
  standId?: string;
  standStart?: Millis;
  standEnd?: Millis;
  /** Absent when assigned, or when no stay times are known. */
  unplacedStay?: UnplacedStay;
}

export interface DatasetStand {
  code: string;
  area: string;
  /** The demo editor's sample size rule, not operational compatibility. */
  size?: StandSize;
}

export interface OperationsDatasetInput {
  readonly id: string;
  readonly label: string;
  readonly airportId: string;
  readonly date: string;
  readonly domain: readonly [Millis, Millis];
  readonly stands: readonly DatasetStand[];
  readonly aircraftSizes: Readonly<Record<string, StandSize>>;
  readonly aircraftMakers: Readonly<Record<string, string>>;
  readonly timeline: DemoTimelineData;
  readonly flights: OpsFlight[];
  readonly noStandStays: Occupancy[];
  readonly capabilities?: { readonly editStands: boolean; readonly fixtureAnalyses: boolean };
  readonly summary?: string;
  readonly overlays?: OverlayData;
  readonly preparedPlan?: {
    readonly caseId: string;
    readonly demandId: string;
    readonly variant: PlanVariant;
    readonly requestFingerprint: string;
  };
}

export interface OperationsDataset extends OperationsDatasetInput {
  readonly capabilities: { readonly editStands: boolean; readonly fixtureAnalyses: boolean };
  readonly flightsById: ReadonlyMap<string, OpsFlight>;
  readonly arrivals: OpsFlight[];
  readonly departures: OpsFlight[];
}

/** Owns one board's mutable records; callers and other datasets stay isolated. */
export function createOperationsDataset(input: OperationsDatasetInput): OperationsDataset {
  const dayStart = Date.parse(`${input.date}T00:00:00Z`);
  if (!input.id.trim() || !input.airportId.trim() || !input.label.trim()) {
    throw new Error("An operations dataset needs a source ID, airport ID and label.");
  }
  if (!Number.isFinite(dayStart) || new Date(dayStart).toISOString().slice(0, 10) !== input.date) {
    throw new Error(`Dataset ${input.id}: invalid UTC reference date ${input.date}.`);
  }
  if (!input.domain.every(Number.isFinite) || input.domain[0] >= input.domain[1]) {
    throw new Error(`Dataset ${input.id}: the timeline domain must be finite and increasing.`);
  }

  const owned = structuredClone(input);
  const prepared = owned.preparedPlan;
  if (prepared && (owned.capabilities?.editStands || !prepared.caseId.trim() || !prepared.demandId.trim() ||
      !["baseline", "tow-options"].includes(prepared.variant) || owned.id !== `${prepared.demandId}/${prepared.variant}` ||
      !/^[0-9a-f]{64}$/.test(prepared.requestFingerprint))) {
    throw new Error("Prepared plan identity must be valid and belong to a read-only schedule.");
  }
  if (owned.overlays) {
    if (owned.capabilities?.editStands) throw new Error("Prepared overlay profiles require a read-only schedule.");
    validateOverlayData(owned.overlays, owned);
  }
  const { timeline, flights, noStandStays } = owned;
  const unique = <T extends { id: string }>(records: readonly T[], kind: string): Map<string, T> => {
    const map = new Map<string, T>();
    for (const record of records) {
      if (!record.id.trim() || map.has(record.id)) {
        throw new Error(`Dataset ${input.id}: empty or duplicate ${kind} ID ${record.id}.`);
      }
      map.set(record.id, record);
    }
    return map;
  };
  const stands = unique(owned.stands.map((stand) => ({ ...stand, id: stand.code })), "stand");
  const rows = unique(timeline.rows, "row");
  const visits = unique(timeline.visits, "visit");
  const stays = unique([...timeline.occupancies, ...noStandStays], "stay");
  const onBoard = new Set(timeline.occupancies.map((stay) => stay.id));
  const flightsById = unique(flights, "flight");
  if (stands.size !== rows.size || [...stands.keys()].some((id) => !rows.has(id))) {
    throw new Error(`Dataset ${input.id}: stand metadata must match the chart rows.`);
  }
  for (const stand of owned.stands) {
    if ((rows.get(stand.code)?.group ?? "") !== stand.area) {
      throw new Error(`Dataset ${input.id}: stand ${stand.code} has inconsistent area metadata.`);
    }
  }
  for (const stay of stays.values()) {
    if (!Number.isFinite(stay.start) || !Number.isFinite(stay.end) || stay.start >= stay.end) {
      throw new Error(`Dataset ${input.id}: stay ${stay.id} needs a finite, increasing interval.`);
    }
    if (!stay.visitId || !visits.has(stay.visitId) || !timeline.turnsById.has(stay.visitId) ||
        !timeline.endpoints.has(stay.id) || !timeline.stayPosition.has(stay.id)) {
      throw new Error(`Dataset ${input.id}: stay ${stay.id} is missing visit or endpoint metadata.`);
    }
    if (onBoard.has(stay.id) ? !stands.has(stay.rowId) : stay.rowId !== "") {
      throw new Error(`Dataset ${input.id}: stay ${stay.id} has an invalid stand ${stay.rowId}.`);
    }
  }
  for (const flight of flights) {
    if (!Number.isFinite(flight.estimate)) {
      throw new Error(`Dataset ${input.id}: flight ${flight.id} needs a finite estimate.`);
    }
    if (flight.occupancyId !== undefined) {
      const stay = stays.get(flight.occupancyId);
      if (!stay || !onBoard.has(stay.id) || flight.unplacedStay ||
          flight.standId !== stay.rowId || flight.visitId !== stay.visitId ||
          flight.standStart !== stay.start || flight.standEnd !== stay.end) {
        throw new Error(`Dataset ${input.id}: flight ${flight.id} does not match its assigned stay.`);
      }
    } else if (flight.standId !== undefined || flight.standStart !== undefined || flight.standEnd !== undefined) {
      throw new Error(`Dataset ${input.id}: flight ${flight.id} has stand details without an assigned stay.`);
    } else if (flight.unplacedStay) {
      const stay = stays.get(flight.unplacedStay.stayId);
      if (!stay || onBoard.has(stay.id) || flight.visitId !== stay.visitId ||
          flight.unplacedStay.start !== stay.start || flight.unplacedStay.end !== stay.end) {
        throw new Error(`Dataset ${input.id}: flight ${flight.id} does not match its unplaced stay.`);
      }
    }
  }
  const byEstimate = (a: OpsFlight, b: OpsFlight) =>
    a.estimate - b.estimate || a.flight.localeCompare(b.flight);
  return {
    ...owned,
    capabilities: owned.capabilities ?? { editStands: false, fixtureAnalyses: false },
    flightsById,
    arrivals: flights.filter((flight) => flight.direction === "arrival").sort(byEstimate),
    departures: flights.filter((flight) => flight.direction === "departure").sort(byEstimate),
  };
}
