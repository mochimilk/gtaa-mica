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

export interface PixelArtProps {
  pixels: Pixels;
  /** Its width and height, px; from crispSize, to keep every pixel crisp. */
  size: number;
  className?: string;
}

/**
 * A drawing at a small size, e.g. on a board bar or in the Studio's list:
 * one square per pixel that is on, edges unblended, in the current text
 * colour. Decorative; where it matters, the text beside it names what it
 * belongs to.
 */
export function PixelArt({ pixels, size, className }: PixelArtProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {pixels.map((on, i) =>
        on ? <rect key={i} x={i % GRID} y={Math.floor(i / GRID)} width={1} height={1} /> : null,
      )}
    </svg>
  );
}
