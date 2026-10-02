// App-owned scroll region with subtle top/bottom fades that appear only when
// content is hidden above/below. Fades are decorative overlays (aria-hidden,
// pointer-events: none) sized to the scroller's client box, so they never
// cover native scrollbars, and the top fade starts below a sticky <thead>.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface OverflowScrollProps {
  /** Class for the scrolling element itself (keeps existing scroller styles/lookups). */
  className?: string;
  children?: ReactNode;
}

interface FadeState {
  top: boolean;
  bottom: boolean;
  /** Top inset: height of a sticky table header inside the scroller, if any. */
  insetTop: number;
  /** Bottom inset: height of a horizontal scrollbar, if any. */
  insetBottom: number;
  /** Width of the visible content area (excludes a vertical scrollbar). */
  width: number;
}

const HIDDEN: FadeState = { top: false, bottom: false, insetTop: 0, insetBottom: 0, width: 0 };
const THRESHOLD = 1; // px of hidden content before a fade shows

const same = (a: FadeState, b: FadeState) =>
  a.top === b.top &&
  a.bottom === b.bottom &&
  a.insetTop === b.insetTop &&
  a.insetBottom === b.insetBottom &&
  a.width === b.width;

export function OverflowScroll({ className, children }: OverflowScrollProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<FadeState>(HIDDEN);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      // Collapsed (display: none somewhere above): no fades.
      if (el.offsetParent === null || el.clientHeight === 0) {
        setFade((cur) => (same(cur, HIDDEN) ? cur : HIDDEN));
        return;
      }
      const thead = el.querySelector("thead");
      const next: FadeState = {
        top: el.scrollTop > THRESHOLD,
        bottom: el.scrollHeight - el.clientHeight - el.scrollTop > THRESHOLD,
        insetTop: thead ? thead.offsetHeight : 0,
        insetBottom: Math.max(0, el.offsetHeight - el.clientHeight),
        width: el.clientWidth,
      };
      // Only update when something changed, so measuring can't loop renders.
      setFade((cur) => (same(cur, next) ? cur : next));
    };
    // Coalesce bursts (scroll, resize, mutations) into one measure per frame.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const resize = new ResizeObserver(schedule);
    const observeChildren = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of Array.from(el.children)) resize.observe(child);
    };
    // Content changes (e.g. an alert acknowledged, list swapped for an empty
    // message) can change scrollHeight without resizing the scroller.
    const mutations = new MutationObserver(() => {
      observeChildren();
      schedule();
    });

    observeChildren();
    mutations.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", schedule, { passive: true });
    measure();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("scroll", schedule);
      mutations.disconnect();
      resize.disconnect();
    };
  }, []);

  return (
    <div className="ofs">
      <div ref={scrollerRef} className={className}>
        {children}
      </div>
      <div
        className={fade.top ? "ofs-fade ofs-fade--top ofs-fade--on" : "ofs-fade ofs-fade--top"}
        style={{ top: fade.insetTop, width: fade.width }}
        aria-hidden="true"
      />
      <div
        className={fade.bottom ? "ofs-fade ofs-fade--bottom ofs-fade--on" : "ofs-fade ofs-fade--bottom"}
        style={{ bottom: fade.insetBottom, width: fade.width }}
        aria-hidden="true"
      />
    </div>
  );
}
