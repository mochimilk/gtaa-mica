import type { ReactNode } from "react";
import { Button, Tooltip, makeStyles, mergeClasses, type ButtonProps } from "@fluentui/react-components";
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
};

/**
 * A rail entry: Fluent's subtle icon-only Button, named by a Tooltip beside
 * it. Its icon is regular at rest and filled on hover, or filled throughout
 * while `current`. Wrappers' props and refs (e.g. MenuTrigger's) reach the
 * button.
 */
export function NavRailButton({ icon: Icon, label, current = false, appearance = "subtle", ...rest }: NavRailButtonProps) {
  return (
    <Tooltip content={label} relationship="label" positioning="after">
      <Button
        {...rest}
        appearance={appearance}
        aria-current={current ? "page" : undefined}
        icon={<Icon filled={current} />}
      />
    </Tooltip>
  );
}
