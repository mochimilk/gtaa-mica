// The Chat page's conversations: Skye first, then each area's channels and
// teammate; what is unread and when it is read; reactions and replies; going
// back to whoever was called as the call ends; a review's call going to the
// channel for the terminal its bags land in; and Skye asking there as the
// call goes out, and Travis answering there once he approves.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { AppAction } from "../src/live/appActions.ts";
import { ANSWER_MS, endGuestCall, inviteToCall } from "../src/live/callGuests.ts";
import { applyPlan, resetStands } from "../src/operations/allocation.ts";
import { clearOutputs } from "../src/operations/outputs.ts";
import { beginSkyeChange, SIGNOFF_MS, undoSkyeChanges } from "../src/operations/skyeReview.ts";
import { terminalOf } from "../src/operations/terminals.ts";
import {
  callFrom,
  chatState,
  isTyping,
  latestPost,
  markRead,
  ME,
  openThread,
  postMessage,
  SECTIONS,
  SKYE,
  SKYE_THREAD,
  startTyping,
  threadPosts,
  THREADS,
  toggleReaction,
  unreadCount,
  unreadThreads,
} from "../src/chat/chatThreads.ts";

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  clearOutputs();
});
afterEach(() => {
  undoSkyeChanges();
  resetStands();
  endGuestCall();
  mock.timers.reset();
  clearOutputs();
  for (const thread of THREADS) markRead(thread.id, posts(thread.id).at(-1)?.at ?? 0);
  openThread(SKYE_THREAD.id);
});

const moveStay = (flightId: string, standId: string): AppAction => ({ name: "move_stay", flightId, standId });
const move = (occupancyId: string, standId: string) => applyPlan({ kind: "move", occupancyId, standId });

function asSkye(action: AppAction, change: () => void): void {
  const finish = beginSkyeChange(action);
  change();
  finish();
}

const posts = (threadId: string) => threadPosts(chatState(), threadId);
const [baggageChannel, baggageTerminalB, travis] = SECTIONS[0].threads;

test("Skye comes first, then each area's channels by sector, then its lead's and crew's chats, all read at the start", () => {
  assert.equal(THREADS[0], SKYE_THREAD);
  assert.deepEqual(
    SECTIONS.map((section) => [section.label, section.threads.map((thread) => [thread.kind, thread.name, thread.sector])]),
    [
      [
        "Baggage ops",
        [
          ["channel", "Baggage control A", "Terminal A"],
          ["channel", "Baggage control B", "Terminal B"],
          ["person", "Travis Hughes", undefined],
          ["person", "Dana Kowalski", undefined],
          ["person", "Mateo Silva", undefined],
        ],
      ],
      [
        "Gate ops",
        [
          ["channel", "Gate allocation B", "Terminal B"],
          ["person", "Priya Raman", undefined],
          ["person", "Hannah Lee", undefined],
        ],
      ],
      [
        "Ramp ops",
        [
          ["channel", "Ramp leads A/B", "Piers A and B"],
          ["person", "Marcus Chen", undefined],
          ["person", "Kofi Mensah", undefined],
          ["person", "Ines Duarte", undefined],
        ],
      ],
      [
        "Apron control",
        [
          ["channel", "Apron tower West", "West apron"],
          ["person", "Aisha Okafor", undefined],
          ["person", "Sofia Reyes", undefined],
        ],
      ],
    ],
  );
  assert.equal(unreadThreads(chatState()), 0);
});

test("someone else's post is unread until the thread is read; the user's own never are", () => {
  postMessage(travis.id, ME, "On my way.");
  assert.equal(unreadCount(chatState(), travis.id), 0);
  postMessage(travis.id, "Travis Hughes", "Thanks.");
  assert.equal(unreadCount(chatState(), travis.id), 1);
  assert.equal(unreadThreads(chatState()), 1);
  markRead(travis.id, posts(travis.id).at(-1)!.at);
  assert.equal(unreadThreads(chatState()), 0);
});

test("Skye shows as typing while each reply she is writing is under way", () => {
  const first = startTyping(SKYE_THREAD.id);
  const second = startTyping(SKYE_THREAD.id);
  first();
  first();
  assert.equal(isTyping(chatState(), SKYE_THREAD.id), true);
  second();
  assert.equal(isTyping(chatState(), SKYE_THREAD.id), false);
});

test("as a call with someone called in ends, the chat with them opens, wherever the user went meanwhile", () => {
  inviteToCall("Travis Hughes");
  openThread(SECTIONS[1].threads[1].id);
  endGuestCall();
  assert.equal(chatState().open, travis.id);
  assert.equal(chatState().returnTo, null);
});

test("a call placed from a channel goes back to the channel", () => {
  callFrom(baggageChannel.id);
  inviteToCall("Travis Hughes");
  mock.timers.tick(ANSWER_MS);
  openThread(SKYE_THREAD.id);
  endGuestCall();
  assert.equal(chatState().open, baggageChannel.id);
});

test("stands are in terminals: Piers A and B in Terminal A; C, D and the remote stands in Terminal B", () => {
  assert.deepEqual(["A3", "B11", "C25", "D43", "R1", ""].map(terminalOf), [
    "Terminal A",
    "Terminal A",
    "Terminal B",
    "Terminal B",
    "Terminal B",
    undefined,
  ]);
});

test("calling Travis in on a change goes to Baggage control for the terminal its bags land in, and back there after", () => {
  // A1 to C25: the bags now come off in Terminal B.
  asSkye(moveStay("T01-ARR", "C25"), () => move("T01-1", "C25"));
  inviteToCall("Travis Hughes");
  assert.equal(chatState().returnTo, baggageTerminalB.id);
  openThread(travis.id);
  endGuestCall();
  assert.equal(chatState().open, baggageTerminalB.id);
});

test("Skye asks in the channel, to nobody by name, as the call goes out, and Travis answers there once he approves", () => {
  const before = posts(baggageTerminalB.id).length;
  const terminalA = posts(baggageChannel.id).length;
  asSkye(moveStay("T01-ARR", "C25"), () => move("T01-1", "C25"));
  inviteToCall("Travis Hughes");
  const ask = [[SKYE, "Hey, one of our stand changes moves bags. Could anyone check the carousels before they're approved?"]];
  assert.deepEqual(posts(baggageTerminalB.id).slice(before).map((post) => [post.author, post.text]), ask);
  // Picking up asks him on the call; the channel was asked already.
  mock.timers.tick(ANSWER_MS);
  assert.deepEqual(posts(baggageTerminalB.id).slice(before).map((post) => [post.author, post.text]), ask);
  mock.timers.tick(SIGNOFF_MS);
  assert.equal(posts(baggageTerminalB.id).at(-1)?.author, "Travis Hughes");
  assert.equal(posts(baggageTerminalB.id).length, before + 2);
  // Terminal A's channel was not asked: the bags land in Terminal B.
  assert.equal(posts(baggageChannel.id).length, terminalA);
});

test("reacting adds the user to an emoji's reactions, again takes them off, and the last one off drops it", () => {
  postMessage(travis.id, "Travis Hughes", "Bags are on 4.");
  const id = posts(travis.id).at(-1)!.id;
  toggleReaction(travis.id, id, "👍", SKYE);
  toggleReaction(travis.id, id, "👍");
  assert.deepEqual(posts(travis.id).at(-1)?.reactions, { "👍": [SKYE, ME] });
  toggleReaction(travis.id, id, "👍");
  toggleReaction(travis.id, id, "👍", SKYE);
  assert.deepEqual(posts(travis.id).at(-1)?.reactions, {});
});

test("a reply carries the post it answers", () => {
  const answered = posts(travis.id).at(-1)!;
  postMessage(travis.id, ME, "Thanks.", { id: answered.id, author: answered.author, text: answered.text });
  assert.deepEqual(posts(travis.id).at(-1)?.replyTo, { id: answered.id, author: answered.author, text: answered.text });
});

test("a chat shows its latest post, on one line: the user's as theirs, and a channel's after who wrote it", () => {
  postMessage(travis.id, "Travis Hughes", "Carousel 4\nis back.");
  assert.equal(latestPost(chatState(), travis.id), "Carousel 4 is back.");
  postMessage(travis.id, ME, "Thanks.");
  assert.equal(latestPost(chatState(), travis.id), "You: Thanks.");
  // A channel's, after who wrote it.
  postMessage(baggageChannel.id, "Travis Hughes", "Belts are fine.");
  assert.equal(latestPost(chatState(), baggageChannel.id), "Travis: Belts are fine.");
});
