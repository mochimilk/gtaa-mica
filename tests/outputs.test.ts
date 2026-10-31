// The Outputs panel's list of every change to the board, under who made it:
// Skye's requests, each with every piece she changed for it, turn by turn,
// and what the user did, each drag, swap or reset on its own. Skye's
// piece is worked on from when her cursor sets off for it, waits for
// approval once it lands (first from baggage, when it moves bags, then from
// the user), then is approved or cancelled with the rest of hers. What ends up
// where it was comes off the list, and an action that does not change the
// board is never on it.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { AppAction } from "../src/live/appActions.ts";
import { endGuestCall } from "../src/live/callGuests.ts";
import { DelegationExecutor } from "../src/live/executor.ts";
import { phraseInterpreter } from "../src/live/requestInterpreter.ts";
import { TranscriptLog } from "../src/live/transcript.ts";
import { applyPlan, occupancyById, resetStands, setClosure } from "../src/operations/allocation.ts";
import { clearOutputs, describeRequest, outputs } from "../src/operations/outputs.ts";
import {
  approveSkyeChanges,
  askForSignoffs,
  asUser,
  beginSkyeChange,
  SIGNOFF_MS,
  skyeTakesHold,
  undoSkyeChanges,
} from "../src/operations/skyeReview.ts";
import { utcAt } from "../src/stand-timeline-demo/adapter.ts";
import { SYNTHETIC_DATE } from "../src/stand-timeline-demo/syntheticFixture.ts";
import { createFakeHost, createScheduler } from "./support/mocks.ts";

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
});

const moveStay = (flightId: string, standId: string): AppAction => ({ name: "move_stay", flightId, standId });
const fixConflicts: AppAction = { name: "fix_all", scope: "conflicts", moves: [], assigns: [], left: [], conflictsCleared: 0 };
const move = (occupancyId: string, standId: string) => applyPlan({ kind: "move", occupancyId, standId });
const standOf = (occupancyId: string) => occupancyById(occupancyId)?.rowId ?? "";

/** Each request as its title, whether Skye is still on it, and its pieces as [title, detail, status]. */
const listed = () =>
  outputs().map((request) => ({
    title: request.title,
    working: request.working,
    steps: request.steps.map((step) => [step.title, step.detail, step.status]),
  }));
const statuses = () => outputs().flatMap((request) => request.steps.map((step) => step.status));

/** Skye takes `action`, making `change` on the board as her cursors would. */
function asSkye(action: AppAction, change: () => void): void {
  const finish = beginSkyeChange(action);
  change();
  finish();
}

test("a piece is worked on as Skye's cursor sets off for it, waits for the user once it lands, and is done once approved", () => {
  const finish = beginSkyeChange(moveStay("T01-ARR", "A4"));
  assert.deepEqual(listed(), [{ title: "Move XA101/102 to stand A4", working: true, steps: [] }]);
  skyeTakesHold("T01-1", "A4");
  assert.deepEqual(listed()[0].steps, [["XA101/102", "A1 → A4", "working"]]);
  // On the same pier: nothing for baggage to see, so it waits on the user alone.
  move("T01-1", "A4");
  assert.deepEqual(listed()[0].steps, [["XA101/102", "A1 → A4", "waiting"]]);
  finish();
  assert.deepEqual(listed(), [
    { title: "Move XA101/102 to stand A4", working: false, steps: [["XA101/102", "A1 → A4", "waiting"]] },
  ]);
  assert.equal(approveSkyeChanges(), true);
  assert.deepEqual(statuses(), ["done"]);
});

test("a piece that moves bags keeps its dots while Skye works, waits on baggage once she is done, then on the user", () => {
  const finish = beginSkyeChange(moveStay("T01-ARR", "C25"));
  move("T01-1", "C25");
  assert.deepEqual(statuses(), ["working"]);
  finish();
  assert.deepEqual(statuses(), ["pending-approval"]);
  askForSignoffs();
  mock.timers.tick(SIGNOFF_MS);
  assert.deepEqual(statuses(), ["waiting"]);
  assert.equal(approveSkyeChanges(), true);
  assert.deepEqual(statuses(), ["done"]);
});

test("one request lists every piece it changed, newest first, and they are cancelled together", () => {
  const was = standOf("T02-1");
  const finish = beginSkyeChange(fixConflicts);
  move("T01-1", "A4");
  move("T02-1", "C25");
  finish();
  assert.equal(outputs().length, 1);
  assert.equal(outputs()[0].title, "Fix all conflicts");
  assert.deepEqual(
    outputs()[0].steps.map((step) => step.detail),
    [`${was} → C25`, "A1 → A4"],
  );
  // The one to another pier waits on baggage; the one on the same pier, on the user alone.
  assert.deepEqual(statuses(), ["pending-approval", "waiting"]);
  undoSkyeChanges();
  // Cancelling is shown on Skye's request, her pieces undone, and not listed as the user's; the two are put back.
  assert.deepEqual(
    outputs().map((request) => [request.actor, request.title]),
    [["skye", "Fix all conflicts"]],
  );
  assert.deepEqual(statuses(), ["undone", "undone"]);
  assert.deepEqual(describeRequest(outputs()[0]), { status: "Cancelled by you", count: "2 changes", waiting: false, cancelled: true });
  assert.deepEqual([standOf("T01-1"), standOf("T02-1")], ["A1", was]);
});

test("what the user does is listed as theirs, one thing at a time: a drag, then a swap", () => {
  move("T01-1", "A4");
  applyPlan({ kind: "swap", occupancyId: "T02-1", otherId: "T08-1" });
  assert.deepEqual(
    outputs().map((request) => [request.actor, request.title, request.working]),
    [
      ["user", "Swapped XA103/104 and XC332/333", false],
      ["user", "Moved XA101/102 to stand A4", false],
    ],
  );
  assert.deepEqual(listed()[1].steps, [["XA101/102", "A1 → A4", "done"]]);
  assert.deepEqual(listed()[0].steps.map((step) => step[1]).sort(), ["A1 → A3", "A3 → A1"]);
});

test("resetting the stands with Skye's changes waiting is one thing the user did", () => {
  asSkye(moveStay("T01-ARR", "A4"), () => move("T01-1", "A4"));
  move("T02-1", "C25");
  asUser("Reset stands", () => {
    undoSkyeChanges();
    resetStands();
  });
  const [reset] = outputs();
  assert.deepEqual([reset.actor, reset.title], ["user", "Reset stands"]);
  assert.deepEqual(
    reset.steps.map((step) => step.detail).sort(),
    ["A4 → A1", "C25 → A1"],
  );
  assert.equal(outputs().length, 3);
});

test("a piece that moves bags says baggage has to approve it from when Skye takes hold of it, and then who did", () => {
  asSkye(moveStay("T01-ARR", "C25"), () => {
    skyeTakesHold("T01-1", "C25");
    assert.deepEqual(outputs()[0].steps[0].needs, { name: "Travis Hughes", expertise: "baggage" });
    move("T01-1", "C25");
  });
  assert.deepEqual(outputs()[0].steps[0].needs, { name: "Travis Hughes", expertise: "baggage" });
  askForSignoffs();
  mock.timers.tick(SIGNOFF_MS);
  assert.equal(outputs()[0].steps[0].approvedBy, "Travis Hughes");
});

test("a piece on the same pier needs no one but the user, and the user's own pieces no one at all", () => {
  asSkye(moveStay("T01-ARR", "A4"), () => {
    skyeTakesHold("T01-1", "A4");
    move("T01-1", "A4");
  });
  assert.equal(outputs()[0].steps[0].needs, undefined);
  undoSkyeChanges();
  move("T01-1", "C25");
  assert.equal(outputs()[0].steps[0].needs, undefined);
});

test("closing an area is a piece of its own", () => {
  const closure = { area: "Pier B", from: utcAt(SYNTHETIC_DATE, "09:00"), to: utcAt(SYNTHETIC_DATE, "13:00") };
  asSkye({ name: "close_area", ...closure, moves: [], stuck: [] }, () => {
    setClosure(closure);
    move("T01-1", "C25");
  });
  assert.deepEqual(listed()[0].steps, [
    ["XA101/102", "A1 → C25", "pending-approval"],
    ["Pier B", "Closed 09:00–13:00", "waiting"],
  ]);
});

test("a piece Skye took hold of but never moved, or moved back, comes off; a request left with nothing comes off too", () => {
  const was = standOf("T02-1");
  const finish = beginSkyeChange(fixConflicts);
  skyeTakesHold("T01-1", "A4");
  move("T02-1", "C25");
  assert.equal(outputs()[0].steps.length, 2);
  move("T02-1", was);
  finish();
  assert.deepEqual(outputs(), []);
});

test("what does not change the board is never listed", () => {
  asSkye({ name: "select_flight", flightId: "T01-ARR" }, () => undefined);
  asSkye({ name: "set_view", view: "all" }, () => undefined);
  assert.deepEqual(outputs(), []);
});

test("pieces Skye puts back in a later request leave nothing to approve, so both are done", () => {
  asSkye(moveStay("T01-ARR", "A4"), () => move("T01-1", "A4"));
  asSkye(moveStay("T01-ARR", "A1"), () => move("T01-1", "A1"));
  assert.deepEqual(listed(), [
    { title: "Move XA101/102 to stand A1", working: false, steps: [["XA101/102", "A4 → A1", "done"]] },
    { title: "Move XA101/102 to stand A4", working: false, steps: [["XA101/102", "A1 → A4", "done"]] },
  ]);
});

test("a change Skye makes for a request is listed under it, piece by piece, waiting on baggage", async () => {
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
  await executor.handleTypedRequest("move XA101 to C25");
  assert.deepEqual(listed(), [
    { title: "Move XA101/102 to stand C25", working: false, steps: [["XA101/102", "A1 → C25", "pending-approval"]] },
  ]);
  await executor.handleTypedRequest("select XA101");
  assert.equal(outputs().length, 1);
});
