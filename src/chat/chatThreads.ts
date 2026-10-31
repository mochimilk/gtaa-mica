// The Chat page's conversations (ChatPage), Teams-style: Skye first, as one
// more person to message, then a section for each operations area the user
// works with: its channels, one for each sector it covers, and the teammate
// on duty in them (TEAM).
// Person to person: what the user sends a teammate or a channel only joins
// it, as calling them in only puts them on the call window; nothing reaches
// anyone, and nobody answers. What the user sends Skye goes to her as a
// typed request (ChatPage), and her reply joins her chat when it comes.
//
// A call belongs to the chat it was placed from, or the chat with whoever was
// called (returnTo): the page shows it there (../approvals/ApprovalsCall), and
// goes back there as it ends. Skye's changes are approved in a call of their
// own, to the channel of the area that has to approve them, for the terminal
// the changes land in (reviewChannel): calling the teammate in for a review
// calls that channel. Skye asks there as the call goes out, as anyone calling
// a channel would, and the teammate on duty answers there once they approve.
//
// React-free, as skyeNotes.ts is, so it can be tested: ChatPage reads it
// with useSyncExternalStore.
import { callGuests, callingNames, EXPERTISE_LABELS, personWith, subscribeCallGuests, type Expertise } from "../live/callGuests";
import {
  reviewTerminal,
  skyeReview,
  subscribeSkyeReview,
  type Signoff,
  type SkyeReview,
} from "../operations/skyeReview";

/** The user, as a post's author: as outputs' decisions name them. */
export const ME = "You";
export const SKYE = "Skye";

/** Skye's chat; a teammate's, one to one; or an area's channel, the teammate and Skye in it. */
export type ThreadKind = "agent" | "person" | "channel";

export type ChatThread = {
  id: string;
  name: string;
  kind: ThreadKind;
  /** Everyone in it but the user. */
  members: readonly string[];
  /** Under its name in the chat's header: what they do, or who is in it. */
  about: string;
  /**
   * A channel's sector ("Terminal A"): the part of the airport its function
   * covers, divided as that function divides it. Its name ends with it in
   * short ("Baggage control A"), and its header says it in full.
   */
  sector?: string;
};

/** An operations area, as the left panel's section: its channels, then the chats with its lead and crew. */
export type ChatSection = { id: Expertise; label: string; threads: readonly ChatThread[] };

/** The post a reply answers, as it is quoted over the reply. */
export type ChatQuote = { id: string; author: string; text: string };

export type ChatPost = {
  id: string;
  author: string;
  text: string;
  /** When it was sent (Date.now(), just after the post before; see stamp). */
  at: number;
  /** The post it answers, if it is a reply. */
  replyTo?: ChatQuote;
  /** Everyone who reacted with each emoji, in the order they did; none, no entry. */
  reactions?: Readonly<Record<string, readonly string[]>>;
};

export const SKYE_THREAD: ChatThread = {
  id: "skye",
  name: SKYE,
  kind: "agent",
  members: [SKYE],
  about: "AI agent for stand planning",
};

// The areas, in the left panel's order: each one's channels, named for the
// sector each covers, and the crew working it with the area's lead. Each
// function divides the airport its own way: baggage and gates by terminal
// (../operations/terminals), the ramp by pier, apron control by apron.
// Baggage has a channel for each terminal, the one lead on duty covering
// both, as one person can cover several sectors on a quiet shift. Made up, as
// the teammates are, until the airport's own boundaries are known.
type Channel = { name: string; sector: string; crew: readonly string[] };
const AREAS: readonly { expertise: Expertise; label: string; channels: readonly Channel[] }[] = [
  {
    expertise: "baggage",
    label: "Baggage ops",
    channels: [
      { name: "Baggage control A", sector: "Terminal A", crew: ["Dana Kowalski"] },
      { name: "Baggage control B", sector: "Terminal B", crew: ["Mateo Silva"] },
    ],
  },
  {
    expertise: "gates",
    label: "Gate ops",
    channels: [{ name: "Gate allocation B", sector: "Terminal B", crew: ["Hannah Lee"] }],
  },
  {
    expertise: "ramp",
    label: "Ramp ops",
    channels: [{ name: "Ramp leads A/B", sector: "Piers A and B", crew: ["Kofi Mensah", "Ines Duarte"] }],
  },
  {
    expertise: "apron",
    label: "Apron control",
    channels: [{ name: "Apron tower West", sector: "West apron", crew: ["Sofia Reyes"] }],
  },
];

const slug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

/** Where someone is, as Teams shows it on their avatar: Fluent's presence statuses. */
export type Presence = "available" | "away" | "busy" | "do-not-disturb" | "out-of-office" | "offline";

/** Made up, as the teammates are: everyone else is available. */
const PRESENCE: Readonly<Record<string, Presence>> = {
  "Priya Raman": "busy",
  "Dana Kowalski": "away",
  "Hannah Lee": "do-not-disturb",
  "Ines Duarte": "out-of-office",
};

export const presenceOf = (name: string): Presence => PRESENCE[name] ?? "available";

/** A teammate's chat with the user: what they do, and where, for a crew member. */
const personChat = (name: string, expertise: Expertise, sector?: string): ChatThread => ({
  id: slug(name),
  name,
  kind: "person",
  members: [name],
  about: sector ? `${EXPERTISE_LABELS[expertise]} · ${sector}` : EXPERTISE_LABELS[expertise],
});

export const SECTIONS: readonly ChatSection[] = AREAS.flatMap(({ expertise, label, channels }) => {
  const lead = personWith(expertise);
  if (!lead) return [];
  return [
    {
      id: expertise,
      label,
      threads: [
        ...channels.map(({ name, sector, crew }): ChatThread => {
          const members = [lead.name, ...crew, SKYE];
          return {
            id: `${expertise}-${slug(sector)}`,
            name,
            kind: "channel",
            members,
            about: `${sector} · ${members.join(", ")} and you`,
            sector,
          };
        }),
        personChat(lead.name, expertise),
        ...channels.flatMap(({ sector, crew }) => crew.map((name) => personChat(name, expertise, sector))),
      ],
    },
  ];
});

/** Every thread, in the left panel's order. */
export const THREADS: readonly ChatThread[] = [SKYE_THREAD, ...SECTIONS.flatMap((section) => section.threads)];

/** An area's channel for a terminal: the one whose sector it is, else the area's first. */
export function channelFor(expertise: Expertise, terminal: string | undefined): ChatThread | undefined {
  const channels = SECTIONS.find((section) => section.id === expertise)?.threads.filter((thread) => thread.kind === "channel") ?? [];
  return channels.find((thread) => thread.sector === terminal) ?? channels[0];
}

/** Where a teammate's sign-off on Skye's changes is asked for: their area's channel for the terminal the changes land in. */
export const reviewChannel = (review: SkyeReview, signoff: Signoff): ChatThread | undefined =>
  channelFor(signoff.expertise, reviewTerminal(review.changes));

export type ChatState = {
  /** Each thread's posts, oldest first. */
  posts: Readonly<Record<string, readonly ChatPost[]>>;
  /** When the user last read each thread: posts after it, by anyone else, are unread. */
  readAt: Readonly<Record<string, number>>;
  /** The thread open on the page. */
  open: string;
  /** How many replies each thread has someone writing: Skye's, while she works on them. */
  typing: Readonly<Record<string, number>>;
  /** While people are called in, the thread to go back to as the call ends: the one called from, or the first person's. */
  returnTo: string | null;
};

let ids = 0;
const nextId = () => `chat-post-${(ids += 1)}`;

/** The newest time given a post: at first, when the app opened. */
let lastStamp = Date.now();

/**
 * Now (Date.now()), but always after the post before: two in the same
 * millisecond keep their order, and one that comes after a thread was read
 * up to the newest is unread.
 */
const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));

/** Minutes in a day, for posts made up on the days before. */
const DAY = 24 * 60;

/**
 * A made-up morning so far, and some of the days before: each thread's posts,
 * all read. In the channels, the leads and their crews talk among themselves.
 */
function seeded(): ChatState {
  const opened = lastStamp;
  const post = (
    author: string,
    minutesAgo: number,
    text: string,
    extra: Pick<ChatPost, "reactions" | "replyTo"> = {},
  ): ChatPost => ({ id: nextId(), author, text, at: opened - minutesAgo * 60_000, ...extra });
  const quote = ({ id, author, text }: ChatPost): ChatQuote => ({ id, author, text });
  const by = (expertise: Expertise) => personWith(expertise)?.name ?? "";
  // Posts others answer, made first so the answers can quote them.
  const beltJam = post("Dana Kowalski", 33, "Spoke too soon on the belts: belt 2 is jamming on and off. A tech is on the way.");
  const scale = post("Mateo Silva", 36, "Morning. Carousel 9's scale is off again, so I'm weighing oversize bags by hand at 10.");
  const bridge = post("Hannah Lee", 27, "C22's jet bridge is back from maintenance, so it's usable again from 10:00.", {
    reactions: { "👍": [by("gates"), SKYE] },
  });
  const towCover = post("Kofi Mensah", 61, "I can take the 11:00 tow from B12 if that helps.");
  const sweep = post("Sofia Reyes", 22, "FOD sweep on the west apron is done. All clear.", { reactions: { "👍": [by("apron")] } });
  const posts: Record<string, ChatPost[]> = {
    [SKYE_THREAD.id]: [
      post(
        SKYE,
        50,
        "Morning. I'm keeping an eye on the stand plan today. Ask me to move a flight, clear a conflict or brief a teammate. Anything we change still needs your approval.",
      ),
    ],
    "baggage-terminal-a": [
      post(by("baggage"), DAY + 120, "Carousel 4 is back in service after the belt check.", { reactions: { "👍": [SKYE, ME] } }),
      post("Dana Kowalski", DAY + 110, "Great, I'll move the oversize drop back to 4 tomorrow."),
      post(by("baggage"), 42, "Morning all. Belts are running normally in both halls."),
      post(by("baggage"), 41, "If a flight moves piers this afternoon, give me a shout before it's locked in. Carousel crews are thin until 15:00."),
      beltJam,
      post(by("baggage"), 31, "Thanks. Send anything heavy to belt 3 until it's sorted.", { replyTo: quote(beltJam) }),
      post("Dana Kowalski", 18, "Belt 2 is fixed. Back to normal.", { reactions: { "👍": [by("baggage")] } }),
    ],
    "baggage-terminal-b": [
      post(by("baggage"), 38, "Covering Terminal B belts as well this morning. Same as A, shout before anything moves."),
      scale,
      post(by("baggage"), 35, "Fine by me. Log it so maintenance picks it up.", { replyTo: quote(scale) }),
      post("Mateo Silva", 12, "Logged. Two crews on carousels 8 and 9 until noon, then just one."),
    ],
    [slug(by("baggage"))]: [
      post(by("baggage"), DAY + 95, "Can you send me the stand plan once the afternoon bank is final?"),
      post(ME, DAY + 90, "Will do.", { reactions: { "❤️": [by("baggage")] } }),
    ],
    "gates-terminal-b": [
      post(by("gates"), 30, "Gate holds are clear for now. I'll flag anything that comes in late."),
      bridge,
      post(by("gates"), 25, "Good news, that gives us a contact gate back for the afternoon.", { replyTo: quote(bridge) }),
      post("Hannah Lee", 9, "Heads up: D40's gate screen is down. Agents are boarding from a paper list for now."),
    ],
    [slug(by("gates"))]: [post(by("gates"), 64, "Do we still need the remote stands after 16:00? I'd like to free up the buses.")],
    "ramp-piers-a-and-b": [
      post("Ines Duarte", DAY + 60, "Pushback tug 3 is back from the shop. I'm off from tomorrow until Monday, Kofi has my handover."),
      post(by("ramp"), 65, "Tow team is one driver short this shift, so tows may run a few minutes behind."),
      towCover,
      post(by("ramp"), 60, "Yes please. With Ines off, I'll cover the Pier A pushbacks myself until noon.", {
        replyTo: quote(towCover),
        reactions: { "👍": ["Kofi Mensah"] },
      }),
    ],
    [slug(by("ramp"))]: [
      post(ME, 2 * DAY + 120, "Thanks for turning that tow around so fast this morning."),
      post(by("ramp"), 2 * DAY + 118, "Anytime."),
    ],
    "apron-west-apron": [
      post(by("apron"), 25, "Marshallers are on both piers from 11:00."),
      sweep,
      post(by("apron"), 21, "Thanks, Sofia."),
      post("Sofia Reyes", 6, "Wind's picking up, gusting to 30 knots after 13:00. We'll be checking chocks and cones more often."),
    ],
    [slug(by("apron"))]: [post(by("apron"), 3 * DAY + 200, "Sent over the updated apron layout. Shout if anything looks off.")],
    "dana-kowalski": [
      post("Dana Kowalski", 2 * DAY + 30, "Do you have a minute later to go over the oversize drop times?"),
      post(ME, 2 * DAY + 25, "Sure, after 14:00."),
    ],
    "mateo-silva": [
      post(ME, DAY + 300, "Thanks for covering carousel 9 yesterday."),
      post("Mateo Silva", DAY + 290, "No problem, it was quiet anyway."),
    ],
    "hannah-lee": [post("Hannah Lee", 40, "Could we keep C22 free for the 15:30 widebody? The bridge suits it best.")],
    "kofi-mensah": [post("Kofi Mensah", 75, "Heads up, tug 2's tow bar is cracked, so I'm on tug 3 today.")],
    "ines-duarte": [post("Ines Duarte", DAY + 55, "I'm off from tomorrow until Monday. Kofi has my handover if anything comes up.")],
    "sofia-reyes": [post("Sofia Reyes", 15, "Can you send me the remote stand plan for this afternoon?")],
  };
  return {
    posts,
    readAt: Object.fromEntries(THREADS.map((thread) => [thread.id, opened])),
    open: SKYE_THREAD.id,
    typing: {},
    returnTo: null,
  };
}

let state: ChatState = seeded();
const listeners = new Set<() => void>();

function set(next: ChatState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore. */
export const chatState = (): ChatState => state;
export function subscribeChat(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `author` sends `text` to a thread, in reply to `replyTo` if given. */
export function postMessage(threadId: string, author: string, text: string, replyTo?: ChatQuote): void {
  const post: ChatPost = { id: nextId(), author, text, at: stamp(), ...(replyTo && { replyTo }) };
  set({ ...state, posts: { ...state.posts, [threadId]: [...(state.posts[threadId] ?? []), post] } });
}

/** `who` reacts to a post with `emoji`, or takes back the reaction if they had. */
export function toggleReaction(threadId: string, postId: string, emoji: string, who = ME): void {
  const posts = state.posts[threadId];
  if (!posts?.some((post) => post.id === postId)) return;
  const react = (post: ChatPost): ChatPost => {
    const had = post.reactions?.[emoji] ?? [];
    const { [emoji]: _, ...others } = post.reactions ?? {};
    const now = had.includes(who) ? had.filter((name) => name !== who) : [...had, who];
    return { ...post, reactions: now.length > 0 ? { ...post.reactions, [emoji]: now } : others };
  };
  set({ ...state, posts: { ...state.posts, [threadId]: posts.map((post) => (post.id === postId ? react(post) : post)) } });
}

/** Opens a thread on the page. */
export function openThread(threadId: string): void {
  if (state.open !== threadId) set({ ...state, open: threadId });
}

/** The user has read a thread up to `at`. */
export function markRead(threadId: string, at: number): void {
  if ((state.readAt[threadId] ?? 0) >= at) return;
  set({ ...state, readAt: { ...state.readAt, [threadId]: at } });
}

/** Someone starts writing a reply in a thread; call the returned function once it is sent, or dropped. */
export function startTyping(threadId: string): () => void {
  const change = (by: number) =>
    set({ ...state, typing: { ...state.typing, [threadId]: Math.max(0, (state.typing[threadId] ?? 0) + by) } });
  change(1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    change(-1);
  };
}

export const isTyping = (current: ChatState, threadId: string): boolean => (current.typing[threadId] ?? 0) > 0;

const NO_POSTS: readonly ChatPost[] = [];

/** A thread's posts, oldest first. */
export const threadPosts = (current: ChatState, threadId: string): readonly ChatPost[] =>
  current.posts[threadId] ?? NO_POSTS;

/**
 * A thread's latest post, on one line, as the left panel shows it under its
 * name: "You: Will do." for the user's; in a channel, anyone's after their
 * first name, as Teams shows a group's ("Travis: Morning all.").
 */
export function latestPost(current: ChatState, threadId: string): string | undefined {
  const post = threadPosts(current, threadId).at(-1);
  if (!post) return undefined;
  const text = post.text.replace(/\s+/g, " ").trim();
  if (post.author === ME) return `You: ${text}`;
  const channel = THREADS.find((thread) => thread.id === threadId)?.kind === "channel";
  return channel ? `${post.author.split(" ")[0]}: ${text}` : text;
}

/** How many of a thread's posts the user has not read: anyone else's since they last did. */
export function unreadCount(current: ChatState, threadId: string): number {
  const readAt = current.readAt[threadId] ?? 0;
  return threadPosts(current, threadId).filter((post) => post.author !== ME && post.at > readAt).length;
}

/** How many threads have posts unread, for the nav rail's counter. */
export const unreadThreads = (current: ChatState): number =>
  THREADS.filter((thread) => unreadCount(current, thread.id) > 0).length;

/** The user calls the people in a thread from it: the page goes back to it as the call ends. */
export function callFrom(threadId: string): void {
  if (state.returnTo !== threadId) set({ ...state, returnTo: threadId });
}

/** A teammate's own chat with the user. */
const personThread = (name: string | undefined): ChatThread | undefined =>
  THREADS.find((thread) => thread.kind === "person" && thread.members[0] === name);

/** Whether people were called in, as last seen. */
let peopleCalled = false;

/**
 * As people are first called in, the call belongs to a chat: the one it was
 * placed from (callFrom); for a teammate who has to approve Skye's changes,
 * the channel that approves them (reviewChannel); else the chat with the
 * first person called. As the call with them ends, the page goes back to it.
 */
function noteCall(): void {
  const guests = callGuests();
  if (guests && !peopleCalled && state.returnTo === null) {
    const first = guests.calling[0] ?? guests.names[0];
    const review = skyeReview();
    const signoff = review?.signoffs.find((entry) => entry.name === first && entry.state !== "approved");
    const called = review && signoff ? reviewChannel(review, signoff) : personThread(first);
    if (called) set({ ...state, returnTo: called.id });
  } else if (!guests && peopleCalled && state.returnTo !== null) {
    set({ ...state, open: state.returnTo, returnTo: null });
  }
  peopleCalled = guests !== null;
  noteAsks();
}
subscribeCallGuests(noteCall);

/**
 * Skye asking a channel to look at what touches its area, as the call to it
 * goes out: to the channel, so to nobody by name ("could anyone", where a
 * chat with one person has "could you"), and for the user, so the changes
 * are "ours", not hers. Whoever picks up, she greets on the call
 * (../operations/disruption's teammateBrief).
 */
function askFor(review: SkyeReview, signoff: Signoff, thread: ChatThread): string {
  const who = thread.kind === "channel" ? "anyone" : "you";
  if (signoff.expertise !== "baggage") {
    return `Hey, some of our stand changes touch ${EXPERTISE_LABELS[signoff.expertise].toLowerCase()}. Could ${who} check them before they're approved?`;
  }
  const count = review.changes.filter((change) => change.baggage).length;
  const moving = count === 1 ? "one of our stand changes moves" : `${count} of our stand changes move`;
  return `Hey, ${moving} bags. Could ${who} check the carousels before they're approved?`;
}

/** The teammates Skye has asked in their channel, since they last waited to be asked. */
const asked = new Set<string>();

/**
 * Skye asks in a teammate's channel once: as the call to them goes out, or
 * as they are asked on a call they were on already. Once she changes
 * something more and they wait to be asked again, she asks again.
 */
function noteAsks(): void {
  const review = skyeReview();
  if (!review) {
    asked.clear();
    return;
  }
  for (const signoff of review.signoffs) {
    const calling = callingNames().includes(signoff.name);
    if (signoff.state === "needed" && !calling) asked.delete(signoff.name);
    if (asked.has(signoff.name) || !(signoff.state === "asked" || (signoff.state === "needed" && calling))) continue;
    const channel = reviewChannel(review, signoff);
    if (!channel) continue;
    asked.add(signoff.name);
    postMessage(channel.id, SKYE, askFor(review, signoff, channel));
  }
}

/** A teammate answering once they approve. */
const approvedFor = (signoff: Signoff): string =>
  signoff.expertise === "baggage"
    ? "Checked the carousels. Approved for baggage."
    : `Checked. Approved for ${EXPERTISE_LABELS[signoff.expertise].toLowerCase()}.`;

/** Each teammate's sign-off as last seen, to post only what changed. */
let signoffs: readonly Signoff[] = [];

/** Skye asks in each teammate's channel (noteAsks), and they answer there once they approve. */
function noteSignoffs(): void {
  noteAsks();
  const review = skyeReview();
  const next = review?.signoffs ?? [];
  for (const signoff of next) {
    if (signoff.state !== "approved" || signoffs.find((entry) => entry.name === signoff.name)?.state === "approved") continue;
    const channel = review && reviewChannel(review, signoff);
    if (channel) postMessage(channel.id, signoff.name, approvedFor(signoff));
  }
  signoffs = next;
}
subscribeSkyeReview(noteSignoffs);
