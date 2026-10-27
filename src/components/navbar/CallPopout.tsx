import * as React from "react";
import { Portal, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { KEEP_SELECTION_ATTR } from "../../operations/ViewsFiltersToolbar";
import { APP_BAR_HEIGHT } from "../app-bar";
import { CallPanel, type CallPanelProps } from "./CallPanel";

/** Space kept between the window and the viewport's top and sides. */
const INSET = 16;
/** The app bar's height (AppBar), which the window never covers, plus 8px above it. */
const BAR_CLEARANCE = APP_BAR_HEIGHT + 8;

/** Where the window rests: one of the four corners of the room above the app bar. */
type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type Point = { x: number; y: number };

/** Keeps a box of the given size in the room above the app bar while it is dragged. */
function clampToRoom(point: Point, size: { width: number; height: number }): Point {
  const maxX = Math.max(INSET, window.innerWidth - size.width - INSET);
  const maxY = Math.max(INSET, window.innerHeight - BAR_CLEARANCE - size.height);
  return {
    x: Math.min(Math.max(point.x, INSET), maxX),
    y: Math.min(Math.max(point.y, INSET), maxY),
  };
}

/** The corner nearest a dropped window: the quarter of the room its middle is in. */
function nearestCorner(rect: DOMRect): Corner {
  const roomMiddle = (INSET + window.innerHeight - BAR_CLEARANCE) / 2;
  const vertical = rect.top + rect.height / 2 < roomMiddle ? "top" : "bottom";
  const horizontal = rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right";
  return `${vertical}-${horizontal}`;
}

/*
 * Figma's call panel as a floating window: 296px wide on 6px corners with a
 * Stroke 3 border, lifted like a popover. It rests in one of four corners of
 * the room above the app bar, starting bottom right. Each corner holds the
 * window by its own corner, so it grows away from it as people join: up from
 * the bottom ones, down from the top. However tall it grows it stops short of
 * the app bar, and its tiles scroll instead.
 */
const useStyles = makeStyles({
  root: {
    position: "fixed",
    display: "flex",
    flexDirection: "column",
    width: `min(296px, calc(100vw - ${2 * INSET}px))`,
    maxHeight: `calc(100vh - ${INSET + BAR_CLEARANCE}px)`,
    boxSizing: "border-box",
    overflow: "hidden",
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxShadow: tokens.shadow16,
    fontFamily: tokens.fontFamilyBase,
    // Focused only to keep focus in the window, not as a control.
    ":focus": { outlineStyle: "none" },
  },
  top: { top: `${INSET}px` },
  bottom: { bottom: `${BAR_CLEARANCE}px` },
  left: { left: `${INSET}px` },
  right: { right: `${INSET}px` },
  // Picked up while dragged.
  dragging: {
    boxShadow: tokens.shadow28,
    cursor: "grabbing",
    userSelect: "none",
  },
  // The toolbar is the title bar: it is what drags the window.
  handle: {
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",
  },
});

export type CallPopoutProps = CallPanelProps & {
  open: boolean;
  /** Moves focus into the window as it opens, as when the user opened it. */
  autoFocus?: boolean;
};

/**
 * The call in a floating window over the board, dragged around by its
 * toolbar and snapped, when let go, to the nearest of four corners. Mount it
 * for as long as calls can happen and toggle `open`: the window keeps its
 * corner while hidden. Escape or the close button close it (`onClose`).
 */
export function CallPopout({ open, autoFocus, onClose, onRemove, ...panelProps }: CallPopoutProps) {
  const styles = useStyles();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [corner, setCorner] = React.useState<Corner>("bottom-right");
  // Where the window is while it is dragged; null at rest in its corner.
  const [position, setPosition] = React.useState<Point | null>(null);
  const drag = React.useRef<{ pointerId: number; offset: Point } | null>(null);
  // Where the window was let go, so it can glide from there into its corner.
  const droppedAt = React.useRef<DOMRect | null>(null);

  // Read when the window mounts, so it only takes focus as it opens.
  const autoFocusRef = React.useRef(autoFocus);
  autoFocusRef.current = autoFocus;
  const setRoot = React.useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element;
    if (element && autoFocusRef.current) element.focus();
  }, []);

  // The snap, from where it was let go into the corner: Fluent's
  // durationNormal on curveDecelerateMid. Without motion it just lands.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const from = droppedAt.current;
    droppedAt.current = null;
    if (!root || !from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = root.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx === 0 && dy === 0) return;
    root.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
      duration: 200,
      easing: "cubic-bezier(0, 0, 0, 1)",
    });
  }, [corner, position]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    const target = event.target as Element;
    // Only presses on the toolbar itself: its buttons stay buttons, and the
    // Add people menu, though portaled, bubbles here through React.
    if (event.button !== 0 || !root || !event.currentTarget.contains(target) || target.closest("button")) return;
    const rect = root.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, offset: { x: event.clientX - rect.left, y: event.clientY - rect.top } };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPosition({ x: rect.left, y: rect.top });
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const root = rootRef.current;
    if (!current || current.pointerId !== event.pointerId || !root) return;
    const point = { x: event.clientX - current.offset.x, y: event.clientY - current.offset.y };
    setPosition(clampToRoom(point, root.getBoundingClientRect()));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    const root = rootRef.current;
    if (root) {
      const rect = root.getBoundingClientRect();
      droppedAt.current = rect;
      setCorner(nearestCorner(rect));
    }
    setPosition(null);
  };

  if (!open) return null;
  const [vertical, horizontal] = corner.split("-") as ["top" | "bottom", "left" | "right"];
  const dragging = position !== null;
  return (
    <Portal>
      <div
        ref={setRoot}
        role="dialog"
        aria-label="Call"
        tabIndex={-1}
        className={mergeClasses(
          styles.root,
          !dragging && styles[vertical],
          !dragging && styles[horizontal],
          dragging && styles.dragging,
        )}
        style={position ? { left: position.x, top: position.y } : undefined}
        onKeyDown={(event) => {
          // Not for Escape in a menu opened from here, which only closes that menu.
          if (event.key === "Escape" && rootRef.current?.contains(event.target as Node)) onClose();
        }}
        // It covers part of the board: Skye's cursors work around it (agentGestures.ts).
        data-agent-avoid=""
        {...KEEP_SELECTION_ATTR}
      >
        <CallPanel
          {...panelProps}
          onClose={onClose}
          // The pressed button goes away with its tile; keep focus in the window.
          onRemove={(name) => {
            rootRef.current?.focus();
            onRemove(name);
          }}
          toolbarProps={{
            className: styles.handle,
            onPointerDown,
            onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onLostPointerCapture: endDrag,
          }}
        />
      </div>
    </Portal>
  );
}
