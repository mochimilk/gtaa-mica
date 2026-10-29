// Compatibility entry point for the lists, editor and agent. These are the
// same mutable flight objects owned by the chart's active dataset.
import { ACTIVE_DATASET, sealActiveDataset } from "./activeDataset";
import type { OpsFlight } from "./dataset";

export type { FlightDirection, OpsFlight, UnplacedStay } from "./dataset";

sealActiveDataset();
export const NO_STAND_STAYS = ACTIVE_DATASET.noStandStays;
export const OPS_FLIGHTS = ACTIVE_DATASET.flights;
export const OPS_FLIGHTS_BY_ID = ACTIVE_DATASET.flightsById;
export const ARRIVALS = ACTIVE_DATASET.arrivals;
export const DEPARTURES = ACTIVE_DATASET.departures;

if (import.meta.hot) import.meta.hot.accept(() => location.reload());

/** Minutes the flight's stay occupies its stand, or null when it has no stand. */
export function standMinutes(flight: OpsFlight): number | null {
  if (flight.standStart === undefined || flight.standEnd === undefined) return null;
  return Math.round((flight.standEnd - flight.standStart) / 60_000);
}

/** "3h 05m" / "45m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
