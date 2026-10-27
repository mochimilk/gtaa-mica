import type { ReactNode } from "react";
import { Toolbar, ToolbarDivider, makeStyles } from "@fluentui/react-components";
import { AppBar } from "../app-bar";
import { AskSkye } from "../ask-skye";
import { NAV_RAIL_WIDTH } from "../nav-rail";
import { DisconnectButton } from "./DisconnectButton";
import { MuteButton } from "./MuteButton";
import { PeopleCallButton } from "./PeopleCallButton";

const useStyles = makeStyles({
  /*
   * The open Ask Skye chat (640px, --ask-width-open in askSkye.css) floats
   * centered over the bar, with its 32px chat toggle 8px off its left end.
   * Cap the start content so its trailing control stays beside them; only a
   * block's 12px end padding may run underneath.
   */
  actionsStart: {
    maxWidth: "min(100%, calc((100vw - 640px) / 2 - 40px - 4px))",
  },
  /*
   * The bar starts right of the nav rail, so its center sits half the rail's
   * width right of the window's. Ask Skye moves back by that half to center on
   * the window; relative, so the bar's layout is unchanged.
   */
  actionsCenter: {
    position: "relative",
    left: `${-NAV_RAIL_WIDTH / 2}px`,
  },
  // The bar's 16px padding already insets it, so no toolbar padding.
  callToolbar: {
    padding: 0,
  },
});

export type AppNavbarProps = {
  /** Left-aligned, opposite the agent. */
  actionsStart?: ReactNode;
  /** Beside Ask Skye's bar, right of Connect: e.g. AlertsMenu. */
  askActionsEnd?: ReactNode;
};

// App identity lives in the left panel's PanelHeader, so the bar has no branding.
export function AppNavbar({ actionsStart, askActionsEnd }: AppNavbarProps) {
  const styles = useStyles();
  // The orb's state is no longer passed in: it follows the live call. Mute is
  // the user's for the whole call, Skye and anyone else, so it sits at the
  // bar's end, followed by Disconnect for either or both.
  return (
    <AppBar
      styles={{ actionsStart: styles.actionsStart, actionsCenter: styles.actionsCenter }}
      actionsStart={actionsStart}
      // Temporarily in place of <ViewSwitcher /> (Stand plan / 3D Map), which
      // nothing listened to yet; restore it here when the 3D map lands.
      actionsCenter={<AskSkye agentName="Skye" actionsEnd={askActionsEnd} />}
      actionsEnd={
        <Toolbar aria-label="Call" className={styles.callToolbar}>
          <PeopleCallButton agentName="Skye" />
          <ToolbarDivider />
          <MuteButton />
          <DisconnectButton agentName="Skye" />
        </Toolbar>
      }
    />
  );
}
