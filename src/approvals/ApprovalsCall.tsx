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
// people: nobody shows as ringing, only once they pick up.
//
// In an area's channel, where Skye's changes are approved, once anyone is on,
// those changes and the decisions on them (./approvalList) are shared, as a
// screen is, by Skye on the user's behalf (the share icon on the user's name
// tag), under everyone in the participants row: two panes side by side. On the left, the stand changes:
// pick one to see it. On the right, what it does to the flight's bags, on
// the board's chart with the carousels for rows (./CarouselTimeline): where
// they came off and where they come off now, and whatever they clash with,
// which is what baggage has to sort out. At the foot, the decision: the
// teammate first (Review with baggage calls them in; skyeReview's
// needsBaggage says when), then the user. What is shared is what waits, and
// stays shared once decided during the call.
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
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ArrowRight16Regular, Checkmark16Regular } from "@fluentui/react-icons";
import { ContentToolbar } from "../components/content-toolbar";
import { CallControls, CallTiles, type CallView } from "../components/navbar";
import { useDragResize } from "../components/resize-handle/useDragResize";
import { useLiveCall } from "../live";
import { callGuests, endGuestCall, removeFromCall, subscribeCallGuests } from "../live/callGuests";
import { flightsAtStay } from "../operations/allocation";
import { baggageDay, bagMove, describeBagMove, type BaggageDay, type BagMove } from "../operations/baggage";
import { useOpsActions, useOpsBoard } from "../operations/OperationsContext";
import type { OpsFlight } from "../operations/operationsData";
import { useOutputs } from "../operations/OutputSteps";
import { describeApprovers, formatLogTime, type OutputStep } from "../operations/outputs";
import { callForSignoffs, skyeReview, subscribeSkyeReview, teammatesBroughtIn, type SkyeReview } from "../operations/skyeReview";
import { formatUtc } from "../stand-timeline-demo/demoData";
import { approvalEntries, approvalStatus, entrySteps, type ApprovalEntry } from "./approvalList";
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
  paneEmpty: {
    margin: `0 ${tokens.spacingHorizontalL}`,
    color: tokens.colorNeutralForeground3,
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
  // One change, a 72px card, 16px in: the arrival, the stands it moves
  // between (on outline tags), the departure. Quiet in every state: Stroke 2
  // throughout, on Background 4 (its hover and pressed forms, its selected
  // one once picked). Positioned, for the focus ring Fluent draws around it.
  change: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
    alignItems: "center",
    gap: tokens.spacingHorizontalL,
    width: "100%",
    minHeight: "72px",
    padding: `0 ${tokens.spacingHorizontalL}`,
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
  changePicked: {
    backgroundColor: tokens.colorNeutralBackground4Selected,
    ":hover": { backgroundColor: tokens.colorNeutralBackground4Selected },
    "&[data-agent-hover]": { backgroundColor: tokens.colorNeutralBackground4Selected },
    ":hover:active": { backgroundColor: tokens.colorNeutralBackground4Selected },
  },
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
    flexShrink: 0,
    margin: 0,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalL}`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground1,
  },
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
  disclaimer: { color: tokens.colorNeutralForeground2 },
  decision: {
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
 * is on it: Skye's changes waiting for approval, or the latest decided since
 * the call began; undefined otherwise.
 */
export function useShareableApproval(channel: boolean): ApprovalEntry | undefined {
  const requests = useOutputs();
  const guests = useSyncExternalStore(subscribeCallGuests, callGuests);
  const live = useLiveCall();
  const latest = useMemo(() => approvalEntries(requests), [requests])[0];
  const someoneOn = live.active || (guests?.names.length ?? 0) > 0;
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

/** The participants row's tiles: 156px tall to start (Figma's 278px wide, at 16:9), and how far they can be dragged. */
const RIBBON_TILE = 156;
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
  // A channel rings, not its people; a person rings as themself.
  const ringing = channel ? [] : (guests?.calling ?? []);
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
  // In the order of the day, as the board reads, so the first is the one Skye briefs first.
  const steps = [...entrySteps(entry)].sort((a, b) => (a.move?.from.start ?? 0) - (b.move?.from.start ?? 0));
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

  return (
    <>
      <div className={styles.panes} data-approval-plan="">
        <section className={styles.pane} aria-labelledby={`${entry.id}-changes`}>
          <header className={styles.paneHeader}>
            <Body1Strong as="h2" id={`${entry.id}-changes`} className={styles.paneTitle}>
              Stand changes
            </Body1Strong>
          </header>
          <ul className={styles.changes} data-approval-changes="">
            {steps.map((candidate) => (
              <ChangeCard
                key={candidate.id}
                step={candidate}
                picked={candidate.id === step?.id}
                onPick={() => setPicked(candidate.id)}
                spotlit={spotOn(candidate) ? (spot?.stands ?? []) : undefined}
              />
            ))}
          </ul>
        </section>
        <BaggagePane key={step?.id} step={step} spotlit={spotOn(step) && !!spot?.bags} />
      </div>
      <footer className={styles.footer}>
        <Caption1 className={styles.disclaimer}>Skye is AI. Check mistakes.</Caption1>
        <Decision entry={entry} review={review} calling={calling} />
        <p className="ops-visually-hidden" aria-live="polite">
          {status.text}
        </p>
      </footer>
    </>
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
 * departure. A closure, which moves no stay itself, shows what it closed.
 * While Skye talks a teammate through it (`spotlit`), it is ringed in the
 * brand's colour, and so is the tag of each stand she is naming.
 */
function ChangeCard({
  step,
  picked,
  onPick,
  spotlit,
}: {
  step: OutputStep;
  picked: boolean;
  onPick: () => void;
  spotlit?: readonly ("from" | "to")[];
}) {
  const styles = useStyles();
  const flights = step.stayId ? flightsAtStay(step.stayId) : [];
  const arrival = flights.find((flight) => flight.direction === "arrival");
  const departure = flights.find((flight) => flight.direction === "departure");
  const stand = (rowId: string, end: "from" | "to") => {
    const lit = !!spotlit?.includes(end);
    return rowId ? (
      <Tag size="small" appearance={lit ? "brand" : "outline"} data-approval-stand={end}>
        {rowId}
      </Tag>
    ) : (
      <Tag size="small" appearance={lit ? "brand" : "outline"} className={lit ? undefined : styles.noStand} data-approval-stand={end}>
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
      </button>
    </li>
  );
}

/**
 * What the change picked does to the flight's bags: the day on the carousels
 * in figures, then on the chart, then in words. While Skye talks about it
 * (`spotlit`), its bags' bars are outlined in the brand's colour.
 */
function BaggagePane({ step, spotlit = false }: { step?: OutputStep; spotlit?: boolean }) {
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
        <Body1Strong as="h2" id={id} className={styles.paneTitle}>
          Baggage carousels
        </Body1Strong>
        {move && <BagsTag move={move} />}
      </header>
      <BagsFigures day={day} />
      {move ? (
        <>
          <CarouselTimeline move={move} spotlit={spotlit} />
          <Body1 as="p" className={styles.bagsSummary}>
            {describeBagMove(move)}
          </Body1>
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
    : waiting?.state === "needed" && !calling.includes(waiting.name)
      ? { label: `Review with ${waiting.expertise}`, onClick: callForSignoffs }
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
