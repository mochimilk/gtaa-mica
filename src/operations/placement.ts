// Where a popover about several selected stays goes: as close as it can to the
// point it is about (the middle of the dashed line between two stays), never
// over a selected bar, and inside the chart's walls.
//
// It tries each side of the point (after, before, below, above), centred on
// it first, then flush with it at either end, and takes the first that is
// clear. Only when none is does it look for the clear spot nearest the
// point, so it does not wander off to one side when there is room by the line.
// Once placed it stays put while that place is still clear, so it does not
// hop from side to side as the chart scrolls.
// Pure geometry: boxes in viewport pixels, no DOM.

export type Box = { left: number; top: number; right: number; bottom: number };
export type Side = "after" | "before" | "below" | "above";
export type Align = "start" | "center" | "end";

export type Placement =
  /**
   * Beside the point, its arrow pointing at it, `gap` px away: further than
   * the usual gap when that is what clears the bars, as below two stays on
   * one stand, whose line runs at the bars' mid-height.
   */
  | { kind: "beside"; position: Side; align: Align; gap: number }
  /** No room beside it: the clear spot nearest it, as its top-left's offset from the point, so it moves with it. */
  | { kind: "near"; dx: number; dy: number };

/** Kept between the popover and a selected bar, px. */
export const BAR_CLEARANCE = 6;
/** Steps the nearest-spot search takes across the chart, px. */
const SEARCH_STEP = 8;
/** Furthest from the point a popover still counts as beside it, px, and the steps out to there. */
const MAX_GAP = 220;
const GAP_STEP = 4;
/** What an off-centre placement costs against a centred one, in px of gap, so centred wins unless much further. */
const OFF_CENTRE = 40;

const ORDER: [Side, Align][] = [
  ["after", "center"],
  ["before", "center"],
  ["below", "center"],
  ["above", "center"],
  ["after", "start"],
  ["after", "end"],
  ["before", "start"],
  ["before", "end"],
  ["below", "start"],
  ["below", "end"],
  ["above", "start"],
  ["above", "end"],
];

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const inflate = (box: Box, by: number): Box => ({
  left: box.left - by,
  top: box.top - by,
  right: box.right + by,
  bottom: box.bottom + by,
});

/** Where the popover's box would be, placed on `side` of `point` with `align`, `gap` away. */
export function besideBox(
  point: { x: number; y: number },
  size: { width: number; height: number },
  side: Side,
  align: Align,
  gap: number,
): Box {
  const across = (start: number, length: number) =>
    align === "start" ? start : align === "end" ? start - length : start - length / 2;
  const left =
    side === "after" ? point.x + gap : side === "before" ? point.x - gap - size.width : across(point.x, size.width);
  const top =
    side === "below" ? point.y + gap : side === "above" ? point.y - gap - size.height : across(point.y, size.height);
  return { left, top, right: left + size.width, bottom: top + size.height };
}

/** The popover's box for a placement about `point`. */
export function placedBox(
  placement: Placement,
  point: { x: number; y: number },
  size: { width: number; height: number },
): Box {
  if (placement.kind === "beside") return besideBox(point, size, placement.position, placement.align, placement.gap);
  const left = point.x + placement.dx;
  const top = point.y + placement.dy;
  return { left, top, right: left + size.width, bottom: top + size.height };
}

/**
 * Where to put a popover of `size` about `point`: where it is (`current`)
 * while that is still clear; else beside the point, on whichever side clears
 * the bars nearest to it (at least `gap` away, centred on it unless that is
 * much further); else the clear spot nearest it; else (nowhere clear at all)
 * after it, the usual place, as a last resort.
 */
export function placeBeside(
  point: { x: number; y: number },
  size: { width: number; height: number },
  avoid: readonly Box[],
  walls: Box,
  gap: number,
  current: Placement | null = null,
): Placement {
  const keepOff = avoid.map((box) => inflate(box, BAR_CLEARANCE));
  const clear = (box: Box) =>
    box.left >= walls.left &&
    box.right <= walls.right &&
    box.top >= walls.top &&
    box.bottom <= walls.bottom &&
    !keepOff.some((bar) => overlaps(box, bar));

  if (current && clear(placedBox(current, point, size))) return current;
  let beside: { position: Side; align: Align; gap: number; cost: number } | null = null;
  for (const [position, align] of ORDER) {
    // The nearest this side and alignment clears the bars, if it does before the walls.
    for (let away = gap; away <= MAX_GAP; away += GAP_STEP) {
      const box = besideBox(point, size, position, align, away);
      if (box.left < walls.left || box.right > walls.right || box.top < walls.top || box.bottom > walls.bottom) {
        // Out past a wall, and further only goes further out.
        const outward =
          (position === "after" && box.right > walls.right) ||
          (position === "before" && box.left < walls.left) ||
          (position === "below" && box.bottom > walls.bottom) ||
          (position === "above" && box.top < walls.top);
        if (outward) break;
        continue;
      }
      if (!clear(box)) continue;
      const cost = away + (align === "center" ? 0 : OFF_CENTRE);
      if (!beside || cost < beside.cost) beside = { position, align, gap: away, cost };
      break;
    }
  }
  if (beside) return { kind: "beside", position: beside.position, align: beside.align, gap: beside.gap };

  // The clear spot nearest the point: its distance to the popover's edge.
  let best: { left: number; top: number; distance: number } | null = null;
  for (let top = walls.top; top + size.height <= walls.bottom; top += SEARCH_STEP) {
    for (let left = walls.left; left + size.width <= walls.right; left += SEARCH_STEP) {
      const box = { left, top, right: left + size.width, bottom: top + size.height };
      if (!clear(box)) continue;
      const dx = Math.max(box.left - point.x, 0, point.x - box.right);
      const dy = Math.max(box.top - point.y, 0, point.y - box.bottom);
      const distance = Math.hypot(dx, dy);
      if (!best || distance < best.distance) best = { left, top, distance };
    }
  }
  return best
    ? { kind: "near", dx: best.left - point.x, dy: best.top - point.y }
    : { kind: "beside", position: "after", align: "center", gap };
}
