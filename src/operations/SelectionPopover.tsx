// App-owned Fluent Popover showing the current selection's details and
// actions, anchored to what was selected:
// - assigned selection (any source): the selected timeline bar (last selected
//   when several), scrolled into view if the selection came from the panel;
// - unassigned flight: its bar in the No stand lane, also when chosen from
//   the panel or the Alerts menu (which closes as it selects); a flight with
//   no stay times has no bar, so its list row, while the panel shows it.
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
import { agentCursor, isSkyeEvent } from "../components/agent-cursor";
import { rowsViewport, sectionOf } from "../stand-timeline";
import { occupancyById } from "./allocation";
import { ARROW, useBesidePlacement } from "./linkAnchor";
import { FlightActions, selectionTitle } from "./FlightActions";
import { FlightCard, SwapCard } from "./FlightCard";
import { selectedFlight, useOperations, type OpsSelection } from "./OperationsContext";
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

const bar = (occupancyId: string) => query(`[data-occupancy-id="${CSS.escape(occupancyId)}"]`);

function findAnchor(selection: OpsSelection): AnchorEl | null {
  const occupancyId = selection.occupancyIds.at(-1);
  if (occupancyId) return bar(occupancyId);
  const flightId = selection.flightId;
  const waiting = selectedFlight(selection)?.unplacedStay;
  return (waiting && bar(waiting.stayId)) || (flightId ? query(`tr[data-flight-id="${CSS.escape(flightId)}"]`) : null);
}

const SCROLL_REGION = ".st-scroller, .ops-group-scroll";

/**
 * The part of a scroll region where content is actually visible: for the
 * chart, where the rows `el` is among show (the body's between its rulers and
 * below the No stand lane, or the lane's own strip; see rowsViewport); for a
 * list, its client box (excluding scrollbars; its column headings sit above it).
 */
function visibleContentBox(region: Element, el?: Element) {
  if (region.matches(".st-scroller")) return rowsViewport(region, el ? sectionOf(el) : "body");
  const r = region.getBoundingClientRect();
  const top = r.top + region.clientTop;
  const left = r.left + region.clientLeft;
  return { top, left, bottom: top + region.clientHeight, right: left + region.clientWidth };
}

/**
 * Scroll the chart just enough that the bar sits fully inside the visible
 * content area (between the UTC rulers and below the No stand lane, right of
 * the pinned gutter; a bar in the lane only along). A bar wider/taller than
 * that area is aligned to its start edge.
 */
function revealBar(el: AnchorEl) {
  const region = el.closest<HTMLElement>(".st-scroller");
  if (region) revealRect(region, el.getBoundingClientRect(), el);
}

/** As revealBar, for any box on the chart (several bars together, say), among the rows `el` is among. */
export function revealRect(region: HTMLElement, r: DOMRect, el?: Element) {
  const box = visibleContentBox(region, el);
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
  const box = visibleContentBox(region, el);
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
  } = useOperations();
  const [anchor, setAnchor] = useState<AnchorEl | null>(null);
  const returnFocusRef = useRef<HTMLElement | SVGElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const positioningRef = useRef<PositioningImperativeRef>(null);
  const titleId = useId();
  const flight = selectedFlight(selection);

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
    const el = findAnchor(selection);
    // A flight picked in the panel reveals its bar automatically: on its
    // stand, or along the No stand lane for one waiting for a stand.
    if (el && selectionSource !== "chart" && el.matches("[data-occupancy-id]")) revealBar(el);
    setAnchor(el);
  }, [detailsOpen, selection, selectionSource, selectionRequest]);

  // Selecting another stay with the details open: the click focuses its bar,
  // outside the popover, and 100ms later the popover's focus trap (tabster's
  // modalizer) pulls focus back to the first button inside (Swap, once two
  // are selected) unless focus is inside by then. Put it on the card itself
  // instead, as when it first opens. Only the user's selections count as
  // requests, so Skye's never move focus.
  useEffect(() => {
    if (detailsOpen) surfaceRef.current?.focus({ preventScroll: true });
  }, [detailsOpen, selectionRequest]);

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
      // Skye's cursor scrolls the chart between the bars it is selecting;
      // the bar it clicks next becomes the anchor, so the selection stays.
      if (!anchorVisible(anchor)) {
        if (!agentCursor.active) clearSelection();
      } else positioningRef.current?.updatePosition();
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

  // Several stays selected: the details go by the middle of the line between
  // them, as close as they fit, never over any of them, inside the chart.
  const isGroup = selection.occupancyIds.length >= 2 && !!anchor?.matches("[data-occupancy-id]");
  const beside = useBesidePlacement(isGroup ? selection.occupancyIds : null, detailsOpen, surfaceRef);

  // Fluent positions against an element or a virtual element; SVG bars use
  // the virtual form (live rect, with the bar as context for scroll parents).
  const target = useMemo(
    () =>
      anchor
        ? (beside?.target ?? {
            getBoundingClientRect: () => anchor.getBoundingClientRect(),
            contextElement: anchor,
          })
        : null,
    [anchor, beside],
  );

  const restoreFocus = () => {
    const el = returnFocusRef.current;
    if (el?.isConnected) el.focus({ preventScroll: true });
  };

  // Every dismiss (close button, Escape, outside click/focus) clears the
  // selection and closes the popover, except the toolbar case below.
  const onOpenChange = (e: OpenPopoverEvents, data: OnOpenChangeData) => {
    if (data.open) return;
    // The user's details: Skye's clicks elsewhere on the board leave them open.
    if (isSkyeEvent()) return;
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
  // One flight or one stay: the flight card. Two stays: the swap card. Cards
  // have no arrow, title bar or close button (Escape or a click outside
  // closes them); three or more stays get the plain details.
  const single = !!flight || selection.occupancyIds.length === 1;
  const [first, second] = selection.occupancyIds.length === 2 ? selection.occupancyIds.map(occupancyById) : [];
  const pair = !single && first && second ? ([first, second] as const) : null;
  const card = single || !!pair;
  const title = selectionTitle(selection.occupancyIds, flight);

  return (
    <Popover
      open={detailsOpen}
      onOpenChange={onOpenChange}
      trapFocus
      withArrow={!card && (beside?.withArrow ?? true)}
      size="small"
      positioning={
        beside
          ? // Several stays: placed by useBesidePlacement, and held there
            // (a card where its arrow would have put its body).
            {
              target,
              positioningRef,
              position: beside.position,
              align: beside.align,
              offset: card && beside.withArrow ? beside.offset + ARROW : beside.offset,
              pinned: true,
            }
          : {
              target,
              positioningRef,
              // Below a single bar (never over it); beside a row.
              position: isBar ? "below" : "after",
              align: isBar ? "center" : "top",
              fallbackPositions: ["above", "after", "before", "below"],
              offset: single ? 4 : undefined,
            }
      }
    >
      {/* Focusable, so Fluent focuses the card itself as it opens, not its
          first button (Swap, say); Tab reaches the buttons from there. */}
      <PopoverSurface
        ref={surfaceRef}
        tabIndex={-1}
        aria-labelledby={titleId}
        className={card ? "ops-popover ops-popover--card" : "ops-popover"}
      >
        {single ? (
          <FlightCard titleId={titleId} title={title} />
        ) : pair ? (
          <SwapCard titleId={titleId} title={title} pair={pair} />
        ) : (
          <>
            <div className="ops-popover-head">
              <h2 id={titleId} className="ops-popover-title">
                {title}
              </h2>
              <Button
                size="small"
                appearance="subtle"
                icon={<DismissRegular />}
                aria-label="Close details and clear selection"
                data-ops-popover-dismiss=""
                onClick={close}
              />
            </div>
            <FlightActions />
          </>
        )}
      </PopoverSurface>
    </Popover>
  );
}
