export function calculateOneWayTowRange(earliestOut, latestArrival, travelMinutes) {
  const travel = travelMinutes * 60_000;
  if (![earliestOut, latestArrival, travel].every(Number.isSafeInteger) || travel <= 0) {
    throw new Error('Invalid handling-policy tow window inputs; travel requires positive millisecond precision.');
  }
  const latestOut = latestArrival - travel;
  if (!Number.isSafeInteger(latestOut)) throw new Error('Tow window bounds require millisecond precision.');
  return latestOut < earliestOut ? null : [earliestOut, latestOut];
}

export function mergeTowRanges(ranges) {
  const sorted = ranges.map(range => {
    if (range.length !== 2 || !range.every(Number.isSafeInteger) || range[0] > range[1]) throw new Error('Invalid inclusive tow window.');
    return [...range];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const result = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]);
    else result.push(range);
  }
  return result;
}
