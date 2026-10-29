type Buffers = { handovers: number; tight: number | null; minimum: number | null };
type Waiting = { assessed: number; unassessed: number };
type Cell = number | string | null | undefined;

export function AccommodationMeasures({ beforeBuffers, afterBuffers, beforeWaiting, afterWaiting,
  beforeCommonMinutes, afterCommonMinutes, incomingMinutes, referenceLabel = "Reference", alternativeLabel = "Preview",
  caption = "Reference versus independent preview; scheduled gaps and illustrative waiting, not operational performance" }: {
  beforeBuffers: Buffers | null; afterBuffers: Buffers | null;
  beforeWaiting: Waiting | null; afterWaiting: Waiting | null;
  beforeCommonMinutes: number | null; afterCommonMinutes: number | null; incomingMinutes?: number | null;
  referenceLabel?: string; alternativeLabel?: string; caption?: string;
}) {
  const rows: [string, Cell, Cell][] = [
    ["Scheduled stand handovers", beforeBuffers?.handovers, afterBuffers?.handovers],
    ["Tight handovers", beforeBuffers?.tight, afterBuffers?.tight],
    ["Minimum scheduled buffer (minutes)", beforeBuffers?.minimum, afterBuffers?.minimum],
    ["Assessed assigned arrivals", beforeWaiting?.assessed, afterWaiting?.assessed],
    ["Unassessed assigned arrivals", beforeWaiting?.unassessed, afterWaiting?.unassessed],
    ["Waiting for common existing arrivals (minutes)", beforeCommonMinutes, afterCommonMinutes],
  ];
  if (incomingMinutes !== undefined) rows.push(["Incoming illustrative waiting (minutes)", "Not in reference", incomingMinutes]);
  const format = (value: Cell) => typeof value === "number" ? Number(value.toFixed(2)).toString() : value ?? "Not assessed";
  return <table className="timeline-overlay-evidence">
    <caption>{caption}</caption>
    <thead><tr><th>Measure</th><th>{referenceLabel}</th><th>{alternativeLabel}</th></tr></thead>
    <tbody>{rows.map(([label, before, after]) => <tr key={label}>
      <th>{label}</th><td>{format(before)}</td><td>{format(after)}</td>
    </tr>)}</tbody>
  </table>;
}
