import * as React from "react";
import { useCoralAuth } from "@coral-ai/react";
import { Avatar, Button, Caption1, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  bundleIcon,
  CallEnd20Filled,
  CallEnd20Regular,
  Dismiss20Filled,
  Dismiss20Regular,
  MicOff16Regular,
  PersonAdd20Filled,
  PersonAdd20Regular,
  PersonDelete20Filled,
  PersonDelete20Regular,
  Shield20Regular,
} from "@fluentui/react-icons";
import { useCallDuration } from "../agent-call";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../menu";
import { gtaaOpal, LiveOrb, skyeOrbStill } from "../orb";
import { isRinging, useLiveCall } from "../../live";
import { expertiseOf } from "../../live/callGuests";
import { CallTile } from "./CallTile";

// Regular at rest, filled on hover/press, as Fluent buttons expect.
const CallEndIcon = bundleIcon(CallEnd20Filled, CallEnd20Regular);
const DismissIcon = bundleIcon(Dismiss20Filled, Dismiss20Regular);
const PersonAddIcon = bundleIcon(PersonAdd20Filled, PersonAdd20Regular);
const PersonDeleteIcon = bundleIcon(PersonDelete20Filled, PersonDelete20Regular);

/** Voice level (0–1, see VoiceMeter) that counts as talking, and how long it holds after. */
const SPEAKING_LEVEL = 0.5;
const SPEAKING_HOLD_MS = 400;
const SPEAKING_SAMPLE_MS = 100;

/*
 * Figma's call panel: a 56px toolbar (12px in, the shield 6px from the clock)
 * over the tiles, which are 8px apart and 8px in from the sides and bottom.
 * The tiles scroll under the toolbar when the window runs out of height.
 */
const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: 0,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    flexShrink: 0,
    height: "56px",
    padding: `0 ${tokens.spacingHorizontalM}`,
    boxSizing: "border-box",
  },
  clock: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalSNudge,
    minWidth: 0,
    color: tokens.colorNeutralForeground2,
  },
  time: {
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: "tabular-nums",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  tiles: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    flex: "1 1 auto",
    minHeight: 0,
    margin: 0,
    padding: `0 ${tokens.spacingHorizontalS} ${tokens.spacingVerticalS}`,
    overflowY: "auto",
    listStyle: "none",
  },
});

/**
 * Whether a call audio level reads as talking, sampled a few times a second.
 * Re-renders only when the answer changes.
 */
function useSpeaking(level: () => number): boolean {
  const [speaking, setSpeaking] = React.useState(false);
  React.useEffect(() => {
    let lastHeard = -Infinity;
    const timer = setInterval(() => {
      const now = performance.now();
      if (level() >= SPEAKING_LEVEL) lastHeard = now;
      setSpeaking(now - lastHeard < SPEAKING_HOLD_MS);
    }, SPEAKING_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [level]);
  return speaking;
}

export type CallPanelProps = {
  /** The agent on the call, e.g. "Skye". */
  agentName: string;
  /** When the call started (epoch ms), or null while it is still ringing. */
  startedAt: number | null;
  /** People called in who have answered, in the order they joined. */
  guests: readonly string[];
  /** People being called in who have not answered yet. */
  calling: readonly string[];
  /** People who can still be added. */
  invitable: readonly string[];
  onInvite: (name: string) => void;
  onRemove: (name: string) => void;
  onClose: () => void;
  /** Spread on the toolbar, e.g. to make it a drag handle. */
  toolbarProps?: React.HTMLAttributes<HTMLDivElement>;
};

/**
 * The call, Teams-style: how long it has run, and a camera-off tile for
 * everyone on it. Skye (while the live call is up) comes first, as their orb,
 * then the people called in, then anyone still being called, then the user.
 * Anyone not answered yet shows "Calling…", with rings rippling out from
 * them.
 */
export function CallPanel({
  agentName,
  startedAt,
  guests,
  calling,
  invitable,
  onInvite,
  onRemove,
  onClose,
  toolbarProps,
}: CallPanelProps) {
  const styles = useStyles();
  const live = useLiveCall();
  const auth = useCoralAuth();
  const duration = useCallDuration(startedAt);
  const user = auth?.status === "signed-in" ? auth.user : undefined;
  const ringing = isRinging(live.state);

  const { voiceLevel } = live;
  const agentSpeaking = useSpeaking(React.useCallback(() => voiceLevel("agent"), [voiceLevel]));
  const userSpeaking = useSpeaking(React.useCallback(() => voiceLevel("user"), [voiceLevel]));

  return (
    <div className={styles.root}>
      <div {...toolbarProps} className={mergeClasses(styles.toolbar, toolbarProps?.className)}>
        <div className={styles.clock}>
          <Shield20Regular />
          <Caption1 role="timer" className={styles.time}>
            {duration}
          </Caption1>
        </div>
        <div className={styles.actions}>
          <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content="Add people" relationship="label">
                <Button appearance="subtle" data-call-add="" icon={<PersonAddIcon />} disabled={invitable.length === 0} />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {invitable.map((name) => (
                  <MenuItem
                    key={name}
                    // The menu's 16px icon slot.
                    icon={<Avatar size={16} name={name} color="colorful" />}
                    data-call-invite={name}
                    secondaryContent={expertiseOf(name)}
                    onClick={() => onInvite(name)}
                  >
                    {name}
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <Tooltip content="Close" relationship="label">
            <Button appearance="subtle" icon={<DismissIcon />} onClick={onClose} />
          </Tooltip>
        </div>
      </div>
      <ul className={styles.tiles} aria-label="On the call">
        {live.active && (
          <CallTile
            name={agentName}
            media={
              <LiveOrb
                size={64}
                glow={!ringing}
                voice={live.remoteStream}
                state={ringing ? "idle" : "thinking"}
                preset="opal"
                palette={gtaaOpal}
                still={skyeOrbStill}
              />
            }
            status={ringing ? "Calling…" : undefined}
            ringing={ringing}
            speaking={agentSpeaking}
          />
        )}
        {guests.map((name) => (
          <CallTile
            key={name}
            name={name}
            media={<Avatar size={64} name={name} />}
            actions={
              <Tooltip content={`Remove ${name}`} relationship="label">
                <Button
                  size="small"
                  appearance="subtle"
                  data-call-remove={name}
                  icon={<PersonDeleteIcon />}
                  onClick={() => onRemove(name)}
                />
              </Tooltip>
            }
          />
        ))}
        {calling.map((name) => (
          <CallTile
            key={name}
            name={name}
            media={<Avatar size={64} name={name} />}
            status="Calling…"
            ringing
            actions={
              <Tooltip content={`Stop calling ${name}`} relationship="label">
                <Button
                  size="small"
                  appearance="subtle"
                  data-call-remove={name}
                  icon={<CallEndIcon />}
                  onClick={() => onRemove(name)}
                />
              </Tooltip>
            }
          />
        ))}
        <CallTile
          name="You"
          media={<Avatar size={64} name={user?.name} image={user?.image ? { src: user.image } : undefined} />}
          nameIcon={live.state.muted ? <MicOff16Regular aria-label="Muted" /> : undefined}
          speaking={userSpeaking}
        />
      </ul>
    </div>
  );
}
