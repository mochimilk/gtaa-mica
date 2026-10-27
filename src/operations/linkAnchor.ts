// Where to put a popover about several selected stays (the details, the swap
// question): by the middle of the dashed line the chart draws between them,
// as close as it fits, but never over a selected bar and never past the
// chart's walls (see ./placement). Re-placed as the chart scrolls or resizes.
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { linkRoute, rowsViewport } from "../stand-timeline";
import { placeBeside, type Box, type Placement } from "./placement";

/** An anchor Fluent's positioning accepts: a live box, plus an element for scroll parents. */
export type VirtualAnchor = {
  getBoundingClientRect: () => DOMRect;
  contextElement?: Element;
};

/** Fluent's arrow, from the point it touches to the popover's body, px. */
export const ARROW = 8;
/** The least between the point and the popover's body: the arrow plus an 8px offset, px. */
const GAP = ARROW + 8;
/** Until the popover has been measured, px. */
const GUESSED_SIZE = { width: 300, height: 180 };

const barOf = (occupancyId: string) =>
  document.querySelector(`[data-occupancy-id="${CSS.escape(occupancyId)}"]`);

const boxOf = (rect: DOMRect) => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
const edges = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

/** The chart's stands as they show: between its pinned rulers, below the No stand lane, right of the stand column. */
function chartContentBox(): Box | null {
  const scroller = document.querySelector(".st-scroller");
  return scroller ? edges(rowsViewport(scroller)) : null;
}

/**
 * What the popover is about, on screen now: for two stays, the middle of the
 * dashed line's vertical run between them (worked out with the chart's own
 * routing, so the two always agree); for more, the middle of their bars.
 */
function pointBetween(occupancyIds: readonly string[]): { x: number; y: number } | null {
  const rects = occupancyIds.flatMap((id) => barOf(id)?.getBoundingClientRect() ?? []);
  if (rects.length === 0) return null;
  if (rects.length === 2) {
    const [, [x1, y1], [x2, y2]] = linkRoute(boxOf(rects[0]), boxOf(rects[1]));
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

const samePlacement = (a: Placement | null, b: Placement) =>
  !!a &&
  (a.kind === "beside" && b.kind === "beside"
    ? a.position === b.position && a.align === b.align && a.gap === b.gap
    : a.kind === "near" && b.kind === "near" && Math.abs(a.dx - b.dx) < 1 && Math.abs(a.dy - b.dy) < 1);

/** Fluent positioning for a popover about several stays: where it goes, and whether its arrow shows. */
export type BesidePlacement = {
  target: VirtualAnchor;
  position: "after" | "before" | "below" | "above";
  align: "start" | "center" | "end";
  offset: number;
  withArrow: boolean;
};

/**
 * Places a popover about these stays (null for none): by the point between
 * them, clear of every one of their bars, inside the chart, and kept where
 * it is while that stays clear (see placeBeside). Placed before it is first
 * painted, and again when it, the chart or the window changes size, or the
 * chart scrolls. `surfaceRef` is the popover's surface, measured so the
 * placement fits it.
 */
export function useBesidePlacement(
  occupancyIds: readonly string[] | null,
  open: boolean,
  surfaceRef: RefObject<HTMLElement | null>,
): BesidePlacement | null {
  const key = occupancyIds && occupancyIds.length >= 2 ? occupancyIds.join("|") : "";
  const [placement, setPlacement] = useState<Placement | null>(null);
  const current = useRef<Placement | null>(null);

  useLayoutEffect(() => {
    current.current = null;
    if (!open || !key) {
      setPlacement(null);
      return undefined;
    }
    const ids = key.split("|");
    let frame = 0;
    const place = () => {
      frame = 0;
      const bars = ids.flatMap((id) => barOf(id)?.getBoundingClientRect() ?? []);
      const point = pointBetween(ids);
      const walls = chartContentBox();
      if (!point || !walls || bars.length === 0) return;
      const surface = surfaceRef.current?.getBoundingClientRect();
      const size = surface && surface.width > 0 ? { width: surface.width, height: surface.height } : GUESSED_SIZE;
      const next = placeBeside(point, size, bars.map(edges), walls, GAP, current.current);
      if (samePlacement(current.current, next)) return;
      current.current = next;
      setPlacement(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    // Its real size, once laid out, and whenever it changes.
    const resize = new ResizeObserver(schedule);
    if (surfaceRef.current) resize.observe(surfaceRef.current);
    const scroller = document.querySelector(".st-scroller");
    if (scroller) resize.observe(scroller);
    const settle = requestAnimationFrame(() => {
      if (surfaceRef.current) resize.observe(surfaceRef.current);
      schedule();
    });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(settle);
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [open, key, surfaceRef]);

  return useMemo(() => {
    if (!key || !placement) return null;
    const ids = key.split("|");
    const contextElement = barOf(ids[0]) ?? undefined;
    // The point, live, so the popover follows the bars as the chart scrolls.
    const at = () => pointBetween(ids) ?? { x: 0, y: 0 };
    if (placement.kind === "near") {
      return {
        // Its top-left, held at the same offset from the point.
        target: {
          getBoundingClientRect: () => {
            const point = at();
            return new DOMRect(point.x + placement.dx, point.y + placement.dy, 0, 0);
          },
          contextElement,
        },
        position: "below",
        align: "start",
        offset: 0,
        withArrow: false,
      };
    }
    return {
      target: {
        getBoundingClientRect: () => {
          const point = at();
          return new DOMRect(point.x, point.y, 0, 0);
        },
        contextElement,
      },
      position: placement.position,
      align: placement.align,
      // As far out as clears the bars; the arrow still points at the line.
      offset: placement.gap - ARROW,
      withArrow: true,
    };
  }, [key, placement]);
}
