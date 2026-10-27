// Where a chart's rows show on screen, for hosts (and the chart's own drag)
// that need to know whether a bar shows, or where to aim at one. Measured
// from the DOM, so it follows scrolling, resizing and the pinned rulers.
import type { TimelineSection } from "./context";

/**
 * Where a section's rows show now inside the chart's scroller (.st-scroller):
 * for the body, below the top ruler and the pinned rows, above the bottom
 * ruler; for "pinned", the pinned rows' own strip. Either way, right of the
 * row labels. Empty (no height) for "pinned" when the chart has no pinned rows.
 */
export function rowsViewport(scroller: Element, section: TimelineSection = "body"): DOMRect {
  const box = scroller.getBoundingClientRect();
  const rect = (selector: string) => scroller.querySelector(selector)?.getBoundingClientRect();
  let top = box.top + scroller.clientTop;
  let bottom = top + scroller.clientHeight;
  let left = box.left + scroller.clientLeft;
  const right = left + scroller.clientWidth;
  const pinned = rect(".st-pinned");
  if (section === "pinned") {
    top = Math.max(top, pinned?.top ?? bottom);
    bottom = Math.min(bottom, pinned?.bottom ?? bottom);
  } else {
    top = Math.max(top, rect(".st-header")?.bottom ?? top, pinned?.bottom ?? top);
    bottom = Math.min(bottom, rect(".st-footer")?.top ?? bottom);
  }
  left = Math.max(left, rect(".st-labels")?.right ?? left);
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/** Which section of its chart an element is in: a bar, a row label. */
export const sectionOf = (element: Element): TimelineSection => (element.closest(".st-pinned") ? "pinned" : "body");
