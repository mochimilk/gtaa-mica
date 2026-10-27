export function calculateOneWayTowRange(earliestOut: number, latestArrival: number, travelMinutes: number): [number, number] | null;
export function mergeTowRanges(ranges: readonly [number, number][]): [number, number][];
export function calculateTowStartRanges(earliestOut: number, latestBackEnd: number, travelMinutes: number, parkingMinutes: number):
  { out: [number, number]; back: [number, number] } | null;
