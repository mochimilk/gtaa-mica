import { useState, type ReactNode, type Ref } from "react";
import { Dismiss } from "@coral-ai/bundleicons/Dismiss";
import {
  Button,
  CounterBadge,
  Popover,
  PopoverSurface,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  useMergedRefs,
  type ButtonProps,
} from "@fluentui/react-components";
import type { FluentIcon } from "@fluentui/react-icons";

/** The rail's width, for layouts that offset against it. */
export const NAV_RAIL_WIDTH = 56;

/*
 * The shell's full-height left ribbon: 56px wide (Figma's 48px, widened; the
 * app bar's and the panel headers' height) with 24px top and 16px bottom
 * padding, its 32px buttons centered, 12px apart, in a top group (pages) and
 * a bottom group (actions) at either end. flexShrink 0 so the shell row never
 * compresses it.
 */
const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "center",
    width: `${NAV_RAIL_WIDTH}px`,
    padding: "24px 0 16px 0",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
  },
  // The icon, holding a count at its top right that overhangs it.
  badged: {
    position: "relative",
    display: "inline-flex",
  },
  badge: {
    position: "absolute",
    top: "-6px",
    right: "-8px",
  },
  // The callout: what it says, then its dismiss, at its top right.
  callout: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalS,
    maxWidth: "280px",
    paddingRight: tokens.spacingHorizontalXS,
  },
  calloutBody: {
    flex: "1 1 auto",
    minWidth: 0,
    alignSelf: "center",
  },
  calloutDismiss: {
    flexShrink: 0,
    marginTop: "-2px",
  },
});

export type NavRailStyles = {
  root?: string;
  group?: string;
};

export type NavRailProps = {
  /** Names the rail's landmark. */
  "aria-label": string;
  /** Top group: the pages. */
  children?: ReactNode;
  /** Bottom group: actions, e.g. a panel toggle and the account. */
  actionsEnd?: ReactNode;
  className?: string;
  styles?: NavRailStyles;
};

/** Vertical ribbon of subtle icon buttons at the shell's left edge. */
export function NavRail({ "aria-label": label, children, actionsEnd, className, styles: slotStyles }: NavRailProps) {
  const styles = useStyles();
  const group = mergeClasses(styles.group, slotStyles?.group);
  return (
    <nav aria-label={label} className={mergeClasses(styles.root, slotStyles?.root, className)}>
      <div className={group}>{children}</div>
      {actionsEnd && <div className={group}>{actionsEnd}</div>}
    </nav>
  );
}

// ButtonProps is a union (a button or an anchor root); omit from each member
// so the union survives, as a plain Omit would merge them.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type NavRailButtonProps = DistributiveOmit<ButtonProps, "icon" | "children"> & {
  /** A bundled (regular + filled) icon. */
  icon: FluentIcon;
  /** Shown in the tooltip; also the button's accessible name. */
  label: string;
  /** The page on screen: its icon stays filled and it is marked current. */
  current?: boolean;
  /** How many things wait there, on a counter at the icon's top right; none at 0. */
  count?: number;
  /** A note beside the entry, pointing at it, while set: e.g. that Skye is at work on its page. */
  callout?: NavRailCallout;
  ref?: Ref<HTMLButtonElement | HTMLAnchorElement>;
};

export type NavRailCallout = {
  /** What it says, with its own name for the surface (`label`). */
  content: ReactNode;
  label: string;
  /** Its dismiss button, or Escape within it. */
  onDismiss: () => void;
};

/**
 * A rail entry: Fluent's subtle icon-only Button, named by a Tooltip beside
 * it. Its icon is regular at rest and filled on hover, or filled throughout
 * while `current`. Wrappers' props and refs (e.g. MenuTrigger's) reach the
 * button.
 *
 * Its `callout` is a Fluent popover beside it, its arrow on the button. It
 * is a note, not a question: it takes no focus as it opens, and stays open
 * through clicks elsewhere until dismissed (or no longer set).
 */
export function NavRailButton({
  icon: Icon,
  label,
  current = false,
  count = 0,
  callout,
  appearance = "subtle",
  ref,
  ...rest
}: NavRailButtonProps) {
  const styles = useStyles();
  const [button, setButton] = useState<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const buttonRef = useMergedRefs(ref, setButton);
  const icon = <Icon filled={current} />;
  return (
    <>
      <Tooltip content={count > 0 ? `${label}, ${count} waiting` : label} relationship="label" positioning="after">
        <Button
          {...rest}
          ref={buttonRef}
          appearance={appearance}
          aria-current={current ? "page" : undefined}
          icon={
            count > 0 ? (
              <span className={styles.badged}>
                {icon}
                <CounterBadge size="small" count={count} className={styles.badge} aria-hidden />
              </span>
            ) : (
              icon
            )
          }
        />
      </Tooltip>
      {callout && button && (
        <Popover
          open
          onOpenChange={(event, data) => {
            if (!data.open && event.type === "keydown") callout.onDismiss();
          }}
          positioning={{ target: button, position: "after", align: "center", offset: 10 }}
          withArrow
          unstable_disableAutoFocus
        >
          <PopoverSurface className={styles.callout} role="status" aria-label={callout.label}>
            <div className={styles.calloutBody}>{callout.content}</div>
            <Button
              className={styles.calloutDismiss}
              appearance="subtle"
              size="small"
              icon={<Dismiss />}
              aria-label="Dismiss"
              onClick={callout.onDismiss}
            />
          </PopoverSurface>
        </Popover>
      )}
    </>
  );
}
