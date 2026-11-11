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
import { activity } from "../src/operations/activity.ts";
import { bagMove, carouselOutages, describeBagMove, describeMaintenanceClash, describeMaintenanceImpact, maintenanceMove } from "../src/operations/baggage.ts";
import { approvalEntries, approvalStatus, reviewSteps } from "../src/approvals/approvalList.ts";
import { boardKpis } from "../src/operations/boardKpis.ts";
import {
  DISRUPTION,
  disruptionNotice,
  disruptionState,
  announceDisruption,
  appliedSummary,
  dismissDisruptionNotice,
  disruptionTask,
  explainPlan,
  handOffLine,
  headsUp,
  headsUpCue,
  landDisruption,
  markDisruptionRunning,
  planDisruption,
  reviewAgenda,
  settledLine,
  settleDisruption,
  teammateBrief,
  teammateBriefScript,
  teammateContext,
  teammateCue,
  teammateCueEnded,
  teammateGoodbyeCue,
  teammateGoodbyeEnded,
  teammateFollowUp,
  teammateQuestionCue,
  teammateQuestionEnded,
} from "../src/operations/disruption.ts";
import { DISRUPTION_TRIGGER, isDisruptionShortcut } from "../src/operations/disruptionTrigger.ts";
import { advanceGoldenPath, isNextBeatKey, nextGoldenBeat } from "../src/operations/goldenPath.ts";
import { outputs } from "../src/operations/outputs.ts";
import {
  approveSkyeChanges,
  askForSignoffs,
  beginSkyeChange,
  setSignoffExchange,
  setSignoffStage,
  SIGNOFF_MS,
  skyeReview,
  subscribeApprovals,
  undoSkyeChanges,
} from "../src/operations/skyeReview.ts";
import { DEMO_DATA, formatUtc } from "../src/stand-timeline-demo/demoData.ts";
import { SAY_INSTRUCTIONS } from "../src/live/callController.ts";
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

test("by default the news arrives when the presenter cues it; Ctrl+Alt+D lands it at once", () => {
  assert.deepEqual(DISRUPTION_TRIGGER.on, "manual");
  const key = (init: KeyboardEventInit) => ({ key: "d", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init }) as KeyboardEvent;
  assert.equal(isDisruptionShortcut(key({ ctrlKey: true, altKey: true })), true);
  assert.equal(isDisruptionShortcut(key({ ctrlKey: true, altKey: true, key: "D" })), true);
  assert.equal(isDisruptionShortcut(key({ ctrlKey: true })), false);
  assert.equal(isDisruptionShortcut(key({ ctrlKey: true, altKey: true, shiftKey: true })), false);
  // The presenter's "next": Ctrl+Alt+N, or a clicker's PageDown, and nothing else.
  assert.equal(isNextBeatKey(key({ key: "n", ctrlKey: true, altKey: true })), true);
  assert.equal(isNextBeatKey(key({ key: "PageDown" })), true);
  assert.equal(isNextBeatKey(key({ key: "PageDown", shiftKey: true })), false);
  assert.equal(isNextBeatKey(key({ key: "n", ctrlKey: true })), false);
  assert.equal(isNextBeatKey(key({ key: "ArrowDown" })), false);
});

test("before the news, there is nothing to resolve or explain", () => {
  assert.equal(disruptionNotice(), null);
  assert.equal(headsUp(), null);
  assert.equal(matchDisruptionRequest("resolve the XD472 disruption"), null);
  const early = validateAppAction("resolve_disruption", {});
  assert.equal(early.ok === false && early.code, "not_late");
  assert.match(explainPlan(), /^There's no disruption on the board/);
  assert.equal(boardKpis(standState()).gateHoldMinutes, 0);
  // The presenter's first step: cue the news.
  assert.equal(nextGoldenBeat(), "news");
});

test("the news arrives once: XD472 runs late, its conflict shows, and nobody's change is listed", () => {
  const listedBefore = outputs().length;
  assert.equal(landDisruption(), true);
  assert.equal(landDisruption(), false);
  // On the board first; Skye tells the user a moment later, once. Until she
  // does, it is her turn: the presenter's "next" waits for her.
  assert.equal(disruptionState().notice, "none");
  assert.equal(nextGoldenBeat(), null);
  assert.equal(announceDisruption(), true);
  assert.equal(announceDisruption(), false);
  const state = disruptionState();
  assert.equal(state.notice, "shown");
  assert.equal(nextGoldenBeat(), "review");
  // The board as the news arrived is the baseline: 5 aircraft would wait 6h 35m for B11.
  assert.equal(state.baseline?.gateHoldMinutes, 395);
  assert.equal(state.baseline?.holds.length, 5);
  assert.equal(state.baseline?.conflicts.length, 1);
  // News, not a change: nothing to undo or list.
  assert.equal(hasStandChanges(), false);
  assert.equal(outputs().length, listedBefore);
  assert.equal(skyeReview(), null);
});

test("the notice says what happened, why, when it now leaves, and what it runs into, in a few short lines", () => {
  const words = disruptionNotice();
  assert.equal(words?.title, "XD472 from London Heathrow is 1h 50m late");
  assert.equal(words?.summary, "XD472 from LHR 1h 50m late");
  assert.equal(words?.context, "XD472 was held at origin for a late inbound crew. Now due on B11 at 10:30, was 08:40.");
  assert.equal(words?.turn, "XD473 now leaves at 13:30, was 11:40.");
  // Two it runs into, by name; the knock-on counted, as the table below names them.
  assert.equal(
    words?.conflict,
    "That runs into XC344/345 (11:50) and XB232/233 (13:05), and the knock-on holds 3 more. 5 aircraft would wait 6h 35m in all.",
  );
});

test("what the notice says agrees with what the chart draws: the same times, and every aircraft it counts is named", () => {
  const stay = occupancyById(DISRUPTION.stayId);
  assert.ok(stay);
  const late = DEMO_DATA.delays.get(stay.id);
  // The bar and its ghosts: on at 10:30, off at 13:30.
  assert.equal(formatUtc(stay.start), "10:30");
  assert.equal(formatUtc(stay.end + (late?.out ?? 0)), "13:30");
  assert.equal(formatUtc(stay.start - (late?.in ?? 0)), "08:40");
  const words = disruptionNotice();
  const kpis = boardKpis(standState());
  // Every aircraft it counts is in its table.
  assert.equal(words?.segments.length, kpis.holds.length + 1);
  const named = words?.segments.map((segment) => segment.stayId);
  for (const hold of kpis.holds) assert.ok(named?.includes(hold.stayId), hold.label);
});

test("every segment on B11 has its flights, its hours and its part in it", () => {
  assert.deepEqual(
    disruptionNotice()?.segments.map(({ name, times, purpose, late }) => [name, times, purpose, late]),
    [
      ["XD472/473", "10:30–13:30", "Late turn, was 08:40–11:40", true],
      ["XC344/345", "11:50–12:55", "Blocked, would wait 1h 40m", false],
      ["XB232/233", "13:05–13:45", "Blocked, would wait 1h 30m", false],
      ["XA117/118", "13:55–14:35", "Knock-on, would wait 1h 20m", false],
      ["XC336/337", "14:45–15:30", "Knock-on, would wait 1h 10m", false],
      ["XA109/110", "15:45–16:50", "Knock-on, would wait 55m", false],
    ],
  );
});

test("what she is on is pinned in the dock from as she brings it up, whoever brought it up, until its result is put away", () => {
  assert.equal(disruptionState().notice, "shown");
  assert.equal(disruptionTask(), "XD472/473 · 1h 50m late");
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
  // Two flights, each to a stand of its own: the two its turn runs into. The
  // three after them only waited in turn, so they need nothing.
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
  // The nearest stand on its own pier is free for the narrowbody: nothing tried first.
  assert.deepEqual(plan.considered.filter((entry) => entry.occupancyId === "T26-1"), []);
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
  assert.match(reply ?? "", /^Done: XD472\/473 keeps B11 and 2 flights move, /);
  assert.equal(host.calls.at(-1), "applyFixes:2:0");
  undoSkyeChanges();
  assert.deepEqual(["T24-1", "T25-1", "T26-1", "T27-1", "T16-1"].map(standOf), ["B11", "B11", "B11", "B11", "B11"]);
  run.dispose();
});

test("Run: Skye clears the knock-on, says what it did to gate hold, and it waits for baggage, then you, in a few words", async () => {
  markDisruptionRunning();
  assert.equal(disruptionState().notice, "running");
  const { run } = executor();
  const reply = await run.handleTypedRequest("Resolve XD472's late arrival");
  // One sentence: the moves are counted, not listed (they are on the board and
  // in Outputs), and the conflict's clearing goes unsaid, as gate hold says it.
  assert.equal(
    reply,
    "Done: XD472/473 keeps B11 and 2 flights move, so gate hold is down from 6h 35m to none. " +
      "Baggage operations in Terminal A approves first, then you. Want me to call them?",
  );
  // Only what it runs into moves; the knock-on behind them stays put, now clear.
  assert.deepEqual(["T24-1", "T25-1", "T26-1", "T27-1", "T16-1"].map(standOf), ["B11", "A3", "B10", "B11", "B11"]);
  assert.equal(boardKpis(standState()).gateHoldMinutes, 0);
  // Listed under the request, the move to Pier A waiting on baggage.
  const [request] = outputs();
  assert.equal(request.title, "Clear XD472/473's knock-on");
  assert.deepEqual(
    request.steps.map((step) => [step.title, step.detail, step.status]),
    [
      ["Carousel 2", "→ 12:45–14:15", "pending-approval"],
      ["XB232/233", "B11 → B10", "waiting"],
      ["XC344/345", "B11 → A3", "pending-approval"],
    ],
  );
  // Skye has done her part: the user's next step is to bring baggage in.
  assert.equal(nextGoldenBeat(), "call");
  run.dispose();
});

test("each change's bags are tied to it: its flight, its carousel before and after, how many and when", () => {
  const review = skyeReview();
  assert.ok(review);
  const delta = review.changes.map((change) => {
    const move = bagMove(change.stayId, change.from, change.to);
    return [change.stayId, change.baggage, move?.was?.carousel, move?.now?.carousel, move?.now?.flight, move?.now?.bags];
  });
  assert.deepEqual(delta, [
    ["T25-1", true, "4", "2", "XC344", 239],
    ["T26-1", false, "5", "5", "XB232", 146],
  ]);
});

test("Skye moves carousel 2's belt maintenance to make room for XC344's bags, as one more thing for baggage to approve", () => {
  const review = skyeReview();
  const maintenance = review?.maintenance;
  assert.ok(maintenance);
  assert.equal(maintenanceMove(), maintenance);
  // Same length, on until its bags are off and the belt has cleared.
  assert.deepEqual(
    [maintenance.carousel, formatUtc(maintenance.from.start), formatUtc(maintenance.from.end), formatUtc(maintenance.to.start), formatUtc(maintenance.to.end)],
    ["2", "12:00", "13:30", "12:45", "14:15"],
  );
  assert.equal(maintenance.to.end - maintenance.to.start, maintenance.from.end - maintenance.from.start);
  // What it clears, and what is next there, which it stays clear of.
  assert.equal(maintenance.instead, "1");
  assert.deepEqual(maintenance.resolves.map((reclaim) => reclaim.flight), ["XD608"]);
  assert.equal(maintenance.next?.flight, "XA618");
  assert.equal(describeMaintenanceClash(maintenance), "Clears XC344 × XD608 on carousel 1, creates none");
  assert.equal(
    describeMaintenanceImpact(maintenance),
    "Clears XC344's clash with XD608's on carousel 1. Creates none: XA618's are next on carousel 2, at 14:32.",
  );
  // In force on the carousels: XC344's bags clear of everyone, and the belt out only at its new hours.
  const change = review?.changes.find((entry) => entry.stayId === "T25-1");
  assert.ok(change);
  const move = bagMove(change.stayId, change.from, change.to);
  assert.equal(move?.clashes.length, 0);
  assert.equal(move?.outage, undefined);
  assert.equal(move && describeBagMove(move), "XC344's 239 bags move from carousel 4 to carousel 2, 12:00–12:35");
  const outage = carouselOutages().find((entry) => entry.carousel === "2");
  assert.deepEqual([outage?.from, outage?.to], ["12:45", "14:15"]);
});

test("the agenda leads with the delay, then what is proposed, then what baggage has to approve, for anyone with no audio", () => {
  assert.equal(
    reviewAgenda({ moves: 2, forBaggage: 1, maintenance: true }),
    "XD472 is 1h 50m late. Two stand changes are proposed; one requires baggage review, with one carousel maintenance move.",
  );
  assert.equal(
    reviewAgenda({ moves: 4, forBaggage: 2, maintenance: true }),
    "XD472 is 1h 50m late. Four stand changes are proposed; two require baggage review, with one carousel maintenance move.",
  );
  assert.equal(reviewAgenda({ moves: 1, forBaggage: 1, maintenance: false }), "XD472 is 1h 50m late. One stand change is proposed; one requires baggage review.");
  assert.equal(reviewAgenda({ moves: 2, forBaggage: 0, maintenance: false }), "XD472 is 1h 50m late. Two stand changes are proposed; none affect baggage.");
});

test("Travis asks about the maintenance before deciding, and Skye's answer is in the plan's own figures, a sentence each", () => {
  const followUp = teammateFollowUp();
  assert.ok(followUp);
  assert.equal(followUp.question, "Quick one: does anything land on carousel 2 while the belt's out?");
  assert.equal(followUp.answer.text, "No. XC344's bags are off by 12:35, and the next are XA618's at 14:32, after it's back.");
  // Where she points as she answers: the maintenance, then the bags it makes room for.
  assert.deepEqual(followUp.answer.beats.map((beat) => beat.kind), ["maintenance", "bags"]);
  // Cued to ask, and only ask; then, with her answer, to approve. All within what can be sent at once.
  const asking = teammateQuestionCue(followUp.question);
  assert.match(asking, /Don't approve yet/);
  assert.ok(injectionByteLength(asking) <= MAX_INJECTION_BYTES);
  const approving = teammateCue(followUp.answer.text);
  assert.match(approving, /^Skye just answered your question: /);
  assert.match(approving, /it's approved for baggage/);
  assert.ok(injectionByteLength(approving) <= MAX_INJECTION_BYTES, `${injectionByteLength(approving)} bytes`);
  assert.equal(teammateQuestionEnded("does anything land on it?"), true);
  assert.equal(teammateQuestionEnded("Quick one"), false);
  // With no maintenance moved, there is nothing to ask.
  assert.equal(teammateFollowUp(null), null);
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
      "Gate hold goes from 6h 35m to none: 5 aircraft no longer wait for a stand. " +
      "Stand use goes from 49% to 50%, using free time on A3 and B10.",
  );
});

test("with others on the call, Skye greets them all and says which part is Travis's", () => {
  const review = skyeReview();
  assert.ok(review);
  const brief = teammateBrief("Travis Hughes", review.changes, ["Travis Hughes", "Priya Raman"]);
  assert.match(brief, /^Hi Travis and Priya\. XD472 is running late\. /);
  assert.match(brief, / Travis, for you: XC344 moves to A3/);
  assert.match(
    teammateBrief("Travis Hughes", review.changes, ["Travis Hughes", "Priya Raman", "Marcus Chen"]),
    /^Hi everyone\. /,
  );
});

test("Travis is briefed on his part in a breath: the move that takes bags to another pier, and the belt work moved for it", () => {
  const review = skyeReview();
  assert.ok(review);
  // The move that keeps its pier, and the figures, are left to the screen.
  assert.equal(
    teammateBrief("Travis Hughes", review.changes),
    "Hey Travis. XD472 is running late, so XC344 moves to A3 and its bags go from carousel 4 to 2. " +
      "To make room, carousel 2's maintenance moves to 12:45–14:15. Can you approve?",
  );
});

test("the brief fits what Skye can be asked to say at once", () => {
  const review = skyeReview();
  assert.ok(review);
  assert.ok(injectionByteLength(`${SAY_INSTRUCTIONS}${teammateBrief("Travis Hughes", review.changes)}`) <= MAX_INJECTION_BYTES);
});

test("once the user has greeted Travis and handed over, Skye goes straight to the changes: no hello, no news", () => {
  const review = skyeReview();
  assert.ok(review);
  const { text, beats } = teammateBriefScript("Travis Hughes", review.changes, ["Travis Hughes"], { introduced: true });
  assert.equal(
    text,
    "XC344 moves to A3 and its bags go from carousel 4 to 2. " +
      "To make room, carousel 2's maintenance moves to 12:45–14:15. Can you approve?",
  );
  assert.deepEqual(
    beats.map((beat) => [beat.kind, text.slice(beat.at, beat.at + 12)]),
    [
      ["look", "XC344 moves "],
      ["card", "XC344 moves "],
      ["stand", "to A3 and it"],
      ["bags", "its bags go "],
      ["maintenance", "To make room"],
      ["ask", "Can you appr"],
    ],
  );
  // With others on the call, still who it's for.
  assert.match(
    teammateBriefScript("Travis Hughes", review.changes, ["Travis Hughes", "Priya Raman"], { introduced: true }).text,
    /^Travis, for you: XC344 moves to A3/,
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
      ["card", "", "XC344 moves "],
      ["stand", "to", "to A3 and it"],
      ["bags", "", "its bags go "],
      ["maintenance", "", "To make room"],
      ["ask", "", "Can you appr"],
    ],
  );
  // What she says that marks each, however she puts the rest: the flight, its new stand, the bags, her ask.
  assert.deepEqual(
    beats.map((beat) => beat.words?.[0]),
    [undefined, "XC344", "A3", "bags", "maintenance", "approve"],
  );
});

test("answering aloud, Travis is cued to approve in one quick sentence, knowing what he approves without reading it out, then to say goodbye as the user approves", () => {
  const review = skyeReview();
  assert.ok(review);
  const cue = teammateCue();
  assert.equal(
    cue,
    "Skye just asked you to approve. Answer her now, out loud, in your own words, friendly and quick, " +
      "in one short sentence with no pauses: that works, and it's approved for baggage. Nothing more.",
  );
  // Nothing in it asks him to slow down, leave gaps, offer more or thank anyone: the user thanks him.
  assert.doesNotMatch(cue, /unhurried|pause after|anything else|[Tt]hanks/);
  assert.ok(injectionByteLength(cue) <= MAX_INJECTION_BYTES);
  // He has answered once he has approved; the rest of his sentence is heard out by his voice stopping.
  assert.equal(teammateCueEnded("Yep, that works, approved for baggage."), true);
  assert.equal(teammateCueEnded("Approved, that works for us."), true);
  assert.equal(teammateCueEnded("Yep, that works,"), false);
  // As the user approves, he says goodbye in a couple of words.
  const goodbye = teammateGoodbyeCue();
  assert.match(goodbye, /^The stand allocator on the call just thanked you and approved the plan/);
  assert.match(goodbye, /two or three words/);
  assert.ok(injectionByteLength(goodbye) <= MAX_INJECTION_BYTES);
  assert.equal(teammateGoodbyeEnded("Cheers, bye!"), true);
  assert.equal(teammateGoodbyeEnded("No worries, see ya."), true);
  assert.equal(teammateGoodbyeEnded("No worries,"), false);
  const context = teammateContext(review.changes);
  assert.equal(
    context,
    "What Skye asked you to approve: XC344/345's bags going to Pier A instead of Pier B and carousel 2's maintenance moving to 12:45–14:15.",
  );
  assert.ok(injectionByteLength(context ?? "") <= MAX_INJECTION_BYTES);
  assert.equal(teammateContext(review.changes.filter((change) => !change.baggage)), null);
  assert.equal(handOffLine("Travis Hughes", true), "Thanks, Travis! Over to you to approve.");
  assert.equal(handOffLine("Travis Hughes", false), "Thanks, Travis!");
});

test("approved, the decision is logged with its figures, and the notice shows the result", () => {
  const decisions: unknown[] = [];
  const stop = subscribeApprovals((decision) => {
    decisions.push(decision);
    assert.equal(settleDisruption(decision), true);
  });
  assert.equal(approveSkyeChanges(), false);
  const [entry] = approvalEntries(outputs());
  const status = () => approvalStatus(entry, skyeReview(), []).text;
  const states = () => reviewSteps(entry, skyeReview()).map((step) => [step.label.replace(/\d\d:\d\d.*/, "<time>"), step.state]);
  assert.deepEqual(states(), [
    ["Pending review", "current"],
    ["Approved by Travis", "todo"],
    ["Ready for your approval", "todo"],
    ["Applied", "todo"],
  ]);
  assert.equal(askForSignoffs(), true);
  // Travis's turn: the presenter's "next" waits for him.
  assert.equal(nextGoldenBeat(), null);
  // Where it has got to says so in one place; none of it is his approval, nor is what he says.
  const travis = "Travis Hughes";
  // As he picks up, the user greets him; their "next" hands the call to Skye.
  setSignoffStage(travis, "joined");
  assert.equal(status(), "Travis joined");
  assert.equal(nextGoldenBeat(), "handover");
  assert.equal(advanceGoldenPath(() => assert.fail("not the news")), "handover");
  assert.equal(status(), "Skye is presenting changes");
  assert.equal(nextGoldenBeat(), null);
  setSignoffStage(travis, "presenting");
  assert.equal(status(), "Skye is presenting changes");
  setSignoffStage(travis, "asking");
  setSignoffExchange(travis, { question: "Does anything land on it?" });
  assert.equal(status(), "Travis is asking Skye");
  setSignoffStage(travis, "answering");
  setSignoffExchange(travis, { question: "Does anything land on it?", answer: "No." });
  assert.equal(status(), "Skye is answering Travis");
  setSignoffStage(travis, "deciding");
  assert.equal(status(), "Waiting for Travis");
  assert.deepEqual(skyeReview()?.signoffs[0]?.exchange, { question: "Does anything land on it?", answer: "No." });
  assert.equal(states()[0][1], "current");
  // Nor can the user go ahead until he has.
  assert.equal(approveSkyeChanges(), false);
  mock.timers.tick(SIGNOFF_MS);
  // His approval, with who and when, before the user's.
  assert.equal(status(), "Ready for your approval");
  assert.deepEqual(states(), [
    ["Pending review", "done"],
    ["Approved by Travis Hughes · <time>", "done"],
    ["Ready for your approval", "current"],
    ["Applied", "todo"],
  ]);
  const baggageSteps = outputs()[0].steps.filter((step) => step.needs);
  assert.deepEqual(baggageSteps.map((step) => step.approvedBy), [travis, travis]);
  assert.equal(nextGoldenBeat(), "approve");
  assert.equal(approveSkyeChanges(), true);
  stop();
  // The result is up: the last step opens its logs.
  assert.equal(nextGoldenBeat(), "logs");
  const [applied] = approvalEntries(outputs());
  assert.deepEqual(reviewSteps(applied, null).map((step) => step.state), ["done", "done", "done", "done"]);
  assert.match(reviewSteps(applied, null).at(-1)?.label ?? "", /^Applied · /);

  assert.equal(decisions.length, 1);
  const [request] = outputs();
  assert.deepEqual(request.decision?.by, ["Travis Hughes", "You"]);
  assert.deepEqual(
    request.decision?.figures.map((figure) => [figure.label, figure.before, figure.after, figure.better]),
    [
      ["Gate hold", "6h 35m", "none", true],
      ["Conflicts", "1", "0", true],
      ["Stand use", "49%", "50%", null],
    ],
  );
  const state = disruptionState();
  assert.equal(state.notice, "approved");
  assert.deepEqual(state.approved?.impact.gateHold, { before: 395, after: 0 });
  // In a line: the moves are on the board.
  assert.equal(settledLine(), "Approved and logged. Gate hold is down from 6h 35m to none, no conflicts left.");
  assert.equal(disruptionTask(), "XD472/473 · Cleared");
  assert.equal(
    appliedSummary(),
    "2 stand changes applied: XC344/345 on A3 and XB232/233 on B10. Carousel 2's maintenance is now 12:45–14:15.",
  );
  // The written record has it all, in order, with who: readable with no audio.
  const record = activity().map((entry) => [entry.who, entry.kind]);
  assert.deepEqual(record.slice(0, 2), [["Flight update", "news"], ["Skye", "said"]]);
  const log = activity().map((entry) => entry.text).join("\n");
  assert.match(log, /Now due on B11 at 10:30, was 08:40/);
  assert.match(log, /Proposed XC344\/345 B11 → A3/);
  assert.match(log, /Moved carousel 2's belt maintenance 12:00–13:30 → 12:45–14:15/);
  assert.match(log, /Approved for baggage: XC344\/345 and carousel 2's maintenance/);
  assert.match(log, /Approved the plan, after baggage/);
  assert.match(log, /Applied\. XD472\/473 keeps B11.*Gate hold 6h 35m → none, conflicts 1 → 0, stand use 49% → 50%/s);
  assert.deepEqual(activity().at(-1)?.kind, "applied");
  // Reset stands keeps the news: XD472 is still late, and its conflict comes back.
  resetStands();
  assert.equal(boardKpis(standState()).gateHoldMinutes, 395);
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
  assert.ok(maintenanceMove());
  undoSkyeChanges();
  assert.deepEqual(["T25-1", "T26-1", "T27-1", "T16-1"].map(standOf), ["B11", "B11", "B11", "B11"]);
  assert.equal(boardKpis(standState()).gateHoldMinutes, 395);
  // The maintenance goes back with them, and that it was cancelled is on the record.
  assert.equal(maintenanceMove(), null);
  assert.deepEqual([carouselOutages().find((entry) => entry.carousel === "2")?.from], ["12:00"]);
  assert.equal(activity().at(-1)?.kind, "cancelled");
  // Back on B11, the plan is the plan again: there is nothing moved for it to make room for.
  assert.equal(carouselOutages().every((entry) => !entry.movedFrom), true);
});
