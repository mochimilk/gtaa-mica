import type { ReactNode } from "react";
import { Body1Strong, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

/*
 * 56px, like the left panel's PanelHeader, so the two headers line up across
 * the shell. No vertical padding: the row centers its content. The label
 * gives way to the actions before it truncates.
 */
const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalL,
    height: "56px",
    padding: "0 16px",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  actionsStart: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    flexShrink: 0,
  },
  label: {
    flex: "0 1 auto",
    minWidth: 0,
    margin: 0,
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  actionsEnd: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalXS,
    flex: "1 0 auto",
  },
});

export type ContentToolbarStyles = {
  root?: string;
  actionsStart?: string;
  label?: string;
  actionsEnd?: string;
};

export type ContentToolbarProps = {
  /** The content area's heading, left-aligned. */
  label: ReactNode;
  /** Controls before the heading, e.g. a panel toggle. */
  actionsStart?: ReactNode;
  /** Right-aligned controls. */
  actionsEnd?: ReactNode;
  className?: string;
  styles?: ContentToolbarStyles;
};

/** Header row for a content area: leading actions, a heading and right-aligned actions. */
export function ContentToolbar({ label, actionsStart, actionsEnd, className, styles: slotStyles }: ContentToolbarProps) {
  const styles = useStyles();
  return (
    <header className={mergeClasses(styles.root, slotStyles?.root, className)}>
      {actionsStart && (
        <div className={mergeClasses(styles.actionsStart, slotStyles?.actionsStart)}>{actionsStart}</div>
      )}
      <Body1Strong as="h1" className={mergeClasses(styles.label, slotStyles?.label)}>
        {label}
      </Body1Strong>
      {actionsEnd && <div className={mergeClasses(styles.actionsEnd, slotStyles?.actionsEnd)}>{actionsEnd}</div>}
    </header>
  );
}
