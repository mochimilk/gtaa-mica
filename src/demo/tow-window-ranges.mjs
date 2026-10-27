export function calculateOneWayTowRange(earliestOut, latestArrival, travelMinutes) {
  const travel = travelMinutes * 60_000, latestOut = latestArrival - travel;
  if (!Number.isSafeInteger(earliestOut) || !Number.isSafeInteger(latestArrival) ||
      !Number.isFinite(travelMinutes) || travelMinutes <= 0 ||
      !Number.isSafeInteger(travel) || !Number.isSafeInteger(latestOut)) {
    throw new Error('Invalid one-way tow window inputs; millisecond precision is required.');
  }
  return latestOut < earliestOut ? null : [earliestOut, latestOut];
}

export function mergeTowRanges(ranges) {
  const merged = [];
  for (const range of ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (!range.every(Number.isSafeInteger) || range.length !== 2 || range[1] < range[0]) throw new Error('Invalid tow window range.');
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

export function calculateTowStartRanges(earliestOut, latestBackEnd, travelMinutes, parkingMinutes) {
  if (!Number.isSafeInteger(earliestOut) || !Number.isSafeInteger(latestBackEnd) ||
      !Number.isFinite(travelMinutes) || travelMinutes <= 0 || !Number.isFinite(parkingMinutes) || parkingMinutes < 0) {
    throw new Error('Invalid handling-policy tow window inputs.');
  }
  const travel = travelMinutes * 60_000, parking = parkingMinutes * 60_000;
  const latestOut = latestBackEnd - 2 * travel - parking;
  const earliestBack = earliestOut + travel + parking;
  const latestBack = latestBackEnd - travel;
  if (![latestOut, earliestBack, latestBack].every(Number.isSafeInteger)) throw new Error('Tow window bounds require millisecond precision.');
  return latestOut < earliestOut ? null : { out: [earliestOut, latestOut], back: [earliestBack, latestBack] };
}
