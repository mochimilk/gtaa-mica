import * as React from "react";
import { Panel, useCoralApp, type PanelToolbarStyles } from "@coral-ai/react";
import { Body1Strong, Caption1, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

/*
 * Additions to Panel.Toolbar's 16px-padding row: 56px tall (not 48px) with no
 * vertical padding, to line up with the content area's ContentToolbar. The
 * header is not a direct Panel.Left child (Coral hoists only Panel.Toolbar
 * itself), so it sits atop the content area and must not shrink there; the
 * identity group gives way to the actions before the title truncates.
 */
const useStyles = makeStyles({
  root: {
    flexShrink: 0,
    height: "56px",
    paddingTop: 0,
    paddingBottom: 0,
  },
  identity: {
    gap: tokens.spacingHorizontalS,
    flex: "0 1 auto",
    minWidth: 0,
  },
  // Same box as Coral's Navbar logo: 24px high, natural aspect ratio.
  logo: {
    display: "inline-flex",
    flexShrink: 0,
    height: "24px",
    "& svg, & img": {
      display: "block",
      height: "100%",
      width: "auto",
    },
  },
  text: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  title: {
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

export type PanelHeaderProps = {
  /** Defaults to the app logo from coral.config.json, as Navbar does. */
  logo?: React.ReactNode;
  /** Defaults to the app name from coral.config.json. */
  title?: string;
  /** Defaults to the app subtitle from coral.config.json; omitted when empty. */
  subtitle?: string;
  /** Actions, as Panel.Toolbar's children: right-aligned. */
  children?: React.ReactNode;
  className?: string;
  /** Panel.Toolbar's slots; `contentBefore` holds the logo and title. */
  styles?: PanelToolbarStyles;
};

/**
 * App identity (logo, title, optional subtitle) for a Panel.Left, composed
 * on Panel.Toolbar so it keeps the toolbar's height, spacing and actions slot.
 * Place it as the panel's first child; it stays put while the content below
 * scrolls.
 */
export function PanelHeader({
  logo,
  title,
  subtitle,
  children,
  className,
  styles: slotStyles,
}: PanelHeaderProps) {
  const styles = useStyles();
  const app = useCoralApp();

  const resolvedTitle = title ?? app.name;
  const resolvedSubtitle = subtitle ?? app.subtitle;
  const resolvedLogo = logo ?? (app.logo ? <img src={app.logo} alt="" /> : null);

  // Toolbar's own title can't carry a subtitle, so the whole identity goes in
  // contentBefore, which Toolbar renders first.
  const identity = (
    <>
      {/* The title names the app, so the mark is decorative here. */}
      {resolvedLogo && (
        <span className={styles.logo} aria-hidden={resolvedTitle ? true : undefined}>
          {resolvedLogo}
        </span>
      )}
      <div className={styles.text}>
        {resolvedTitle && <Body1Strong className={styles.title}>{resolvedTitle}</Body1Strong>}
        {resolvedSubtitle && <Caption1 className={styles.subtitle}>{resolvedSubtitle}</Caption1>}
      </div>
    </>
  );

  return (
    <Panel.Toolbar
      className={mergeClasses(styles.root, className)}
      styles={{
        ...slotStyles,
        contentBefore: mergeClasses(styles.identity, slotStyles?.contentBefore),
      }}
      contentBefore={identity}
    >
      {children}
    </Panel.Toolbar>
  );
}
