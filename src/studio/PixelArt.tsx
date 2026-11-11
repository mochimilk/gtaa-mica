import { memo, type CSSProperties } from "react";
import { GRID, type Pixels } from "./drawings";

/**
 * The size, px, nearest `target` at which each of a drawing's pixels covers
 * a whole number of device pixels (at least one), so its pixels come out
 * alike, its lines even, however the screen scales.
 */
export function crispSize(target: number) {
  const ratio = globalThis.devicePixelRatio || 1;
  return (Math.max(1, Math.round((target * ratio) / GRID)) * GRID) / ratio;
}

/** Each drawing's outline as one path, made once per drawing. */
const paths = new WeakMap<Pixels, string>();

/** A drawing's pixels that are on, as one path: a rectangle per run of them along a row. */
function pixelPath(pixels: Pixels): string {
  let d = paths.get(pixels);
  if (d !== undefined) return d;
  d = "";
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!pixels[y * GRID + x]) continue;
      let run = 1;
      while (x + run < GRID && pixels[y * GRID + x + run]) run++;
      d += `M${x} ${y}h${run}v1h${-run}z`;
      x += run - 1;
    }
  }
  paths.set(pixels, d);
  return d;
}

export interface PixelArtProps {
  pixels: Pixels;
  /** Its width and height, px; from crispSize, to keep every pixel crisp. */
  size: number;
  className?: string;
  /** E.g. its `color`, where that differs bar to bar. */
  style?: CSSProperties;
}

/**
 * A drawing at a small size, e.g. on a board bar or in the Studio's list:
 * its pixels that are on, edges unblended, in the current text colour, as
 * one path (a board shows a hundred of these). Decorative; where it matters,
 * the text beside it names what it belongs to.
 */
export const PixelArt = memo(function PixelArt({ pixels, size, className, style }: PixelArtProps) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={pixelPath(pixels)} />
    </svg>
  );
});
