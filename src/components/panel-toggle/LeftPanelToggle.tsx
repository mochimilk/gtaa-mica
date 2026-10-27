import * as React from "react";
import { Panel, eventBus } from "@coral-ai/react";
import { Tooltip, type TooltipProps } from "@fluentui/react-components";

const subscribe = (notify: () => void) => {
  eventBus.on("setActivePanelLeft", notify);
  return () => eventBus.off("setActivePanelLeft", notify);
};

/** Whether Coral's event bus has this Panel.Left open; no state of our own. */
function useLeftPanelOpen(panelID: string) {
  return React.useSyncExternalStore(subscribe, () => eventBus.getActivePanelLeft() === panelID);
}

export type LeftPanelToggleProps = {
  /** The Panel.Left the toggle opens and closes. */
  panelID: string;
  /** Names that panel in the toggle's label, e.g. "operations panel". */
  panelLabel: string;
  /** Where the label's tooltip opens, e.g. "after" from a left rail. */
  tooltipPositioning?: TooltipProps["positioning"];
};

/**
 * Coral's Panel.Toggle for a Panel.Left, labelled (and tooltipped) by whether
 * the panel is open. It stays mounted while the panel is open or closed, so
 * focus stays on it, and as an explicit Panel.Toggle it is the panel's only
 * toggle.
 */
export function LeftPanelToggle({ panelID, panelLabel, tooltipPositioning }: LeftPanelToggleProps) {
  const open = useLeftPanelOpen(panelID);
  const label = `${open ? "Close" : "Open"} ${panelLabel}`;
  return (
    <Tooltip content={label} relationship="label" positioning={tooltipPositioning}>
      <Panel.Toggle panelID={panelID} aria-label={label} />
    </Tooltip>
  );
}
