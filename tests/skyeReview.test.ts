// Skye's stand changes waiting for approval: what counts as a change, when
// baggage has to approve first, approving, undoing, changes joining one that
// is waiting, and Skye saying so in her reply.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { DelegationExecutor } from "../src/live/executor.ts";
import {
  ANSWER_MS,
  callGuests,
  endGuestCall,
  EXPERTISE_LABELS,
  inviteToCall,
  leaveCall,
  PEOPLE,
  personWith,
  TEAM,
} from "../src/live/callGuests.ts";
import type { ChangeWait } from "../src/live/opsHost.ts";
import { phraseInterpreter } from "../src/live/requestInterpreter.ts";
import { TranscriptLog } from "../src/live/transcript.ts";
import {
  applyPlan,
  currentClosure,
  occupancyById,
  resetStands,
  setClosure,
} from "../src/operations/allocation.ts";
import {
  approveSignoff,
  approveSkyeChanges,
  askForSignoffs,
  callForSignoffs,
  skyeReview,
  beginSkyeChange,
  needsBaggage,
  readyForUser,
  setAnswerAloud,
  SIGNOFF_ALOUD_MS,
  SIGNOFF_MS,
  undoSkyeChanges,
} from "../src/operations/skyeReview.ts";
import { utcAt } from "../src/stand-timeline-demo/adapter.ts";
import { SYNTHETIC_DATE } from "../src/stand-timeline-demo/syntheticFixture.ts";
import { createFakeHost, createScheduler, flush } from "./support/mocks.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => {
  undoSkyeChanges();
  resetStands();
  endGuestCall();
  mock.timers.reset();
});

const standOf = (occupancyId: string) => occupancyById(occupancyId)?.rowId;

/** Skye makes `change` on the board; returns what she would say of the wait, and any call she offers. */
function asSkye(change: () => void): ChangeWait | null {
  const finish = beginSkyeChange();
  change();
  return finish();
}

test("everyone on the team has an expertise, and Travis runs baggage", () => {
  assert.ok(PEOPLE.includes("Travis Hughes"));
  assert.ok(TEAM.every((person) => EXPERTISE_LABELS[person.expertise]));
  assert.equal(personWith("baggage")?.name, "Travis Hughes");
});

test("baggage approves a change that moves bags: another pier, a stand gained or lost, or new times", () => {
  const at = (hhmm: string) => utcAt(SYNTHETIC_DATE, hhmm);
  const place = (rowId: string, start = "09:00", end = "10:00") => ({ rowId, start: at(start), end: at(end) });
  assert.equal(needsBaggage(place("A1"), place("A4")), false);
  assert.equal(needsBaggage(place("A1"), place("C25")), true);
  assert.equal(needsBaggage(place("B12"), place("R1")), true);
  assert.equal(needsBaggage(place(""), place("A4")), true);
  assert.equal(needsBaggage(place("A4"), place("")), true);
  assert.equal(needsBaggage(place("A1"), place("A1", "09:30", "10:30")), true);
});

test("a change on the same pier waits for the user alone, and approving keeps it", () => {
  const said = asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "A4" }));
  assert.deepEqual(said, { say: "It's waiting for your approval." });
  const review = skyeReview();
  assert.ok(review);
  assert.deepEqual(
    review.changes.map((change) => [change.stayId, change.from.rowId, change.to.rowId, change.baggage]),
    [["T01-1", "A1", "A4", false]],
  );
  assert.deepEqual(review.signoffs, []);
  assert.ok(readyForUser(review));
  assert.equal(approveSkyeChanges(), true);
  assert.equal(skyeReview(), null);
  assert.equal(standOf("T01-1"), "A4");
});

test("a change to another pier waits for Travis, once the user sends it to him; they approve only after he has", () => {
  const said = asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" }));
  // Approval is asked of baggage in the terminal the bags now land in, on its channel, until someone picks up.
  assert.equal(said?.say, "Baggage operations in Terminal B approves first, then you.");
  // Said straight after, so the team she has just named is "them".
  assert.deepEqual(said?.offer, {
    ask: "Want me to call them?",
    action: { name: "add_to_call", person: "Travis Hughes" },
  });
  assert.deepEqual(skyeReview()?.signoffs, [{ name: "Travis Hughes", expertise: "baggage", state: "needed" }]);
  assert.equal(approveSkyeChanges(), false);
  // Nobody is asked until the user sends it (Review with baggage).
  mock.timers.tick(SIGNOFF_MS);
  assert.equal(skyeReview()?.signoffs[0]?.state, "needed");

  assert.equal(askForSignoffs(), true);
  assert.equal(skyeReview()?.signoffs[0]?.state, "asked");
  assert.equal(askForSignoffs(), false);
  assert.equal(approveSkyeChanges(), false);

  mock.timers.tick(SIGNOFF_MS);
  assert.equal(skyeReview()?.signoffs[0]?.state, "approved");
  assert.equal(approveSkyeChanges(), true);
  assert.equal(standOf("T01-1"), "C25");
});

test("Travis on the call already looks at it at once; one being called looks once he answers; neither is offered a call", () => {
  inviteToCall("Travis Hughes");
  mock.timers.tick(ANSWER_MS);
  const onCall = asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" }));
  assert.equal(skyeReview()?.signoffs[0]?.state, "asked");
  assert.match(onCall?.say ?? "", /Travis is on the call, so I've sent it over\.$/);
  assert.equal(onCall?.offer, undefined);
  undoSkyeChanges();
  endGuestCall();

  inviteToCall("Travis Hughes");
  const ringing = asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" }));
  assert.match(ringing?.say ?? "", /I'm calling baggage operations in Terminal B already\.$/);
  assert.equal(ringing?.offer, undefined);
  assert.equal(skyeReview()?.signoffs[0]?.state, "needed");
  mock.timers.tick(ANSWER_MS);
  assert.equal(skyeReview()?.signoffs[0]?.state, "asked");
});

test("Travis answering aloud approves as he says so, with a backstop; leaving himself, the call goes on", () => {
  const voiced: string[] = [];
  setAnswerAloud((name) => (voiced.push(name), true));
  try {
    inviteToCall("Travis Hughes");
    mock.timers.tick(ANSWER_MS);
    asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" }));
    assert.deepEqual(voiced, ["Travis Hughes"]);
    assert.deepEqual(skyeReview()?.signoffs, [{ name: "Travis Hughes", expertise: "baggage", state: "asked", aloud: true }]);
    // Not after the usual few seconds: he approves as he says so.
    mock.timers.tick(SIGNOFF_MS);
    assert.equal(skyeReview()?.signoffs[0]?.state, "asked");
    approveSignoff("Travis Hughes");
    assert.equal(skyeReview()?.signoffs[0]?.state, "approved");
    // He hangs up himself, and the call goes on for the user.
    leaveCall("Travis Hughes");
    assert.deepEqual(callGuests(), { names: [], calling: [], since: callGuests()?.since });
    undoSkyeChanges();

    // Never saying so, he approves all the same, in the end.
    asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" }));
    askForSignoffs();
    mock.timers.tick(SIGNOFF_ALOUD_MS - 1);
    assert.equal(skyeReview()?.signoffs[0]?.state, "asked");
    mock.timers.tick(1);
    assert.equal(skyeReview()?.signoffs[0]?.state, "approved");
  } finally {
    setAnswerAloud(null);
  }
});

test("Review with baggage calls in whoever still has to see it, once", () => {
  asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" }));
  assert.equal(callForSignoffs(), true);
  assert.equal(callForSignoffs(), false);
  mock.timers.tick(ANSWER_MS);
  assert.equal(skyeReview()?.signoffs[0]?.state, "asked");
});

test("undoing puts the stays Skye changed back, and reopens an area she closed", () => {
  const closure = { area: "Pier B", from: utcAt(SYNTHETIC_DATE, "09:00"), to: utcAt(SYNTHETIC_DATE, "13:00") };
  asSkye(() => {
    setClosure(closure);
    applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" });
  });
  assert.deepEqual(skyeReview()?.closure, { from: null, to: closure });
  undoSkyeChanges();
  assert.equal(skyeReview(), null);
  assert.equal(standOf("T01-1"), "A1");
  assert.equal(currentClosure(), null);
});

test("undoing leaves a stay someone has changed again since as they left it", () => {
  asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" }));
  // The user moves it on by hand.
  applyPlan({ kind: "move", occupancyId: "T01-1", standId: "B14" });
  undoSkyeChanges();
  assert.equal(standOf("T01-1"), "B14");
});

test("a change made while one waits joins it, and the approvals start over", () => {
  asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "A4" }));
  assert.deepEqual(skyeReview()?.signoffs, []);
  // Then on to Pier C: one change, A1 to C25, which baggage has to see.
  asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" }));
  const review = skyeReview();
  assert.deepEqual(
    review?.changes.map((change) => [change.from.rowId, change.to.rowId, change.baggage]),
    [["A1", "C25", true]],
  );
  assert.equal(review?.signoffs[0]?.state, "needed");
  // Sent to Travis, then Skye changes something more: he is asked again from the start.
  askForSignoffs();
  asSkye(() => applyPlan({ kind: "move", occupancyId: "T02-1", standId: "C25" }));
  assert.equal(skyeReview()?.signoffs[0]?.state, "needed");
  undoSkyeChanges();
  assert.equal(standOf("T01-1"), "A1");
});

test("nothing changed on the board, nothing waits; a stay moved back where it was leaves nothing to approve", () => {
  assert.equal(asSkye(() => undefined), null);
  assert.equal(skyeReview(), null);
  asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "A4" }));
  asSkye(() => applyPlan({ kind: "move", occupancyId: "T01-1", standId: "A1" }));
  assert.equal(skyeReview(), null);
});

test("Skye's reply says her change is waiting, and what her cursor changed before a stop still waits", async () => {
  const scheduler = createScheduler();
  const host = createFakeHost();
  host.beginChange = beginSkyeChange;
  const executor = new DelegationExecutor({
    host,
    transcript: new TranscriptLog(),
    interpreter: phraseInterpreter,
    schedule: scheduler.schedule,
    inject: () => undefined,
  });
  const reply = await executor.handleTypedRequest("move XA101 to C25");
  assert.match(
    reply ?? "",
    /^Moved XA101\/102 from A1 to C25\. .* Baggage operations in Terminal B approves first, then you\. Want me to call them\?$/,
  );
  assert.equal(skyeReview()?.changes.length, 1);

  // A yes calls him; he looks at it once he answers, then approves.
  await executor.handleTypedRequest("yes");
  assert.deepEqual(host.calls.at(-1), "addToCall:Travis Hughes");
  assert.equal(skyeReview()?.signoffs[0]?.state, "needed");
  mock.timers.tick(ANSWER_MS);
  assert.equal(skyeReview()?.signoffs[0]?.state, "asked");
  mock.timers.tick(SIGNOFF_MS);
  assert.equal(skyeReview()?.signoffs[0]?.state, "approved");
  undoSkyeChanges();
  endGuestCall();

  // Stopped while her cursor is part way: what it moved waits all the same.
  host.gesture = async (_action, signal) => {
    applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" });
    executor.cancelTyped();
    await flush();
    assert.ok(signal.aborted);
  };
  assert.equal(await executor.handleTypedRequest("move XA101 to C25"), null);
  assert.equal(skyeReview()?.changes[0]?.to.rowId, "C25");
});
