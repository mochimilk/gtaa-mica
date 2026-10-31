// Skye's stand changes, held until they are approved. Skye makes a change on
// the board as a person would (her cursor drags the stays), and it then waits
// here, on the board, for whoever has to approve it: the teammate for each
// area it touches (baggage, for now; see needsBaggage), then the user, who
// runs the stands. Approving keeps it; cancelling puts the stays Skye changed
// back where they were. Changes Skye makes while one is waiting join it, and
// are approved or cancelled together. Every piece Skye changes is listed, under
// the request she changed it for and with where it stands, in the Outputs
// panel and its peek (outputs.ts), with the decision at their foot
// (OutputsApproval), and on the call's shared screen (../approvals/ApprovalsCall),
// which opens as a teammate is brought in (teammatesBroughtIn).
//
// A teammate looks at it once they are on the call: already on it when Skye
// makes the change, or called in (Skye offers to; Review with baggage does).
// A placeholder: nothing reaches anyone. Each approves on their own after a
// few seconds (SIGNOFF_MS), as people called in answer; one with a voice of
// their own (../live/teammateVoice) answers Skye aloud and approves as they
// say so (setAnswerAloud, approveSignoff).
import {
  callingNames,
  EXPERTISE_LABELS,
  guestNames,
  inviteToCall,
  personWith,
  subscribeCallGuests,
  type Expertise,
} from "../live/callGuests";
import type { AppAction } from "../live/appActions";
import type { ChangeWait } from "../live/opsHost";
import {
  currentClosure,
  planUpdating,
  restoreStays,
  sameClosure,
  samePlace,
  standArea,
  standState,
  subscribeAllocation,
  type Closure,
  type StandState,
  type StayPlace,
} from "./allocation";
import {
  describeBoardAction,
  describeClosure,
  describeMove,
  finishRequest,
  logDecision,
  putStep,
  removeStep,
  describeUserChange,
  setStepApprover,
  setStepStatus,
  startRequest,
  stayLabel,
  type DecisionFigure,
  type OutputActor,
  type OutputDecision,
  type OutputStatus,
  type OutputStep,
} from "./outputs";
import { boardKpis } from "./boardKpis";
import { formatDuration } from "./operationsData";
import { terminalOf } from "./terminals";

/** How long a teammate takes to approve, ms: long enough for Skye to brief them first (DisruptionNotice). */
export const SIGNOFF_MS = 10_000;

/** How long a teammate answering aloud has to approve, ms, should they never say so: a backstop. */
export const SIGNOFF_ALOUD_MS = 60_000;

/** One stay Skye changed: where it was before she did, and where she left it. */
export type ReviewChange = {
  stayId: string;
  from: StayPlace;
  to: StayPlace;
  /** It moves the flight's bags (see needsBaggage), so baggage has to approve it. */
  baggage: boolean;
};

/**
 * A teammate who has to approve before the user can: `needed` until the user
 * sends it to them (askForSignoffs), `asked` while they look, then `approved`,
 * `at` when (Date.now()). `aloud` when, asked, they answer Skye aloud on the
 * call (setAnswerAloud), approving as they say so.
 */
export type Signoff = {
  name: string;
  expertise: Expertise;
  state: "needed" | "asked" | "approved";
  at?: number;
  aloud?: true;
};

export type SkyeReview = {
  changes: readonly ReviewChange[];
  /** The closure Skye put in force or lifted, and what was before; null when she left it alone. */
  closure: { from: Closure | null; to: Closure | null } | null;
  /** Who has to approve first, in order; the user approves last. */
  signoffs: readonly Signoff[];
};

/**
 * Whether a change moves a flight's bags, so baggage has to approve it: the
 * stay goes to another pier (or the remote stands), onto a stand or off one,
 * or to other times. A move between stands on the same pier at the same
 * times does not.
 */
export const needsBaggage = (from: StayPlace, to: StayPlace): boolean =>
  standArea(from.rowId) !== standArea(to.rowId) || from.start !== to.start || from.end !== to.end;

/**
 * What is waiting. `before` is each stay Skye changed as it was before she
 * first did; `after`, as she last left it. A closure she changed is held the
 * same way; undefined when she has not.
 */
type Held = {
  before: Map<string, StayPlace>;
  after: Map<string, StayPlace>;
  closureBefore?: Closure | null;
  closureAfter?: Closure | null;
  /** The Outputs panel's pieces for the changes waiting (outputs.ts), each with its stay's id, or CLOSURE. */
  steps: Map<string, string>;
};

let held: Held | null = null;
let review: SkyeReview | null = null;
const timers = new Set<ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function set(next: SkyeReview | null): void {
  review = next;
  if (next) syncSteps(next);
  for (const listener of listeners) listener();
}

/**
 * Where each piece waiting stands in the Outputs panel: on a teammate who
 * still has to approve its change (baggage, for a change that moves bags),
 * or on the user alone; one with nothing left to approve is done.
 */
function syncSteps(current: SkyeReview): void {
  if (!held) return;
  const baggage = current.signoffs.find((entry) => entry.expertise === "baggage");
  const byStatus = { "pending-approval": [] as string[], waiting: [] as string[], done: [] as string[] };
  // The pieces baggage has approved, to show who did.
  const approved: string[] = [];
  for (const [stepId, piece] of held.steps) {
    const change = current.changes.find((entry) => entry.stayId === piece);
    if (piece === CLOSURE ? !current.closure : !change) byStatus.done.push(stepId);
    else if (change?.baggage && baggage && baggage.state !== "approved") byStatus["pending-approval"].push(stepId);
    else byStatus.waiting.push(stepId);
    if (change?.baggage && baggage?.state === "approved") approved.push(stepId);
  }
  for (const [status, stepIds] of Object.entries(byStatus)) setStepStatus(stepIds, status as keyof typeof byStatus);
  if (baggage) setStepApprover(approved, baggage.name);
}

/** For useSyncExternalStore. */
export const skyeReview = (): SkyeReview | null => review;
export function subscribeSkyeReview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function clearTimers(): void {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}

/** Moves a teammate's sign-off on; one approving notes when, and one asked whether they answer aloud. */
function setSignoff(name: string, state: Signoff["state"], aloud = false): void {
  if (!review) return;
  const next = (entry: Signoff): Signoff => {
    if (state === "approved") return { ...entry, state, at: Date.now() };
    // How they answered the last time they were asked is no guide to the next.
    const { aloud: _, ...rest } = entry;
    return state === "asked" && aloud ? { ...rest, state, aloud: true } : { ...rest, state };
  };
  set({ ...review, signoffs: review.signoffs.map((entry) => (entry.name === name ? next(entry) : entry)) });
}

/**
 * Whether a teammate answers Skye aloud as they are asked, set by the call
 * (../live/LiveCallProvider): asked, it starts their voice, and says whether
 * it could. Null when nobody can.
 */
let answersAloud: ((name: string) => boolean) | null = null;
export function setAnswerAloud(decide: ((name: string) => boolean) | null): void {
  answersAloud = decide;
}

/** A teammate approves, while they are asked: as they say so (aloud), or after SIGNOFF_MS. */
export function approveSignoff(name: string): void {
  if (review?.signoffs.some((entry) => entry.name === name && entry.state === "asked")) setSignoff(name, "approved");
}

/**
 * Sends what is waiting to the teammates who have to approve it first (only
 * those named, when `names` is given); each approves after SIGNOFF_MS, or,
 * answering aloud (setAnswerAloud), as they say so, SIGNOFF_ALOUD_MS being
 * a backstop. Returns whether anyone was asked.
 */
export function askForSignoffs(names?: readonly string[]): boolean {
  const asking =
    review?.signoffs.filter((entry) => entry.state === "needed" && (!names || names.includes(entry.name))) ?? [];
  for (const { name } of asking) {
    // Decided first, so whoever hears they are asked hears how they answer.
    const aloud = answersAloud?.(name) ?? false;
    setSignoff(name, "asked", aloud);
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        approveSignoff(name);
      },
      aloud ? SIGNOFF_ALOUD_MS : SIGNOFF_MS,
    );
    timers.add(timer);
  }
  return asking.length > 0;
}

/** Whoever has to approve and is on the call looks at it. */
const askThoseOnTheCall = () => askForSignoffs(guestNames());
subscribeCallGuests(askThoseOnTheCall);

/**
 * Calls in the teammates who still have to see what is waiting and are not
 * on the call or being called; each looks at it once they answer. Returns
 * whether anyone was called.
 */
export function callForSignoffs(): boolean {
  const reachable = new Set([...guestNames(), ...callingNames()]);
  const calling = review?.signoffs.filter((entry) => entry.state === "needed" && !reachable.has(entry.name)) ?? [];
  for (const { name } of calling) inviteToCall(name);
  return calling.length > 0;
}

/**
 * Whether a teammate has been brought in on what is waiting: being called for
 * it (`calling`, everyone being called), looking at it, or done. Review with
 * baggage does it, and so does a yes to Skye's offer to call them, or their
 * being on the call already when Skye is done. The call opens on the Chat page then.
 */
export const teammatesBroughtIn = (current: SkyeReview | null, calling: readonly string[] = callingNames()): boolean =>
  !!current?.signoffs.some((entry) => entry.state !== "needed" || calling.includes(entry.name));

/**
 * Puts what `held` changed up for approval, asking again from the start:
 * a change to what is waiting is a different plan. Nothing to approve when
 * the stays are back where they were.
 */
function hold(next: Held): void {
  clearTimers();
  const changes = [...next.after].flatMap(([stayId, to]): ReviewChange[] => {
    const from = next.before.get(stayId);
    return from && !samePlace(from, to) ? [{ stayId, from, to, baggage: needsBaggage(from, to) }] : [];
  });
  const closure =
    next.closureBefore !== undefined && !sameClosure(next.closureBefore, next.closureAfter ?? null)
      ? { from: next.closureBefore, to: next.closureAfter ?? null }
      : null;
  if (changes.length === 0 && !closure) {
    // Skye put it all back herself: nothing is left to approve.
    setStepStatus(next.steps.keys(), "done");
    held = null;
    set(null);
    return;
  }
  held = next;
  const areas: Expertise[] = changes.some((change) => change.baggage) ? ["baggage"] : [];
  const signoffs = areas.flatMap((expertise): Signoff[] => {
    const person = personWith(expertise);
    return person ? [{ name: person.name, expertise, state: "needed" }] : [];
  });
  set({ changes, closure, signoffs });
  askThoseOnTheCall();
}

/** "a, b and c". */
const listWords = (words: readonly string[]) =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/**
 * The terminal Skye's changes land in, whose channel approves them
 * (../chat/chatThreads): where the first change that moves bags takes them,
 * else where it took them from; undefined when none does.
 */
export function reviewTerminal(changes: readonly ReviewChange[]): string | undefined {
  const change = changes.find((entry) => entry.baggage);
  return change ? (terminalOf(change.to.rowId) ?? terminalOf(change.from.rowId)) : undefined;
}

/**
 * What Skye says of the wait, after saying what she did, in as few words as
 * it takes: who has to approve first, where they are, and, for one not on
 * the call, an offer to call them. Approval is asked of an area's team in the
 * changes' terminal, called on its channel: she names the team until someone
 * picks up, and then them.
 */
function waitFor(current: SkyeReview): ChangeWait {
  const first = current.signoffs.filter((entry) => entry.state !== "approved");
  if (first.length === 0) return { say: "It's waiting for your approval." };
  const terminal = reviewTerminal(current.changes);
  const team = (entry: Signoff) => `${EXPERTISE_LABELS[entry.expertise].toLowerCase()}${terminal ? ` in ${terminal}` : ""}`;
  const teams = listWords(first.map(team));
  const parts = [`${teams.charAt(0).toUpperCase()}${teams.slice(1)} ${first.length === 1 ? "approves" : "approve"} first, then you.`];
  const firstName = (name: string) => name.split(" ")[0];
  const asked = first.filter((entry) => entry.state === "asked").map((entry) => firstName(entry.name));
  if (asked.length > 0) parts.push(`${listWords(asked)} ${asked.length === 1 ? "is" : "are"} on the call, so I've sent it over.`);
  const ringing = first.filter((entry) => entry.state === "needed" && callingNames().includes(entry.name));
  if (ringing.length > 0) parts.push(`I'm calling ${listWords(ringing.map(team))} already.`);
  const away = first.find((entry) => entry.state === "needed" && !callingNames().includes(entry.name));
  if (!away) return { say: parts.join(" ") };
  // The offer always follows what she says, so a team she has just named is "them".
  return {
    say: parts.join(" "),
    offer: { ask: `Want me to call ${first.length === 1 ? "them" : team(away)}?`, action: { name: "add_to_call", person: away.name } },
  };
}

/* ----------------------------------------- the board's changes, for Outputs */

/** The piece that is the area closure, among the stays' ids. */
const CLOSURE = "closure";

/**
 * A run of changes to the board the Outputs panel lists together, under who
 * made them: a request Skye works on, or something the user does in one go (a
 * drag, a swap, a reset). Each piece is listed once, from where it
 * was when the run started (see follow).
 */
type Trail = {
  requestId: string;
  /** The board as it was when the run started. */
  start: StandState;
  /** Each piece's step id, by its stay's id (or CLOSURE). */
  steps: Map<string, string>;
  /** Where a piece that has landed stands. */
  landed: (from: StayPlace, to: StayPlace) => OutputStatus;
  /** Who has to approve a piece going from `from` to `to` before the user, if anyone. */
  needs: (from: StayPlace, to: StayPlace) => OutputStep["needs"];
  /** Where a closure that has changed stands. */
  closed: OutputStatus;
  done: boolean;
};

/**
 * Skye's piece waits on the user once it lands; one baggage has to see keeps
 * its dots while she works, as baggage is asked only once she is done (hold),
 * and it waits on them from then (syncSteps).
 */
const skyeLanded = (from: StayPlace, to: StayPlace): OutputStatus =>
  needsBaggage(from, to) && personWith("baggage") ? "working" : "waiting";
/** Baggage has to see a piece of Skye's that moves bags, before the user does. */
function skyeNeeds(from: StayPlace, to: StayPlace): OutputStep["needs"] {
  const person = needsBaggage(from, to) ? personWith("baggage") : undefined;
  return person && { name: person.name, expertise: person.expertise };
}
/** The user's own changes need no one's approval. */
const userLanded = (): OutputStatus => "done";
const userNeeds = () => undefined;

/** The board as it was after the last change, to tell what each change moved. */
let board = standState();
/** The request Skye is working on now: what changes on the board is hers, and the pieces her cursor takes hold of. */
let skyeTrail: Trail | null = null;
/** What the user is doing in one go (asUser): what changes on the board meanwhile is theirs, together. */
let userTrail: Trail | null = null;
/** While Skye's changes are cancelled on their own: shown on her requests (struck through), not listed as the user's. */
let cancelling = false;

const stepOf = (current: Trail, piece: string) => {
  const id = current.steps.get(piece) ?? `${current.requestId}:${piece}`;
  current.steps.set(piece, id);
  return id;
};

function dropStep(current: Trail, piece: string): void {
  const id = current.steps.get(piece);
  if (!id) return;
  removeStep(current.requestId, id);
  current.steps.delete(piece);
}

/**
 * Lists what a change on the board moved, from `before` to `now`: each piece
 * that landed (see `landed`), and one back where it started comes off.
 */
function follow(current: Trail, before: StandState, now: StandState): void {
  for (const [stayId, place] of now.stays) {
    const from = current.start.stays.get(stayId);
    if (!from || samePlace(before.stays.get(stayId), place)) continue;
    if (samePlace(from, place)) {
      dropStep(current, stayId);
      continue;
    }
    putStep(current.requestId, {
      id: stepOf(current, stayId),
      stayId,
      title: stayLabel(stayId),
      detail: describeMove(from, place),
      move: { from, to: place },
      status: current.landed(from, place),
      needs: current.needs(from, place),
    });
  }
  if (!sameClosure(before.closure, now.closure)) {
    const area = now.closure ?? current.start.closure;
    if (sameClosure(current.start.closure, now.closure) || !area) dropStep(current, CLOSURE);
    else {
      putStep(current.requestId, {
        id: stepOf(current, CLOSURE),
        title: area.area,
        detail: describeClosure(now.closure),
        status: current.closed,
      });
    }
  }
}

function openTrail(title: string, actor: OutputActor, landed: Trail["landed"], needs: Trail["needs"], closed: OutputStatus): Trail {
  return { requestId: startRequest(title, actor), start: board, steps: new Map(), landed, needs, closed, done: false };
}

/** The run is over: what was taken hold of but never moved comes off, and so does the request if nothing is left on it. */
function closeTrail(current: Trail): void {
  if (current.done) return;
  current.done = true;
  for (const piece of [...current.steps.keys()]) {
    const unchanged =
      piece === CLOSURE
        ? sameClosure(current.start.closure, board.closure)
        : samePlace(current.start.stays.get(piece), board.stays.get(piece));
    if (unchanged) dropStep(current, piece);
  }
  finishRequest(current.requestId);
}

// Every change to the board is listed: the user's own, or Skye's while she
// works on a request, or the user's in one go (asUser) whoever else is at it.
const stopFollowing = subscribeAllocation(() => {
  const before = board;
  board = standState();
  // The plan moving on (a stay running late) is news, not anyone's change; nor
  // is Skye's being cancelled, which her requests show.
  if (planUpdating() || cancelling) return;
  const current = userTrail ?? skyeTrail;
  if (current) {
    follow(current, before, board);
    return;
  }
  // A change of the user's on its own: a drag, a swap.
  const own = openTrail(describeUserChange(before, board), "user", userLanded, userNeeds, "done");
  own.start = before;
  follow(own, before, board);
  closeTrail(own);
});
// A hot update would leave the old copy listening too.
if (import.meta.hot) import.meta.hot.dispose(stopFollowing);

/**
 * Lists what `work` changes on the board as one thing the user did, `title`:
 * resetting the stands. Inside another, it joins it.
 */
export function asUser<T>(title: string, work: () => T): T {
  if (userTrail) return work();
  const current = openTrail(title, "user", userLanded, userNeeds, "done");
  userTrail = current;
  try {
    return work();
  } finally {
    userTrail = null;
    closeTrail(current);
  }
}

/**
 * Skye's cursor (or one of its helpers) sets off to take hold of a stay and
 * drag it onto `toStand` ("" for the No stand lane), `shiftMs` along in time:
 * listed as being worked on, until it lands.
 */
export function skyeTakesHold(stayId: string, toStand: string, shiftMs = 0): void {
  const current = skyeTrail;
  const from = current?.start.stays.get(stayId);
  const now = board.stays.get(stayId);
  if (!current || !from || !now) return;
  // Where it is going says already whether baggage will have to see it.
  const to = { rowId: toStand, start: now.start + shiftMs, end: now.end + shiftMs };
  putStep(current.requestId, {
    id: stepOf(current, stayId),
    stayId,
    title: stayLabel(stayId),
    detail: describeMove(from, to),
    move: { from, to },
    status: "working",
    needs: current.needs(from, to),
  });
}

/** Lists the request Skye is starting: what changes on the board from here is hers. */
function startSkyeTrail(title: string): Trail {
  // One request at a time: a newer one takes what changes from here.
  if (skyeTrail) closeTrail(skyeTrail);
  skyeTrail = openTrail(title, "skye", skyeLanded, skyeNeeds, "waiting");
  return skyeTrail;
}

function endSkyeTrail(current: Trail): void {
  if (skyeTrail === current) skyeTrail = null;
  closeTrail(current);
}

/**
 * Starts watching the board for a change Skye is about to make. The function
 * it returns, called once she has made it, puts whatever changed on the board
 * in between up for approval (joining anything already waiting), and returns
 * what Skye says of the wait; null when nothing on the board changed.
 *
 * An `action` that changes the board is listed in the Outputs panel as Skye
 * starts it, with every piece she changes for it as she goes; taken off again
 * if it changed nothing.
 */
export function beginSkyeChange(action?: AppAction): () => ChangeWait | null {
  const start = standState();
  const title = action ? describeBoardAction(action) : null;
  const current = title ? startSkyeTrail(title) : null;
  return () => {
    if (current) endSkyeTrail(current);
    const end = standState();
    const next: Held = held ?? { before: new Map(), after: new Map(), steps: new Map() };
    let touched = false;
    for (const [id, was] of start.stays) {
      const now = end.stays.get(id);
      if (!now || samePlace(was, now)) continue;
      if (!next.before.has(id)) next.before.set(id, was);
      next.after.set(id, now);
      touched = true;
    }
    if (!sameClosure(start.closure, end.closure)) {
      if (next.closureBefore === undefined) next.closureBefore = start.closure;
      next.closureAfter = end.closure;
      touched = true;
    }
    if (!touched) return null;
    if (current) for (const [piece, id] of current.steps) next.steps.set(id, piece);
    hold(next);
    return review ? waitFor(review) : null;
  };
}

/** Whether everyone who has to approve before the user has. */
export const readyForUser = (current: SkyeReview): boolean =>
  current.signoffs.every((entry) => entry.state === "approved");

/** The user approves: what is waiting stays as it is. Only once everyone before them has. */
export function approveSkyeChanges(): boolean {
  if (!review || !readyForUser(review)) return false;
  clearTimers();
  if (held) {
    setStepStatus(held.steps.keys(), "done");
    const decision = decide(review, held);
    logDecision(held.steps.keys(), decision);
    for (const listener of [...approvalListeners]) listener(decision);
  }
  held = null;
  set(null);
  return true;
}

const approvalListeners = new Set<(decision: OutputDecision) => void>();

/** Told of each approval as it is logged, with what it decided. */
export function subscribeApprovals(listener: (decision: OutputDecision) => void): () => void {
  approvalListeners.add(listener);
  return () => approvalListeners.delete(listener);
}

/**
 * What approving decides, for the log: who approved (the teammates, then the
 * user), when each teammate did, and the board's headline figures (figuresOf).
 */
function decide(current: SkyeReview, waiting: Held): OutputDecision {
  return {
    at: Date.now(),
    by: [...current.signoffs.map((entry) => entry.name), "You"],
    signoffs: current.signoffs.map((entry) => ({ name: entry.name, at: entry.at ?? Date.now() })),
    figures: figuresOf(waiting),
  };
}

/**
 * The board's headline figures as they were before what is waiting and as
 * they are now, each with whether that is better.
 */
function figuresOf(waiting: Held): DecisionFigure[] {
  const now = standState();
  const stays = new Map(now.stays);
  for (const [id, was] of waiting.before) stays.set(id, was);
  const closure = waiting.closureBefore !== undefined ? waiting.closureBefore : now.closure;
  const [before, after] = [boardKpis({ stays, closure }), boardKpis(now)];
  const figure = (label: string, from: number, to: number, say: (value: number) => string, lowerIsBetter: boolean | null) => ({
    label,
    before: say(from),
    after: say(to),
    better: lowerIsBetter === null || from === to ? null : (to < from) === lowerIsBetter,
  });
  const percent = (share: number) => Math.round(share * 100);
  const hold = (minutes: number) => (minutes > 0 ? formatDuration(minutes) : "none");
  // Gate hold and conflicts only when there were or are some; stand use always.
  const figures = [
    (before.gateHoldMinutes || after.gateHoldMinutes) &&
      figure("Gate hold", before.gateHoldMinutes, after.gateHoldMinutes, hold, true),
    (before.conflicts.length || after.conflicts.length) &&
      figure("Conflicts", before.conflicts.length, after.conflicts.length, String, true),
    figure("Stand use", percent(before.standUse), percent(after.standUse), (value) => `${value}%`, null),
  ];
  return figures.filter((entry): entry is DecisionFigure => !!entry);
}

/**
 * Cancels what is waiting: each stay Skye changed goes back where it was, and
 * so does a closure she changed. One someone has changed again since is left
 * as they left it. Her pieces are marked undone, which is all the Outputs
 * panel shows of it; inside something else the user does (resetting the
 * stands), what it puts back is listed with that.
 */
export function undoSkyeChanges(): void {
  if (!held) return;
  if (userTrail) {
    undoHeld();
    return;
  }
  cancelling = true;
  try {
    undoHeld();
  } finally {
    cancelling = false;
  }
}

function undoHeld(): void {
  if (!held) return;
  const { before, after, closureBefore, closureAfter } = held;
  clearTimers();
  setStepStatus(held.steps.keys(), "undone");
  held = null;
  const now = standState().stays;
  const back = new Map<string, StayPlace>();
  for (const [id, left] of after) {
    const was = before.get(id);
    if (was && samePlace(now.get(id), left)) back.set(id, was);
  }
  const reopen = closureBefore !== undefined && sameClosure(currentClosure(), closureAfter ?? null);
  if (back.size > 0 || reopen) restoreStays(back, reopen ? closureBefore : undefined);
  set(null);
}
