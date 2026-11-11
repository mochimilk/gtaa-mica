// The call, as the Chat page shows it in place of its chat's conversation
// (../chat/ChatPage), as a Teams call lays it out: its title, with Teams'
// meeting bar beside it (CallControls), over the call. Until anyone else is
// on it, the user alone, big; with only Skye, the two of them big, side by
// side; with people, them big, the user in the participants row over them,
// centred until it fills, then scrolling. In this gallery, two or more big
// tiles fill the space left without scrolling, cropped as video fills its
// frame: two side by side, three as one big beside two stacked, more in rows.
// Its View switches to the speaker, big, with everyone else in the row. One
// big tile, the speaker's or anyone's alone, keeps to 16:9. A channel is called, not its
// people: only whoever Skye is calling for her changes shows as ringing; the
// rest only once they pick up.
//
// In an area's channel, where Skye's changes are approved, as soon as anyone is
// called or on, those changes and the decisions on them (./approvalList) are
// shared, as a screen is, by Skye on the user's behalf (the share icon on the
// user's name tag), under everyone in the participants row. First the agenda:
// where things stand, in one place throughout (calling, presenting, a question,
// waiting on the reviewer), and in writing what is asked, so it can be followed
// without hearing Skye. Then two panes side by side. On the left, what is
// proposed: each stand change with what it does to its flight's carousel,
// and any carousel maintenance moved, each marked if baggage has to decide it.
// Pick one to see it. On the right, the same flight's bags, on the board's chart
// with the carousels for rows (./CarouselTimeline): where they came off and
// where they come off now, and whatever they clash with. At the foot, the
// review's states (reviewSteps) and the decision: the teammate first (Review
// with baggage calls them in; skyeReview's needsBaggage says when), then the
// user. What is shared is what waits, and stays shared once decided during
// the call.
//
// Colour means one thing here: the brand's fill on a value is what changes (the
// stand or carousel a flight goes to, maintenance's new times), and never on
// what stays as it was. A ring in the brand's colour only draws the eye: what
// is picked, or what Skye is talking about.
//
// The page opens on it once a teammate is brought in on what waits (Review
// with baggage, or a yes to Skye's offer to call them): see useOpenApprovals.
// Ending the call goes back to the chat with whoever was called
// (../chat/chatThreads). A placeholder still: nothing reaches Travis. With
// Skye on a voice call, she walks him through it with her cursor as she
// briefs him (./walkThrough, ./spotlight), and he answers her aloud
// (../live/teammateVoice); otherwise he approves after a few seconds, as
// skyeReview has him do.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Caption1Strong,
  createFocusOutlineStyle,
  Tag,
  Badge,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ArrowRight12Regular, ArrowRight16Regular, Checkmark12Regular, Checkmark16Regular, Circle12Regular } from "@fluentui/react-icons";
import { ContentToolbar } from "../components/content-toolbar";
import { CallControls, CallTiles, type CallView } from "../components/navbar";
import { useDragResize } from "../components/resize-handle/useDragResize";
import { useLiveCall } from "../live";
import { callGuests, endGuestCall, removeFromCall, subscribeCallGuests } from "../live/callGuests";
import { flightsAtStay } from "../operations/allocation";
import {
  baggageDay,
  bagMove,
  describeBagMove,
  describeMaintenanceClash,
  describeMaintenanceImpact,
  type BaggageDay,
  type BagMove,
  type MaintenanceMove,
} from "../operations/baggage";
import { placeSignoffCall } from "../operations/agentGestures";
import { reviewAgenda } from "../operations/disruption";
import { useOpsActions, useOpsBoard } from "../operations/OperationsContext";
import type { OpsFlight } from "../operations/operationsData";
import { useOutputs } from "../operations/OutputSteps";
import { describeApprovers, formatLogTime, type OutputStep } from "../operations/outputs";
import { placingSignoffCall, skyeReview, subscribeSkyeReview, teammatesBroughtIn, type SkyeReview } from "../operations/skyeReview";
import { formatUtc } from "../stand-timeline-demo/demoData";
import { approvalEntries, approvalStatus, entrySteps, reviewSteps, type ApprovalEntry, type ApprovalTone } from "./approvalList";
import { CarouselTimeline } from "./CarouselTimeline";
import { spotlight, subscribeSpotlight } from "./spotlight";
import "../operations/operations.css";

/**
 * Calls `open` as a teammate is brought in on what waits (skyeReview's
 * teammatesBroughtIn), wherever the user is: the call opens then.
 */
export function useOpenApprovals(open: () => void): void {
  const review = useSyncExternalStore(subscribeSkyeReview, skyeReview);
  const calling = useSyncExternalStore(subscribeCallGuests, callGuests)?.calling ?? [];
  const brought = teammatesBroughtIn(review, calling);
  const was = useRef(brought);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (brought && !was.current) openRef.current();
    was.current = brought;
  }, [brought]);
}

const useStyles = makeStyles({
  // The content toolbar, divided from the call and the panes under it.
  toolbar: {
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  // The call's main space, filling what is left, 24px in: in the gallery, its
  // tiles in --columns columns and as many rows as they take, 10px apart,
  // each filling its cell (not 16:9), so nothing scrolls.
  stage: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 0",
    minHeight: 0,
    padding: tokens.spacingHorizontalXXL,
    containerType: "size",
  },
  // One tile (the speaker, or one person): 16:9, as big as fits, centred.
  stageOne: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    "& > li": { width: "min(100cqw, calc(100cqh * 16 / 9))", aspectRatio: "16 / 9" },
  },
  stageTiles: {
    display: "grid",
    gridTemplateColumns: "repeat(var(--columns), minmax(0, 1fr))",
    gridAutoRows: "minmax(0, 1fr)",
    gap: "10px",
    flex: "1 1 0",
    minHeight: 0,
    margin: 0,
    padding: 0,
    "& > li": { aspectRatio: "auto", minWidth: 0, minHeight: 0 },
  },
  // Three: the first big at the left, the other two stacked at the right.
  stageThree: {
    gridTemplateColumns: "3fr 2fr",
    gridTemplateRows: "repeat(2, minmax(0, 1fr))",
    "& > li:first-child": { gridRow: "span 2" },
  },
  // The participants row, over the divider under it, and its resize handle.
  ribbon: {
    position: "relative",
    flex: "none",
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  // Its tiles: --ribbon-tile tall at 16:9 (Figma's call window tiles at
  // 278px, so 156px, to start), 10px apart, 12px from the toolbar and the
  // divider, 24px in. Centred until it fills, then from the left, scrolling
  // sideways.
  callStrip: {
    display: "grid",
    gridAutoFlow: "column",
    gridAutoColumns: "calc(var(--ribbon-tile) * 16 / 9)",
    justifyContent: "safe center",
    gap: "10px",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXXL}`,
    overflowX: "auto",
    overflowY: "hidden",
    // These tiles are short: a tile's "Calling…" goes in its corner, clear of its name.
    "& [data-call-status]": {
      position: "absolute",
      top: tokens.spacingVerticalS,
      right: tokens.spacingHorizontalS,
      margin: 0,
    },
  },
  // Coral's panel resize handle (Panel.Left's), turned for a row: an 8px band
  // over the divider, where a 128px bar shows on hover.
  ribbonResize: {
    position: "absolute",
    left: "0",
    bottom: "-4px",
    width: "100%",
    height: "8px",
    cursor: "ns-resize",
    zIndex: 1,
    "::before": {
      content: '""',
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: "128px",
      height: "4px",
      borderRadius: "var(--borderRadiusCircular)",
      backgroundColor: "var(--colorNeutralStroke1)",
      opacity: 0,
      transition: "opacity 150ms ease",
    },
    ":hover::before": {
      opacity: 1,
    },
  },
  // The two panes, side by side, 16px apart and in, filling the height left.
  panes: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: tokens.spacingHorizontalL,
    flex: "1 1 0",
    minHeight: 0,
    padding: tokens.spacingHorizontalL,
  },
  pane: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  // A pane's 56px header, as the content toolbar's: its title 16px in.
  paneHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    height: "56px",
    padding: `0 ${tokens.spacingHorizontalL}`,
    boxSizing: "border-box",
    flexShrink: 0,
  },
  paneTitle: {
    margin: 0,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // The title, and which change the pane is about: the card picked says the same.
  paneHeading: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  paneLink: {
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.colorNeutralForeground2,
    fontVariantNumeric: "tabular-nums",
  },
  paneEmpty: {
    margin: `0 ${tokens.spacingHorizontalL}`,
    color: tokens.colorNeutralForeground3,
  },
  // What the review is for and where it has got to, over the panes: its state
  // first, so it stays put, then the agenda; under them any question put to
  // Skye and her answer.
  agenda: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    flexShrink: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL} 0`,
  },
  agendaLine: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    minWidth: 0,
  },
  phase: { flexShrink: 0 },
  exchange: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: tokens.spacingHorizontalS,
    margin: 0,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    "& dt": { color: tokens.colorNeutralForeground2 },
    "& dd": { margin: 0, color: tokens.colorNeutralForeground1 },
  },
  // The stand changes, 8px apart, scrolling under the pane's header. 4px
  // taller into the header than its cards start, so the first card's rings
  // (focus's 2px, the spotlight's 4px) are not clipped at its top.
  changes: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    flex: "1 1 0",
    minHeight: 0,
    margin: `calc(${tokens.spacingVerticalXS} * -1) 0 0`,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalL}`,
    overflowY: "auto",
    listStyle: "none",
  },
  // One change, a card, 16px in: the arrival, the stands it moves between
  // (on outline tags), the departure; under them, its carousel and whether
  // baggage decides it. Quiet in every state: Stroke 2 throughout, on Background
  // 4 (its hover and pressed forms, its selected one once picked). Positioned,
  // for the focus ring Fluent draws around it.
  change: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalXS,
    width: "100%",
    minHeight: "72px",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    boxSizing: "border-box",
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground4,
    color: tokens.colorNeutralForeground1,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    // A person's pointer or Skye's (data-agent-hover: see agent-cursor/cursorMotion).
    ":hover": { backgroundColor: tokens.colorNeutralBackground4Hover },
    "&[data-agent-hover]": { backgroundColor: tokens.colorNeutralBackground4Hover },
    ":hover:active": { backgroundColor: tokens.colorNeutralBackground4Pressed },
    ...createFocusOutlineStyle({ style: { outlineRadius: tokens.borderRadiusXLarge } }),
  },
  // Picked, it is the one the baggage pane is about, its bars outlined the same.
  changePicked: {
    backgroundColor: tokens.colorNeutralBackground4Selected,
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground4Selected },
    "&[data-agent-hover]": { backgroundColor: tokens.colorNeutralBackground4Selected },
    ":hover:active": { backgroundColor: tokens.colorNeutralBackground4Selected },
  },
  // Its second line, across the card: its carousel, its bags, and at the end whether baggage decides it.
  changeBags: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
    paddingTop: tokens.spacingVerticalXS,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
    fontVariantNumeric: "tabular-nums",
  },
  carousels: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    flexShrink: 0,
  },
  bagsDetail: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  decide: {
    flexShrink: 0,
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXXS,
  },
  decideNone: { color: tokens.colorNeutralForeground3 },
  decideDone: { color: tokens.colorStatusSuccessForeground1 },
  // The change Skye is talking a teammate through (./spotlight): ringed as
  // focus is, in the brand's colour.
  changeSpotlit: {
    outline: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    outlineOffset: tokens.strokeWidthThick,
  },
  flight: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  flightEnd: {
    alignItems: "flex-end",
    textAlign: "end",
  },
  route: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
    fontVariantNumeric: "tabular-nums",
  },
  stands: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalL,
  },
  // A value that changes, wherever it shows (a stand, a carousel, maintenance's new times): filled.
  proposedValue: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  // A stand Skye is naming that stays as it is: outlined to draw the eye, not filled as what changes is.
  standNamed: {
    outline: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    outlineOffset: tokens.strokeWidthThin,
  },
  // No stand, as NS, its outline tag in Fluent's warning orange: the
  // warning foreground, inside the warning stroke that goes with it.
  noStand: {
    color: tokens.colorStatusWarningForeground3,
    borderTopColor: tokens.colorStatusWarningBorder2,
    borderRightColor: tokens.colorStatusWarningBorder2,
    borderBottomColor: tokens.colorStatusWarningBorder2,
    borderLeftColor: tokens.colorStatusWarningBorder2,
  },
  // The day's reclaim in figures, under the pane's header, as the board's KPIs
  // sit under its chart: each a label over its figure, 24px apart, 16px in.
  bagsFigures: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: tokens.spacingHorizontalXXL,
    rowGap: tokens.spacingVerticalS,
    flexShrink: 0,
    margin: 0,
    padding: `0 ${tokens.spacingHorizontalL} ${tokens.spacingVerticalM}`,
  },
  bagsFigure: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    fontVariantNumeric: "tabular-nums",
  },
  bagsFigureLabel: { color: tokens.colorNeutralForeground3 },
  bagsFigureValue: { margin: 0 },
  bagsFigureAlert: { color: tokens.colorStatusDangerForeground1 },
  // The change in words, under the chart, which fills the pane flush above it.
  bagsSummary: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    flexShrink: 0,
    margin: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalM}`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground1,
  },
  bagsKey: { color: tokens.colorNeutralForeground3 },
  // The bags' tag in Fluent's status colours, as its tint badges have them.
  tagDanger: {
    backgroundColor: tokens.colorStatusDangerBackground1,
    color: tokens.colorStatusDangerForeground1,
  },
  tagWarning: {
    backgroundColor: tokens.colorStatusWarningBackground1,
    color: tokens.colorStatusWarningForeground3,
  },
  // Figma's 57px foot: the disclaimer 24px in, the decision at the end.
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexShrink: 0,
    minHeight: "57px",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXXL}`,
    boxSizing: "border-box",
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  disclaimer: { color: tokens.colorNeutralForeground2, flexShrink: 0 },
  // The review's states, in order, between the disclaimer and the decision.
  steps: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalXXS,
    flex: "1 1 0",
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  step: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXXS,
    whiteSpace: "nowrap",
    color: tokens.colorNeutralForeground3,
  },
  stepDone: { color: tokens.colorNeutralForeground2 },
  stepCurrent: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  stepDoneIcon: { color: tokens.colorStatusSuccessForeground1 },
  decision: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  decided: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
  },
  approvedIcon: { color: tokens.colorStatusSuccessForeground1 },
});

/** Whether the user stopped sharing Skye's changes on the call: until they share them again, or the call ends. */
let shareStopped = false;
const shareListeners = new Set<() => void>();
const subscribeShare = (listener: () => void) => {
  shareListeners.add(listener);
  return () => shareListeners.delete(listener);
};
const shareStoppedNow = () => shareStopped;

/** The toolbars' Share and Stop sharing: shares Skye's changes on the call again, or stops. */
export function shareApproval(share: boolean): void {
  if (shareStopped === !share) return;
  shareStopped = !share;
  for (const listener of shareListeners) listener();
}
// The next call shares them again.
subscribeCallGuests(() => {
  if (callGuests() === null) shareApproval(true);
});

/**
 * What a call can share, in an area's channel (`channel`), once anyone else
 * is on it or being called: Skye's changes waiting for approval, or the latest decided since
 * the call began; undefined otherwise.
 */
export function useShareableApproval(channel: boolean): ApprovalEntry | undefined {
  const requests = useOutputs();
  const guests = useSyncExternalStore(subscribeCallGuests, callGuests);
  const live = useLiveCall();
  const latest = useMemo(() => approvalEntries(requests), [requests])[0];
  const someoneOn = live.active || (guests?.names.length ?? 0) > 0 || (guests?.calling.length ?? 0) > 0;
  const began = guests?.since ?? live.state.startedAt ?? Number.POSITIVE_INFINITY;
  const decidedAt = latest?.requests[0]?.decision?.at;
  return channel && someoneOn && latest && (latest.waiting || (decidedAt !== undefined && decidedAt >= began))
    ? latest
    : undefined;
}

/**
 * What the call shares: what it can (useShareableApproval), unless the user
 * stopped sharing it. The call view shows it, and the user's tile and the
 * toolbars' Share say it is shared, on the page and in the call window alike.
 */
export function useSharedApproval(channel: boolean): ApprovalEntry | undefined {
  const shareable = useShareableApproval(channel);
  const stopped = useSyncExternalStore(subscribeShare, shareStoppedNow);
  return stopped ? undefined : shareable;
}

/** The participants row's tiles: how tall to start, short enough to leave room for the review under them, and how far they can be dragged. */
const RIBBON_TILE = 108;
const RIBBON_TILE_MIN = 90;
const RIBBON_TILE_MAX = 320;

export type ApprovalsCallProps = {
  /** Who the call is with: its title, unless Skye's changes are shared. */
  label: string;
  /** The call is an area's channel's: its people show only once they pick up, and Skye's changes are shared. */
  channel: boolean;
};

/**
 * The call on the page: its title and meeting bar, and everyone on it, laid
 * out as the file's head says, with Skye's changes shared in a channel's.
 * Only while there is a call. Leave takes the people called in off the call,
 * or, with nobody but Skye on it, disconnects her, as the call window's does.
 */
export function ApprovalsCall({ label, channel }: ApprovalsCallProps) {
  const styles = useStyles();
  const review = useSyncExternalStore(subscribeSkyeReview, skyeReview);
  const guests = useSyncExternalStore(subscribeCallGuests, callGuests);
  const live = useLiveCall();
  const names = guests?.names ?? [];
  // A channel rings, not its people, apart from whoever Skye is calling for her
  // changes, so it shows who the call is for; a person rings as themself.
  const ringing = (guests?.calling ?? []).filter((name) => !channel || !!review?.signoffs.some((signoff) => signoff.name === name));
  const people = names.length + ringing.length;
  const shareable = useShareableApproval(channel);
  const shared = useSharedApproval(channel);
  // Everyone else, in the tiles' order: Skye, those on, those ringing. The
  // speaker, for the speaker view (the one to start with), is the first of
  // them, once anyone but Skye is on or ringing.
  const others = [...(live.active ? ["Skye"] : []), ...names, ...ringing];
  const speaker = people > 0 ? others[0] : undefined;
  const [view, setView] = useState<CallView>("speaker");
  // The participants row's tiles: how tall, dragged from its foot.
  const [ribbonTile, setRibbonTile] = useState(RIBBON_TILE);
  const resizeRibbon = useDragResize("y", true, (delta) =>
    setRibbonTile(Math.min(RIBBON_TILE_MAX, Math.max(RIBBON_TILE_MIN, ribbonTile + delta))),
  );

  // Skye shares her changes on the user's behalf: the user's tile says so.
  const tiles = (include: "all" | "others" | "self", className: string, show?: (name: string) => boolean) => (
    <CallTiles
      agentName="Skye"
      guests={names}
      calling={ringing}
      onRemove={removeFromCall}
      include={include}
      show={show}
      sharing={shared !== undefined}
      className={className}
    />
  );
  // The participants row, which its foot resizes.
  const ribbon = (include: "all" | "self", show?: (name: string) => boolean) => (
    <div className={styles.ribbon} style={{ "--ribbon-tile": `${ribbonTile}px` } as CSSProperties}>
      {tiles(include, styles.callStrip, show)}
      <div className={styles.ribbonResize} onMouseDown={resizeRibbon} />
    </div>
  );
  // The main space, with `count` tiles in it: one at 16:9; the rest filling
  // it, two side by side, three as one big and two stacked, four two by two,
  // then three and four across.
  const stage = (include: "all" | "others", count: number, show?: (name: string) => boolean) => {
    const columns = count <= 2 ? count : count === 4 ? 2 : count <= 6 ? 3 : 4;
    const layout = mergeClasses(styles.stageTiles, count === 1 && styles.stageOne, count === 3 && styles.stageThree);
    return (
      <div className={styles.stage} style={{ "--columns": columns } as CSSProperties}>
        {tiles(include, layout, show)}
      </div>
    );
  };

  return (
    <>
      <ContentToolbar
        className={styles.toolbar}
        label={shared ? shared.requests[0].title : label}
        actionsEnd={
          <CallControls
            meeting
            view={view}
            onViewChange={setView}
            sharing={shared !== undefined}
            onShareChange={shareable ? shareApproval : undefined}
            onLeave={guests !== null ? endGuestCall : () => live.hangup()}
          />
        }
      />
      {shared ? (
        <>
          {ribbon("all")}
          <Plan key={shared.id} entry={shared} review={shared.waiting ? review : null} calling={guests?.calling ?? []} />
        </>
      ) : view === "speaker" && speaker ? (
        // The speaker big, everyone else in the row.
        <>
          {ribbon("all", (name) => name !== speaker)}
          {stage("others", 1, (name) => name === speaker)}
        </>
      ) : people === 0 ? (
        // The user alone, or with only Skye: big, side by side.
        stage("all", others.length + 1)
      ) : (
        <>
          {ribbon("self")}
          {stage("others", others.length)}
        </>
      )}
    </>
  );
}

/** The plan shared: its stand changes beside what the one picked does to the bags, over the decision. */
function Plan({ entry, review, calling }: { entry: ApprovalEntry; review: SkyeReview | null; calling: readonly string[] }) {
  const styles = useStyles();
  // In the order of the day, as the board reads, so the first is the one Skye
  // briefs first; carousel maintenance moved among them by when it was planned.
  const when = (candidate: OutputStep) => candidate.maintenance?.from.start ?? candidate.move?.from.start ?? 0;
  const steps = [...entrySteps(entry)].sort((a, b) => when(a) - when(b));
  // The one picked; until then, the first baggage has to approve, else the first.
  const [picked, setPicked] = useState<string | null>(null);
  const step =
    steps.find((candidate) => candidate.id === picked) ??
    steps.find((candidate) => candidate.needs?.expertise === "baggage") ??
    steps[0];
  const status = approvalStatus(entry, review, calling);
  // What Skye points at as she walks a teammate through it.
  const spot = useSyncExternalStore(subscribeSpotlight, spotlight);
  const spotOn = (candidate?: OutputStep) => !!candidate?.stayId && !!spot?.stayIds.includes(candidate.stayId);
  // Maintenance moved is about the flight it makes room for: the pane shows that flight's bags.
  const bagsStep = step?.maintenance ? (steps.find((candidate) => candidate.stayId === step.maintenance?.stayId) ?? step) : step;

  return (
    <>
      <ReviewAgenda entry={entry} steps={steps} review={review} tone={status.tone} phase={status.text} />
      <div className={styles.panes} data-approval-plan="">
        <section className={styles.pane} aria-labelledby={`${entry.id}-changes`}>
          <header className={styles.paneHeader}>
            <Body1Strong as="h2" id={`${entry.id}-changes`} className={styles.paneTitle}>
              Proposed changes
            </Body1Strong>
          </header>
          <ul className={styles.changes} data-approval-changes="">
            {steps.map((candidate) =>
              candidate.maintenance ? (
                <MaintenanceCard
                  key={candidate.id}
                  step={candidate}
                  maintenance={candidate.maintenance}
                  picked={candidate.id === step?.id}
                  proposed={entry.waiting}
                  onPick={() => setPicked(candidate.id)}
                  spotlit={!!spot?.maintenance}
                />
              ) : (
                <ChangeCard
                  key={candidate.id}
                  step={candidate}
                  picked={candidate.id === step?.id}
                  proposed={entry.waiting}
                  onPick={() => setPicked(candidate.id)}
                  spotlit={spotOn(candidate) ? (spot?.stands ?? []) : undefined}
                />
              ),
            )}
          </ul>
        </section>
        <BaggagePane key={step?.id} step={bagsStep} maintenance={step?.maintenance} spotlit={(spotOn(bagsStep) && !!spot?.bags) || !!spot?.maintenance} />
      </div>
      <footer className={styles.footer}>
        <Caption1 className={styles.disclaimer}>Skye is AI. Check mistakes.</Caption1>
        <ReviewSteps entry={entry} review={review} />
        <Decision entry={entry} review={review} calling={calling} />
        <p className="ops-visually-hidden" aria-live="polite">
          {status.text}
        </p>
      </footer>
    </>
  );
}

const PHASE_COLOR: Record<ApprovalTone, "warning" | "brand" | "success" | "subtle"> = {
  warning: "warning",
  brand: "brand",
  success: "success",
  subtle: "subtle",
};

/**
 * Over the panes: where the review has got to, always in this place, and what
 * it is for, written so that whoever is called in can follow it without
 * hearing Skye. Under them, any question the reviewer has put to her, with
 * her answer once she gives it.
 */
function ReviewAgenda({
  entry,
  steps,
  review,
  tone,
  phase,
}: {
  entry: ApprovalEntry;
  steps: readonly OutputStep[];
  review: SkyeReview | null;
  tone: ApprovalTone;
  phase: string;
}) {
  const styles = useStyles();
  const moves = steps.filter((step) => step.move);
  const agenda = reviewAgenda(
    { moves: moves.length, forBaggage: moves.filter((step) => step.needs).length, maintenance: steps.some((step) => step.maintenance) },
    !entry.waiting,
  );
  const asker = review?.signoffs.find((signoff) => signoff.exchange);
  const exchange = asker?.exchange;
  return (
    <section className={styles.agenda} aria-label="Agenda">
      <div className={styles.agendaLine}>
        <Badge appearance="tint" color={PHASE_COLOR[tone]} className={styles.phase}>
          {phase}
        </Badge>
        <Body1Strong>{agenda}</Body1Strong>
      </div>
      {exchange && asker && (
        <dl className={styles.exchange} aria-label={`${asker.name}'s question`}>
          <dt>
            <Caption1Strong>{asker.name.split(" ")[0]}</Caption1Strong>
          </dt>
          <dd>
            <Caption1>{exchange.question}</Caption1>
          </dd>
          {exchange.answer && (
            <>
              <dt>
                <Caption1Strong>Skye</Caption1Strong>
              </dt>
              <dd>
                <Caption1>{exchange.answer}</Caption1>
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

/** The review's states in order, at the foot (reviewSteps): who approved it and when, and that it is applied, only once they are so. */
function ReviewSteps({ entry, review }: { entry: ApprovalEntry; review: SkyeReview | null }) {
  const styles = useStyles();
  // Cancelled: the decision at the foot says so.
  if (!entry.waiting && !entry.requests[0]?.decision) return null;
  return (
    <ol className={styles.steps} aria-label="Review states">
      {reviewSteps(entry, review).map((step) => (
        <li
          key={step.id}
          className={mergeClasses(styles.step, step.state === "done" && styles.stepDone, step.state === "current" && styles.stepCurrent)}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          {step.state === "done" ? <Checkmark12Regular aria-hidden className={styles.stepDoneIcon} /> : <Circle12Regular aria-hidden />}
          <Caption1>{step.label}</Caption1>
        </li>
      ))}
    </ol>
  );
}

/** Whether baggage decides a piece, and once they have, who did: at the end of its card, so what is asked can be found at a glance. */
function DecideMark({ step }: { step: OutputStep }) {
  const styles = useStyles();
  if (step.approvedBy) {
    return (
      <Caption1 className={mergeClasses(styles.decide, styles.decideDone)}>
        <Checkmark12Regular aria-hidden /> {step.approvedBy.split(" ")[0]} approved
      </Caption1>
    );
  }
  if (!step.needs) return <Caption1 className={mergeClasses(styles.decide, styles.decideNone)}>No baggage change</Caption1>;
  return (
    <Badge appearance="tint" color="warning" shape="rounded" className={styles.decide}>
      {step.needs.expertise[0].toUpperCase() + step.needs.expertise.slice(1)} review
    </Badge>
  );
}

/** "XA103" over "SFO 09:00": a flight, where it comes from or goes to, and when. */
function FlightEnd({ flight, fallback, end }: { flight?: OpsFlight; fallback?: string; end?: boolean }) {
  const styles = useStyles();
  return (
    <span className={mergeClasses(styles.flight, end && styles.flightEnd)}>
      <Caption1Strong>{flight?.flight ?? fallback}</Caption1Strong>
      {flight && (
        <span className={styles.route}>
          <Caption1Strong>{flight.routeEnd}</Caption1Strong>
          <Caption1>{formatUtc(flight.estimate)}</Caption1>
        </span>
      )}
    </span>
  );
}

/**
 * One stand change, Figma's card: the arrival, from stand → to stand, the
 * departure; under them, what it does to its flight's carousel, its bags and
 * when they come off, and whether baggage decides it. A closure, which moves no
 * stay itself, shows what it closed. While it is `proposed`, the stand it goes
 * to is filled in the brand's colour, as is a new carousel; what stays as it was
 * never is. While Skye talks a teammate through it (`spotlit`), it is ringed in
 * the brand's colour, and so is the tag of each stand she is naming.
 */
function ChangeCard({
  step,
  picked,
  proposed,
  onPick,
  spotlit,
}: {
  step: OutputStep;
  picked: boolean;
  proposed: boolean;
  onPick: () => void;
  spotlit?: readonly ("from" | "to")[];
}) {
  const styles = useStyles();
  const flights = step.stayId ? flightsAtStay(step.stayId) : [];
  const arrival = flights.find((flight) => flight.direction === "arrival");
  const departure = flights.find((flight) => flight.direction === "departure");
  const { move } = step;
  // Read on every stand change too: its bags follow the board.
  const { allocationVersion } = useOpsBoard();
  const bags = useMemo(() => (step.stayId && move ? bagMove(step.stayId, move.from, move.to) : null), [step, allocationVersion]);
  const stand = (rowId: string, end: "from" | "to") => {
    // Only the side that changes is blue: a move in time on one stand changes neither.
    const changes = proposed && end === "to" && move?.from.rowId !== move?.to.rowId;
    const named = !!spotlit?.includes(end) && styles.standNamed;
    return rowId ? (
      <Tag size="small" appearance={changes ? "filled" : "outline"} className={mergeClasses(changes && styles.proposedValue, named || undefined)} data-approval-stand={end}>
        {rowId}
      </Tag>
    ) : (
      <Tag
        size="small"
        appearance={changes ? "filled" : "outline"}
        className={mergeClasses(changes ? styles.proposedValue : styles.noStand, named || undefined)}
        data-approval-stand={end}
      >
        <span aria-hidden>NS</span>
        <span className="ops-visually-hidden">No stand</span>
      </Tag>
    );
  };
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        className={mergeClasses(styles.change, picked && styles.changePicked, spotlit && styles.changeSpotlit)}
        onClick={onPick}
        data-approval-change={step.stayId}
      >
        <FlightEnd flight={arrival} fallback={arrival || departure ? undefined : step.title} />
        {step.move ? (
          <span className={styles.stands}>
            {stand(step.move.from.rowId, "from")}
            <ArrowRight16Regular aria-hidden />
            <span className="ops-visually-hidden">to</span>
            {stand(step.move.to.rowId, "to")}
          </span>
        ) : (
          <Body1>{step.detail}</Body1>
        )}
        <FlightEnd flight={departure} end />
        {bags && <CarouselDelta bags={bags} proposed={proposed} step={step} />}
      </button>
    </li>
  );
}

/**
 * A change's carousel, on its card: where its bags came off → where they do
 * now, the new one filled in the brand's colour while it is proposed, or the one
 * they stay on, neutral. Then how many bags, and when they come off.
 */
function CarouselDelta({ bags, proposed, step }: { bags: BagMove; proposed: boolean; step: OutputStep }) {
  const styles = useStyles();
  const { was, now } = bags;
  const shown = now ?? was;
  const moved = !!was && !!now && was.carousel !== now.carousel;
  return (
    <span className={styles.changeBags} data-approval-carousels="">
      {shown && (
        <>
          <span className={styles.carousels}>
            <Caption1>Carousel</Caption1>
            {moved && was && now ? (
              <>
                <Tag size="extra-small" appearance="outline">
                  {was.carousel}
                </Tag>
                <ArrowRight12Regular aria-hidden />
                <span className="ops-visually-hidden">to</span>
                <Tag size="extra-small" appearance={proposed ? "filled" : "outline"} className={proposed ? styles.proposedValue : undefined}>
                  {now.carousel}
                </Tag>
              </>
            ) : (
              <Tag size="extra-small" appearance="outline">
                {shown.carousel}
              </Tag>
            )}
          </span>
          <Caption1 className={styles.bagsDetail}>
            {shown.bags} bags · {formatUtc(shown.start)}–{formatUtc(shown.end)}
          </Caption1>
        </>
      )}
      <DecideMark step={step} />
    </span>
  );
}

/**
 * Carousel maintenance moved, as a change of its own for baggage to approve:
 * the carousel and its work, its old and new times (the new filled in the
 * brand's colour while proposed), and the conflict it clears.
 */
function MaintenanceCard({
  step,
  maintenance,
  picked,
  proposed,
  onPick,
  spotlit,
}: {
  step: OutputStep;
  maintenance: MaintenanceMove;
  picked: boolean;
  proposed: boolean;
  onPick: () => void;
  spotlit: boolean;
}) {
  const styles = useStyles();
  const { from, to } = maintenance;
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        className={mergeClasses(styles.change, picked && styles.changePicked, spotlit && styles.changeSpotlit)}
        onClick={onPick}
        data-approval-maintenance=""
      >
        <span className={styles.flight}>
          <Caption1Strong>Carousel {maintenance.carousel}</Caption1Strong>
          <span className={styles.route}>
            <Caption1>{maintenance.reason}</Caption1>
          </span>
        </span>
        <span className={styles.stands}>
          <Tag size="small" appearance="outline">
            {formatUtc(from.start)}–{formatUtc(from.end)}
          </Tag>
          <ArrowRight16Regular aria-hidden />
          <span className="ops-visually-hidden">to</span>
          <Tag size="small" appearance={proposed ? "filled" : "outline"} className={proposed ? styles.proposedValue : undefined}>
            {formatUtc(to.start)}–{formatUtc(to.end)}
          </Tag>
        </span>
        <span className={mergeClasses(styles.flight, styles.flightEnd)} />
        <span className={styles.changeBags}>
          <Caption1 className={styles.bagsDetail}>{describeMaintenanceClash(maintenance)}</Caption1>
          <DecideMark step={step} />
        </span>
      </button>
    </li>
  );
}

/**
 * What the change picked does to the flight's bags: which change it is, the
 * same flights and stands as its card, so the two panes read as one; the day on
 * the carousels in figures, then on the chart, then in words, with any
 * `maintenance` moved for it. While Skye talks about it (`spotlit`), its bags'
 * bars are outlined in the brand's colour.
 */
function BaggagePane({ step, maintenance, spotlit = false }: { step?: OutputStep; maintenance?: MaintenanceMove; spotlit?: boolean }) {
  const styles = useStyles();
  // Read on every stand change too: everyone else's bags follow the board.
  const { allocationVersion } = useOpsBoard();
  const move = useMemo(
    () => (step?.stayId && step.move ? bagMove(step.stayId, step.move.from, step.move.to) : null),
    [step, allocationVersion],
  );
  const day = useMemo(() => baggageDay(), [allocationVersion]);
  const id = `${step?.id ?? "none"}-bags`;
  return (
    <section className={styles.pane} aria-labelledby={id} data-approval-bags="">
      <header className={styles.paneHeader}>
        <span className={styles.paneHeading}>
          <Body1Strong as="h2" id={id} className={styles.paneTitle}>
            Baggage carousels
          </Body1Strong>
          {step?.move && (
            <Caption1 className={styles.paneLink} data-approval-link="">
              {step.title} · {step.detail}
            </Caption1>
          )}
        </span>
        {move && <BagsTag move={move} />}
      </header>
      <BagsFigures day={day} />
      {move ? (
        <>
          <CarouselTimeline move={move} spotlit={spotlit} />
          <div className={styles.bagsSummary}>
            <Body1>{describeBagMove(move)}</Body1>
            {maintenance && <Body1>{describeMaintenanceImpact(maintenance)}</Body1>}
            <Caption1 className={styles.bagsKey}>Each bar is a flight's bags on the belt, first bag to last, not its aircraft's time on the stand.</Caption1>
          </div>
        </>
      ) : (
        <Caption1 as="p" className={styles.paneEmpty}>
          {!step
            ? "Pick a stand change to see what it does to the bags."
            : step.stayId
              ? `${step.title} reaches this stand by tow, so it has no bags to reclaim here.`
              : "Closing an area moves no bags itself. Each stay it moved is listed on its own."}
        </Caption1>
      )}
    </section>
  );
}

const HOUR_MS = 3_600_000;

/**
 * The day on the carousels, as the board stands: how many flights' bags and
 * how many bags, the busiest hour, the carousels out of service, and the
 * flights whose bags clash (in red while there are any). Synthetic figures.
 */
function BagsFigures({ day }: { day: BaggageDay }) {
  const styles = useStyles();
  const figures: { label: string; value: string; alert?: boolean }[] = [
    { label: "Flights", value: String(day.flights) },
    { label: "Bags", value: day.bags.toLocaleString("en-US") },
    ...(day.peak
      ? [{ label: "Busiest", value: `${formatUtc(day.peak.from)}–${formatUtc(day.peak.from + HOUR_MS)} · ${day.peak.flights} flights` }]
      : []),
    { label: "Out of service", value: day.outages === 1 ? "1 carousel" : `${day.outages} carousels` },
    { label: "Clashes", value: String(day.clashes), alert: day.clashes > 0 },
  ];
  return (
    <dl className={styles.bagsFigures} aria-label="The day on the carousels (synthetic)">
      {figures.map((figure) => (
        <div key={figure.label} className={styles.bagsFigure}>
          <dt className={styles.bagsFigureLabel}>
            <Caption1>{figure.label}</Caption1>
          </dt>
          <dd className={mergeClasses(styles.bagsFigureValue, figure.alert && styles.bagsFigureAlert)}>
            <Caption1Strong>{figure.value}</Caption1Strong>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Where the bags stand after the change, on a small Fluent tag in a status
 * colour: in someone else's way or on a carousel out of service (danger),
 * moved (warning), or as they were (the tag's own neutral).
 */
function BagsTag({ move }: { move: BagMove }) {
  const styles = useStyles();
  const { was, now, clashes, outage } = move;
  const moved = !was || !now || was.carousel !== now.carousel || was.start !== now.start;
  const [label, tone] =
    clashes.length > 0 || outage
      ? ["Conflict", styles.tagDanger]
      : moved
        ? ["Bags move", styles.tagWarning]
        : ["No change", undefined];
  return (
    <Tag size="small" appearance="filled" shape="rounded" className={tone}>
      {label}
    </Tag>
  );
}

/**
 * The decision, at the page's foot: Cancel beside the primary button, which
 * calls the teammate in (Review with baggage), waits while they ring and
 * look, then approves the plan. Once decided, who approved it and when.
 */
function Decision({ entry, review, calling }: { entry: ApprovalEntry; review: SkyeReview | null; calling: readonly string[] }) {
  const styles = useStyles();
  const { approveSkyeChanges, undoSkyeChanges } = useOpsActions();
  // Skye at work on another request: what she changes joins this, so it waits for her.
  const skyeWorking = useOutputs().some((request) => request.actor === "skye" && request.working);
  const decision = entry.requests[0]?.decision;
  if (!entry.waiting) {
    return (
      <span className={styles.decided}>
        {decision ? (
          <>
            <Checkmark16Regular aria-hidden className={styles.approvedIcon} />
            <Caption1>
              Approved by {describeApprovers(decision.by)} · {formatLogTime(decision.at)}
            </Caption1>
          </>
        ) : (
          <Caption1>Cancelled: every stay is back where it was.</Caption1>
        )}
      </span>
    );
  }
  const waiting = review?.signoffs.find((signoff) => signoff.state !== "approved");
  const primary: { label: string; onClick?: () => unknown } = skyeWorking
    ? { label: "Skye is still at work" }
    : placingSignoffCall()
      ? { label: `Calling ${waiting?.expertise ?? ""}` }
      : waiting?.state === "needed" && !calling.includes(waiting.name)
        ? { label: `Review with ${waiting.expertise}`, onClick: placeSignoffCall }
        : waiting
          ? { label: "Waiting for approval" }
          : { label: "Approve plan", onClick: approveSkyeChanges };
  return (
    <span className={styles.decision}>
      <Button appearance="secondary" onClick={undoSkyeChanges}>
        Cancel
      </Button>
      <Button appearance="primary" disabledFocusable={!primary.onClick} onClick={primary.onClick} data-approval-decision="">
        {primary.label}
      </Button>
    </span>
  );
}
