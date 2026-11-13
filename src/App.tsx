import {
  CoralShellColumn,
  CoralShellRow,
  Content,
} from "@coral-ai/react";
import { ToolbarDivider, makeStyles, tokens } from "@fluentui/react-components";
import { AppNavbar } from "./components/navbar";
import { AppNavRail, usePageHistory, type AppPage } from "./components/nav-rail";
import { NorvaraLogo } from "./components/navbar/NorvaraLogo";
import { PanelHeader } from "./components/panel-header";
import { SharedPanelLeft } from "./components/panel-left";
import { LeftPanelToggle } from "./components/panel-toggle";
import { DesktopTitleBar, hasDesktopTitleBar } from "./components/title-bar";
import { useEffect, useMemo, useRef } from "react";
import { MINUTE, type DropPreview } from "./stand-timeline";
import { DEMO_DATA } from "./stand-timeline-demo/demoData";
import { StandTimelineDemo } from "./stand-timeline-demo/StandTimelineDemo";
import { useDemoZoom } from "./stand-timeline-demo/ZoomMenuRow";
import { checkSwap, currentClosure, describePlan } from "./operations/allocation";
import {
  FIRST_LANE_ROW,
  NO_STAND_LABEL,
  describeLaneDrop,
  keepsTimes,
  noStandLane,
  planBoardDrop,
  type NoStandLane,
} from "./operations/noStandLane";
import { AlertsMenu } from "./operations/AlertsMenu";
import { DisruptionNotice, DisruptionWatch } from "./operations/DisruptionNotice";
import { SourceSummary } from "./data-sources/SourceSummary";
import { ScenarioToolbar } from "./data-sources/ScenarioToolbar";
import { ACTIVE_DATASET } from "./operations/activeDataset";
import { useAccommodationSession } from "./operations/useAccommodationSession";
import { ClosureBand, ClosureLabel } from "./operations/ClosureBand";
import { FlightBarMenu } from "./operations/FlightBarMenu";
import { FlightDragChip, FlightDropGhost } from "./operations/FlightDrag";
import { OperationsPanel } from "./operations/OperationsPanel";
import { OutputsPanel, OutputsToggle } from "./operations/OutputsPanel";
import { OutputsPeek } from "./operations/OutputsPeek";
import {
  OperationsProvider,
  selectedFlight,
  useOpsActions,
  useOpsBoard,
  useOpsSelections,
  type OpsSelection,
} from "./operations/OperationsContext";
import { SelectionPopover } from "./operations/SelectionPopover";
import { SwapConfirm } from "./operations/SwapConfirm";
import { ViewsFiltersToolbar } from "./operations/ViewsFiltersToolbar";
import { LiveCallProvider } from "./live";
import { outOfSightStyle, useShownPage, useSkyeAt } from "./live/outOfSight";
import { AgentCursor, AgentHelperCursors } from "./components/agent-cursor";
import { SkyeGlowDefs } from "./components/skye-glow";
import { LumaSkyeBackground } from "./components/luma-skye/LumaSkyeBackground";
import { useDrawings } from "./studio/drawings";
import { StudioPage } from "./studio/StudioPage";
import { shareApproval, useOpenApprovals } from "./approvals/ApprovalsCall";
import { ChatPage, useCallInChat, useCallShare, useCallThread, useUnreadChats } from "./chat/ChatPage";
import { chatState, openThread } from "./chat/chatThreads";
import { TimelineOverlayProvider, OverlayToolbar, OverlayLayers, OverlayReviews } from "./overlays/TimelineOverlays";
import { RequestsProvider, RequestsToolbar } from "./requests/RequestsFeature";

// Each page's left panel: its stable ID, shared with its toggle (in the
// desktop title bar, or the nav rail in a browser), and its name in the
// toggle's label. All three open at one width (SharedPanelLeft).
const LEFT_PANELS: Record<AppPage, { id: string; label: string }> = {
  planner: { id: "operations-panel", label: "operations panel" },
  chat: { id: "chat-panel", label: "chat panel" },
  studio: { id: "studio-panel", label: "drawings panel" },
};

/** Bars drag anywhere on the board: to any stand, and along in time in 5-minute steps. */
const DRAG_SNAP_MS = 5 * MINUTE;

/**
 * The verdict shown while a bar is dragged over a row (and along in time):
 * green for a move onto free time, a swap with the one stay it lands on, a
 * waiting flight dropped on a stand that takes it, or a stay dropped into the
 * No stand lane; red otherwise. To or from the lane, a stay keeps its times
 * however it is dragged, so its ghost does too.
 */
function previewDrop(occupancyId: string, rowId: string, shiftMs: number): DropPreview {
  const drop = planBoardDrop(occupancyId, rowId, shiftMs);
  const kept = keepsTimes(occupancyId, rowId) ? { shiftMs: 0 } : {};
  switch (drop.kind) {
    case "move":
      return { allowed: true, label: `Drop to ${describePlan(drop)}` };
    case "swap":
      return { allowed: true, swapWithId: drop.otherId, label: `Drop to ${describePlan(drop)}` };
    case "assign":
    case "unassign":
      return { allowed: true, label: `Drop to ${describeLaneDrop(drop)}`, ...kept };
    case "conflict":
      return { allowed: false, blockingIds: drop.blockingIds, label: drop.reason, ...kept };
    case "stay":
      return { allowed: false };
  }
}

/** The waiting stay of a selected flight with no stand: its bar in the No stand lane. */
const waitingStayIds = (selection: OpsSelection) => {
  const stayId = selectedFlight(selection)?.unplacedStay?.stayId;
  return stayId ? [stayId] : [];
};

/**
 * The No stand lane's label in the stand column, on its first row: how many
 * flights wait there. Its other rows are unlabelled.
 */
function laneLabel(lane: NoStandLane) {
  const waiting = lane.stays.length;
  return (row: { id: string }) =>
    row.id === FIRST_LANE_ROW ? (
      <span className="ops-lane-label">
        <span className="st-row-name">{NO_STAND_LABEL}</span>
        <span className={waiting > 0 ? "ops-lane-count ops-lane-count--waiting" : "ops-lane-count"}>
          {waiting > 0 ? `${waiting} waiting` : "None waiting"}
        </span>
      </span>
    ) : null;
}

/**
 * Chart wired to the shared operations selection, views, filters and stands.
 * While `away`, out of sight behind another page (PlannerPage), what floats
 * beside it is put away, so none of it shows over that page.
 */
function ConnectedTimeline({ away }: { away: boolean }) {
  // Not the details popover or swap question (useOpsDetails): the chart does not draw them.
  const { selection, skyeSelection } = useOpsSelections();
  const { applyChartIntent } = useOpsActions();
  const { matcher, allocationVersion, boardHeld, flightStyle } = useOpsBoard();
  // Flights waiting for a stand, in the No stand lane above the stands. While
  // Skye's cursors work several at once, it keeps its rows (see layoutLane).
  const heldLane = useRef<NoStandLane | undefined>(undefined);
  const lane = useMemo(() => {
    const next = noStandLane(boardHeld ? heldLane.current : undefined);
    heldLane.current = next;
    return next;
  }, [allocationVersion, boardHeld]);
  // A new array per stand change, so the chart lays the bars out again.
  const occupancies = useMemo(() => [...DEMO_DATA.occupancies, ...lane.stays], [allocationVersion, lane]);
  const pinnedLabel = useMemo(() => laneLabel(lane), [lane]);
  // Read on every stand change (allocationVersion re-renders this).
  const closure = currentClosure();
  // The user and Skye select side by side: the chart shows both, Skye's in her
  // colours. Made once per selection (and stand change, for a pair's verdict),
  // so the chart redraws only the bars whose selection changed.
  const { skyeIds, selectedIds, links } = useMemo(() => {
    const userIds = [...selection.occupancyIds, ...waitingStayIds(selection)];
    const skyeIds = [...skyeSelection.occupancyIds, ...waitingStayIds(skyeSelection)].filter((id) => !userIds.includes(id));
    // A pair is linked within one player's selection, never across the two.
    const linkFor = (pair: readonly string[], skye: boolean) => {
      if (pair.length !== 2) return [];
      const status = checkSwap(pair[0], pair[1]).ok ? "compatible" : "incompatible";
      return [{ fromId: pair[0], toId: pair[1], className: `demo-link--${status}${skye ? " demo-link--skye" : ""}` }];
    };
    return {
      skyeIds,
      selectedIds: [...userIds, ...skyeIds],
      links: [...linkFor(selection.occupancyIds, false), ...linkFor(skyeSelection.occupancyIds, true)],
    };
  }, [selection, skyeSelection, allocationVersion]);
  // The board's zoom, shared with its controls in the header's View menu.
  const zoom = useDemoZoom();
  // Each aircraft type's drawing from the Studio, in the middle of its aircraft's bars.
  const drawings = useDrawings();
  // What the board draws of the host's, made once each, so a render here does
  // not render them again: they follow what they read themselves.
  const underlay = useMemo(() => <ClosureBand closure={closure} />, [closure]);
  const overlay = useMemo(
    () => (
      <>
        <ClosureLabel closure={closure} />
        {/* A flight with no stand, dragged from the list: where it would land. */}
        <FlightDropGhost />
      </>
    ),
    [closure],
  );
  const toolbar = useMemo(
    () => (
      <>
        <ViewsFiltersToolbar zoom={zoom} />
        <ToolbarDivider />
        <OutputsToggle />
      </>
    ),
    [zoom],
  );
  const summary = useMemo(() => <SourceSummary />, []);
  // Where FlightBarMenu listens for right-clicks on the bars.
  const boardRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {/* Details show in SelectionPopover.
          Non-matching bars are dimmed (still occupied/selectable), never removed.
          What Skye selected is outlined in its orb's colours (skye-glow). */}
      <div ref={boardRef} className="skye-selection-scope">
        <StandTimelineDemo
          selectedIds={selectedIds}
          skyeIds={skyeIds}
          links={links}
          onIntent={applyChartIntent}
          isMatch={matcher.active ? matcher.occupancy : undefined}
          selectionActive={selectedIds.length > 0 || !!selection.flightId || !!skyeSelection.flightId}
          occupancies={occupancies}
          pinnedRows={lane.rows}
          pinnedLabel={pinnedLabel}
          previewDrop={ACTIVE_DATASET.capabilities.editStands ? previewDrop : undefined}
          dragSnapMs={DRAG_SNAP_MS}
          underlay={<>{underlay}<OverlayLayers position="underlay" isMatch={matcher.active ? matcher.occupancy : undefined} /></>}
          overlay={<>{overlay}<OverlayLayers position="overlay" isMatch={matcher.active ? matcher.occupancy : undefined} /></>}
          toolbar={<>{!away && <><ScenarioToolbar /><RequestsToolbar /><OverlayToolbar /></>}{toolbar}</>}
          summary={summary}
          zoom={zoom}
          flightStyle={flightStyle}
          drawings={drawings}
        />
      </div>
      <OverlayReviews visible={!away} />
      {!away && (
        <>
          <SelectionPopover />
          {/* A bar's right-click menu: Unassign stand. */}
          <FlightBarMenu board={boardRef} />
          {/* Asks before the user's swaps, beside the two stays. */}
          <SwapConfirm />
          {/* The flight being dragged from the list, beside the pointer. */}
          <FlightDragChip />
        </>
      )}
    </>
  );
}

/**
 * The Stand planner page: the operations panel beside the board. While
 * another page shows (`away`), the board stays mounted behind it, out of
 * sight and inert, so Skye carries on working on it in the background (see
 * live/outOfSight.ts), and it is as she and the user left it when they
 * come back. The panel, which the other page has its own of, and the Outputs
 * peek go meanwhile.
 */
function PlannerPage({ away, panelClassName }: { away: boolean; panelClassName: string }) {
  return (
    /* The panel sits inside the content window, beside the timeline. */
    <div
      style={{ display: "flex", flex: "1 1 auto", minHeight: 0, position: "relative", ...(away ? outOfSightStyle : {}) }}
      inert={away}
    >
      {!away && (
        <SharedPanelLeft panelID={LEFT_PANELS.planner.id} className={panelClassName}>
          <PanelHeader logo={<NorvaraLogo />} />
          <OperationsPanel />
        </SharedPanelLeft>
      )}
      {/*
        Bounded flex host: the timeline fills this height and scrolls its
        own rows between pinned rulers. overflowY stays as a fallback for
        viewports shorter than the timeline's minimum.
      */}
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          boxSizing: "border-box",
          flex: "1 1 0",
          height: "100%",
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        <ConnectedTimeline away={away} />
      </main>
      {/* What Skye is changing, at the top right under the board's header, while the Outputs panel is closed. */}
      {!away && <OutputsPeek />}
    </div>
  );
}

/*
 * Panel.Left's own margin offsets it against Content in the shell row; inside
 * Content it sits flush, divided from the timeline by a hairline.
 */
const useStyles = makeStyles({
  panel: {
    margin: 0,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  // The window: the desktop title bar (none in a browser) over the shell.
  window: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
  },
  // Beside the full-height nav rail, the content and app bar column takes the
  // rest of the width (and may shrink below its content's), and the shell's
  // height under the title bar in place of Coral's 100vh.
  main: {
    flex: "1 1 0",
    minWidth: 0,
    height: "auto",
  },
  // Coral's content window keeps its glass (its own backdrop-filter value),
  // drawn by a layer behind its content instead of by the window itself. In
  // Chromium, a backdrop-filter on an ancestor stops any backdrop-filter
  // inside it from blurring, and the board's time ruler, No stand lane and
  // stand column blur the rows that scroll under them. Its tint is
  // colorNeutralBackground4 at half opacity, in place of Coral's
  // colorNeutralBackgroundAlpha.
  content: {
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground4} 50%, transparent)`,
    backdropFilter: "none",
    isolation: "isolate",
    "::before": {
      content: '""',
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: -1,
      borderRadius: "inherit",
      backdropFilter: "saturate(150%) blur(20px)",
      pointerEvents: "none",
    },
  },
});

/**
 * The app bar under the content. The Chat page shows the call itself while
 * the call's chat is open (useCallInChat); anywhere else, other chats
 * included, the call window floats over the page.
 */
function Navbar({ page, onOpenChat }: { page: AppPage; onOpenChat: () => void }) {
  const callInChat = useCallInChat();
  const { toChannel, canShare, sharing } = useCallShare();
  const callThread = useCallThread();
  return (
    <AppNavbar
      askActionsEnd={<AlertsMenu />}
      // Skye catching the day's disruption (see docs/disruption-demo.md).
      askNotices={page === "planner" && ACTIVE_DATASET.capabilities.fixtureAnalyses ? <DisruptionNotice /> : undefined}
      callOnPage={page === "chat" && callInChat}
      callToChannel={toChannel}
      callSharing={sharing}
      onCallShareChange={canShare ? shareApproval : undefined}
      // The call window's Open: the Chat page, on the call's chat.
      onOpenCall={() => {
        if (callThread) openThread(callThread);
        onOpenChat();
      }}
    />
  );
}

export default function App() {
  const styles = useStyles();
  // The page on screen, with the pages before it for the title bar's Back and Forward.
  const { page, go: setPage, back, forward } = usePageHistory<AppPage>("planner");
  const workspace = useAccommodationSession();
  useEffect(() => {
    if (workspace.revision) document.querySelector<HTMLButtonElement>("[data-requests-toolbar]")?.focus({ preventScroll: true });
  }, [workspace.revision]);
  const leftPanel = LEFT_PANELS[page];
  // In the desktop app the left panel's toggle is in the title bar, after
  // Back and Forward; in a browser, at the nav rail's foot.
  const titleBar = hasDesktopTitleBar();
  const panelToggle = (
    <LeftPanelToggle
      panelID={leftPanel.id}
      panelLabel={leftPanel.label}
      tooltipPositioning={titleBar ? "below" : "after"}
      size={titleBar ? "small" : undefined}
    />
  );
  // Bringing a teammate in on Skye's changes (Review with baggage) opens the
  // call, in the chat it belongs to: their area's channel for the changes' terminal.
  useOpenApprovals(() => {
    const { returnTo } = chatState();
    if (returnTo) openThread(returnTo);
    setPage("chat");
  });
  const chatsUnread = useUnreadChats();
  // Where Skye's cursor is at work: that page stays mounted, out of sight,
  // while another shows, and the nav rail says she is there.
  useShownPage(page);
  const skyeAt = useSkyeAt();
  return (
    // OperationsProvider first: the voice session reaches the app through the
    // same selection, views, filters and acknowledgements the UI uses.
    <OperationsProvider key={workspace.revision}>
      <RequestsProvider dataset={workspace.reference} visible={page === "planner"}>
      <TimelineOverlayProvider dataset={workspace.active}>
      <LiveCallProvider>
        <LumaSkyeBackground />
        {/* Skye catching the day's disruption and speaking up around it, on the board and in the chat alike. */}
        {page !== "studio" && ACTIVE_DATASET.capabilities.fixtureAnalyses && <DisruptionWatch />}
        <div className={styles.window}>
          <DesktopTitleBar onBack={back} onForward={forward} actions={panelToggle} />
          {/* The nav rail runs the full height, beside the content and the app bar. */}
          <CoralShellRow>
            <AppNavRail
              page={page}
              onNavigate={setPage}
              chatsUnread={chatsUnread}
              skyeAt={skyeAt}
              actionsEnd={titleBar ? undefined : panelToggle}
            />
            <CoralShellColumn className={styles.main}>
              <CoralShellRow>
                <Content className={styles.content}>
                  {/*
                    The board on every page, first, so its controls come before
                    any other page's chart in the document for whatever looks
                    them up there (Skye's cursors among them). The Chat page
                    while it shows, or while Skye is at work on it.
                  */}
                  <PlannerPage away={page !== "planner"} panelClassName={styles.panel} />
                  {page === "studio" && <StudioPage panelID={leftPanel.id} panelClassName={styles.panel} />}
                  {(page === "chat" || skyeAt?.page === "chat") && (
                    <ChatPage panelID={LEFT_PANELS.chat.id} panelClassName={styles.panel} away={page !== "chat"} />
                  )}
                </Content>
                {/* Beside the content window; its toggle ends the board's header. */}
                {page === "planner" && <OutputsPanel />}
              </CoralShellRow>

              <Navbar page={page} onOpenChat={() => setPage("chat")} />

            </CoralShellColumn>
          </CoralShellRow>
        </div>
        {/* Skye's own cursor, shown while Skye clicks things in the app. */}
        <AgentCursor name="Skye" />
        {/* The cursors Skye splits into to work on several things at once. */}
        <AgentHelperCursors />
        {/* The gradient that outlines Skye's selections on the chart. */}
        <SkyeGlowDefs />
      </LiveCallProvider>
      </TimelineOverlayProvider>
      </RequestsProvider>
    </OperationsProvider>
  );
}
