import * as React from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { bundleIcon, PlugDisconnected20Filled, PlugDisconnected20Regular } from "@fluentui/react-icons";
import { useLiveCall } from "../../live";
import { KEEP_SELECTION_ATTR } from "../../operations/ViewsFiltersToolbar";

// Regular at rest, filled on hover/press, as Fluent buttons expect.
const DisconnectIcon = bundleIcon(PlugDisconnected20Filled, PlugDisconnected20Regular);

export type DisconnectButtonProps = {
  /** The agent the live call is with, e.g. "Skye". */
  agentName: string;
};

/**
 * Takes Skye off the call: a transparent unplug button, disabled while she is
 * not on it. Connect, in the Ask Skye pill, puts her back. The people called
 * in leave from the call window instead (its red Leave; CallPanel), so they
 * stay on when Skye goes, and she stays on when they do.
 */
export function DisconnectButton({ agentName }: DisconnectButtonProps) {
  const live = useLiveCall();
  const agentOn = live.active;
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  // Focus lands here when the control just pressed goes away: Connect (or the
  // mic) as the voice bar replaces it, or this button as it disables. Only
  // then, so a change Skye makes to the call never takes focus.
  const pressed = React.useRef(false);
  const wasAgentOn = React.useRef(agentOn);
  React.useLayoutEffect(() => {
    const placed = agentOn && !wasAgentOn.current;
    wasAgentOn.current = agentOn;
    const ownPress = pressed.current;
    pressed.current = false;
    if (!placed && !ownPress) return;
    const active = document.activeElement;
    if (!active || active === document.body) buttonRef.current?.focus();
  }, [agentOn]);

  // Disabled but focusable, so its tooltip still shows and the toolbar's arrow
  // keys still reach it, as Fluent advises for toolbars.
  return (
    <Tooltip content={agentOn ? `Disconnect ${agentName}` : "Disconnect"} relationship="label">
      <Button
        ref={buttonRef}
        {...KEEP_SELECTION_ATTR}
        appearance="transparent"
        disabledFocusable={!agentOn}
        icon={<DisconnectIcon />}
        onClick={
          agentOn
            ? () => {
                pressed.current = true;
                live.hangup();
              }
            : undefined
        }
      />
    </Tooltip>
  );
}
