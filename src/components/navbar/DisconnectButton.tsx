import * as React from "react";
import { Button, SplitButton, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { bundleIcon, CallEnd20Filled, PlugDisconnected20Filled, PlugDisconnected20Regular } from "@fluentui/react-icons";
import { useLiveCall } from "../../live";
import { callGuests, endGuestCall, subscribeCallGuests } from "../../live/callGuests";
import { KEEP_SELECTION_ATTR, MENU_POSITIONING } from "../../operations/ViewsFiltersToolbar";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, type MenuButtonProps } from "../menu";

// Regular at rest, filled on hover/press, as Fluent buttons expect.
const DisconnectIcon = bundleIcon(PlugDisconnected20Filled, PlugDisconnected20Regular);

/** Above the button, as the bar is at the bottom, fitted to the room there. */
const POSITIONING = { ...MENU_POSITIONING, position: "above", align: "end" } as const;

// Leave: Fluent's danger fill, as Teams' Leave. On both halves of the split.
const useStyles = makeStyles({
  danger: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    ":hover": {
      backgroundColor: tokens.colorStatusDangerBackground3Hover,
      color: tokens.colorNeutralForegroundOnBrand,
    },
    ":hover:active": {
      backgroundColor: tokens.colorStatusDangerBackground3Pressed,
      color: tokens.colorNeutralForegroundOnBrand,
    },
  },
});

export type DisconnectButtonProps = {
  /** The agent the live call is with, e.g. "Skye". */
  agentName: string;
};

/**
 * Takes Skye, the people called in, or both off the call. While Skye is the
 * most on the call it is a transparent unplug button: disabled with nobody,
 * disconnecting Skye with her alone. Once the user calls people in it is
 * Teams' red Leave, with the end-call icon, which disconnects the people;
 * with Skye there too it is a split button whose menu offers all, Skye or the
 * people.
 */
export function DisconnectButton({ agentName }: DisconnectButtonProps) {
  const styles = useStyles();
  const live = useLiveCall();
  const guests = React.useSyncExternalStore(subscribeCallGuests, callGuests);
  const agentOn = live.active;
  const peopleOn = guests !== null;
  const both = agentOn && peopleOn;
  const variant = both ? "split" : peopleOn ? "leave" : "unplug";
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  // Focus lands here when the control just pressed goes away: Connect (or the
  // mic) as the voice bar replaces it, or this button as another variant
  // takes its place. Only then, so a change Skye makes to the call never takes
  // focus.
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
  }, [agentOn, variant]);

  const disconnectAgent = () => {
    pressed.current = true;
    live.hangup();
  };
  const disconnectPeople = () => {
    pressed.current = true;
    endGuestCall();
  };
  const disconnectAll = () => {
    pressed.current = true;
    live.hangup();
    endGuestCall();
  };

  if (variant === "split") {
    return (
      <Menu positioning={POSITIONING}>
        <MenuTrigger disableButtonEnhancement>
          {(triggerProps: MenuButtonProps) => (
            <SplitButton
              {...KEEP_SELECTION_ATTR}
              appearance="primary"
              icon={<CallEnd20Filled />}
              menuButton={{ ...triggerProps, className: styles.danger, "aria-label": "Leave options" }}
              primaryActionButton={{ ref: buttonRef, className: styles.danger, onClick: disconnectPeople }}
            >
              Leave
            </SplitButton>
          )}
        </MenuTrigger>
        <MenuPopover {...KEEP_SELECTION_ATTR}>
          <MenuList>
            <MenuItem onClick={disconnectAll}>Disconnect all</MenuItem>
            <MenuItem onClick={disconnectAgent}>Disconnect {agentName}</MenuItem>
            <MenuItem onClick={disconnectPeople}>Disconnect people</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    );
  }

  if (variant === "leave") {
    return (
      <Button
        ref={buttonRef}
        {...KEEP_SELECTION_ATTR}
        appearance="primary"
        className={styles.danger}
        icon={<CallEnd20Filled />}
        onClick={disconnectPeople}
      >
        Leave
      </Button>
    );
  }

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
        onClick={agentOn ? disconnectAgent : undefined}
      />
    </Tooltip>
  );
}
