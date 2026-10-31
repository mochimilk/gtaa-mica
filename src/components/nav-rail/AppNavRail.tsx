import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Airplane } from "@coral-ai/bundleicons/Airplane";
import { Chat } from "@coral-ai/bundleicons/Chat";
import { Branch } from "@coral-ai/bundleicons/Branch";
import { MoreHorizontal } from "@coral-ai/bundleicons/MoreHorizontal";
import { PaintBrush } from "@coral-ai/bundleicons/PaintBrush";
import { Body1Strong, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { SkyeAt } from "../../live/outOfSight";
import { agentCursor } from "../agent-cursor";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../menu";
import { StepStatusIcon } from "../step-status-icon";
import { AccountButton } from "./AccountButton";
import { NavRail, NavRailButton, type NavRailCallout } from "./NavRail";

/**
 * The pages the rail opens: the stand planner, the chat with Skye and the
 * teammates (where Skye's changes to the plan come for approval), and the
 * Studio's drawings for its aircraft.
 */
export type AppPage = "planner" | "chat" | "studio";

export type AppNavRailProps = {
  /** The page on screen. */
  page: AppPage;
  onNavigate: (page: AppPage) => void;
  /** How many conversations have posts unread, on Chat's counter. */
  chatsUnread?: number;
  /**
   * Where Skye's cursor is at work (../../live/outOfSight). While that page
   * is out of sight, a note beside its entry says she is still working there,
   * then that she is done, until the user goes there or dismisses it.
   */
  skyeAt?: SkyeAt | null;
  /** Above the account at the rail's foot: e.g. the left panel's toggle. */
  actionsEnd?: ReactNode;
};

const useStyles = makeStyles({
  // The step spinner (its 32px box) beside what she is doing, as Outputs lists her work.
  note: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    marginLeft: `calc(-1 * ${tokens.spacingHorizontalS})`,
  },
  icon: { flexShrink: 0 },
  text: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  doing: { color: tokens.colorNeutralForeground2 },
});

/** Skye's work on a page the user has left, for the note beside its entry: under way, or `done` while they were away. */
type AwayWork = { at: SkyeAt; done: boolean };

/**
 * The work the note beside an entry is about, if it shows now: Skye's on a
 * page out of sight, or finished there while it was, until the user goes
 * there; none once dismissed, until her next stint of work. Kept in step as
 * she works and the user moves about during render, not in an effect, so
 * the note never trails them by a frame.
 */
function useAwayWork(page: AppPage, at: SkyeAt | null): [AwayWork | null, () => void] {
  const [work, setWork] = useState<AwayWork | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  let next = work;
  if (at) next = work?.at === at ? work : { at, done: false };
  else if (work && !work.done) next = work.at.page === page ? null : { at: work.at, done: true };
  // Done, and seen.
  if (next?.done && next.at.page === page) next = null;
  if (next !== work) setWork(next);
  const shows = next && next.at.page !== page && next.at.stint !== dismissed ? next : null;
  return [shows, () => shows && setDismissed(shows.at.stint)];
}

const useCursorTask = () => useSyncExternalStore(agentCursor.subscribe, () => agentCursor.task);

/** The note's words: that Skye is still at work there, and on what (her cursor's tag, as it counts the work off), or that she is done. */
function AwayNote({ work }: { work: AwayWork }) {
  const styles = useStyles();
  const task = useCursorTask();
  const doing = (work.done ? null : task) ?? work.at.doing;
  return (
    <div className={styles.note}>
      <StepStatusIcon status={work.done ? "done" : "in-progress"} className={styles.icon} />
      <div className={styles.text}>
        <Body1Strong>{work.done ? "Skye is done here" : "Skye is still working here"}</Body1Strong>
        {doing && <Caption1 className={styles.doing}>{doing}</Caption1>}
      </div>
    </div>
  );
}

/**
 * Mica's pages and the user, down the shell's left edge. Stand planner,
 * Chat and Studio switch the page on screen. The other entries are
 * visual only for now: nothing listens to them.
 */
export function AppNavRail({ page, onNavigate, chatsUnread = 0, skyeAt = null, actionsEnd }: AppNavRailProps) {
  const [away, dismiss] = useAwayWork(page, skyeAt);
  const callout = (on: AppPage): NavRailCallout | undefined =>
    away?.at.page === on
      ? { content: <AwayNote work={away} />, label: away.done ? "Skye is done here" : "Skye is still working here", onDismiss: dismiss }
      : undefined;
  return (
    <NavRail
      aria-label="App"
      actionsEnd={
        <>
          {actionsEnd}
          <AccountButton />
        </>
      }
    >
      <NavRailButton
        icon={Airplane}
        label="Stand planner"
        current={page === "planner"}
        callout={callout("planner")}
        onClick={() => onNavigate("planner")}
      />
      <NavRailButton
        icon={Chat}
        label="Chat"
        current={page === "chat"}
        count={chatsUnread}
        callout={callout("chat")}
        onClick={() => onNavigate("chat")}
      />
      <NavRailButton icon={Branch} label="Scenarios" />
      <NavRailButton
        icon={PaintBrush}
        label="Studio"
        current={page === "studio"}
        callout={callout("studio")}
        onClick={() => onNavigate("studio")}
      />
      <Menu positioning="after-top">
        <MenuTrigger disableButtonEnhancement>
          <NavRailButton icon={MoreHorizontal} label="More" />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem>3D Map</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </NavRail>
  );
}
