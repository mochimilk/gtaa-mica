import * as React from "react";
import { Panel, eventBus } from "@coral-ai/react";
import { Tooltip, type TooltipProps } from "@fluentui/react-components";

const subscribe = (notify: () => void) => {
  eventBus.on("setActivePanel", notify);
  return () => eventBus.off("setActivePanel", notify);
};

/** Whether Coral's event bus has this Panel.Right open; no state of our own. */
export function useRightPanelOpen(panelID: string) {
  return React.useSyncExternalStore(subscribe, () => eventBus.getActivePanel() === panelID);
}

export type RightPanelToggleProps = {
  /** The Panel.Right the toggle opens and closes. */
  panelID: string;
  /** Names that panel in the toggle's label, e.g. "outputs". */
  panelLabel: string;
  /**
   * The label while the panel has nothing to show; given, the toggle is
   * greyed out. It stays focusable, so its tooltip still says why.
   */
  disabledLabel?: string;
  /** Where the label's tooltip opens. */
  tooltipPositioning?: TooltipProps["positioning"];
} & Omit<React.ComponentProps<typeof Panel.Toggle>, "panelID" | "aria-label" | "disabled" | "disabledFocusable">;

/**
 * Coral's Panel.Toggle for a Panel.Right, labelled (and tooltipped) by whether
 * the panel is open, as LeftPanelToggle is for a Panel.Left. As an explicit
 * Panel.Toggle it is the panel's only toggle.
 */
export function RightPanelToggle({
  panelID,
  panelLabel,
  disabledLabel,
  tooltipPositioning,
  ...rest
}: RightPanelToggleProps) {
  const open = useRightPanelOpen(panelID);
  const label = disabledLabel ?? `${open ? "Close" : "Open"} ${panelLabel}`;
  return (
    <Tooltip content={label} relationship="label" positioning={tooltipPositioning}>
      <Panel.Toggle {...rest} panelID={panelID} aria-label={label} disabledFocusable={disabledLabel !== undefined} />
    </Tooltip>
  );
}
