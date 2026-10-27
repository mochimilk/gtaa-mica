import type { BarEnds, BarEndShape, Millis } from "./model";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export interface TimeScale {
  domain: readonly [Millis, Millis];
  width: number;
  x(t: Millis): number;
}

export function createTimeScale(
  domain: readonly [Millis, Millis],
  width: number,
): TimeScale {
  const [d0, d1] = domain;
  const k = width / Math.max(1, d1 - d0);
  return { domain, width, x: (t) => (t - d0) * k };
}

/** Tick times aligned to multiples of `stepMs` since the epoch, inside the domain. */
export function timeTicks(
  domain: readonly [Millis, Millis],
  stepMs: number,
): Millis[] {
  const ticks: Millis[] = [];
  for (let t = Math.ceil(domain[0] / stepMs) * stepMs; t <= domain[1]; t += stepMs) {
    ticks.push(t);
  }
  return ticks;
}

export function clipInterval(
  start: Millis,
  end: Millis,
  domain: readonly [Millis, Millis],
): { start: Millis; end: Millis; clippedStart: boolean; clippedEnd: boolean } | null {
  if (end <= domain[0] || start >= domain[1] || end <= start) return null;
  return {
    start: Math.max(start, domain[0]),
    end: Math.min(end, domain[1]),
    clippedStart: start < domain[0],
    clippedEnd: end > domain[1],
  };
}

/** Truncate text with an ellipsis to roughly fit `widthPx`. Returns "" if nothing useful fits. */
export function fitLabel(text: string, widthPx: number, charPx: number): string {
  const max = Math.floor(widthPx / charPx);
  if (text.length <= max) return text;
  if (max < 3) return "";
  return text.slice(0, max - 1).trimEnd() + "…";
}

export type Point = readonly [number, number];

export interface BarBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Orthogonal route from bar `a` to bar `b`, leaving and entering at their
 * vertical centres, `outset` px outside each edge:
 * - b after a: a's end edge → elbow halfway across the gap → b's start edge.
 * - b before a: a's start edge → elbow halfway → b's end edge.
 * - overlapping in time: a bracket out past both end edges by `bracket` px.
 */
export function linkRoute(a: BarBox, b: BarBox, outset = 1.5, bracket = 16): Point[] {
  const ay = a.y + a.height / 2;
  const by = b.y + b.height / 2;
  const aStart = a.x - outset;
  const aEnd = a.x + a.width + outset;
  const bStart = b.x - outset;
  const bEnd = b.x + b.width + outset;
  let x1: number;
  let x2: number;
  let mid: number;
  if (bStart >= aEnd) {
    [x1, x2] = [aEnd, bStart];
    mid = (x1 + x2) / 2;
  } else if (bEnd <= aStart) {
    [x1, x2] = [aStart, bEnd];
    mid = (x1 + x2) / 2;
  } else {
    [x1, x2] = [aEnd, bEnd];
    mid = Math.max(aEnd, bEnd) + bracket;
  }
  return [[x1, ay], [mid, ay], [mid, by], [x2, by]];
}

/**
 * SVG path through `points` with each corner rounded by up to `radius`,
 * clamped to half of the shorter adjoining segment. Repeated points are dropped.
 */
export function roundedPath(points: readonly Point[], radius: number): string {
  const pts = points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1],
  );
  if (pts.length === 0) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const lin = Math.hypot(cx - px, cy - py);
    const lout = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, lin / 2, lout / 2);
    const ax = cx - ((cx - px) / lin) * r;
    const ay = cy - ((cy - py) / lin) * r;
    const bx = cx + ((nx - cx) / lout) * r;
    const by = cy + ((ny - cy) / lout) * r;
    d += ` L${ax},${ay} Q${cx},${cy} ${bx},${by}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last[0]},${last[1]}`;
}

/** Both ends round: a plain rounded bar. */
export const ROUND_ENDS: BarEnds = { start: "round", end: "round" };

/**
 * End shapes scale with the bar's height, so a taller box (a card, say) has
 * the same shape: a taper's point is this share of the height out from its
 * shoulders, and a zigzag's teeth reach this share in, ZIGZAG_TEETH of them.
 */
const TAPER_RATIO = 0.3;
const ZIGZAG_RATIO = 0.12;
const ZIGZAG_TEETH = 3;

/** How far an end's shape reaches in from the bar's edge, px; 0 for a round end. */
export function barEndDepth(shape: BarEndShape, height: number): number {
  return shape === "taper" ? height * TAPER_RATIO : shape === "zigzag" ? height * ZIGZAG_RATIO : 0;
}

/** A polygon vertex, rounded by up to `r`. */
interface Corner {
  x: number;
  y: number;
  r: number;
}

/**
 * One end's vertices, top to bottom, at `edge`, reaching in towards `inward`
 * (+1 for the start, -1 for the end), never past the bar's middle.
 */
function endCorners(shape: BarEndShape, edge: number, inward: 1 | -1, box: BarBox, radius: number): Corner[] {
  const { y, width, height } = box;
  const reach = Math.min(barEndDepth(shape, height), width / 2);
  const at = (depth: number, dy: number, r: number): Corner => ({ x: edge + inward * depth, y: y + dy, r });
  if (shape === "taper") {
    // A softened point: its tip and shoulders take half the corners' rounding.
    return [at(reach, 0, radius / 2), at(0, height / 2, radius / 2), at(reach, height, radius / 2)];
  }
  if (shape === "zigzag") {
    // Sharp teeth pointing out to the edge, from the corners' inner side.
    return Array.from({ length: 2 * ZIGZAG_TEETH + 1 }, (_, k) =>
      at(k % 2 ? 0 : reach, (k * height) / (2 * ZIGZAG_TEETH), 0),
    );
  }
  return [at(0, 0, radius), at(0, height, radius)];
}

/** Unit vector from a to b. */
function unit(a: Corner, b: Corner): Point {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return [(b.x - a.x) / l, (b.y - a.y) / l];
}

/** Whether the polygon turns clockwise (on screen) at b: a convex corner of a clockwise polygon. */
function convex(a: Corner, b: Corner, c: Corner): boolean {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) >= 0;
}

/**
 * A clockwise polygon grown `by` px all round: each edge moved out along its
 * normal, so the new edges stay parallel, and each rounding kept concentric.
 */
function grow(corners: readonly Corner[], by: number): Corner[] {
  const n = corners.length;
  return corners.map((c, i) => {
    const prev = corners[(i + n - 1) % n];
    const next = corners[(i + 1) % n];
    const [d1x, d1y] = unit(prev, c);
    const [d2x, d2y] = unit(c, next);
    // Outward normals of a clockwise polygon on screen (y down).
    const [n1x, n1y, n2x, n2y] = [d1y, -d1x, d2y, -d2x];
    const k = by / (1 + n1x * n2x + n1y * n2y);
    const r = c.r > 0 ? Math.max(0, c.r + (convex(prev, c, next) ? by : -by)) : 0;
    return { x: c.x + (n1x + n2x) * k, y: c.y + (n1y + n2y) * k, r };
  });
}

const fmt = (v: number) => +v.toFixed(2);

/**
 * Closed SVG path through a clockwise polygon, each vertex rounded by a
 * circular arc of up to its `r`, clamped to half of the shorter adjoining edge.
 */
function roundedPolygon(corners: readonly Corner[]): string {
  const n = corners.length;
  let d = "";
  corners.forEach((c, i) => {
    const prev = corners[(i + n - 1) % n];
    const next = corners[(i + 1) % n];
    const l1 = Math.hypot(prev.x - c.x, prev.y - c.y);
    const l2 = Math.hypot(next.x - c.x, next.y - c.y);
    const [u1x, u1y] = unit(c, prev);
    const [u2x, u2y] = unit(c, next);
    // Half the angle between the two edges at this vertex.
    const half = Math.acos(Math.min(1, Math.max(-1, u1x * u2x + u1y * u2y))) / 2;
    const t = c.r > 0 && half > 1e-3 && half < Math.PI / 2 - 1e-3 ? Math.min(c.r / Math.tan(half), l1 / 2, l2 / 2) : 0;
    d += `${i ? "L" : "M"}${fmt(c.x + u1x * t)},${fmt(c.y + u1y * t)}`;
    if (t > 0) {
      const r = fmt(t * Math.tan(half));
      d += `A${r},${r} 0 0 ${convex(prev, c, next) ? 1 : 0} ${fmt(c.x + u2x * t)},${fmt(c.y + u2y * t)}`;
    }
  });
  return `${d}Z`;
}

/**
 * SVG path of a bar in `box`, each end drawn as `ends` says: round (its
 * corners rounded by `radius`, as a rounded rectangle), tapered to a point
 * at mid-height, or zigzagged. Neither end's shape reaches past the middle.
 * `outset` grows it that far all round, e.g. for an outline around the bar,
 * with its edges parallel to the bar's and its curves concentric.
 */
export function barPath(box: BarBox, ends: BarEnds, radius: number, outset = 0): string {
  // Clockwise from the top right: down the end, then up the start.
  const corners = [
    ...endCorners(ends.end, box.x + box.width, -1, box, radius),
    ...endCorners(ends.start, box.x, 1, box, radius).reverse(),
  ].filter((c, i, all) => {
    // Two ends meeting at the middle share a vertex; keep one.
    const prev = all[(i + all.length - 1) % all.length];
    return Math.hypot(c.x - prev.x, c.y - prev.y) > 1e-6;
  });
  return roundedPolygon(outset ? grow(corners, outset) : corners);
}

/** Snap a coordinate to the pixel grid for crisp 1px lines. */
export function crisp(v: number): number {
  return Math.round(v) + 0.5;
}
