// A closed stand area on the chart (see Closure in ./allocation): a hatched
// band over the area's stands for the closure's hours, drawn under the bars,
// and a label drawn over them so no bar hides it. Custom chart layers, so
// they share the chart's coordinates and scroll with it.
import { useId } from "react";
import { useTimeline, useTimelineRegion, type TimelineContextValue } from "../stand-timeline";
import { formatUtc } from "../stand-timeline-demo/demoData";
import { standArea, type Closure } from "./allocation";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Where the closure is on the plot, or null when none of it shows. */
function closureBox(closure: Closure, { rows, rowHeight, scale }: TimelineContextValue) {
  const indices = rows.flatMap((row, index) => (standArea(row.id) === closure.area ? [index] : []));
  if (indices.length === 0) return null;
  const x0 = clamp(scale.x(closure.from), 0, scale.width);
  const x1 = clamp(scale.x(closure.to), 0, scale.width);
  if (x1 - x0 < 1) return null;
  const y = Math.min(...indices) * rowHeight;
  return { x: x0, y, width: x1 - x0, height: (Math.max(...indices) + 1) * rowHeight - y };
}

const describe = (closure: Closure) => `${closure.area} closed ${formatUtc(closure.from)}–${formatUtc(closure.to)}`;

/**
 * The hatched band, under the bars, showing through their glass. Skye's
 * cursor goes to it (`data-closure-band`) before it clears the area. Its
 * pattern has an id of its own (useId).
 */
export function ClosureBand({ closure }: { closure: Closure | null }) {
  const region = useTimelineRegion();
  const timeline = useTimeline();
  const hatchId = `ops-closure-hatch-${useId().replace(/[^\w-]/g, "")}`;
  const box = region === "plot" && closure ? closureBox(closure, timeline) : null;
  if (!box) return null;
  return (
    <g className="ops-closure" pointerEvents="none" aria-hidden="true">
      <defs>
        <pattern id={hatchId} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="ops-closure-fill" width={8} height={8} />
          <line className="ops-closure-stripe" x1={0} y1={0} x2={0} y2={8} />
        </pattern>
      </defs>
      <rect data-closure-band="" className="ops-closure-band" {...box} rx={4} fill={`url(#${hatchId})`} />
    </g>
  );
}

/** Roughly how wide the label's 10px semibold text is per character, px; sizes its pill. */
const LABEL_CHAR_PX = 6;

/** The band's label, over the bars: a pill at its top-left, "Pier B closed 09:00–13:00". */
export function ClosureLabel({ closure }: { closure: Closure | null }) {
  const region = useTimelineRegion();
  const timeline = useTimeline();
  const box = region === "plot" && closure ? closureBox(closure, timeline) : null;
  if (!box || !closure) return null;
  const text = describe(closure);
  return (
    <g className="ops-closure-label" pointerEvents="none" role="img" aria-label={text}>
      <rect x={box.x + 4} y={box.y + 3} width={text.length * LABEL_CHAR_PX + 12} height={16} rx={8} />
      <text x={box.x + 10} y={box.y + 14.5} aria-hidden="true">
        {text}
      </text>
    </g>
  );
}
