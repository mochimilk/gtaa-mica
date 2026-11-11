// Skye's notification, right above Ask Skye (its `notices`): a pill saying
// what she caught (a conflict, say), with her one next step and Dismiss.
// Pressing it opens it upward over the board into the details: a picture of
// it (a snippet of the board, say), what happened in her words, and that she
// is AI. It widens out of the bar as it arrives, and sinks back as it goes.
//
// Its next step and Dismiss both put it away: it plays its exit, then calls
// back, so the caller's state change (which unmounts it) lands after it.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { CheckmarkCircle20Regular, Dismiss20Regular, Info20Regular, Warning20Regular } from "@fluentui/react-icons";
import "./skyeNotification.css";

export type SkyeNotificationTone = "danger" | "warning" | "success" | "info";

const TONE_ICON: Record<SkyeNotificationTone, ReactNode> = {
  danger: <Warning20Regular />,
  warning: <Warning20Regular />,
  success: <CheckmarkCircle20Regular />,
  info: <Info20Regular />,
};

/** How long its exit plays, ms: skyeNotification.css's skye-notif-out. */
const LEAVE_MS = 200;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export type SkyeNotificationProps = {
  /** Its icon's colours, and the icon itself unless `icon` is given. Defaults to danger. */
  tone?: SkyeNotificationTone;
  icon?: ReactNode;
  /** What kind of news, e.g. "Conflict". */
  title: string;
  /** The news itself in a line, e.g. "XD472 from LHR 1h 50m late"; cut short with an ellipsis. */
  summary: string;
  /** Skye's one next step, e.g. Plan; pressing it puts the notification away first. Primary unless said otherwise. */
  action?: { label: string; onClick: () => void; disabled?: boolean; appearance?: "primary" | "outline" };
  /** Called once it has gone. */
  onDismiss: () => void;
  /** The dismiss button's accessible name and tooltip. Defaults to "Dismiss". */
  dismissLabel?: string;
  /** Shown first when open, boxed: a picture of what the news is about. */
  preview?: ReactNode;
  /** The details, when open: paragraphs, say. */
  children?: ReactNode;
  /** The line under the details; null for none. */
  disclaimer?: string | null;
  defaultOpen?: boolean;
  /** What it is about, as `data-notif`, for code to find it by (the demo's golden path presses its action). */
  name?: string;
};

export function SkyeNotification({
  tone = "danger",
  icon,
  title,
  summary,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  preview,
  children,
  disclaimer = "Skye is AI. Check mistakes.",
  defaultOpen = false,
  name,
}: SkyeNotificationProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [leaving, setLeaving] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef(0);
  const titleId = useId();
  const drawerId = useId();

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  // Said once it is up, not as it mounts, so screen readers take it as news.
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounced(`${title}: ${summary}`), 100);
    return () => window.clearTimeout(timer);
  }, [title, summary]);

  const leave = (then: () => void) => {
    if (leaving) return;
    if (reducedMotion()) return then();
    setLeaving(true);
    leaveTimer.current = window.setTimeout(then, LEAVE_MS);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    toggleRef.current?.focus();
  };

  return (
    <section
      className="skye-notif"
      data-notif={name}
      data-tone={tone}
      data-open={open || undefined}
      data-leaving={leaving || undefined}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
      <span className="skye-notif__sr" role="status">
        {announced}
      </span>
      <div className="skye-notif__drawer" id={drawerId} inert={!open}>
        <div className="skye-notif__drawer-inner">
          <div className="skye-notif__body">
            {preview && <div className="skye-notif__preview">{preview}</div>}
            {children}
          </div>
          {disclaimer && <p className="skye-notif__disclaimer">{disclaimer}</p>}
        </div>
      </div>
      <div className="skye-notif__bar">
        <button
          ref={toggleRef}
          type="button"
          className="skye-notif__toggle"
          aria-expanded={open}
          aria-controls={drawerId}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="skye-notif__icon" aria-hidden>
            {icon ?? TONE_ICON[tone]}
          </span>
          <span className="skye-notif__heading">
            <span id={titleId} className="skye-notif__title">
              {title}
            </span>
            <span className="skye-notif__summary" title={summary}>
              {summary}
            </span>
          </span>
        </button>
        <div className="skye-notif__actions">
          {action && (
            <Button
              appearance={action.appearance ?? "primary"}
              shape="circular"
              className="skye-notif__action"
              disabled={action.disabled}
              onClick={() => leave(action.onClick)}
            >
              {action.label}
            </Button>
          )}
          <Tooltip content={dismissLabel} relationship="label">
            <Button
              appearance="transparent"
              shape="circular"
              className="skye-notif__dismiss"
              icon={<Dismiss20Regular />}
              onClick={() => leave(onDismiss)}
            />
          </Tooltip>
        </div>
      </div>
    </section>
  );
}
