// Scenario 1, disruption resolution (docs/disruption-demo.md): the late
// arrival arriving as news, the notice's words, Skye's plan for its knock-on,
// carrying it out, why it is what it is, baggage's part, and the approval
// logged with what it did. The tests run in order: the news arrives once.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { applyAppAction, validateAppAction, type AppAction } from "../src/live/appActions.ts";
import { decisionToRequest } from "../src/live/backendInterpreter.ts";
import { endGuestCall } from "../src/live/callGuests.ts";
import { DelegationExecutor } from "../src/live/executor.ts";
import { injectionByteLength, MAX_INJECTION_BYTES } from "../src/live/liveEvents.ts";
import { matchDisruptionRequest, phraseInterpreter, withDemoShortcuts, type RequestInterpreter } from "../src/live/requestInterpreter.ts";
import { TranscriptLog } from "../src/live/transcript.ts";
import { mergeSkyeNotes, postSkyeNote, skyeNotes } from "../src/components/ask-skye/skyeNotes.ts";
import { hasStandChanges, occupancyById, resetStands, standState } from "../src/operations/allocation.ts";
import { boardKpis } from "../src/operations/boardKpis.ts";
import {
  DISRUPTION,
  disruptionNotice,
  disruptionState,
  announceDisruption,
  dismissDisruptionNotice,
  explainPlan,
  handOffLine,
  headsUp,
  headsUpCue,
  landDisruption,
  markDisruptionRunning,
  planDisruption,
  settledLine,
  settleDisruption,
  teammateBrief,
  teammateBriefScript,
  teammateContext,
  teammateCue,
} from "../src/operations/disruption.ts";
import { DISRUPTION_TRIGGER, isDisruptionShortcut } from "../src/operations/disruptionTrigger.ts";
import { outputs } from "../src/operations/outputs.ts";
import {
  approveSkyeChanges,
  askForSignoffs,
  beginSkyeChange,
  SIGNOFF_MS,
  skyeReview,
  subscribeApprovals,
  undoSkyeChanges,
} from "../src/operations/skyeReview.ts";
import { createFakeHost, createScheduler } from "./support/mocks.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => {
  mock.timers.reset();
  endGuestCall();
});

const standOf = (stayId: string) => occupancyById(stayId)?.rowId;

/** A typed request through the executor, with the demo shortcuts and Skye's changes held for approval. */
function executor(inner: RequestInterpreter = phraseInterpreter) {
  const host = createFakeHost();
  host.beginChange = beginSkyeChange;
  const run = new DelegationExecutor({
    host,
    transcript: new TranscriptLog(),
    interpreter: withDemoShortcuts(inner),
    schedule: createScheduler().schedule,
    inject: () => undefined,
  });
  return { host, run };
}

test("by default the news arrives once Skye is connected; Ctrl+Alt+D lands it at once", () => {
  assert.deepEqual(DISRUPTION_TRIGGER.on, "connect");
  const key = (init: KeyboardEventInit) => ({ key: "d", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init }) as KeyboardEvent;
  assert.equal(isDisruptionShortcut(key({ ctrlKey: true, altKey: true })), true);
  assert.equal(isDisruptionShortcut(key({ ctrlKey: true, altKey: true, key: "D" })), true);
  assert.equal(isDisruptionShortcut(key({ ctrlKey: true })), false);
  assert.equal(isDisruptionShortcut(key({ ctrlKey: true, altKey: true, shiftKey: true })), false);
});

test("before the news, there is nothing to resolve or explain", () => {
  assert.equal(disruptionNotice(), null);
  assert.equal(headsUp(), null);
  assert.equal(matchDisruptionRequest("resolve the XD472 disruption"), null);
  const early = validateAppAction("resolve_disruption", {});
  assert.equal(early.ok === false && early.code, "not_late");
  assert.match(explainPlan(), /^There's no disruption on the board/);
  assert.equal(boardKpis(standState()).gateHoldMinutes, 0);
});

test("the news arrives once: XD472 runs late, its conflict shows, and nobody's change is listed", () => {
  const listedBefore = outputs().length;
  assert.equal(landDisruption(), true);
  assert.equal(landDisruption(), false);
  // On the board first; Skye tells the user a moment later, once.
  assert.equal(disruptionState().notice, "none");
  assert.equal(announceDisruption(), true);
  assert.equal(announceDisruption(), false);
  const state = disruptionState();
  assert.equal(state.notice, "shown");
  // The board as the news arrived is the baseline: 5 aircraft would wait 13h 15m for B11.
  assert.equal(state.baseline?.gateHoldMinutes, 795);
  assert.equal(state.baseline?.holds.length, 5);
  assert.equal(state.baseline?.conflicts.length, 1);
  // News, not a change: nothing to undo or list.
  assert.equal(hasStandChanges(), false);
  assert.equal(outputs().length, listedBefore);
  assert.equal(skyeReview(), null);
});

test("the notice says what happened, why, and what it runs into", () => {
  assert.deepEqual(disruptionNotice(), {
    title: "XD472 from London Heathrow is 1h 50m late",
    summary: "XD472 from LHR 1h 50m late",
    context:
      "XD472 was held at origin for a late inbound crew, who need their rest before taking it back out. Now due on B11 at 10:30, was 08:40.",
    conflict:
      "Its turn now runs to 14:50, into XC344/345 (11:50), XB232/233 (13:05), XA117/118 (13:55) and XC336/337 (14:45). " +
      "The knock-on holds 5 arrivals for 13h 15m in all.",
  });
});

test("the heads-up is short: the flight, where from, what it's doing, and an offer, the details left to the notice", () => {
  assert.equal(
    headsUp(),
    "Heads-up: XD472 from London Heathrow is running late and causing conflicts on the board. Want to take a look?",
  );
  // On a call she is steered, not scripted: told the news, asked to put it briefly in her own words, in that order.
  const cue = headsUpCue() ?? "";
  assert.match(cue, /^News just in: XD472 from London Heathrow is 1h 50m late/);
  assert.match(cue, /in your own words, one short casual sentence, in this order: the flight number, where it's from, then what it's doing/);
  assert.match(cue, /"XD472 from London Heathrow is running late and causing conflicts on the board"/);
  assert.match(cue, /Skip times and figures/);
  assert.doesNotMatch(cue, /14:50|13h 15m|XC344/);
  assert.ok(injectionByteLength(cue) <= MAX_INJECTION_BYTES);
});

test("Skye's plan moves what XD472 runs into, nearest stands first, and keeps XD472 on B11", () => {
  const plan = planDisruption();
  assert.equal(plan.stayId, DISRUPTION.stayId);
  // Four flights, each to a stand of its own.
  assert.deepEqual(
    plan.moves.map((move) => [move.occupancyId, move.fromStand, move.standId, move.shiftMs]),
    [
      // The B788 has no widebody stand free on Pier B, so it goes to Pier A.
      ["T25-1", "B11", "A3", 0],
      // The two narrowbodies stay on Pier B.
      ["T26-1", "B11", "B10", 0],
      ["T27-1", "B11", "B14", 0],
      // By then Pier B is full, so the E195 goes to Pier A too.
      ["T16-1", "B11", "A5", 0],
    ],
  );
  assert.deepEqual(plan.stuck, []);
  // What it looked at first, and why each would not do: Pier B, then out by row.
  assert.deepEqual(
    plan.considered.filter((entry) => entry.occupancyId === "T25-1").map((entry) => `${entry.standId}: ${entry.reason}`),
    [
      "B10: taken by XB216/217",
      "B12: taken by XD456/457",
      "B14: narrowbody only",
      "B15: taken by XB628/629",
      "B16: taken by XB636/637",
      "A6: taken by XD616/617",
      "A5: taken by XD608/609",
      "A4: narrowbody only",
    ],
  );
  assert.deepEqual(
    plan.considered.filter((entry) => entry.occupancyId === "T16-1").map((entry) => `${entry.standId}: ${entry.reason}`),
    [
      "B10: taken by XD458/459",
      "B12: taken by XD456/457",
      "B14: taken by XB234/235",
      "B15: taken by XB236/237",
      "B16: taken by XC346/347",
      "A6: taken by XA618/619",
    ],
  );
});

test("the Run request and the follow-up questions are understood the same way every time", async () => {
  assert.equal(matchDisruptionRequest("Resolve XD472's late arrival"), "resolve");
  assert.equal(matchDisruptionRequest("can you fix the late arrival"), "resolve");
  assert.equal(matchDisruptionRequest("deal with the knock-on on B11"), "resolve");
  assert.equal(matchDisruptionRequest("why not move XD472 instead?"), "explain");
  assert.equal(matchDisruptionRequest("what's the impact"), "explain");
  assert.equal(matchDisruptionRequest("select XA101"), null);
  // Ahead of the interpreter, which is never asked.
  let asked = 0;
  const inner: RequestInterpreter = {
    id: "never",
    interpret: () => {
      asked += 1;
      return Promise.resolve({ kind: "unclear", hint: "no" });
    },
  };
  const { run } = executor(inner);
  const interpreted = await withDemoShortcuts(inner).interpret({
    utterance: "Resolve XD472's late arrival",
    snapshot: createFakeHost().snapshot(),
    transcript: "",
    taskHistory: [],
  });
  assert.equal(interpreted.kind === "action" && interpreted.action.name, "resolve_disruption");
  assert.equal(asked, 0);
  run.dispose();
  // The model may choose it too, with or without the flight.
  const decided = decisionToRequest({ kind: "action", action_name: "resolve_disruption", args: { flightId: null } as never, reason: null, hint: null });
  assert.equal(decided.kind === "action" && decided.action.name === "resolve_disruption" && decided.action.flightId, DISRUPTION.flightId);
});

test("a yes to Skye's offer, however it's put, carries it out without asking the model", async () => {
  const offered = validateAppAction("resolve_disruption", {});
  assert.ok(offered.ok);
  const history = [{ utterance: "(Skye raised this herself)", action: null, outcome: "applied" as const, result: headsUp() ?? "", proposal: offered.action }];
  let asked = 0;
  const inner: RequestInterpreter = {
    id: "model",
    interpret: () => {
      asked += 1;
      return Promise.resolve({ kind: "unclear", hint: "asked the model" });
    },
  };
  const interpret = (utterance: string, taskHistory = history) =>
    withDemoShortcuts(inner).interpret({ utterance, snapshot: createFakeHost().snapshot(), transcript: "", taskHistory });
  for (const utterance of ["yes", "Yeah, let's work through it.", "sure", "go for it", "let's do it", "okay run it", "let's take a look", "show me"]) {
    const result = await interpret(utterance);
    assert.equal(result.kind === "action" && result.action.name, "resolve_disruption", utterance);
  }
  assert.equal(asked, 0);
  // Anything else, or a yes once she has moved on, is the model's to work out.
  await interpret("no, not yet");
  await interpret("yes", []);
  assert.equal(asked, 2);
});

test("Skye's heads-up is her offer: a yes carries out the plan", async () => {
  const { run, host } = executor();
  const offered = validateAppAction("resolve_disruption", {});
  assert.ok(offered.ok);
  run.offer(headsUp() ?? "", offered.action);
  const reply = await run.handleTypedRequest("yes, go ahead");
  assert.match(reply ?? "", /^Done: XD472\/473 keeps B11, and we've given the 4 flights behind it new stands\./);
  assert.equal(host.calls.at(-1), "applyFixes:4:0");
  undoSkyeChanges();
  assert.deepEqual(["T24-1", "T25-1", "T26-1", "T27-1", "T16-1"].map(standOf), ["B11", "B11", "B11", "B11", "B11"]);
  run.dispose();
});

test("Run: Skye clears the knock-on, says what it did to gate hold, and it waits for baggage, then you, in a few words", async () => {
  markDisruptionRunning();
  assert.equal(disruptionState().notice, "running");
  const { run } = executor();
  const reply = await run.handleTypedRequest("Resolve XD472's late arrival");
  // The moves are counted, not listed (they are on the board and in Outputs),
  // and the conflict's clearing goes unsaid, as gate hold says it.
  assert.equal(
    reply,
    "Done: XD472/473 keeps B11, and we've given the 4 flights behind it new stands. Gate hold is down from 13h 15m to none. " +
      "Baggage operations in Terminal A approves first, then you. Want me to call them?",
  );
  assert.deepEqual(["T24-1", "T25-1", "T26-1", "T27-1", "T16-1"].map(standOf), ["B11", "A3", "B10", "B14", "A5"]);
  assert.equal(boardKpis(standState()).gateHoldMinutes, 0);
  // Listed under the request, the moves to Pier A waiting on baggage.
  const [request] = outputs();
  assert.equal(request.title, "Clear XD472/473's knock-on");
  assert.deepEqual(
    request.steps.map((step) => [step.title, step.detail, step.status]),
    [
      ["XC336/337", "B11 → A5", "pending-approval"],
      ["XA117/118", "B11 → B14", "waiting"],
      ["XB232/233", "B11 → B10", "waiting"],
      ["XC344/345", "B11 → A3", "pending-approval"],
    ],
  );
  run.dispose();
});

test("asked why, Skye says why XD472 keeps its stand and what the plan does to the figures", () => {
  const validated = validateAppAction("explain_plan");
  assert.ok(validated.ok);
  const result = applyAppAction(validated.action, createFakeHost());
  assert.ok(result.ok && !result.mutated);
  assert.equal(
    result.spoken,
    "XD472/473 keeps B11: it's already inbound, with its passengers and bags headed there, and moving a widebody mid-turn means a tow. " +
      "The arrivals behind it haven't landed yet, so moving them costs nothing on the ground. " +
      "So XC344/345 moves from B11 to A3, XB232/233 moves from B11 to B10, XA117/118 moves from B11 to B14 and XC336/337 moves from B11 to A5. " +
      "Gate hold goes from 13h 15m to none: 5 aircraft no longer wait for a stand. " +
      "Stand use goes from 49% to 50%, using free time on A3, B10, B14 and A5.",
  );
});

test("with others on the call, Skye greets them all and says which part is Travis's", () => {
  const review = skyeReview();
  assert.ok(review);
  const brief = teammateBrief("Travis Hughes", review.changes, ["Travis Hughes", "Priya Raman"]);
  assert.match(brief, /^Hi Travis and Priya\. /);
  assert.match(brief, / Travis, for you: XC344\/345 moves from B11 to A3/);
  assert.match(
    teammateBrief("Travis Hughes", review.changes, ["Travis Hughes", "Priya Raman", "Marcus Chen"]),
    /^Hi everyone\. /,
  );
});

test("Travis is briefed on his part: the moves that take bags to another pier", () => {
  const review = skyeReview();
  assert.ok(review);
  assert.equal(
    teammateBrief("Travis Hughes", review.changes),
    "Hey Travis. XD472 is 1h 50m late on B11, so we've re-planned the arrivals behind it. " +
      "For you: XC344/345 moves from B11 to A3, 11:50–12:55, so its bags go to Pier A instead of Pier B. " +
      "And XC336/337 moves from B11 to A5, 14:45–15:30, so its bags go to Pier A instead of Pier B. " +
      "The other 2 moves stay on the same pier, so nothing changes for bags there. Can you approve?",
  );
});

test("her brief says where she comes to each change, stand and what it does to the bags, for her cursor", () => {
  const review = skyeReview();
  assert.ok(review);
  const { text, beats } = teammateBriefScript("Travis Hughes", review.changes);
  assert.equal(text, teammateBrief("Travis Hughes", review.changes));
  // Each beat, with the words it starts at.
  assert.deepEqual(
    beats.map((beat) => [beat.kind, "end" in beat ? beat.end : "", text.slice(beat.at, beat.at + 12)]),
    [
      ["look", "", "Hey Travis. "],
      ["card", "", "XC344/345 mo"],
      ["stand", "from", "from B11 to "],
      ["stand", "to", "to A3, 11:50"],
      ["bags", "", "so its bags "],
      ["card", "", "XC336/337 mo"],
      ["stand", "from", "from B11 to "],
      ["stand", "to", "to A5, 14:45"],
      ["bags", "", "so its bags "],
      ["others", "", "The other 2 "],
      ["ask", "", "Can you appr"],
    ],
  );
  const others = beats.find((beat) => beat.kind === "others");
  assert.deepEqual(others && "stayIds" in others ? others.stayIds.length : 0, 2);
  // What she says that marks each, however she puts the rest: the flight, each stand, the bags, her ask.
  assert.deepEqual(
    beats.map((beat) => beat.words?.[0]),
    [undefined, "XC344", "B11", "A3", "bags", "XC336", "B11", "A5", "bags", "other", "approve"],
  );
});

test("answering aloud, Travis is cued to approve at an ordinary pace, then a plain thanks, knowing what he approves without reading it out; she thanks him, and then it's the user's", () => {
  const review = skyeReview();
  assert.ok(review);
  const cue = teammateCue();
  assert.equal(
    cue,
    "Skye just asked you to approve. Answer her now, out loud, in your own words, friendly and at an ordinary " +
      "pace, with no long pauses: the carousels can take it; it's approved for baggage; then a " +
      'plain "Thanks.", naming nobody, and "Let me know if you need anything else."',
  );
  // Nothing in it asks him to slow down or leave gaps.
  assert.doesNotMatch(cue, /unhurried|pause after/);
  assert.doesNotMatch(cue, /gotta hop/);
  assert.ok(injectionByteLength(cue) <= MAX_INJECTION_BYTES);
  const context = teammateContext(review.changes);
  assert.equal(
    context,
    "What Skye asked you to approve: XC344/345's bags going to Pier A instead of Pier B and XC336/337's bags going to Pier A instead of Pier B.",
  );
  assert.ok(injectionByteLength(context ?? "") <= MAX_INJECTION_BYTES);
  assert.equal(teammateContext(review.changes.filter((change) => !change.baggage)), null);
  assert.equal(handOffLine("Travis Hughes", true), "Thanks, Travis! That's approved for baggage, so it's over to you.");
  assert.equal(handOffLine("Travis Hughes", false), "Thanks, Travis!");
});

test("approved, the decision is logged with its figures, and the notice shows the result", () => {
  const decisions: unknown[] = [];
  const stop = subscribeApprovals((decision) => {
    decisions.push(decision);
    assert.equal(settleDisruption(decision), true);
  });
  assert.equal(approveSkyeChanges(), false);
  assert.equal(askForSignoffs(), true);
  mock.timers.tick(SIGNOFF_MS);
  assert.equal(approveSkyeChanges(), true);
  stop();

  assert.equal(decisions.length, 1);
  const [request] = outputs();
  assert.deepEqual(request.decision?.by, ["Travis Hughes", "You"]);
  assert.deepEqual(
    request.decision?.figures.map((figure) => [figure.label, figure.before, figure.after, figure.better]),
    [
      ["Gate hold", "13h 15m", "none", true],
      ["Conflicts", "1", "0", true],
      ["Stand use", "49%", "50%", null],
    ],
  );
  const state = disruptionState();
  assert.equal(state.notice, "approved");
  assert.deepEqual(state.approved?.impact.gateHold, { before: 795, after: 0 });
  // In a line: the moves are on the board.
  assert.equal(settledLine(), "That's approved and logged. Gate hold is down from 13h 15m to none, with no conflicts left.");
  // Reset stands keeps the news: XD472 is still late, and its conflict comes back.
  resetStands();
  assert.equal(boardKpis(standState()).gateHoldMinutes, 795);
  dismissDisruptionNotice();
  assert.equal(disruptionState().notice, "approved");
});

test("what Skye says unasked joins the chat once, and keeps its place when a reply settling drops it", () => {
  postSkyeNote("**Heads-up:** XD472 is late.");
  const [note] = skyeNotes().slice(-1);
  const hello = { id: "a", role: "user" as const, content: "hi" };
  const merged = mergeSkyeNotes([hello], [note]);
  assert.deepEqual(merged.at(-1), { id: note.id, role: "assistant", content: "**Heads-up:** XD472 is late." });
  assert.equal(mergeSkyeNotes(merged, [note]), merged);
  // Coral settles a typed reply with the list it sent, without the note: it goes back after "hi", not at the end.
  const settled = [hello, { id: "b", role: "user" as const, content: "resolve it" }, { id: "c", role: "assistant" as const, content: "Done." }];
  assert.deepEqual(mergeSkyeNotes(settled, [note]).map((message) => message.id), ["a", note.id, "b", "c"]);
  // Its message gone too: at the end.
  assert.deepEqual(mergeSkyeNotes(settled.slice(1), [note]).map((message) => message.id), ["b", "c", note.id]);
});

test("the plan can still be undone: the stays go back and XD472 holds up B11 again", () => {
  const resolve: AppAction | undefined = (() => {
    const validated = validateAppAction("resolve_disruption", {});
    return validated.ok ? validated.action : undefined;
  })();
  assert.ok(resolve);
  const finish = beginSkyeChange(resolve);
  assert.ok(applyAppAction(resolve, createFakeHost()).ok);
  finish();
  assert.equal(boardKpis(standState()).gateHoldMinutes, 0);
  undoSkyeChanges();
  assert.deepEqual(["T25-1", "T26-1", "T27-1", "T16-1"].map(standOf), ["B11", "B11", "B11", "B11"]);
  assert.equal(boardKpis(standState()).gateHoldMinutes, 795);
});
