import * as React from "react";
import {
  Avatar,
  Button,
  Divider,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  ToggleButton,
  Tooltip,
  createCustomFocusIndicatorStyle,
  makeStyles,
  tokens,
  typographyStyles,
} from "@fluentui/react-components";
import {
  bundleIcon,
  Call20Filled,
  Call20Regular,
  PeopleCall20Filled,
  PeopleCall20Regular,
  PersonAdd20Filled,
  PersonAdd20Regular,
} from "@fluentui/react-icons";
import { useLiveCall } from "../../live";
import { useRingback } from "../agent-call";
import {
  EXPERTISE_LABELS,
  PEOPLE,
  TEAM,
  callGuests,
  inviteToCall,
  removeFromCall,
  subscribeCallGuests,
} from "../../live/callGuests";
import { KEEP_SELECTION_ATTR, MENU_POSITIONING } from "../../operations/ViewsFiltersToolbar";
import { CallPopout } from "./CallPopout";

// Regular at rest, filled on hover/press, as Fluent buttons expect.
const PeopleCallIcon = bundleIcon(PeopleCall20Filled, PeopleCall20Regular);
const CallIcon = bundleIcon(Call20Filled, Call20Regular);
const PersonAddIcon = bundleIcon(PersonAdd20Filled, PersonAdd20Regular);

// Placeholder: made-up teammates to bring into a Teams-style call (PEOPLE in
// ../../live/callGuests, shared with Skye). Calling one rings for a few
// seconds, then puts them on the call view; nothing reaches them yet. The
// data-call-* attributes are how Skye's cursor finds these controls
// (agentGestures.ts).

// A static class, so a row's hover and focus can reach its (hashed) call button.
const CALL_CLASS = "mica-people-call__call";

/** Above the button, as the bar is at the bottom, fitted to the room there. */
const POSITIONING = { ...MENU_POSITIONING, position: "above", align: "end" } as const;

/*
 * A popover rather than a Menu, since each row holds its own call button and
 * a menu item cannot hold another control. Laid out like Teams' people list:
 * 44px rows throughout (8px around the 28px avatars), action icons centered
 * in the avatar column, all text 8px past it, on the popover's 4px corners.
 */
const useStyles = makeStyles({
  surface: {
    display: "flex",
    flexDirection: "column",
    minWidth: "256px",
    padding: "4px",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  person: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "44px",
    padding: "0 6px 0 10px",
    borderRadius: tokens.borderRadiusMedium,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    [`&:hover .${CALL_CLASS}`]: { opacity: 1 },
  },
  // The name over what they work on, as Teams shows a person's title.
  who: {
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  name: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ...typographyStyles.body1,
  },
  expertise: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.colorNeutralForeground3,
    ...typographyStyles.caption1,
  },
  // Hidden until its row is hovered or it has keyboard focus. Not on any
  // focus: opening the popover focuses the first one, which would show it.
  call: {
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: tokens.durationFaster,
    transitionTimingFunction: tokens.curveEasyEase,
    ...createCustomFocusIndicatorStyle({ opacity: 1 }),
  },
  // Inset to the avatars' edge.
  divider: {
    flexGrow: 0,
    margin: "4px 10px",
  },
  // A subtle button laid out as a row: text lines up with the names.
  add: {
    justifyContent: "flex-start",
    width: "100%",
    minHeight: "44px",
    padding: "0 10px",
    borderRadius: tokens.borderRadiusMedium,
    ...typographyStyles.body1,
  },
  // The avatar column's 28px and 8px gap, around the 20px icon.
  addIcon: {
    width: "28px",
    marginRight: "8px",
  },
});

/** The earlier of two times, either of which may be unset. */
function earliest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

export type PeopleCallButtonProps = {
  /** The agent the live call is with, e.g. "Skye". */
  agentName: string;
};


/**
 * The People button. Off a call it lists teammates to call. Calling someone
 * in pops the call out into a window the user can drag around the board
 * (CallPopout); calling Skye does not. On a call this button shows or hides
 * that window, which goes when the call ends.
 */
export function PeopleCallButton({ agentName }: PeopleCallButtonProps) {
  const styles = useStyles();
  const live = useLiveCall();
  const [listOpen, setListOpen] = React.useState(false);
  // `focus`: the user opened it, so it takes focus; a call starting leaves focus where it is.
  const [popout, setPopout] = React.useState({ open: false, focus: false });
  // Shared, so Skye can call people in too.
  const guests = React.useSyncExternalStore(subscribeCallGuests, callGuests);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  const onCall = live.active || guests !== null;
  const startedAt = earliest(live.state.startedAt, guests?.since ?? null);
  // It rings while anyone is being called in, whether the user or Skye called them.
  useRingback((guests?.calling.length ?? 0) > 0);

  // Skye leaving leaves the people called in on the call: Disconnect at the
  // bar's end takes either side off, or both (DisconnectButton).

  // People being called in pops the window out. Calling Skye leaves it shut,
  // for this button to show. The call ending puts it away.
  const peopleOn = guests !== null;
  const wasPeopleOn = React.useRef(peopleOn);
  React.useEffect(() => {
    if (wasPeopleOn.current === peopleOn) return;
    wasPeopleOn.current = peopleOn;
    if (peopleOn) setPopout((current) => (current.open ? current : { open: true, focus: false }));
  }, [peopleOn]);
  React.useEffect(() => {
    if (!onCall) setPopout((current) => (current.open ? { open: false, focus: false } : current));
  }, [onCall]);

  const invite = inviteToCall;
  const remove = removeFromCall;

  // The list makes way for the call window, which takes focus from it.
  const callFromList = (name: string) => {
    setListOpen(false);
    setPopout({ open: true, focus: true });
    invite(name);
  };

  // Closed from inside the window, focus comes back here.
  const closePopout = () => {
    setPopout({ open: false, focus: false });
    buttonRef.current?.focus();
  };

  return (
    <>
      {onCall ? (
        <Tooltip content="Call" relationship="label">
          <ToggleButton
            ref={buttonRef}
            {...KEEP_SELECTION_ATTR}
            appearance="subtle"
            data-call-toggle=""
            checked={popout.open}
            icon={<PeopleCallIcon />}
            onClick={() => setPopout({ open: !popout.open, focus: !popout.open })}
          />
        </Tooltip>
      ) : (
        <Popover open={listOpen} onOpenChange={(_, data) => setListOpen(data.open)} trapFocus positioning={POSITIONING}>
          <PopoverTrigger disableButtonEnhancement>
            <Tooltip content="People" relationship="label">
              <Button ref={buttonRef} {...KEEP_SELECTION_ATTR} data-call-people="" appearance="subtle" icon={<PeopleCallIcon />} />
            </Tooltip>
          </PopoverTrigger>
          <PopoverSurface className={styles.surface} aria-label="People" {...KEEP_SELECTION_ATTR}>
            <ul className={styles.list}>
              {TEAM.map(({ name, expertise }) => (
                <li key={name} className={styles.person}>
                  <Avatar size={28} name={name} color="colorful" />
                  <span className={styles.who}>
                    <span className={styles.name}>{name}</span>
                    <span className={styles.expertise}>{EXPERTISE_LABELS[expertise]}</span>
                  </span>
                  <Tooltip content={`Call ${name}`} relationship="label">
                    <Button
                      appearance="subtle"
                      icon={<CallIcon />}
                      className={`${CALL_CLASS} ${styles.call}`}
                      data-call-person={name}
                      onClick={() => callFromList(name)}
                    />
                  </Tooltip>
                </li>
              ))}
            </ul>
            <Divider className={styles.divider} />
            <Button
              appearance="subtle"
              icon={{ children: <PersonAddIcon />, className: styles.addIcon }}
              className={styles.add}
            >
              Add people
            </Button>
          </PopoverSurface>
        </Popover>
      )}
      <CallPopout
        open={onCall && popout.open}
        autoFocus={popout.focus}
        agentName={agentName}
        startedAt={startedAt}
        guests={guests?.names ?? []}
        calling={guests?.calling ?? []}
        invitable={PEOPLE.filter((name) => !guests?.names.includes(name) && !guests?.calling.includes(name))}
        onInvite={invite}
        onRemove={remove}
        onClose={closePopout}
      />
    </>
  );
}
