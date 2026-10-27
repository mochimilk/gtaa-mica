import type { ReactElement, ReactNode } from "react";
import { Tag, makeStyles, mergeClasses, tokens, typographyStyles } from "@fluentui/react-components";

// A static class, so the tile's hover can reach its (hashed) actions.
const ACTIONS_CLASS = "mica-call-tile__actions";

/** One calling ring: from the media's edge outward, fading as it goes. */
const RIPPLE = {
  content: '""',
  position: "absolute",
  inset: 0,
  borderRadius: tokens.borderRadiusCircular,
  border: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke2}`,
  pointerEvents: "none",
  animationName: {
    from: { transform: "scale(1)", opacity: 1 },
    to: { transform: "scale(1.6)", opacity: 0 },
  },
  animationDuration: "1.6s",
  animationTimingFunction: tokens.curveDecelerateMid,
  animationIterationCount: "infinite",
} as const;

/*
 * A 16:9 video tile with the camera off, as in Figma: Background 2 on 6px
 * corners, the 64px avatar in the middle (Figma placed it by hand; here it is
 * centered whatever the tile's size), and the name on a small filled Tag 8px
 * in from the bottom-left corner, over where the video would be.
 */
const useStyles = makeStyles({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingVerticalS,
    flexShrink: 0,
    aspectRatio: "16 / 9",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    // Drawn inside the tile, so speaking never shifts the layout.
    outline: `${tokens.strokeWidthThick} solid transparent`,
    outlineOffset: `calc(-1 * ${tokens.strokeWidthThick})`,
    transitionProperty: "outline-color",
    transitionDuration: tokens.durationFaster,
    transitionTimingFunction: tokens.curveEasyEase,
    [`&:hover .${ACTIONS_CLASS}, &:focus-within .${ACTIONS_CLASS}`]: { opacity: 1 },
  },
  // Teams' speaking outline.
  speaking: {
    outlineColor: tokens.colorBrandStroke1,
  },
  // Holds the avatar or orb, so the calling rings can circle it.
  media: {
    position: "relative",
    display: "inline-flex",
    borderRadius: tokens.borderRadiusCircular,
  },
  /*
   * Teams' calling state: rings ripple out from the avatar, two at a time, as
   * it rings. Without motion, one ring stays round it.
   */
  ringing: {
    "::before": RIPPLE,
    "::after": { ...RIPPLE, animationDelay: "0.8s" },
    "@media (prefers-reduced-motion: reduce)": {
      "::before": { animationName: "none", transform: "scale(1.15)" },
      "::after": { display: "none" },
    },
  },
  status: {
    ...typographyStyles.caption1,
    color: tokens.colorNeutralForeground3,
  },
  name: {
    position: "absolute",
    left: tokens.spacingHorizontalS,
    bottom: tokens.spacingVerticalS,
    maxWidth: `calc(100% - 2 * ${tokens.spacingHorizontalS})`,
  },
  nameText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // Hidden until the tile is hovered or holds focus.
  actions: {
    position: "absolute",
    top: tokens.spacingVerticalS,
    right: tokens.spacingHorizontalS,
    display: "flex",
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: tokens.durationFaster,
    transitionTimingFunction: tokens.curveEasyEase,
  },
});

export type CallTileProps = {
  /** Shown on the name tag. */
  name: string;
  /** What stands in for the video: an Avatar at size 64, or Skye's orb. */
  media: ReactNode;
  /** Under the media, e.g. "Calling…". */
  status?: string;
  /** Being called and not answered yet: rings ripple out from the media. */
  ringing?: boolean;
  /** Before the name on the tag, e.g. a muted microphone. */
  nameIcon?: ReactElement;
  speaking?: boolean;
  /** Buttons in the top-right corner, shown on hover or focus. */
  actions?: ReactNode;
  className?: string;
};

/** One person on the call, camera off. Render inside a list: the root is an `li`. */
export function CallTile({ name, media, status, ringing, nameIcon, speaking, actions, className }: CallTileProps) {
  const styles = useStyles();
  return (
    <li className={mergeClasses(styles.root, speaking && styles.speaking, className)}>
      <span className={mergeClasses(styles.media, ringing && styles.ringing)}>{media}</span>
      {status && <span className={styles.status}>{status}</span>}
      <Tag
        size="small"
        appearance="filled"
        icon={nameIcon}
        className={styles.name}
        primaryText={{ className: styles.nameText }}
      >
        {name}
      </Tag>
      {actions && <div className={mergeClasses(ACTIONS_CLASS, styles.actions)}>{actions}</div>}
    </li>
  );
}
