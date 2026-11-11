// What Skye is on, pinned in the dock beside Ask Skye, so the current
// disruption can always be read off the same place, wherever her cursor has
// gone and whichever page is showing: "XD472/473 · 1h 50m late". It is also the
// way back to the written record: it opens and closes the Outputs panel, on
// every page, at any point. With no task on, it says Activity, and with nothing
// on the record yet it is not there.
import { useSyncExternalStore } from "react";
import { eventBus } from "@coral-ai/react";
import { makeStyles, ToggleButton, tokens, Tooltip } from "@fluentui/react-components";
import { bundleIcon, History20Filled, History20Regular } from "@fluentui/react-icons";
import { useRightPanelOpen } from "../components/panel-toggle";
import { activity, subscribeActivity } from "./activity";
import { disruptionState, disruptionTask, subscribeDisruption } from "./disruption";
import { OUTPUTS_PANEL_ID } from "./OutputsPanel";
import { useOutputs } from "./OutputSteps";

const TaskIcon = bundleIcon(History20Filled, History20Regular);

const useStyles = makeStyles({
  button: {
    whiteSpace: "nowrap",
    fontWeight: tokens.fontWeightRegular,
    fontVariantNumeric: "tabular-nums",
    // Too narrow for it beside the bar, the icon alone, its tooltip saying the rest.
    "@media (max-width: 1100px)": {
      minWidth: "auto",
      "& > span:last-child": { display: "none" },
    },
  },
});

export function SkyeTask() {
  const styles = useStyles();
  // Read on each change of the disruption, so it follows the story.
  useSyncExternalStore(subscribeDisruption, disruptionState);
  const task = disruptionTask();
  const logged = useSyncExternalStore(subscribeActivity, activity).length > 0;
  const listed = useOutputs().length > 0;
  const open = useRightPanelOpen(OUTPUTS_PANEL_ID);
  if (!task && !logged && !listed) return null;
  const label = task ?? "Activity";
  return (
    <Tooltip content={`${open ? "Close" : "Open"} activity${task ? `: ${task}` : ""}`} relationship="label">
      <ToggleButton
        appearance="subtle"
        shape="circular"
        checked={open}
        icon={<TaskIcon />}
        className={styles.button}
        data-skye-task=""
        onClick={() => eventBus.setActivePanel(open ? null : OUTPUTS_PANEL_ID)}
      >
        <span>{label}</span>
      </ToggleButton>
    </Tooltip>
  );
}
