import * as React from "react";
import { createPortal } from "react-dom";
import { gtaaOpal, LiveOrb, skyeOrbStill } from "../orb";
import { agentHelpers, AURA_RADIUS } from "./agentSwarm";
import { agentCursor, type AgentCursorController } from "./cursorMotion";
// The tag's typeface, in the two weights it uses (name, and task text).
import "@fontsource/roboto-mono/400.css";
import "@fontsource/roboto-mono/600.css";
import "./agent-cursor.css";

export type AgentCursorProps = {
  /**
   * Shown on the tag beside the cursor, so it is clear whose cursor it is.
   * Without one, the tag shows only while the cursor has a task (setTask).
   */
  name?: string;
  /** What moves it; Skye's main cursor by default. */
  controller?: AgentCursorController;
  /** One of Skye's helper cursors, an orb of her light, which splits off from Skye's dot rather than the pill's orb. */
  helper?: boolean;
};

/** The square the dot is drawn in, px: room for the orb it grows into. */
const DOT_BOX = 40;
/** The orb Skye's cursor becomes while its helpers work (setOrb), px: the Ask pill's orb's size. */
const ORB_SIZE = 32;

/** The aura round that orb (see agentSwarm.ts), px: the notch just outside its ring, and the dotted orbit round both. */
const AURA_NOTCH = AURA_RADIUS + 4.5;
const AURA_ORBIT = AURA_RADIUS + 8;
const AURA_BOX = 2 * (AURA_ORBIT + 2);
/** The aura's circles' lengths, for their dashes. */
const AURA_LENGTHS = {
  "--agent-cursor-aura-ring": `${2 * Math.PI * AURA_RADIUS}px`,
  "--agent-cursor-aura-notch": `${2 * Math.PI * AURA_NOTCH}px`,
} as React.CSSProperties;

/**
 * The overlay for one of Skye's cursors. Mount it once; its controller
 * (`agentCursor` by default) moves it. It is purely visual: it takes no
 * pointer events and is hidden from assistive technology, because what it
 * clicks is announced by the change itself.
 *
 * The cursor is Skye's orb, shrunk to a dot: it leaves the orb in the Ask
 * pill (see `agentCursor.setHome`) as the thinking dots pulling together into
 * one, stays out where it last clicked, and returns to the orb when recalled
 * from the pill. Helper cursors (`helper`), small orbs of Skye's light, split
 * off from that dot instead, and while they work it is a live orb of its own
 * (`setOrb`), glowing, with a ring round it filling as they work (`setProgress`).
 */
export function AgentCursor({ name, controller = agentCursor, helper = false }: AgentCursorProps) {
  const ref = React.useCallback((element: HTMLDivElement | null) => controller.attach(element), [controller]);
  // The orb's renderer runs only while it shows.
  const orbShown = React.useSyncExternalStore(controller.subscribe, () => controller.out && controller.orbShown);
  return createPortal(
    <div className="agent-cursor-layer" aria-hidden>
      <div
        ref={ref}
        className="agent-cursor"
        data-variant="arrow"
        data-helper={helper ? "" : undefined}
        data-unnamed={name ? undefined : ""}
      >
        {/* The thinking dots, as they take off from the orb and close into the cursor. */}
        <span className="agent-cursor-swarm">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="agent-cursor-body">
          {helper ? (
            // A helper is an orb of Skye's light, as the light along her tethers is.
            <span className="agent-cursor-echo" />
          ) : (
            <>
              {/* A soft glow behind the dot. */}
              <span className="agent-cursor-glow" />
              {/* The dot and its ring as vectors, so they resize smoothly and the ring keeps its width. */}
              <svg
                className="agent-cursor-dot"
                width={DOT_BOX}
                height={DOT_BOX}
                viewBox={`${-DOT_BOX / 2} ${-DOT_BOX / 2} ${DOT_BOX} ${DOT_BOX}`}
              >
                <circle className="agent-cursor-dot-fill" />
                <circle className="agent-cursor-dot-ring" />
              </svg>
            </>
          )}
          {/*
            Skye's orb while its helpers work, in the glow of their light
            rather than its own (--agent-cursor-light), with its aura round
            it. Its gradient stands in until the renderer is up.
          */}
          {!helper && (
            <span className="agent-cursor-orb">
              <span className="agent-cursor-skye" />
              {/* A loading bar for the helpers' work (setProgress), the ring Skye's tethers leave from. */}
              <svg
                className="agent-cursor-aura"
                width={AURA_BOX}
                height={AURA_BOX}
                viewBox={`${-AURA_BOX / 2} ${-AURA_BOX / 2} ${AURA_BOX} ${AURA_BOX}`}
                style={AURA_LENGTHS}
              >
                <circle className="agent-cursor-aura-orbit" r={AURA_ORBIT} />
                {/* Turned a quarter back, so they start at the top. */}
                <circle className="agent-cursor-aura-track" r={AURA_RADIUS} transform="rotate(-90)" />
                <circle className="agent-cursor-aura-bar" r={AURA_RADIUS} transform="rotate(-90)" />
                <circle className="agent-cursor-aura-notch" r={AURA_NOTCH} transform="rotate(-90)" />
              </svg>
              <LiveOrb
                size={ORB_SIZE}
                state="thinking"
                preset="opal"
                palette={gtaaOpal}
                paused={!orbShown}
                placeholder="gradient"
                still={skyeOrbStill}
              />
            </span>
          )}
          {/* The orb's opal, over the dot while it is still the orb. */}
          <span className="agent-cursor-opal" />
        </span>
        <span className="agent-cursor-tag">
          {name}
          {/* What it is doing, while it works with others (see setTask). */}
          <span className="agent-cursor-task" />
          {/* The key Skye holds while it clicks, as when adding to a selection. */}
          <kbd className="agent-cursor-key">Ctrl</kbd>
        </span>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Skye's helper cursors (see agentSwarm.ts), hidden until Skye splits into
 * them. They have no names; each tag shows only what that helper is doing.
 * Mount once.
 */
export function AgentHelperCursors() {
  return (
    <>
      {agentHelpers.map((helper, index) => (
        <AgentCursor key={index} controller={helper.controller} helper />
      ))}
    </>
  );
}
