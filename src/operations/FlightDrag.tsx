// Dragging a flight that has no stand out of the Arrivals/Departures list and
// onto a stand on the chart, which gives it that stand. Its stay keeps its
// times, so only the stand under the pointer matters: the chart shows a ghost
// of the stay on that stand, green where it can go and red where it cannot,
// a chip follows the pointer with the flight (and, over a stand it cannot go
// on, why), and a drop where it can go gives it the stand. Escape cancels.
//
// This is the panel's way in for people. The same flight's bar in the No
// stand lane drags down onto a stand as well (see ./noStandLane), and that is
// the way Skye's cursor does it, so she never works in the panel.
import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { Portal } from "@fluentui/react-components";
import { barPath, rowsViewport, useTimeline, useTimelineRegion, type Millis } from "../stand-timeline";
import { DEMO_DATA, formatUtc } from "../stand-timeline-demo/demoData";
import { BAR_INSET, stayEnds } from "../stand-timeline-demo/theme";
import { planAssign } from "./allocation";
import { useOperations } from "./OperationsContext";
import type { OpsFlight } from "./operationsData";

/** How far a press on a row must travel before it becomes a drag, px. */
const DRAG_THRESHOLD = 5;
/** Distance from the chart's top and bottom edges where a drag scrolls it, px. */
const AUTOSCROLL_EDGE = 32;

export type FlightDragState = {
  flight: string;
  stayId: string;
  start: Millis;
  end: Millis;
  /** The pointer, in client coordinates. */
  x: number;
  y: number;
  /** The stand under the pointer, or null off the chart's stands. */
  standId: string | null;
  /** Whether the stay can go on that stand under the sample rules. */
  allowed: boolean;
  /** Why it cannot, in a sentence that names it. */
  reason: string | null;
};

/**
 * The flights being dragged onto the chart, by pointer: one for a mouse,
 * one per finger on a touch screen.
 */
let drags: ReadonlyMap<number, FlightDragState> = new Map();
const listeners = new Set<() => void>();

const flightDrags = () => drags;
function subscribeFlightDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function setDrag(pointerId: number, next: FlightDragState | null): void {
  const updated = new Map(drags);
  if (next) updated.set(pointerId, next);
  else updated.delete(pointerId);
  drags = updated;
  for (const listener of listeners) listener();
}

/** The flights being dragged onto the chart now. */
export const useFlightDrags = (): FlightDragState[] => [...useSyncExternalStore(subscribeFlightDrag, flightDrags).values()];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The chart's stands as they show on screen: between its pinned rulers, below the No stand lane, label column included. */
function standsBox(scroller: Element): DOMRect {
  const box = scroller.getBoundingClientRect();
  const rows = rowsViewport(scroller);
  return new DOMRect(box.left, rows.top, scroller.clientWidth, rows.height);
}

/** The stand whose row is under a point on screen, or null when the point is not over the chart's stands. */
export function standAt(x: number, y: number): string | null {
  const scroller = document.querySelector(".st-scroller");
  if (!scroller) return null;
  const box = standsBox(scroller);
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
  // The stands' labels only: the No stand lane is not somewhere to put a flight with no stand.
  for (const label of scroller.querySelectorAll<HTMLElement>(".st-body .st-row-label[data-row-id]")) {
    const rect = label.getBoundingClientRect();
    if (y >= rect.top && y < rect.bottom) return label.dataset.rowId ?? null;
  }
  return null;
}

/** Ends a pointer's drag under way, if any, without dropping. */
const stops = new Map<number, () => void>();

/** Drags past their threshold, so the page shows a closed hand while any is. */
let carrying = 0;

/**
 * Starts dragging a flight with no stand from its row, on a press there. A
 * drop on a stand it can go on calls `onDrop` with its stay and that stand;
 * anything else drops nothing. Rows of flights with no stay times, or with a
 * stand already, do nothing.
 */
export function beginFlightDrag(
  event: ReactPointerEvent,
  flight: OpsFlight,
  onDrop: (stayId: string, standId: string) => void,
): void {
  const stay = flight.unplacedStay;
  if (!stay || flight.standId || event.button !== 0) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const { pointerId, clientX: x0, clientY: y0, isPrimary } = event;
  stops.get(pointerId)?.();
  let active = false;
  let pointer = { x: x0, y: y0 };
  let frame = 0;
  // The verdict is worked out once per stand the pointer passes over.
  let verdictFor: string | null = null;
  let verdict: { allowed: boolean; reason: string | null } = { allowed: false, reason: null };

  const show = () => {
    const standId = standAt(pointer.x, pointer.y);
    if (standId && standId !== verdictFor) {
      const plan = planAssign([stay.stayId], standId);
      verdict = { allowed: plan.assigns.length === 1, reason: plan.unplaceable[0]?.reason ?? null };
      verdictFor = standId;
    }
    const allowed = !!standId && verdict.allowed;
    // The page's cursor follows the primary pointer only.
    if (isPrimary) document.documentElement.classList.toggle("ops-flight-drag--blocked", !!standId && !allowed);
    setDrag(pointerId, {
      flight: flight.flight,
      stayId: stay.stayId,
      start: stay.start,
      end: stay.end,
      ...pointer,
      standId,
      allowed,
      reason: standId && !allowed ? verdict.reason : null,
    });
  };

  // Scrolls the chart while the pointer rests near its top or bottom edge.
  // Only the primary pointer: one chart cannot follow several.
  const autoscroll = () => {
    frame = 0;
    const scroller = document.querySelector<HTMLElement>(".st-scroller");
    if (!active || !scroller || !isPrimary) return;
    const box = standsBox(scroller);
    if (pointer.x < box.left || pointer.x > box.right) return;
    const by =
      pointer.y < box.top + AUTOSCROLL_EDGE
        ? pointer.y - (box.top + AUTOSCROLL_EDGE)
        : pointer.y > box.bottom - AUTOSCROLL_EDGE
          ? pointer.y - (box.bottom - AUTOSCROLL_EDGE)
          : 0;
    if (by === 0 || pointer.y < box.top - AUTOSCROLL_EDGE || pointer.y > box.bottom + AUTOSCROLL_EDGE) return;
    scroller.scrollTop += clamp(by / 3, -12, 12);
    show();
    frame = requestAnimationFrame(autoscroll);
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointer = { x: e.clientX, y: e.clientY };
    if (!active) {
      if (Math.hypot(pointer.x - x0, pointer.y - y0) < DRAG_THRESHOLD) return;
      active = true;
      carrying += 1;
      document.documentElement.classList.add("ops-flight-drag");
      window.getSelection()?.removeAllRanges();
    }
    show();
    if (!frame) frame = requestAnimationFrame(autoscroll);
  };

  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", escape);
    if (frame) cancelAnimationFrame(frame);
    if (active) carrying = Math.max(0, carrying - 1);
    if (carrying === 0) document.documentElement.classList.remove("ops-flight-drag");
    if (isPrimary || carrying === 0) document.documentElement.classList.remove("ops-flight-drag--blocked");
    setDrag(pointerId, null);
    if (stops.get(pointerId) === stop) stops.delete(pointerId);
  };

  const finish = (drop: boolean) => {
    const wasActive = active;
    const last = drags.get(pointerId);
    stop();
    if (!wasActive) return;
    // The click that ends a drag must neither select nor clear.
    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (drop && last?.standId && last.allowed) onDrop(stay.stayId, last.standId);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId === pointerId) finish(true);
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) finish(false);
  };
  const escape = (e: KeyboardEvent) => {
    if (e.key === "Escape") finish(false);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape);
  stops.set(pointerId, stop);
}

/** "09:45–11:10". */
const hours = (drag: FlightDragState) => `${formatUtc(drag.start)}–${formatUtc(drag.end)}`;

/**
 * Each flight being dragged, beside its pointer: its number and hours, the
 * stand under the pointer, and why it cannot go there when it cannot.
 */
export function FlightDragChip() {
  const carried = useFlightDrags();
  if (carried.length === 0) return null;
  // Fluent's Portal, so the chips have the app's theme tokens outside the panel.
  return (
    <Portal>
      {carried.map((drag) => {
        const verdict = drag.standId ? (drag.allowed ? "allowed" : "blocked") : "none";
        return (
          <div
            key={drag.stayId}
            className={`ops-drag-chip ops-drag-chip--${verdict}`}
            style={{ left: drag.x + 18, top: drag.y + 30 }}
            aria-hidden="true"
          >
            <div className="ops-drag-chip-line">
              <span className="ops-drag-chip-flight">{drag.flight}</span>
              <span className="ops-drag-chip-hours">{hours(drag)}</span>
              {drag.standId && (
                <span className="ops-drag-chip-stand">{drag.allowed ? `→ ${drag.standId}` : `✕ ${drag.standId}`}</span>
              )}
            </div>
            {drag.reason && <div className="ops-drag-chip-reason">{drag.reason}</div>}
          </div>
        );
      })}
    </Portal>
  );
}

/**
 * A chart layer: where each dragged flight's stay would land, on the stand
 * under its pointer at its own hours, green where it can go and red where it
 * cannot. Drawn over the bars, like a dragged bar's ghost, in its bar's shape.
 */
export function FlightDropGhost() {
  const region = useTimelineRegion();
  const { rows, rowHeight, barRadius, scale } = useTimeline();
  const { flightStyle } = useOperations();
  const carried = useFlightDrags();
  if (region !== "plot") return null;
  return (
    <>
      {carried.map((drag) => {
        const index = drag.standId ? rows.findIndex((row) => row.id === drag.standId) : -1;
        if (index < 0) return null;
        const x0 = clamp(scale.x(drag.start), 0, scale.width);
        const x1 = clamp(scale.x(drag.end), 0, scale.width);
        const y = index * rowHeight + BAR_INSET;
        const height = rowHeight - 2 * BAR_INSET;
        return (
          <g
            key={drag.stayId}
            className={`st-drop ${drag.allowed ? "st-drop--allowed" : "st-drop--blocked"} ops-flight-drop`}
            data-flight-drop={drag.stayId}
            pointerEvents="none"
            aria-hidden="true"
          >
            <path
              className="st-drop-rect"
              d={barPath(
                { x: x0, y, width: Math.max(2, x1 - x0), height },
                stayEnds(DEMO_DATA.endpoints.get(drag.stayId), flightStyle),
                barRadius,
              )}
            />
            {x1 - x0 > 48 && (
              <text className="ops-flight-drop-label" x={x0 + 8} y={y + height / 2} dominantBaseline="central">
                {drag.flight}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}
