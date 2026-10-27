import type { ReactNode } from "react";
import { makeStyles, mergeClasses } from "@fluentui/react-components";

/** The bar's height, for layouts that keep clear of it. */
export const APP_BAR_HEIGHT = 56;

/*
 * Mica's bottom bar: 56px, like the nav rail's width and the panel headers'
 * height, with no vertical padding, so its content centers, and flexShrink 0
 * so it never compresses in the shell column. Equal outer columns keep the
 * center slot truly centered whatever the sides hold, and let a long side
 * shrink instead of pushing into it.
 *
 * Coral's Content window above keeps a 4px margin, so the room under it is
 * 60px: the bar rises 2px into that margin to sit in the room's middle.
 */
const useStyles = makeStyles({
  root: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
    alignItems: "center",
    columnGap: "12px",
    width: "100%",
    height: `${APP_BAR_HEIGHT}px`,
    marginTop: "-2px",
    marginBottom: "2px",
    padding: "0 16px",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  actionsStart: {
    gridColumn: "1",
    justifySelf: "start",
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    maxWidth: "100%",
  },
  actionsCenter: {
    gridColumn: "2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  actionsEnd: {
    gridColumn: "3",
    justifySelf: "end",
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    maxWidth: "100%",
  },
});

export type AppBarStyles = {
  root?: string;
  actionsStart?: string;
  actionsCenter?: string;
  actionsEnd?: string;
};

export type AppBarProps = {
  /** Left-aligned content. */
  actionsStart?: ReactNode;
  /** Centered in the bar. */
  actionsCenter?: ReactNode;
  /** Right-aligned content. */
  actionsEnd?: ReactNode;
  className?: string;
  styles?: AppBarStyles;
};

/** App bar with Coral Navbar's three action slots, without its branding. */
export function AppBar({ actionsStart, actionsCenter, actionsEnd, className, styles: slotStyles }: AppBarProps) {
  const styles = useStyles();
  return (
    <header className={mergeClasses(styles.root, slotStyles?.root, className)}>
      {actionsStart && (
        <div className={mergeClasses(styles.actionsStart, slotStyles?.actionsStart)}>{actionsStart}</div>
      )}
      {actionsCenter && (
        <div className={mergeClasses(styles.actionsCenter, slotStyles?.actionsCenter)}>{actionsCenter}</div>
      )}
      {actionsEnd && <div className={mergeClasses(styles.actionsEnd, slotStyles?.actionsEnd)}>{actionsEnd}</div>}
    </header>
  );
}
