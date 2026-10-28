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
import { matchDisruptionRequest, phraseInterpreter, withDemoShortcuts, type RequestInterpreter } from "../src/live/requestInterpreter.ts";
import { TranscriptLog } from "../src/live/transcript.ts";
import { mergeSkyeNotes, postSkyeNote, skyeNotes } from "../src/components/ask-skye/skyeNotes.ts";
import { hasStandChanges, occupancyById, resetStands, standState } from "../src/operations/allocation.ts";
import { boardKpis } from "../src/operations/boardKpis.ts";
import {
  DISRUPTION,
  disruptionNotice,
  disruptionState,
  dismissDisruptionNotice,
  explainPlan,
  headsUp,
  landDisruption,
  markDisruptionRunning,
  planDisruption,
  settledLine,
  settleDisruption,
  teammateBrief,
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
  const state = disruptionState();
  assert.equal(state.notice, "shown");
  // The board as the news arrived is the baseline: 4 aircraft would wait 5h 45m for B11.
  assert.equal(state.baseline?.gateHoldMinutes, 345);
  assert.equal(state.baseline?.holds.length, 4);
  assert.equal(state.baseline?.conflicts.length, 1);
  // News, not a change: nothing to undo or list.
  assert.equal(hasStandChanges(), false);
  assert.equal(outputs().length, listedBefore);
  assert.equal(skyeReview(), null);
});

test("the notice says what happened, why, what it runs into, and what is needed", () => {
  assert.deepEqual(disruptionNotice(), {
    title: "XD472 from London Heathrow is 1h 50m late",
    context: "Held at origin for a late inbound crew. Now due on B11 at 10:30, was 08:40.",
    conflict:
      "Its turn now runs to 13:30, into XC344/345 (11:50) and XB232/233 (13:05). The knock-on holds 4 arrivals for 5h 45m in all.",
    action: "Re-plan B11 before XC344 is due at 11:50.",
  });
  assert.match(headsUp() ?? "", /^Heads-up: XD472 from London Heathrow is 1h 50m late\. .* Want me to work it\?$/);
});

test("Skye's plan moves what XD472 runs into, nearest stands first, and keeps XD472 on B11", () => {
  const plan = planDisruption();
  assert.equal(plan.stayId, DISRUPTION.stayId);
  assert.deepEqual(
    plan.moves.map((move) => [move.occupancyId, move.fromStand, move.standId, move.shiftMs]),
    [
      // The B788 has no widebody stand free on Pier B, so it goes to Pier A.
      ["T25-1", "B11", "A3", 0],
      // The narrowbody stays on Pier B.
      ["T26-1", "B11", "B10", 0],
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

test("Skye's heads-up is her offer: a yes carries out the plan", async () => {
  const { run, host } = executor();
  const offered = validateAppAction("resolve_disruption", {});
  assert.ok(offered.ok);
  run.offer(headsUp() ?? "", offered.action);
  const reply = await run.handleTypedRequest("yes, go ahead");
  assert.match(reply ?? "", /^Done: XD472\/473 keeps B11, and I moved XC344\/345 to A3 and XB232\/233 to B10\./);
  assert.equal(host.calls.at(-1), "applyFixes:2:0");
  undoSkyeChanges();
  assert.deepEqual(["T24-1", "T25-1", "T26-1"].map(standOf), ["B11", "B11", "B11"]);
  run.dispose();
});

test("Run: Skye clears the knock-on, says what it did to gate hold, and it waits for baggage, then you", async () => {
  markDisruptionRunning();
  assert.equal(disruptionState().notice, "running");
  const { run } = executor();
  const reply = await run.handleTypedRequest("Resolve XD472's late arrival");
  assert.equal(
    reply,
    "Done: XD472/473 keeps B11, and I moved XC344/345 to A3 and XB232/233 to B10. Gate hold goes from 5h 45m to none. " +
      "That clears the B11 conflict. It's waiting for approval: Travis Hughes for baggage operations first, then you. " +
      "Want me to give Travis a call?",
  );
  assert.deepEqual(["T24-1", "T25-1", "T26-1"].map(standOf), ["B11", "A3", "B10"]);
  assert.equal(boardKpis(standState()).gateHoldMinutes, 0);
  // Listed under the request, the move to Pier A waiting on baggage.
  const [request] = outputs();
  assert.equal(request.title, "Clear XD472/473's knock-on");
  assert.deepEqual(
    request.steps.map((step) => [step.title, step.detail, step.status]),
    [
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
      "So XC344/345 moves from B11 to A3 and XB232/233 moves from B11 to B10. " +
      "Gate hold goes from 5h 45m to none: 4 aircraft no longer wait for a stand. " +
      "Stand use goes from 47% to 48%, using free time on A3 and B10.",
  );
});

test("Travis is briefed on his part: the move that takes bags to another pier", () => {
  const review = skyeReview();
  assert.ok(review);
  assert.equal(
    teammateBrief("Travis Hughes", review.changes),
    "Travis, it's Skye. XD472 is 1h 50m late on B11, so I've re-planned the arrivals behind it. " +
      "For you: XC344/345 moves from B11 to A3, 11:50–12:55, so its bags go to Pier A instead of Pier B. " +
      "The other move stays on the same pier, so nothing changes for bags there. Can you approve?",
  );
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
      ["Gate hold", "5h 45m", "none", true],
      ["Conflicts", "1", "0", true],
      ["Stand use", "47%", "48%", null],
    ],
  );
  const state = disruptionState();
  assert.equal(state.notice, "approved");
  assert.deepEqual(state.approved?.impact.gateHold, { before: 345, after: 0 });
  assert.equal(
    settledLine(),
    "That's approved and logged. Gate hold is down from 5h 45m to none, with no conflicts left. " +
      "XC344/345 on A3 and XB232/233 on B10, and XD472/473 keeps B11.",
  );
  // Reset stands keeps the news: XD472 is still late, and its conflict comes back.
  resetStands();
  assert.equal(boardKpis(standState()).gateHoldMinutes, 345);
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
  assert.deepEqual(["T25-1", "T26-1"].map(standOf), ["B11", "B11"]);
  assert.equal(boardKpis(standState()).gateHoldMinutes, 345);
});
