import * as React from "react";
import { createPortal } from "react-dom";
import { Dismiss20Regular } from "@fluentui/react-icons";
import { AskButton } from "./AskButton";

/** Where floating windows render: in Ask Skye's stack, centred above the bar. */
export const AskFloatSlot = React.createContext<HTMLElement | null>(null);

/**
 * Past the close transition (content out over --ask-motion-reveal, 100ms, then
 * the window over --ask-motion-grow, 150ms), in case it never reports its end.
 */
const CLOSE_FALLBACK_MS = 400;

export type AskFloatingWindowProps = {
  /** Named in the header, as the chat's is. */
  title: string;
  open: boolean;
  /**
   * Without it the window cannot be dismissed: it has no close button and
   * Escape leaves it open, so it closes only once `open` goes false (a
   * decision made inside it, say).
   */
  onOpenChange?: (open: boolean) => void;
  /** For the opener's `aria-controls`. */
  id?: string;
  /**
   * Opened by Skye while she talks about what it shows, not by the user: a
   * compact window (its content sizes it down) that leaves focus where the
   * user has it.
   */
  compact?: boolean;
  children: React.ReactNode;
};

/**
 * A window floating centred above Ask Skye's bar, in the open chat's glass
 * with its header and close button. Render it from inside AskSkye (e.g. in
 * `actionsEnd`, beside its opener); pair `open` with `useAskPanel` so it and
 * the chat close each other. It opens and closes with the chat's motion,
 * moves focus in as it opens, gives it back to its opener as it closes, and
 * closes on Escape or a press outside the bar.
 */
export function AskFloatingWindow({ title, open, onOpenChange, id, compact = false, children }: AskFloatingWindowProps) {
  const slot = React.useContext(AskFloatSlot);
  const titleId = React.useId();
  const rootRef = React.useRef<HTMLElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  const wasOpen = React.useRef(false);
  // Kept mounted while it closes, so it can narrow back to the bar as the chat does.
  const [shown, setShown] = React.useState(open);
  if (open && !shown) setShown(true);
  const closing = shown && !open;

  React.useLayoutEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (open && !was) {
      // Skye's compact window leaves focus with the user.
      if (compact) return;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      rootRef.current?.focus();
    } else if (!open && was) {
      // Closed from inside, focus would be left in the closing window or drop on the page.
      const active = document.activeElement;
      if (!active || active === document.body || rootRef.current?.contains(active)) opener.current?.focus();
    }
  }, [open, slot]);

  // Gone once the close transition has run; at once without motion, when no transition runs.
  React.useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => setShown(false), CLOSE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  if (!shown || !slot) return null;
  return createPortal(
    <section
      ref={rootRef}
      id={id}
      className="mica-ask__float"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-closing={closing || undefined}
      data-compact={compact || undefined}
      inert={closing}
      // Open, it covers part of the board: Skye's cursors work around it (agentGestures.ts).
      data-agent-avoid={closing ? undefined : ""}
      onTransitionEnd={(event) => {
        if (closing && event.target === event.currentTarget && event.propertyName === "translate") setShown(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !onOpenChange) return;
        event.stopPropagation();
        onOpenChange(false);
      }}
    >
      <header className="mica-ask__header" data-dismissible={onOpenChange ? undefined : "false"}>
        <div className="mica-ask__title">
          <h2 id={titleId} className="mica-ask__title-name">
            {title}
          </h2>
        </div>
        {onOpenChange && (
          <AskButton
            shape="circular"
            appearance="transparent"
            icon={Dismiss20Regular}
            label={`Close ${title.toLowerCase()}`}
            onClick={() => onOpenChange(false)}
          />
        )}
      </header>
      <div className="mica-ask__float-body">{children}</div>
    </section>,
    slot,
  );
}
