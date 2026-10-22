// App-owned Fluent Popover showing the current selection's details and
// actions, anchored to what was selected:
// - assigned selection (any source): the selected timeline bar (last selected
//   when several), scrolled into view if the selection came from the panel;
// - unassigned flight (no bar exists): its list row, or the alert's
//   "Select" button when chosen from Alerts. No bar is ever invented.
// The reusable chart is untouched; bars are found by their data-occupancy-id.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Popover,
  PopoverSurface,
  type OnOpenChangeData,
  type OpenPopoverEvents,
  type PositioningImperativeRef,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { FlightActions, selectionTitle } from "./FlightActions";
import {
  selectedFlight,
  useOperations,
  type OpsSelection,
  type SelectionSource,
} from "./OperationsContext";
import "./operations.css";

type AnchorEl = HTMLElement | SVGElement;

/** Elements that open the popover themselves; clicks/focus on them must not close it. */
const TRIGGERS = "[data-occupancy-id], tr[data-flight-id], [data-ops-alert-flight]";

const isRendered = (el: Element) => {
  const r = el.getBoundingClientRect();
  return el.isConnected && r.width > 0 && r.height > 0;
};

function query(selector: string): AnchorEl | null {
  const el = document.querySelector<HTMLElement | SVGElement>(selector);
  return el && isRendered(el) ? el : null;
}

function findAnchor(selection: OpsSelection, source: SelectionSource): AnchorEl | null {
  const occupancyId = selection.occupancyIds.at(-1);
  if (occupancyId) return query(`[data-occupancy-id="${CSS.escape(occupancyId)}"]`);
  const flightId = selection.flightId;
  if (!flightId) return null;
  const row = `tr[data-flight-id="${CSS.escape(flightId)}"]`;
  const alert = `[data-ops-alert-flight="${CSS.escape(flightId)}"]`;
  return source === "alert" ? query(alert) ?? query(row) : query(row) ?? query(alert);
}

const SCROLL_REGION = ".st-scroller, .ops-group-scroll";

/**
 * The part of a scroll region where content is actually visible: its client
 * box (excluding scrollbars), minus pinned overlays measured from the DOM —
 * the chart's sticky rulers (.st-header/.st-footer) and stand gutter
 * (.st-labels), or a list's sticky table header (thead).
 */
function visibleContentBox(region: Element) {
  const r = region.getBoundingClientRect();
  let top = r.top + region.clientTop;
  let left = r.left + region.clientLeft;
  let bottom = top + region.clientHeight;
  const right = left + region.clientWidth;
  const rect = (sel: string) => region.querySelector(sel)?.getBoundingClientRect();
  const header = rect(".st-header") ?? rect("thead");
  const footer = rect(".st-footer");
  const gutter = rect(".st-labels");
  if (header) top = Math.max(top, header.bottom);
  if (footer) bottom = Math.min(bottom, footer.top);
  if (gutter) left = Math.max(left, gutter.right);
  return { top, left, bottom, right };
}

/**
 * Scroll the chart just enough that the bar sits fully inside the visible
 * content area (between the UTC rulers, right of the pinned gutter). A bar
 * wider/taller than that area is aligned to its start edge.
 */
function revealBar(el: AnchorEl) {
  const region = el.closest<HTMLElement>(".st-scroller");
  if (!region) return;
  const box = visibleContentBox(region);
  const r = el.getBoundingClientRect();
  const delta = (start: number, end: number, min: number, max: number) =>
    start < min ? start - min : end > max ? Math.min(end - max, start - min) : 0;
  region.scrollTop += delta(r.top, r.bottom, box.top, box.bottom);
  region.scrollLeft += delta(r.left, r.right, box.left, box.right);
}

/** Is any part of the anchor visible in its region's content area? */
function anchorVisible(el: AnchorEl): boolean {
  if (!isRendered(el)) return false;
  const region = el.closest(SCROLL_REGION);
  if (!region) return true;
  const r = el.getBoundingClientRect();
  const box = visibleContentBox(region);
  return r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right;
}

export function SelectionPopover() {
  const {
    selection,
    detailsOpen,
    setDetailsOpen,
    selectionSource,
    selectionRequest,
    clearSelection,
    dataset,
  } = useOperations();
  const [anchor, setAnchor] = useState<AnchorEl | null>(null);
  const returnFocusRef = useRef<HTMLElement | SVGElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const positioningRef = useRef<PositioningImperativeRef>(null);
  const titleId = useId();
  const flight = selectedFlight(selection, dataset);

  // Resolve the anchor on every selection request (so reselecting the same
  // item reopens) and remember where focus was, for focus return on close.
  useLayoutEffect(() => {
    if (!detailsOpen) {
      setAnchor(null);
      return;
    }
    const active = document.activeElement as HTMLElement | SVGElement | null;
    if (active && active !== document.body && !surfaceRef.current?.contains(active)) {
      returnFocusRef.current = active;
    }
    const el = findAnchor(selection, selectionSource);
    // An assigned flight picked in the panel reveals its bar automatically.
    // Unassigned flights have no bar, so nothing scrolls for them.
    if (el && selectionSource !== "chart" && el.matches("[data-occupancy-id]")) revealBar(el);
    setAnchor(el);
  }, [detailsOpen, selection, selectionSource, selectionRequest]);

  // Follow the anchor; once it is hidden in its region or disappears, dismiss
  // like any other close (clears the selection; clearing never scrolls).
  // Triggers: any scroll (capture), window resize, and
  // a ResizeObserver on the anchor and its scroll region — which also fires
  // when a group collapses (Coral sets display:none, the region goes to 0)
  // or the panel is resized. One check per frame at most; no polling.
  useEffect(() => {
    if (!detailsOpen || !anchor) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      if (!anchorVisible(anchor)) clearSelection();
      else positioningRef.current?.updatePosition();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(anchor);
    const region = anchor.closest(SCROLL_REGION);
    if (region) resize.observe(region);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    schedule(); // initial check once bound (anchor may already be hidden)
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [detailsOpen, anchor, clearSelection]);

  // Fluent positions against an element or a virtual element; SVG bars use
  // the virtual form (live rect, with the bar as context for scroll parents).
  const target = useMemo(
    () =>
      anchor
        ? {
            getBoundingClientRect: () => anchor.getBoundingClientRect(),
            contextElement: anchor,
          }
        : null,
    [anchor],
  );

  const restoreFocus = () => {
    const el = returnFocusRef.current;
    if (el?.isConnected) el.focus({ preventScroll: true });
  };

  // Every dismiss (close button, Escape, outside click/focus) clears the
  // selection and closes the popover, except the toolbar case below.
  const onOpenChange = (e: OpenPopoverEvents, data: OnOpenChangeData) => {
    if (data.open) return;
    // Clicking/focusing another bar, row or alert button re-targets instead:
    // its own handler sets the new selection, which must not be cleared.
    const t = e.target;
    if (t instanceof Element && t.closest(TRIGGERS)) return;
    // Views/Filters toolbar and its menus: close the details so the menu can
    // take focus, but keep the selection (filters never clear it either).
    if (t instanceof Element && t.closest("[data-ops-keep-selection]")) {
      setDetailsOpen(false);
      return;
    }
    clearSelection();
    if (e.type === "keydown") restoreFocus(); // Escape returns focus
  };

  const close = () => {
    clearSelection();
    restoreFocus();
  };

  if (!target) return null;
  const isBar = !!anchor?.matches("[data-occupancy-id]");

  return (
    <Popover
      open={detailsOpen}
      onOpenChange={onOpenChange}
      trapFocus
      withArrow
      size="small"
      positioning={{
        target,
        positioningRef,
        position: isBar ? "below" : "after",
        align: isBar ? "center" : "top",
        fallbackPositions: ["above", "after", "before", "below"],
      }}
    >
      <PopoverSurface ref={surfaceRef} aria-labelledby={titleId} className="ops-popover">
        <div className="ops-popover-head">
          <h2 id={titleId} className="ops-popover-title">
            {selectionTitle(selection.occupancyIds, flight)}
          </h2>
          <Button
            size="small"
            appearance="subtle"
            icon={<DismissRegular />}
            aria-label="Close details and clear selection"
            onClick={close}
          />
        </div>
        <FlightActions />
      </PopoverSurface>
    </Popover>
  );
}
