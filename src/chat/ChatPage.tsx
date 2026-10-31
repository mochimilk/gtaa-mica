// The Chat page, as Teams' chat has it (Figma's Teams 2 Web shell). The left
// panel lists the conversations (./chatThreads): Skye first, as one more
// person to message, then a section for each operations area, its channels
// and the teammate on duty in them; Coral's pill tabs at the top narrow them to
// the unread, the channels or the one-to-one chats. The one open fills the
// content area: its header (who it is with, and Call), then the conversation,
// with the box to write in at its foot.
//
// A call shows in the chat it belongs to (useCallThread), taking the content
// area over as a video call does (../approvals/ApprovalsCall): everyone on
// it, and, in a channel's, Skye's changes for approval on its shared screen.
// Any other chat shows as it is, the call going on in the call window that
// floats over every page (PeopleCallButton). As it ends, the page goes back
// to its chat (chatThreads' returnTo).
//
// The conversation is Coral's chat, which is made for talking to an agent: it
// sends what is typed to a handler and writes the reply under thinking dots,
// with Copy and Regenerate. Here it only shows the thread. Every post, the
// user's too, goes in as an assistant message of a type drawn here as Teams
// draws a message (Post), and Chat.Input stands outside Chat.Canvas, so what
// is sent is posted to the thread (chatThreads) rather than run. Skye answers
// as a person would: what is sent her runs as a typed request while she shows
// as typing, and her reply is posted when it comes. As in Teams, each day
// starts under its date, and right-clicking a post opens its menu: reactions,
// Reply (quoting it over what is sent next) and Copy.
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Chat, useChatContext, type ChatMessage, type ChatMessageRendererProps } from "@coral-ai/chat";
import { Panel, PillTab, PillTabList } from "@coral-ai/react";
import { ArrowReply } from "@coral-ai/bundleicons/ArrowReply";
import { Call } from "@coral-ai/bundleicons/Call";
import { Copy } from "@coral-ai/bundleicons/Copy";
import { Dismiss } from "@coral-ai/bundleicons/Dismiss";
import { EmojiAdd } from "@coral-ai/bundleicons/EmojiAdd";
import { Send } from "@coral-ai/bundleicons/Send";
import {
  Avatar,
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Caption1Strong,
  createFocusOutlineStyle,
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ApprovalsCall, useShareableApproval, useSharedApproval } from "../approvals/ApprovalsCall";
import { Menu, MenuGroup, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../components/menu";
import { skyeOrbStill } from "../components/orb";
import { photoOf } from "../components/people/photos";
import { PanelHeader } from "../components/panel-header";
import { SharedPanelLeft } from "../components/panel-left";
import { useLiveCall } from "../live";
import { callGuests, inviteToCall, PEOPLE, subscribeCallGuests } from "../live/callGuests";
import { outOfSightStyle } from "../live/outOfSight";
import { describeApprovers, formatLogTime } from "../operations/outputs";
import {
  callFrom,
  chatState,
  isTyping,
  latestPost,
  markRead,
  ME,
  openThread,
  postMessage,
  presenceOf,
  SECTIONS,
  SKYE,
  SKYE_THREAD,
  startTyping,
  subscribeChat,
  threadPosts,
  THREADS,
  toggleReaction,
  unreadCount,
  unreadThreads,
  type ChatPost,
  type ChatQuote,
  type ChatThread,
} from "./chatThreads";
import "../operations/operations.css";
import "./chat.css";

const useChat = () => useSyncExternalStore(subscribeChat, chatState);

/**
 * The chat the call going on belongs to: while people are called in, the one
 * it was placed from or with whoever was called (returnTo); on Skye's voice
 * call alone, hers; null off a call.
 */
export function useCallThread(): string | null {
  const { returnTo } = useChat();
  const guests = useSyncExternalStore(subscribeCallGuests, callGuests);
  const live = useLiveCall();
  return guests !== null ? returnTo : live.active ? SKYE_THREAD.id : null;
}

/** Whether the Chat page, on screen, shows the call itself: its chat is the one open. */
export function useCallInChat(): boolean {
  const { open } = useChat();
  const callThread = useCallThread();
  return callThread !== null && callThread === open;
}

/**
 * The call going on, for the call window over other pages: whether it is a
 * channel's (which rings rather than its people), whether Skye's changes can
 * be shared on it, and whether they are, on the user's behalf.
 */
export function useCallShare(): { toChannel: boolean; canShare: boolean; sharing: boolean } {
  const callThread = useCallThread();
  const toChannel = THREADS.find((thread) => thread.id === callThread)?.kind === "channel";
  const canShare = useShareableApproval(toChannel) !== undefined;
  return { toChannel, canShare, sharing: useSharedApproval(toChannel) !== undefined };
}

const unreadSnapshot = () => unreadThreads(chatState());

/** How many conversations have posts unread, for the rail's counter. */
export const useUnreadChats = (): number => useSyncExternalStore(subscribeChat, unreadSnapshot);

// The message types Chat.Messages draws here: a post, and someone typing one.
const POST_TYPE = "post";
const TYPING_TYPE = "typing";

/** Posts by the same person this close together run on under one name, as Teams groups them. */
const RUN_ON_MS = 5 * 60_000;

type PostMeta = Pick<ChatPost, "author" | "at" | "replyTo" | "reactions"> & {
  runsOn: boolean;
  /** The date it starts, when it is a day's first post: "Monday, October 12". */
  day?: string;
};

const dayOf = (at: number) => new Date(at).toDateString();
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" });

/** When a post was sent, as Teams says it over the post: "08:53" today, "10/12 08:53" before. */
const postTime = (at: number) =>
  dayOf(at) === dayOf(Date.now()) ? formatLogTime(at) : `${shortDate.format(at)} ${formatLogTime(at)}`;

/** A thread's posts as Coral's messages: every one an assistant message, so Chat.Messages draws it with ours. */
function toChatMessages(posts: readonly ChatPost[]): ChatMessage[] {
  return posts.map((post, index) => {
    const before = posts[index - 1];
    const newDay = !before || dayOf(before.at) !== dayOf(post.at);
    const runsOn = !newDay && !post.replyTo && before.author === post.author && post.at - before.at < RUN_ON_MS;
    const metadata: PostMeta = {
      author: post.author,
      at: post.at,
      replyTo: post.replyTo,
      reactions: post.reactions,
      runsOn,
      day: newDay ? dayLabel.format(post.at) : undefined,
    };
    return { id: post.id, role: "assistant", type: POST_TYPE, content: post.text, metadata };
  });
}

/** The reactions a post's menu offers, as Teams' are. */
const REACTIONS: readonly { emoji: string; label: string }[] = [
  { emoji: "❤️", label: "Heart" },
  { emoji: "👍", label: "Like" },
  { emoji: "👎", label: "Dislike" },
  { emoji: "‼️", label: "Exclamation" },
  { emoji: "😂", label: "Laugh" },
  { emoji: "✔️", label: "Check" },
];

/** What the open thread's posts can do from their menus: react to them and reply to them. */
type ThreadActions = { threadId: string; reply: (quote: ChatQuote) => void };
const ThreadActionsContext = createContext<ThreadActions | null>(null);

type Filter = "all" | "unread" | "channels" | "chats";
const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "channels", label: "Channels" },
  { id: "chats", label: "Chats" },
];

const useStyles = makeStyles({
  root: {
    display: "flex",
    flex: "1 1 auto",
    minHeight: 0,
    position: "relative",
  },
  // Figma's filter lockup, as Coral's pill tabs across the panel, 16px in.
  // Each tab takes its share of the width, 8px in (Coral's are 12px), so all
  // four fit the panel.
  pillTabs: {
    display: "flex",
    width: "100%",
    boxSizing: "border-box",
  },
  pillTab: {
    flex: "1 1 auto",
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalS,
  },
  filters: {
    flexShrink: 0,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalS}`,
  },
  // The list scrolls under the panel's header and filters, which stay put.
  list: {
    flex: "1 1 0",
    minHeight: 0,
    overflowY: "auto",
  },
  listEmpty: {
    margin: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    color: tokens.colorNeutralForeground3,
  },
  // A section's items with nothing under them (Coral leaves 16px).
  section: {
    "& > div:last-child": { paddingBottom: 0 },
  },
  // Two-line list items (Coral's are one line, 36px): the 32px avatar inside
  // Coral's 8px padding, the name over Coral's description: bold in
  // Foreground 1 with posts unread, Body 1 in Foreground 3 once read. The one
  // open is lifted as Teams lifts it, white on Shadow 2.
  item: {
    height: "auto",
    minHeight: "52px",
    color: tokens.colorNeutralForeground1,
    ":hover": { color: tokens.colorNeutralForeground1 },
  },
  itemOpen: {
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1 },
    ":active": { backgroundColor: tokens.colorNeutralBackground1 },
  },
  unreadName: { fontWeight: tokens.fontWeightBold },
  readName: { color: tokens.colorNeutralForeground3 },
  // A 20px box at the row's end: the brand's 8px dot for new posts, or,
  // while on a call with them, a 20px phone in the neutral foreground.
  rowMark: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    flexShrink: 0,
    fontSize: "20px",
    color: tokens.colorNeutralForeground1,
  },
  unreadDot: {
    width: "8px",
    height: "8px",
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground,
  },
  // Skye's orb, a still of it: drawn a quarter past its 32px box, as its
  // glow overhangs (as the Outputs panel's is).
  orbBox: {
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  main: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 0",
    minWidth: 0,
    minHeight: 0,
  },
  // Figma's entity header at the shell's 56px: the avatar, the name over
  // what they do, then Call at the end.
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    height: "56px",
    padding: `0 ${tokens.spacingHorizontalL}`,
    boxSizing: "border-box",
    flexShrink: 0,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  headerText: {
    display: "flex",
    flexDirection: "column",
    flex: "0 1 auto",
    minWidth: 0,
  },
  headerName: {
    margin: 0,
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  headerAbout: {
    color: tokens.colorNeutralForeground2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalXS,
    flex: "1 0 auto",
  },
  // The conversation and the box to write in, which floats over its foot (chat.css).
  thread: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 0",
    minHeight: 0,
    position: "relative",
  },
  // The box to write in, in the messages' column (Coral's: 768px, 16px in),
  // at the conversation's foot. The posts scroll on under it, so its margins
  // let the wheel and clicks through to them.
  compose: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    display: "flex",
    flexDirection: "column",
    maxWidth: "768px",
    margin: "0 auto",
    padding: `0 ${tokens.spacingHorizontalL} ${tokens.spacingVerticalL}`,
    boxSizing: "border-box",
    pointerEvents: "none",
    "& > *": { pointerEvents: "auto" },
  },
  // Someone writing a reply, as the last thing in the conversation: their avatar, then who.
  typingText: {
    alignSelf: "center",
    color: tokens.colorNeutralForeground3,
  },
  // A post, Teams-style: anyone else's at the left after their avatar, the
  // user's at the right, in the brand's tint, each under its name and time
  // (the user's, the time alone). One running on from the same person sits
  // close under it, with no avatar, name or time.
  post: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalL,
  },
  postRunsOn: { paddingTop: tokens.spacingVerticalXXS },
  postMine: { justifyContent: "flex-end" },
  postAvatar: {
    display: "flex",
    width: "32px",
    flexShrink: 0,
  },
  // Level with the top of the bubble, under the name and time.
  postAvatarHeaded: { marginTop: `calc(${tokens.lineHeightBase200} + ${tokens.spacingVerticalXS})` },
  postBody: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: tokens.spacingVerticalXS,
    minWidth: 0,
    maxWidth: "80%",
  },
  postBodyMine: { alignItems: "flex-end" },
  // The name and time over the bubble, in Caption 1 and Foreground 3.
  postHead: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalM,
    color: tokens.colorNeutralForeground3,
  },
  // Teams' own bubble: 6px 15px 8px in, inside a 1px clear border, its
  // corners 6px round; the user's square at the foot of its tail side.
  bubble: {
    maxWidth: "100%",
    padding: `${tokens.spacingVerticalSNudge} 15px ${tokens.spacingVerticalS}`,
    boxSizing: "border-box",
    border: `${tokens.strokeWidthThin} solid ${tokens.colorTransparentStroke}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
  },
  bubbleMine: { backgroundColor: tokens.colorBrandBackground2, borderBottomRightRadius: 0 },
  // The bubble and its reactions. With reactions, Teams leaves 21px under the
  // bubble, and the 26px reactions sit at the foot of that, so they overlap
  // the bubble's by 5px.
  bubbleWrap: {
    position: "relative",
    maxWidth: "100%",
  },
  bubbleWrapReacted: { paddingBottom: "21px" },
  // Focusable, so the keyboard reaches its menu (Shift+F10) too.
  bubbleFocus: createFocusOutlineStyle({ style: { outlineRadius: tokens.borderRadiusLarge } }),
  // Teams' day divider: the date, centred, over the day's first post.
  day: {
    display: "block",
    margin: 0,
    paddingTop: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  // The post a reply answers, quoted over it: who wrote it, and two lines of it.
  quote: {
    display: "flex",
    flexDirection: "column",
    marginBottom: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderLeft: `${tokens.strokeWidthThick} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
  },
  quoteText: {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    whiteSpace: "pre-wrap",
  },
  // Its reactions, each emoji with how many, then one to add: 26px, as
  // Teams' are, starting where the bubble's text does (its border and
  // padding, 16px in); for the user's, ending where it does, so they stay in
  // the column.
  reactions: {
    position: "absolute",
    bottom: 0,
    left: "16px",
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    whiteSpace: "nowrap",
  },
  reactionsMine: { left: "auto", right: "16px" },
  // Each at least 34px wide, as Teams' are, the one to add a reaction too.
  reaction: {
    minWidth: "34px",
    height: "26px",
    minHeight: "26px",
    boxSizing: "border-box",
    padding: `0 ${tokens.spacingHorizontalS}`,
    gap: tokens.spacingHorizontalXS,
  },
  // One the user is among: the brand's stroke, 1.5px, its padding half a pixel less to keep the emoji in place.
  reactionMine: {
    border: `1.5px solid ${tokens.colorBrandStroke1}`,
    padding: "0 7.5px",
    ":hover": { border: `1.5px solid ${tokens.colorBrandStroke1}` },
    ":hover:active": { border: `1.5px solid ${tokens.colorBrandStroke1}` },
  },
  reactionEmoji: { fontSize: tokens.fontSizeBase400, lineHeight: 1 },
  addReaction: {
    minWidth: "34px",
    maxWidth: "none",
    height: "26px",
    minHeight: "26px",
  },
  // The reply being written, quoted just above the box, as a quote is, its dismiss inside it.
  replying: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalXS,
    marginBottom: tokens.spacingVerticalXS,
  },
  replyingBody: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minWidth: 0,
  },
  replyingText: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  postText: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});

export type ChatPageProps = {
  /** The chat panel's Panel.Left id, shared with its toggle (App's LEFT_PANELS). */
  panelID: string;
  panelClassName?: string;
  /**
   * Out of sight behind another page, while Skye is at work here
   * (../live/outOfSight): mounted as it was, so her work goes on, but not
   * drawn, inert, and without its panel, which the page on screen has its
   * own of. Nothing is marked read meanwhile.
   */
  away?: boolean;
};

export function ChatPage({ panelID, panelClassName, away = false }: ChatPageProps) {
  const styles = useStyles();
  const chat = useChat();
  const thread = THREADS.find((candidate) => candidate.id === chat.open) ?? SKYE_THREAD;
  // The call shows here only in its own chat.
  const onCall = useCallThread() === thread.id;
  const posts = threadPosts(chat, thread.id);
  // What is unsent in each thread, kept while another is open or a call is on.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});

  // The open thread is read as it shows, and as posts come in while it does.
  const latest = posts.at(-1)?.at ?? 0;
  useEffect(() => {
    if (!onCall && !away) markRead(thread.id, latest);
  }, [onCall, away, thread.id, latest]);

  return (
    <div className={styles.root} style={away ? outOfSightStyle : undefined} inert={away}>
      {!away && (
        <SharedPanelLeft panelID={panelID} className={panelClassName}>
          <PanelHeader title="Chat" />
          <ChatList />
        </SharedPanelLeft>
      )}

      <main className={styles.main}>
        {onCall ? (
          <ApprovalsCall
            label={`Call with ${thread.name}`}
            channel={thread.kind === "channel"}
          />
        ) : (
          <>
            <ChatHeader thread={thread} />
            <Conversation
              key={thread.id}
              thread={thread}
              posts={posts}
              typing={isTyping(chat, thread.id)}
              draft={drafts[thread.id] ?? ""}
              onDraftChange={(text) => setDrafts((current) => ({ ...current, [thread.id]: text }))}
            />
          </>
        )}
      </main>
    </div>
  );
}

/** The left panel's list: the filters, then Skye, then each area's section. */
function ChatList() {
  const styles = useStyles();
  const chat = useChat();
  const callThread = useCallThread();
  const [filter, setFilter] = useState<Filter>("all");
  const onCallWith = (thread: ChatThread) => thread.id === callThread;
  const shows = (thread: ChatThread) =>
    filter === "unread"
      ? unreadCount(chat, thread.id) > 0
      : filter === "channels"
        ? thread.kind === "channel"
        : filter === "chats"
          ? thread.kind !== "channel"
          : true;
  const sections = SECTIONS.map((section) => ({ ...section, threads: section.threads.filter(shows) })).filter(
    (section) => section.threads.length > 0,
  );

  const item = (thread: ChatThread) => {
    const unread = unreadCount(chat, thread.id);
    const open = thread.id === chat.open;
    const onCall = onCallWith(thread);
    return (
      <Panel.NavItem
        key={thread.id}
        value={thread.id}
        className={mergeClasses(styles.item, open && styles.itemOpen)}
        label={
          unread > 0 ? (
            <Body1Strong className={styles.unreadName}>{thread.name}</Body1Strong>
          ) : (
            <Body1 className={styles.readName}>{thread.name}</Body1>
          )
        }
        description={latestPost(chat, thread.id)}
        icon={<ThreadAvatar thread={thread} />}
        selected={open}
        onSelect={() => openThread(thread.id)}
        actions={
          (onCall || unread > 0) && (
            <>
              <span className={styles.rowMark} aria-hidden>
                {onCall ? <Call /> : <span className={styles.unreadDot} />}
              </span>
              {onCall && <span className="ops-visually-hidden">On a call</span>}
              {unread > 0 && <span className="ops-visually-hidden">{unread} unread</span>}
            </>
          )
        }
      />
    );
  };

  return (
    <>
      <div className={styles.filters}>
        <PillTabList
          selectedValue={filter}
          onTabSelect={(_, data) => setFilter(data.value as Filter)}
          className={styles.pillTabs}
        >
          {FILTERS.map(({ id, label }) => (
            <PillTab key={id} value={id} className={styles.pillTab}>
              {label}
            </PillTab>
          ))}
        </PillTabList>
      </div>
      <div className={styles.list}>
        {shows(SKYE_THREAD) && (
          <Panel.NavSection border>
            {item(SKYE_THREAD)}
          </Panel.NavSection>
        )}
        {sections.map((section) => (
          <Panel.NavSection key={section.id} label={section.label} className={styles.section}>
            {section.threads.map(item)}
          </Panel.NavSection>
        ))}
        {!shows(SKYE_THREAD) && sections.length === 0 && (
          <Caption1 as="p" className={styles.listEmpty}>
            {filter === "unread" ? "You're all caught up." : "No chats here yet."}
          </Caption1>
        )}
      </div>
    </>
  );
}

/**
 * Who a post or thread is from: Skye as her orb (a still of it, drawn a
 * quarter past its box, as the Outputs panel's is), anyone else as Fluent's
 * Avatar, available, at 32px. Decorative: their name is always beside it.
 */
function PersonAvatar({ name }: { name: string }) {
  const styles = useStyles();
  if (name === SKYE) {
    return (
      <span aria-hidden className={styles.orbBox}>
        <img src={skyeOrbStill} alt="" width={40} height={40} />
      </span>
    );
  }
  return (
    <Avatar size={32} name={name} image={photoOf(name)} color="colorful" badge={{ status: presenceOf(name) }} aria-hidden />
  );
}

/**
 * A thread's picture: its person's, or a channel's square with its
 * initials. `filled` is what Panel.NavItem gives its icon on hover; these
 * have no filled form.
 */
function ThreadAvatar({ thread }: { thread: ChatThread; filled?: boolean }) {
  if (thread.kind === "channel") return <Avatar size={32} name={thread.name} shape="square" color="colorful" aria-hidden />;
  return <PersonAvatar name={thread.members[0]} />;
}

/**
 * The open thread's header: who it is with, and Call. Calling Skye starts
 * the call with her; calling a teammate or a channel calls its people in
 * (callGuests), and the call is this chat's. On a call going on elsewhere,
 * Call adds them to it instead, which stays that chat's.
 */
function ChatHeader({ thread }: { thread: ChatThread }) {
  const styles = useStyles();
  const live = useLiveCall();
  const guests = useSyncExternalStore(subscribeCallGuests, callGuests);
  const onCall = live.active || guests !== null;
  const reached = new Set([...(guests?.names ?? []), ...(guests?.calling ?? [])]);
  const toCall = thread.members.filter((name) => PEOPLE.includes(name) && !reached.has(name));
  const call =
    thread.kind === "agent"
      ? !live.active && { label: `Call ${thread.name}`, start: () => live.startCall() }
      : toCall.length > 0 && {
          label: onCall ? `Add ${thread.name} to the call` : `Call ${thread.name}`,
          start: () => {
            if (!onCall) callFrom(thread.id);
            toCall.forEach(inviteToCall);
          },
        };

  return (
    <header className={styles.header}>
      <ThreadAvatar thread={thread} />
      <div className={styles.headerText}>
        <Body1Strong as="h1" className={styles.headerName}>
          {thread.name}
        </Body1Strong>
        <Caption1 className={styles.headerAbout}>{thread.about}</Caption1>
      </div>
      <div className={styles.headerActions}>
        {call && (
          <Tooltip content={call.label} relationship="label">
            <Button appearance="subtle" icon={<Call />} onClick={call.start} />
          </Tooltip>
        )}
      </div>
    </header>
  );
}

type ConversationProps = {
  thread: ChatThread;
  posts: readonly ChatPost[];
  /** Someone in it is writing a reply: Skye, at work on one. */
  typing: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
};

/**
 * The thread's posts on Coral's chat, and the box to write in over their foot.
 * Sending posts what is written as the user's; to Skye, it also goes to her
 * as a typed request, and her reply is posted as hers when it comes. While
 * she writes it, she shows typing after the last post.
 */
function Conversation({ thread, posts, typing, draft, onDraftChange }: ConversationProps) {
  const styles = useStyles();
  const { runTypedRequest } = useLiveCall();
  // Who types: the teammate, one to one; otherwise Skye, the one who answers in her chat and the channels.
  const typist = thread.kind === "person" ? thread.name : SKYE;
  const messages = useMemo(() => {
    const shown = toChatMessages(posts);
    return typing
      ? [...shown, { id: "typing", role: "assistant" as const, type: TYPING_TYPE, content: "", metadata: { author: typist } }]
      : shown;
  }, [posts, typing, typist]);
  // The post being replied to, from its menu, quoted over the box until sent or dismissed.
  const [replying, setReplying] = useState<ChatQuote | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // How tall the box to write in is, with the reply it quotes: it grows with what is written.
  const composeRef = useRef<HTMLDivElement>(null);
  const [composeHeight, setComposeHeight] = useState(0);
  useLayoutEffect(() => {
    const compose = composeRef.current;
    if (!compose) return;
    const measure = () => setComposeHeight(compose.offsetHeight);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(compose);
    return () => resize.disconnect();
  }, []);
  const actions = useMemo<ThreadActions>(
    () => ({
      threadId: thread.id,
      reply: (quote) => {
        setReplying(quote);
        inputRef.current?.focus();
      },
    }),
    [thread.id],
  );

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    postMessage(thread.id, ME, text, replying ?? undefined);
    onDraftChange("");
    setReplying(null);
    if (thread.kind === "agent") void ask(text);
  };
  // A request a newer one replaced comes back null: only the newer one is answered.
  const ask = async (text: string) => {
    const done = startTyping(thread.id);
    try {
      const reply = await runTypedRequest(text);
      if (reply) postMessage(thread.id, SKYE, reply);
    } finally {
      done();
    }
  };

  return (
    <div
      className={mergeClasses("chat-thread", styles.thread)}
      style={{ "--chat-compose-height": `${composeHeight}px` } as CSSProperties}
    >
      <ThreadActionsContext.Provider value={actions}>
        <Chat.Canvas>
          <ShowPosts messages={messages} />
          <ComposeSpace height={composeHeight} />
          <Chat.Messages components={POST_COMPONENTS} />
        </Chat.Canvas>
      </ThreadActionsContext.Provider>
      <span className="ops-visually-hidden" aria-live="polite">
        {typing ? `${typist} is typing…` : ""}
      </span>
      <div ref={composeRef} className={mergeClasses("chat-compose", styles.compose)}>
        {replying && (
          <div className={mergeClasses(styles.quote, styles.replying)}>
            <div className={styles.replyingBody}>
              <Caption1Strong>Replying to {replying.author === ME ? "yourself" : replying.author}</Caption1Strong>
              <Caption1 className={styles.replyingText}>{replying.text}</Caption1>
            </div>
            <Tooltip content="Cancel reply" relationship="label">
              <Button appearance="subtle" size="small" icon={<Dismiss />} onClick={() => setReplying(null)} />
            </Tooltip>
          </div>
        )}
        {/* Outside Chat.Canvas, so Enter and Send post here rather than run Coral's agent turn. */}
        <Chat.Input
          ref={inputRef}
          value={draft}
          onChange={onDraftChange}
          onEnter={send}
          placeholder={`Message ${thread.name}`}
          actionsEnd={
            <Button
              appearance="transparent"
              aria-label="Send"
              icon={<Send />}
              disabled={!draft.trim()}
              onClick={send}
            />
          }
        />
      </div>
    </div>
  );
}

/** Puts the thread's posts in the Chat.Canvas around it, before it paints, so it scrolls to the newest. */
function ShowPosts({ messages }: { messages: ChatMessage[] }) {
  const { setMessages } = useChatContext();
  useLayoutEffect(() => setMessages(messages), [messages, setMessages]);
  return null;
}

/**
 * Tells the Chat.Canvas around it how tall the box to write in over its foot
 * is, as Coral's own Chat.Input would from inside it, so Scroll to bottom
 * shows over the box; and, as the box grows, keeps the newest post in sight
 * over it, unless the user has scrolled up from it.
 */
function ComposeSpace({ height }: { height: number }) {
  const { setInputHeight, messagesContainerRef, showScrollButton } = useChatContext();
  useLayoutEffect(() => {
    setInputHeight(height);
    const scroller = messagesContainerRef.current;
    if (scroller && !showScrollButton) scroller.scrollTop = scroller.scrollHeight;
    // Only as the box resizes: the posts coming in scroll Coral's canvas themselves.
  }, [height]);
  return null;
}

/**
 * One post, Teams-style: anyone else's after their avatar, with their name
 * and the time over the bubble; the user's at the right, with the time
 * alone. Running on from the same person, the name and time are only read
 * out, not shown. A day's first post has the date over it. Right-clicking
 * the bubble opens its menu; its reactions overlap its foot.
 */
function PostFrame({ id, meta, text, children }: { id: string; meta: PostMeta; text: string; children: ReactNode }) {
  const styles = useStyles();
  const actions = useContext(ThreadActionsContext);
  const mine = meta.author === ME;
  const react = (emoji: string) => actions && toggleReaction(actions.threadId, id, emoji);
  const reactions = Object.entries(meta.reactions ?? {});
  return (
    <>
      {meta.day && (
        <Caption1 as="p" className={styles.day}>
          {meta.day}
        </Caption1>
      )}
      <div className={mergeClasses(styles.post, meta.runsOn && styles.postRunsOn, mine && styles.postMine)}>
        {!mine && (
          <span className={mergeClasses(styles.postAvatar, !meta.runsOn && styles.postAvatarHeaded)}>
            {!meta.runsOn && <PersonAvatar name={meta.author} />}
          </span>
        )}
        <div className={mergeClasses(styles.postBody, mine && styles.postBodyMine)}>
          <div className={meta.runsOn ? "ops-visually-hidden" : styles.postHead}>
            {mine ? <span className="ops-visually-hidden">You</span> : <Caption1>{meta.author}</Caption1>}
            <Caption1>{postTime(meta.at)}</Caption1>
          </div>
          <div className={mergeClasses(styles.bubbleWrap, reactions.length > 0 && styles.bubbleWrapReacted)}>
            <Menu openOnContext>
              <MenuTrigger disableButtonEnhancement>
                <div tabIndex={0} className={mergeClasses(styles.bubble, mine && styles.bubbleMine, styles.bubbleFocus)}>
                  {meta.replyTo && <Quote quote={meta.replyTo} />}
                  {children}
                </div>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <ReactionChoices onReact={react} />
                  <MenuItem icon={<ArrowReply />} onClick={() => actions?.reply({ id, author: meta.author, text })}>
                    Reply
                  </MenuItem>
                  <MenuItem icon={<Copy />} onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}>
                    Copy
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            {reactions.length > 0 && (
              <div className={mergeClasses(styles.reactions, mine && styles.reactionsMine)}>
                {reactions.map(([emoji, who]) => (
                  <Tooltip key={emoji} content={`${describeApprovers(who)} reacted`} relationship="description">
                    <ToggleButton
                      size="small"
                      shape="circular"
                      checked={who.includes(ME)}
                      aria-label={`${emoji} ${who.length}`}
                      className={mergeClasses(styles.reaction, who.includes(ME) && styles.reactionMine)}
                      onClick={() => react(emoji)}
                    >
                      <span className={styles.reactionEmoji}>{emoji}</span>
                      {/* How many, from two up, as Teams counts them. */}
                      {who.length > 1 && who.length}
                    </ToggleButton>
                  </Tooltip>
                ))}
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <Tooltip content="Add a reaction" relationship="label">
                      <Button size="small" shape="circular" icon={<EmojiAdd />} className={styles.addReaction} />
                    </Tooltip>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <ReactionChoices onReact={react} />
                    </MenuList>
                  </MenuPopover>
                </Menu>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** The reactions at the head of a post's menu, side by side (chat.css), each a menu item for the keyboard. */
function ReactionChoices({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <MenuGroup aria-label="React" className="chat-react-row">
      {REACTIONS.map(({ emoji, label }) => (
        <MenuItem key={emoji} aria-label={label} className="chat-react-item" onClick={() => onReact(emoji)}>
          {emoji}
        </MenuItem>
      ))}
    </MenuGroup>
  );
}

/** The post a reply answers, quoted at the head of the reply's bubble. */
function Quote({ quote }: { quote: ChatQuote }) {
  const styles = useStyles();
  return (
    <div className={styles.quote}>
      <Caption1Strong>{quote.author}</Caption1Strong>
      <Caption1 className={styles.quoteText}>{quote.text}</Caption1>
    </div>
  );
}

function Post({ message }: ChatMessageRendererProps) {
  const styles = useStyles();
  return (
    <PostFrame id={message.id ?? ""} meta={message.metadata as PostMeta} text={message.content}>
      <Body1 className={styles.postText}>{message.content}</Body1>
    </PostFrame>
  );
}

/** Someone writing a reply, after the last post: their avatar, and that they are typing. */
function Typing({ message }: ChatMessageRendererProps) {
  const styles = useStyles();
  const { author } = message.metadata as { author: string };
  return (
    <div className={styles.post} aria-hidden>
      <span className={styles.postAvatar}>
        <PersonAvatar name={author} />
      </span>
      <Caption1 className={styles.typingText}>{author} is typing…</Caption1>
    </div>
  );
}

const POST_COMPONENTS = { [POST_TYPE]: Post, [TYPING_TYPE]: Typing };
