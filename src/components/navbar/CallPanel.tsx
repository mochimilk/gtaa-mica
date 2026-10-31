import * as React from "react";
import { useCoralAuth } from "@coral-ai/react";
import {
  Avatar,
  AvatarGroup,
  AvatarGroupItem,
  AvatarGroupPopover,
  Button,
  Caption1,
  CounterBadge,
  Toolbar,
  ToggleButton,
  ToolbarDivider,
  Tooltip,
  makeStyles,
  mergeClasses,
  partitionAvatarGroupItems,
  tokens,
} from "@fluentui/react-components";
import {
  AddSquare20Filled,
  AddSquare20Regular,
  ArrowMaximize20Filled,
  ArrowMaximize20Regular,
  ArrowMinimize20Filled,
  ArrowMinimize20Regular,
  bundleIcon,
  CallEnd20Filled,
  CallEnd20Regular,
  Chat20Filled,
  Chat20Regular,
  Emoji20Filled,
  Emoji20Regular,
  Grid20Filled,
  Grid20Regular,
  HandRight20Filled,
  HandRight20Regular,
  MicOff16Regular,
  ShareScreenStart16Regular,
  MoreHorizontal20Filled,
  MoreHorizontal20Regular,
  Open20Filled,
  Open20Regular,
  People20Filled,
  People20Regular,
  PersonDelete20Filled,
  PersonDelete20Regular,
  ShareScreenStart20Filled,
  ShareScreenStart20Regular,
  ShareScreenStop20Filled,
  ShareScreenStop20Regular,
  Subtract20Filled,
  Subtract20Regular,
  VideoOff20Filled,
  VideoOff20Regular,
} from "@fluentui/react-icons";
import { useCallDuration, useSpeaking } from "../agent-call";
import { gtaaOpal, LiveOrb, skyeOrbStill } from "../orb";
import { photoOf } from "../people/photos";
import { isRinging, useLiveCall } from "../../live";
import { callGuests, subscribeCallGuests } from "../../live/callGuests";
import { Menu, MenuItemRadio, MenuList, MenuPopover, MenuTrigger } from "../menu";
import { CallTile } from "./CallTile";
import { MuteButton } from "./MuteButton";

// Regular at rest, filled on hover/press, as Fluent buttons expect.
const CallEndIcon = bundleIcon(CallEnd20Filled, CallEnd20Regular);
const PersonDeleteIcon = bundleIcon(PersonDelete20Filled, PersonDelete20Regular);
const VideoOffIcon = bundleIcon(VideoOff20Filled, VideoOff20Regular);
const ShareIcon = bundleIcon(ShareScreenStart20Filled, ShareScreenStart20Regular);
const StopShareIcon = bundleIcon(ShareScreenStop20Filled, ShareScreenStop20Regular);
const ChatIcon = bundleIcon(Chat20Filled, Chat20Regular);
const PeopleIcon = bundleIcon(People20Filled, People20Regular);
const RaiseIcon = bundleIcon(HandRight20Filled, HandRight20Regular);
const ReactIcon = bundleIcon(Emoji20Filled, Emoji20Regular);
const ViewIcon = bundleIcon(Grid20Filled, Grid20Regular);
const AppsIcon = bundleIcon(AddSquare20Filled, AddSquare20Regular);
const MoreIcon = bundleIcon(MoreHorizontal20Filled, MoreHorizontal20Regular);
const MinimizeIcon = bundleIcon(Subtract20Filled, Subtract20Regular);
const ShrinkIcon = bundleIcon(ArrowMinimize20Filled, ArrowMinimize20Regular);
const ExpandIcon = bundleIcon(ArrowMaximize20Filled, ArrowMaximize20Regular);
const OpenIcon = bundleIcon(Open20Filled, Open20Regular);

/*
 * Teams' call window: a 44px title bar, 12px in, with how long the call has
 * run at its start and the window's own buttons at its end; under it, the
 * call's controls spread across (CallControls), 12px in; then the tiles, 8px
 * apart and 8px in from the sides and bottom, which scroll under the bars
 * when the window runs out of height, or, shrunk, everyone's avatars.
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
    height: "44px",
    padding: `0 ${tokens.spacingHorizontalS} 0 ${tokens.spacingHorizontalM}`,
    boxSizing: "border-box",
  },
  windowButtons: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXXS,
  },
  // Share, while sharing: checked, its icon in the brand's colour.
  sharing: {
    color: tokens.colorBrandForeground1,
    ":hover": { color: tokens.colorBrandForeground1 },
  },
  // The call's controls under the title bar, spread across it.
  windowControls: {
    justifyContent: "space-between",
    flexShrink: 0,
    padding: `0 ${tokens.spacingHorizontalM} ${tokens.spacingVerticalS}`,
  },
  // Shrunk: everyone's avatars in place of their tiles.
  avatars: {
    flexShrink: 0,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM} ${tokens.spacingVerticalM}`,
  },
  time: {
    minWidth: 0,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: "tabular-nums",
  },
  // The toolbar's own padding would inset the controls twice.
  controls: {
    gap: tokens.spacingHorizontalXS,
    padding: 0,
  },
  // People's icon, holding the count at its top right that overhangs it, as the nav rail's.
  badged: {
    position: "relative",
    display: "inline-flex",
  },
  badge: {
    position: "absolute",
    top: "-6px",
    right: "-8px",
  },
  // Teams' red Leave: Fluent's danger fill.
  leave: {
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

export type LeaveButtonProps = {
  onClick: () => void;
  /** The icon alone, named by a tooltip, as on the call window's bar. */
  iconOnly?: boolean;
  /** Its name; "Leave" by default. */
  label?: string;
};

/** Teams' red Leave, with the end-call icon: the call window's, and the Chat page's. */
export function LeaveButton({ onClick, iconOnly, label = "Leave" }: LeaveButtonProps) {
  const styles = useStyles();
  if (iconOnly) {
    return (
      <Tooltip content={label} relationship="label">
        <Button appearance="primary" className={styles.leave} icon={<CallEnd20Filled />} onClick={onClick} />
      </Tooltip>
    );
  }
  return (
    <Button appearance="primary" className={styles.leave} icon={<CallEnd20Filled />} onClick={onClick}>
      {label}
    </Button>
  );
}

/** A button of Teams' that the demo has nothing behind: there to look the part, and does nothing. */
function Placeholder({ label, icon }: { label: string; icon: React.ReactElement }) {
  return (
    <Tooltip content={label} relationship="label">
      <Button appearance="subtle" icon={icon} />
    </Tooltip>
  );
}

/** How a call on a page lays out the people on it: all of them alike, or the speaker big. */
export type CallView = "gallery" | "speaker";

export type CallControlsProps = {
  /** The red Leave: what it ends, and its name ("Leave" by default). */
  onLeave: () => void;
  leaveLabel?: string;
  /** The meeting bar's View, which switches it; a placeholder without `onViewChange`. */
  view?: CallView;
  onViewChange?: (view: CallView) => void;
  /** Sharing on the call: Share shows it, as Stop sharing; a placeholder without `onShareChange`. */
  sharing?: boolean;
  onShareChange?: (share: boolean) => void;
  className?: string;
  /**
   * Teams' meeting bar, for a page: Chat, People (counting everyone on the
   * call), Raise, React, View, Apps and More before the call's own controls,
   * and Leave named on it rather than in a tooltip.
   */
  meeting?: boolean;
};

/**
 * The call's controls, as Teams has them: camera, microphone, share and the
 * red Leave, icons alone. Only the microphone (MuteButton, the app bar's, for
 * the whole call) and Leave work: the camera is not part of the demo, so it
 * is disabled, and the rest are placeholders. The call window's, and, as the
 * meeting bar, the Chat page's.
 */
export function CallControls({
  onLeave,
  leaveLabel,
  meeting = false,
  view = "speaker",
  onViewChange,
  sharing = false,
  onShareChange,
  className,
}: CallControlsProps) {
  const styles = useStyles();
  const live = useLiveCall();
  const guests = React.useSyncExternalStore(subscribeCallGuests, callGuests);
  // Everyone on the call, the user too.
  const people = 1 + (live.active ? 1 : 0) + (guests?.names.length ?? 0);
  return (
    <Toolbar aria-label="Call controls" className={mergeClasses(styles.controls, className)}>
      {meeting && (
        <>
          <Placeholder label="Chat" icon={<ChatIcon />} />
          <Placeholder
            label={`People, ${people} on the call`}
            icon={
              <span className={styles.badged}>
                <PeopleIcon />
                <CounterBadge size="small" count={people} className={styles.badge} aria-hidden />
              </span>
            }
          />
          <Placeholder label="Raise" icon={<RaiseIcon />} />
          <Placeholder label="React" icon={<ReactIcon />} />
          {onViewChange ? (
            <Menu
              checkedValues={{ view: [view] }}
              onCheckedValueChange={(_, data) => onViewChange(data.checkedItems[0] as CallView)}
            >
              <MenuTrigger disableButtonEnhancement>
                <Tooltip content="View" relationship="label">
                  <Button appearance="subtle" icon={<ViewIcon />} />
                </Tooltip>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItemRadio name="view" value="gallery">
                    Gallery
                  </MenuItemRadio>
                  <MenuItemRadio name="view" value="speaker">
                    Speaker
                  </MenuItemRadio>
                </MenuList>
              </MenuPopover>
            </Menu>
          ) : (
            <Placeholder label="View" icon={<ViewIcon />} />
          )}
          <Placeholder label="Apps" icon={<AppsIcon />} />
          <Placeholder label="More" icon={<MoreIcon />} />
          <ToolbarDivider />
        </>
      )}
      {/* Disabled but focusable, so its tooltip still says what it is. */}
      <Tooltip content="Camera is off" relationship="label">
        <Button appearance="subtle" disabledFocusable icon={<VideoOffIcon />} />
      </Tooltip>
      <MuteButton />
      {onShareChange ? (
        <Tooltip content={sharing ? "Stop sharing" : "Share"} relationship="label">
          <ToggleButton
            appearance="subtle"
            checked={sharing}
            icon={sharing ? <StopShareIcon /> : <ShareIcon />}
            className={sharing ? styles.sharing : undefined}
            onClick={() => onShareChange(!sharing)}
          />
        </Tooltip>
      ) : (
        <Placeholder label="Share" icon={<ShareIcon />} />
      )}
      <LeaveButton iconOnly={!meeting} label={leaveLabel} onClick={onLeave} />
    </Toolbar>
  );
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
  onRemove: (name: string) => void;
  /** The red Leave: what it ends, and its name ("Leave", "Disconnect Skye"). */
  onLeave: () => void;
  leaveLabel?: string;
  /** The user is sharing (Skye, on their behalf): their tile says so (CallTiles), and Share is Stop sharing. */
  sharing?: boolean;
  /** Share and Stop sharing; a placeholder without it, when there is nothing to share. */
  onShareChange?: (share: boolean) => void;
  /** Spread on the title bar, e.g. to make it a drag handle. */
  toolbarProps?: React.HTMLAttributes<HTMLDivElement>;
  /** The title bar's Minimize: puts the window away, the call going on. */
  onMinimize?: () => void;
  /** Shrunk: everyone's avatars in place of their tiles. The title bar's Shrink, then Expand, switches it. */
  compact?: boolean;
  onCompactChange?: (compact: boolean) => void;
  /** The title bar's Open: the call in its chat, on the Chat page. */
  onOpen?: () => void;
};

type WindowButtonProps = {
  label: string;
  icon: React.ReactElement;
  onClick: () => void;
  /** e.g. data-call-expand, for Skye's cursor to find it by (agentGestures.ts). */
  [data: `data-${string}`]: string | undefined;
};

/** One of the title bar's buttons: Fluent's subtle icon button, named by a tooltip. */
function WindowButton({ label, icon, onClick, ...data }: WindowButtonProps) {
  return (
    <Tooltip content={label} relationship="label">
      <Button appearance="subtle" icon={icon} onClick={onClick} {...data} />
    </Tooltip>
  );
}

/**
 * The call, Teams-style, as its window shows it: a title bar with how long it
 * has run and the window's own buttons (Minimize, Shrink or Expand, Open),
 * the call's controls under it (CallControls), then a camera-off tile for
 * everyone on it (CallTiles), or, shrunk, their avatars (CallAvatars).
 */
export function CallPanel({
  agentName,
  startedAt,
  guests,
  calling,
  onRemove,
  onLeave,
  leaveLabel,
  sharing,
  onShareChange,
  toolbarProps,
  onMinimize,
  compact = false,
  onCompactChange,
  onOpen,
}: CallPanelProps) {
  const styles = useStyles();
  const duration = useCallDuration(startedAt);

  return (
    <div className={styles.root}>
      <div {...toolbarProps} className={mergeClasses(styles.toolbar, toolbarProps?.className)}>
        <Caption1 role="timer" className={styles.time}>
          {duration}
        </Caption1>
        <div className={styles.windowButtons}>
          {onMinimize && <WindowButton label="Minimize" icon={<MinimizeIcon />} onClick={onMinimize} />}
          {onCompactChange && (
            <WindowButton
              label={compact ? "Expand" : "Shrink"}
              icon={compact ? <ExpandIcon /> : <ShrinkIcon />}
              onClick={() => onCompactChange(!compact)}
              data-call-expand={compact ? "" : undefined}
            />
          )}
          {onOpen && <WindowButton label="Open in Chat" icon={<OpenIcon />} onClick={onOpen} />}
        </div>
      </div>
      <CallControls
        onLeave={onLeave}
        leaveLabel={leaveLabel}
        sharing={sharing}
        onShareChange={onShareChange}
        className={styles.windowControls}
      />
      {compact ? (
        <CallAvatars agentName={agentName} guests={guests} calling={calling} />
      ) : (
        <CallTiles agentName={agentName} guests={guests} calling={calling} onRemove={onRemove} sharing={sharing} />
      )}
    </div>
  );
}

/**
 * Everyone on the call as Fluent's avatar group, in the tiles' order: Skye
 * (her orb) while the live call is up, the people called in, anyone being
 * called, then the user. Past five, the rest wait behind its overflow.
 */
function CallAvatars({ agentName, guests, calling }: Pick<CallPanelProps, "agentName" | "guests" | "calling">) {
  const styles = useStyles();
  const live = useLiveCall();
  const auth = useCoralAuth();
  const user = auth?.status === "signed-in" ? auth.user : undefined;
  const people: { key: string; name: string; image?: string }[] = [
    ...(live.active ? [{ key: agentName, name: agentName, image: skyeOrbStill }] : []),
    ...[...guests, ...calling].map((name) => ({ key: name, name, image: photoOf(name)?.src })),
    { key: "You", name: user?.name ?? "You", image: user?.image },
  ];
  const { inlineItems, overflowItems } = partitionAvatarGroupItems({ items: people, maxInlineItems: 5 });
  const item = ({ key, name, image }: (typeof people)[number]) => (
    <AvatarGroupItem key={key} name={name} image={image ? { src: image } : undefined} />
  );
  return (
    <AvatarGroup layout="stack" size={32} className={styles.avatars} aria-label="On the call">
      {inlineItems.map(item)}
      {overflowItems && <AvatarGroupPopover>{overflowItems.map(item)}</AvatarGroupPopover>}
    </AvatarGroup>
  );
}

export type CallTilesProps = Pick<CallPanelProps, "agentName" | "guests" | "calling" | "onRemove"> & {
  /** In place of the call window's column, e.g. a row across a page. */
  className?: string;
  /** Whose tiles: everyone's (the default), everyone's but the user's, or the user's alone. */
  include?: "all" | "others" | "self";
  /** Which of those, by name (the user's tile is "You"): e.g. the speaker alone, or all but them. */
  show?: (name: string) => boolean;
  /** The user is sharing (Skye, on their behalf): their name tag shows the share icon. */
  sharing?: boolean;
};

/**
 * A camera-off tile for everyone on the call: Skye (while the live call is
 * up) first, as their orb, then the people called in, then anyone still being
 * called, then the user. Anyone not answered yet shows "Calling…", with rings
 * rippling out from them. The call window's, and the Chat page's, which
 * can lay the user out apart from the rest (`include`).
 */
export function CallTiles({
  agentName,
  guests,
  calling,
  onRemove,
  className,
  include = "all",
  show = () => true,
  sharing = false,
}: CallTilesProps) {
  const styles = useStyles();
  const live = useLiveCall();
  const auth = useCoralAuth();
  const user = auth?.status === "signed-in" ? auth.user : undefined;
  const ringing = isRinging(live.state);

  const { voiceLevel } = live;
  const agentSpeaking = useSpeaking(React.useCallback(() => voiceLevel("agent"), [voiceLevel]));
  const userSpeaking = useSpeaking(React.useCallback(() => voiceLevel("user"), [voiceLevel]));

  return (
    <ul className={mergeClasses(styles.tiles, className)} aria-label={include === "self" ? "You, on the call" : "On the call"}>
      {include !== "self" && live.active && show(agentName) && (
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
      {(include === "self" ? [] : guests).filter(show).map((name) => (
        <CallTile
          key={name}
          name={name}
          media={<Avatar size={64} name={name} image={photoOf(name)} />}
          nameIcon={live.teammateMuted.includes(name) ? <MicOff16Regular aria-label="Muted" /> : undefined}
          speaking={live.teammateSpeaking === name}
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
      {(include === "self" ? [] : calling).filter(show).map((name) => (
        <CallTile
          key={name}
          name={name}
          media={<Avatar size={64} name={name} image={photoOf(name)} />}
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
      {include !== "others" && show("You") && (
        <CallTile
          name="You"
          media={<Avatar size={64} name={user?.name} image={user?.image ? { src: user.image } : undefined} />}
          nameIcon={
            sharing || live.state.muted ? (
              <>
                {sharing && <ShareScreenStart16Regular aria-label="Sharing" />}
                {live.state.muted && <MicOff16Regular aria-label="Muted" />}
              </>
            ) : undefined
          }
          speaking={userSpeaking}
        />
      )}
    </ul>
  );
}
