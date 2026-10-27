// While the Outputs panel is closed, the request Skye is on peeks out at the
// board's top right, just under its header (below the panel's toggle), in the
// glass of Ask Skye's floating windows (askSkye.css, .mica-ask__float), with
// smaller corners. Its title and where it stands head it, fixed, over a
// hairline; under that, the pieces she has changed for it, newest first. It
// shows five and a half rows, so one cut in half says there is more, and
// scrolls for the rest, fading at an edge with more past it (OverflowScroll);
// with fewer it hugs them. Once she is done it is the compact approval: lit
// in violet from its edges in, its glass clear at the middle, with the
// decision at its foot (OutputsApproval), and
// stays until her changes are approved or undone. Opening the panel puts it
// away; closing the panel brings it back.
//
// It stands over Skye's cursors and everything else (window-layer): it mounts
// at the top of the page rather than in the board, whose window is a layer
// of its own, and is placed at the board's top right from where it would sit
// (its anchor), following the board as it changes size.
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { eventBus } from "@coral-ai/react";
import {
  Body1Strong,
  Caption1,
  Portal,
  PortalMountNodeProvider,
  makeStyles,
  mergeClasses,
  tokens,
  type GriffelStyle,
} from "@fluentui/react-components";
import { useRightPanelOpen } from "../components/panel-toggle";
import { windowNode, windowPortalNode } from "../components/window-layer";
import type { OutputRequest } from "./outputs";
import { OutputsApproval } from "./OutputsApproval";
import { OUTPUTS_PANEL_ID } from "./OutputsPanel";
import { OUTPUT_ROW_HEIGHT, OutputSteps, RequestMeta, useOutputs } from "./OutputSteps";
import { OverflowScroll } from "./OverflowScroll";
import { skyeReview, subscribeSkyeReview } from "./skyeReview";
import { KEEP_SELECTION_ATTR } from "./ViewsFiltersToolbar";
import "./operations.css";

/** The board's header (ContentToolbar) is this tall; the peek sits 8px under it. */
const HEADER_HEIGHT = 56;

/**
 * Ask Skye's floating windows' glass, open (askSkye.css), lighter: their
 * gentle lens (LiquidGlassFilter.tsx), frosted a little less (12px to their 15px), and the theme's
 * background as a 75% tint (theirs is 90%). The board shows through it, so
 * its list fades its rows out at the edges (OverflowScroll's mask) rather
 * than painting over them.
 */
const GLASS_LENS = "url(#mica-liquid-glass-open)";
const GLASS_BACKDROP = "blur(12px) saturate(140%)";
const GLASS_TINT = `color-mix(in srgb, ${tokens.colorNeutralBackground2} 75%, transparent)`;
/**
 * Done, in dark mode, the tint is the reference card's deep navy instead, as
 * strong, so the violet light over it stays saturated rather than greying on
 * the neutral tint. Light mode keeps its own, under dark text.
 */
const DONE_TINT = "color-mix(in srgb, #05051d 75%, transparent)";

const subscribeColorMode = (notify: () => void) => {
  eventBus.on("colorModeChanged", notify);
  return () => eventBus.off("colorModeChanged", notify);
};
const useColorMode = () => useSyncExternalStore(subscribeColorMode, () => eventBus.getColorMode());

/**
 * The peek's padding, 16px all round its header and its buttons, and either
 * side of its list of rows: to the left of their icons (whose 20px sits 6px
 * in from its 32px box) and the right of what ends them. The list has 8px
 * above its first row and below its last.
 */
const INSET = tokens.spacingHorizontalL;
const EDGE = tokens.spacingVerticalL;
const LIST_EDGE = tokens.spacingVerticalS;
/** How far a row's 20px icon sits in from its 32px box. */
const ICON_AIR = "6px";

/**
 * Done, the peek is lit from its edges in, over its glass, as the reference
 * card is: inner shadows, so the light follows a rounded shape, never a
 * circle, offset upward, so its top stays dark and the light rises from the
 * foot and up its sides. Lavender at full strength at the edge, the foot's
 * blue-violet at 45% further in, and nothing in the middle, so the glass (navy, done, in dark
 * mode) shows through.
 *
 * The light is cast on a layer LIT_BLEED past every edge, clipped by the
 * peek, with LIT_RADIUS corners: its dark middle then has those rounder
 * corners rather than the peek's own tight ones. The shadows spread as much
 * further, so its edges are lit as strongly.
 */
const LIT_BLEED = 24;
const LIT_RADIUS = "64px";
/**
 * As Skye finishes, the light rises into place as it comes up (from
 * LIT_RISE below, over LIT_ENTER_MS), then breathes for as long as it shows,
 * in the rhythm of the skye's rim at the page's foot (VoiceSkye's rimSway,
 * 4.6s): dimming to LIT_BREATH as it sinks LIT_SINK, and back. Opacity and
 * position only (the layer's bleed hides its edges), so it costs no repaint.
 */
const LIT_RISE = "16px";
const LIT_ENTER_MS = 600;
const LIT_BREATH = 0.6;
const LIT_SINK = "4px";
const LIT = [
  `inset 0 -19px 18px ${2 + LIT_BLEED}px rgba(150, 138, 240, 1)`,
  `inset 0 -36px 48px ${10 + LIT_BLEED}px rgba(84, 84, 228, 0.45)`,
  `inset 0 -45px 56px ${8 + LIT_BLEED}px rgba(80, 84, 230, 0.45)`,
].join(", ");

/** Inside the 1px border: the glass layers are rounded themselves, as the blur is not clipped to its parent's corners. */
const INNER_RADIUS = `calc(${tokens.borderRadiusXLarge} - 1px)`;

// The glass lies under the content, in layers that fade in and out: the
// blur sees only as far back as an ancestor that fades, so neither the
// surface nor the peek ever does (as Ask Skye's windows fade their glass,
// not themselves).
const glassLayer: GriffelStyle = {
  content: '""',
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  // Under the lit layer (-1), which lies over the tint.
  zIndex: -2,
  borderRadius: INNER_RADIUS,
  pointerEvents: "none",
  opacity: 0,
  transitionProperty: "opacity",
  transitionDuration: tokens.durationFast,
  transitionTimingFunction: tokens.curveAccelerateMid,
};
const fadeIn: GriffelStyle = {
  opacity: 1,
  transitionDuration: tokens.durationNormal,
  transitionTimingFunction: tokens.curveDecelerateMid,
};
const useStyles = makeStyles({
  // Placed under the header; slides in and out, and is not there at all once faded out.
  // Where it would sit, in the board: its top right, which the peek is placed from.
  anchor: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    pointerEvents: "none",
  },
  // Placed (top, right, max width) from the anchor's board, in its style.
  peek: {
    position: "fixed",
    display: "flex",
    width: "300px",
    borderRadius: tokens.borderRadiusXLarge,
    transform: "translateY(-4px)",
    visibility: "hidden",
    transitionProperty: "transform, visibility",
    transitionDuration: `${tokens.durationFast}, 0s`,
    transitionTimingFunction: tokens.curveAccelerateMid,
    transitionDelay: `0s, ${tokens.durationFast}`,
    "@media (prefers-reduced-motion: reduce)": { transform: "none" },
  },
  shown: {
    transform: "none",
    visibility: "visible",
    transitionDuration: `${tokens.durationNormal}, 0s`,
    transitionTimingFunction: tokens.curveDecelerateMid,
    transitionDelay: "0s",
  },
  // The glass and what is on it.
  surface: {
    position: "relative",
    flex: "1 1 auto",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    isolation: "isolate",
    overflow: "hidden",
    border: "1px solid transparent",
    borderRadius: "inherit",
    boxShadow: "none",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: tokens.durationFast,
    transitionTimingFunction: tokens.curveAccelerateMid,
    "::before": { ...glassLayer, filter: GLASS_LENS, backdropFilter: GLASS_BACKDROP },
    "::after": {
      ...glassLayer,
      backgroundColor: GLASS_TINT,
      transitionProperty: "opacity, background-color",
    },
    "& > *": {
      opacity: 0,
      transitionProperty: "opacity",
      transitionDuration: tokens.durationFast,
      transitionTimingFunction: tokens.curveAccelerateMid,
    },
  },
  surfaceShown: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow28,
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveDecelerateMid,
    "::before": fadeIn,
    "::after": { ...fadeIn, transitionProperty: "opacity, background-color" },
    "& > *": fadeIn,
  },
  surfaceDoneDark: {
    "::after": { backgroundColor: DONE_TINT },
  },
  // Over the glass and its tint, under the content; it fades in as Skye finishes.
  lit: {
    position: "absolute",
    top: `${-LIT_BLEED}px`,
    right: `${-LIT_BLEED}px`,
    bottom: `${-LIT_BLEED}px`,
    left: `${-LIT_BLEED}px`,
    zIndex: -1,
    borderRadius: LIT_RADIUS,
    pointerEvents: "none",
    boxShadow: LIT,
    animationName: [
      { from: { opacity: 0, transform: `translateY(${LIT_RISE})` }, to: { opacity: 1, transform: "none" } },
      { from: { opacity: 1, transform: "none" }, to: { opacity: LIT_BREATH, transform: `translateY(${LIT_SINK})` } },
    ],
    animationDuration: `${LIT_ENTER_MS}ms, 4.6s`,
    animationTimingFunction: `${tokens.curveDecelerateMid}, ease-in-out`,
    animationDelay: `0s, ${LIT_ENTER_MS}ms`,
    animationIterationCount: "1, infinite",
    animationDirection: "normal, alternate",
    animationFillMode: "both, none",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  // Fixed over the pieces, which scroll under its hairline.
  header: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minWidth: 0,
    padding: `${EDGE} ${INSET}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  title: {
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meta: {
    color: tokens.colorNeutralForeground3,
  },
  // Five and a half rows at most, under the list's padding; fewer hug their rows.
  steps: {
    maxHeight: `calc(${LIST_EDGE} + ${5.5 * OUTPUT_ROW_HEIGHT}px)`,
    overflowY: "auto",
  },
  // Their icons and what ends them in line with the header's text.
  rows: {
    padding: `${LIST_EDGE} ${INSET} ${LIST_EDGE} calc(${INSET} - ${ICON_AIR})`,
  },
  approval: {
    flexShrink: 0,
    padding: `${EDGE} ${INSET}`,
  },
});

/**
 * The request to peek at: the one Skye is working on, once she has changed
 * something for it; then, while her changes wait to be approved, the last one
 * she worked on. What the user changes meanwhile is listed in the panel, and
 * does not take its place.
 */
function usePeekRequest(): { request: OutputRequest | null; done: boolean } {
  const requests = useOutputs();
  const review = useSyncExternalStore(subscribeSkyeReview, skyeReview);
  const working = requests.find((request) => request.actor === "skye" && request.working);
  if (working) return { request: working.steps.length > 0 ? working : null, done: false };
  return { request: review ? (requests.find((request) => request.actor === "skye") ?? null) : null, done: true };
}

/** The board's box on screen, from the anchor in it: its top, its right edge's distance from the window's, and its width. */
type BoardBox = { top: number; right: number; width: number };

function useBoardBox(anchor: RefObject<HTMLElement | null>): BoardBox | null {
  const [box, setBox] = useState<BoardBox | null>(null);
  useLayoutEffect(() => {
    const board = anchor.current?.parentElement;
    if (!board) return undefined;
    const place = () => {
      const rect = board.getBoundingClientRect();
      setBox((was) => {
        const next = { top: rect.top, right: window.innerWidth - rect.right, width: rect.width };
        return was && was.top === next.top && was.right === next.right && was.width === next.width ? was : next;
      });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(board);
    window.addEventListener("resize", place);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);
  return box;
}

/** The peek's inset from the board's right edge, px (its 16px). */
const BOARD_INSET = 16;

export function OutputsPeek() {
  const styles = useStyles();
  const { request, done } = usePeekRequest();
  const colorMode = useColorMode();
  const panelOpen = useRightPanelOpen(OUTPUTS_PANEL_ID);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const board = useBoardBox(anchorRef);
  const shown = !!request && !panelOpen;
  // What it showed last stays while it fades out.
  const last = useRef<OutputRequest | null>(null);
  if (request) last.current = request;
  const showing = request ?? last.current;

  return (
    <>
      <span ref={anchorRef} className={styles.anchor} aria-hidden />
      {showing && board && (
        <PortalMountNodeProvider value={windowNode()}>
          <Portal>
            {/* Over Skye's cursors, and what opens from it (its tooltips) over it. */}
            <PortalMountNodeProvider value={windowPortalNode()}>
              <Peek
                showing={showing}
                shown={shown}
                done={done}
                dark={colorMode === "dark"}
                place={{
                  top: board.top + HEADER_HEIGHT + 8,
                  right: board.right + BOARD_INSET,
                  maxWidth: board.width - 2 * BOARD_INSET,
                }}
              />
            </PortalMountNodeProvider>
          </Portal>
        </PortalMountNodeProvider>
      )}
    </>
  );
}

function Peek({
  showing,
  shown,
  done,
  dark,
  place,
}: {
  showing: OutputRequest;
  shown: boolean;
  done: boolean;
  dark: boolean;
  place: { top: number; right: number; maxWidth: number };
}) {
  const styles = useStyles();
  const colorMode = dark ? "dark" : "light";
  return (
    <section
      {...KEEP_SELECTION_ATTR}
      className={mergeClasses(styles.peek, shown && styles.shown)}
      style={place}
      aria-label={`Skye's changes: ${showing.title}`}
      aria-hidden={shown ? undefined : true}
      // Skye's cursors keep clear of it as they work (agentGestures' covers).
      data-agent-avoid={shown ? "" : undefined}
    >
      <div
        className={mergeClasses(
          styles.surface,
          shown && styles.surfaceShown,
          shown && done && colorMode === "dark" && styles.surfaceDoneDark,
        )}
      >
        {done && <span className={styles.lit} aria-hidden />}
        <div className={styles.header}>
          <Body1Strong className={styles.title}>{showing.title}</Body1Strong>
          <Caption1 className={styles.meta}>
            <RequestMeta request={showing} />
          </Caption1>
        </div>
        <OverflowScroll className={styles.steps} fade="mask">
          <OutputSteps steps={showing.steps} className={styles.rows} />
        </OverflowScroll>
        <OutputsApproval className={styles.approval} />
      </div>
    </section>
  );
}
