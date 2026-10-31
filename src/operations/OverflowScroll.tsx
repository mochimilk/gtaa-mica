// App-owned scroll region whose content fades to transparent at an edge with
// more past it, so it works over any surface, clear glass included. Each fade
// grows with the distance hidden past its edge (up to MASK_FADE), so it eases
// in as scrolling starts and out at the end. The mask is on the scroller's own
// box, which stays put while the compositor scrolls the content, so a fast
// scroll can't outrun it. A `header` (a table's column headings, say) sits
// above the scroller rather than sticking inside it, so nothing scrolls
// beneath it and it needs no surface of its own: it keeps the scroller's
// scrollbar gutter (operations.css), so columns line up, and follows its
// horizontal scroll.
import { useLayoutEffect, useRef, type ReactNode } from "react";

export interface OverflowScrollProps {
  /** Class for the scrolling element itself (keeps existing scroller styles/lookups). */
  className?: string;
  /** Fixed content above the scroll region, aligned with it (e.g. column headings). */
  header?: ReactNode;
  children?: ReactNode;
}

/** How far an edge fades, px, once at least that much is hidden past it. */
const MASK_FADE = 16;
const THRESHOLD = 1; // px of hidden content before a fade starts

/**
 * The scroller's mask: opaque, fading in over `top` px and out over `bottom`
 * px, plus an opaque strip down a vertical scrollbar `bar` px wide so the
 * scrollbar itself never fades.
 */
function edgeMask(top: number, bottom: number, bar: number) {
  const fade = `linear-gradient(to bottom, transparent, #000 ${top}px, #000 calc(100% - ${bottom}px), transparent)`;
  return bar > 0 ? `${fade}, linear-gradient(#000, #000) right / ${bar}px 100% no-repeat` : fade;
}

export function OverflowScroll({ className, header, children }: OverflowScrollProps) {
  const headRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;

    // Collapsed (display: none somewhere above) measures 0 throughout: no mask.
    const measure = () => {
      frame = 0;
      const hiddenBelow = el.scrollHeight - el.clientHeight - el.scrollTop;
      const top = el.scrollTop > THRESHOLD ? Math.min(MASK_FADE, el.scrollTop) : 0;
      const bottom = hiddenBelow > THRESHOLD ? Math.min(MASK_FADE, hiddenBelow) : 0;
      el.style.mask = top || bottom ? edgeMask(top, bottom, el.offsetWidth - el.clientWidth) : "";
    };
    // Coalesce bursts (scroll, resize, mutations) into one measure per frame.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      if (headRef.current) headRef.current.scrollLeft = el.scrollLeft;
      schedule();
    };

    const resize = new ResizeObserver(schedule);
    const observeChildren = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of Array.from(el.children)) resize.observe(child);
    };
    // Content changes (e.g. a row added, list swapped for an empty message)
    // can change scrollHeight without resizing the scroller.
    const mutations = new MutationObserver(() => {
      observeChildren();
      schedule();
    });

    observeChildren();
    mutations.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    measure();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      mutations.disconnect();
      resize.disconnect();
    };
  }, []);

  return (
    <div className="ofs">
      {header != null && (
        <div ref={headRef} className="ofs-head">
          {header}
        </div>
      )}
      <div ref={scrollerRef} className={className}>
        {children}
      </div>
    </div>
  );
}
