// The Approvals page's list and words: what waits (Skye's changes, as one),
// then what was decided, approved or undone; where each stands as Travis is
// called, reviews and approves; when the page opens itself; and where each
// change moved its stay from and to, for its card and the carousels.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { AppAction } from "../src/live/appActions.ts";
import { ANSWER_MS, callingNames, endGuestCall, inviteToCall } from "../src/live/callGuests.ts";
import { approvalEntries, approvalStatus, entrySteps } from "../src/approvals/approvalList.ts";
import { applyPlan, resetStands } from "../src/operations/allocation.ts";
import { clearOutputs, outputs } from "../src/operations/outputs.ts";
import {
  approveSkyeChanges,
  beginSkyeChange,
  SIGNOFF_MS,
  skyeReview,
  teammatesBroughtIn,
  undoSkyeChanges,
} from "../src/operations/skyeReview.ts";

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
const move = (occupancyId: string, standId: string) => applyPlan({ kind: "move", occupancyId, standId });

/** Skye takes `action`, making `change` on the board as her cursors would. */
function asSkye(action: AppAction, change: () => void): void {
  const finish = beginSkyeChange(action);
  change();
  finish();
}

const entries = () => approvalEntries(outputs());
const statusOf = (index = 0) => approvalStatus(entries()[index], skyeReview(), callingNames());

test("nothing is listed until Skye's changes have to be approved; the user's own never are", () => {
  assert.deepEqual(entries(), []);
  move("T01-1", "C25");
  assert.equal(outputs().length, 1);
  assert.deepEqual(entries(), []);
});

test("what waits reads as Travis is called, reviews and approves, then is listed as decided, on the same entry", () => {
  asSkye(moveStay("T01-ARR", "C25"), () => move("T01-1", "C25"));
  const [waiting] = entries();
  assert.equal(waiting.waiting, true);
  assert.deepEqual(entrySteps(waiting).map((step) => [step.title, step.detail]), [["XA101/102", "A1 → C25"]]);
  // Where it was and is, for its card and the carousels, kept once decided too.
  assert.deepEqual(
    [entrySteps(waiting)[0].move?.from.rowId, entrySteps(waiting)[0].move?.to.rowId],
    ["A1", "C25"],
  );
  assert.deepEqual(statusOf(), { text: "Needs baggage", tone: "warning" });

  inviteToCall("Travis Hughes");
  assert.deepEqual(statusOf(), { text: "Calling Travis", tone: "warning" });
  mock.timers.tick(ANSWER_MS);
  assert.deepEqual(statusOf(), { text: "Travis is reviewing", tone: "warning" });
  mock.timers.tick(SIGNOFF_MS);
  assert.deepEqual(statusOf(), { text: "Ready for your approval", tone: "brand" });
  assert.equal(typeof skyeReview()?.signoffs[0]?.at, "number");

  assert.equal(approveSkyeChanges(), true);
  const [decided] = entries();
  assert.equal(decided.id, waiting.id);
  assert.equal(decided.waiting, false);
  assert.deepEqual(entrySteps(decided)[0].move, entrySteps(waiting)[0].move);
  assert.equal(statusOf().tone, "success");
  assert.match(statusOf().text, /^Approved \d{2}:\d{2}/);
  const decision = decided.requests[0].decision;
  assert.deepEqual(decision?.by, ["Travis Hughes", "You"]);
  assert.deepEqual(decision?.signoffs.map((signoff) => [signoff.name, typeof signoff.at]), [["Travis Hughes", "number"]]);
});

test("cancelled, it is listed as decided, cancelled", () => {
  asSkye(moveStay("T01-ARR", "C25"), () => move("T01-1", "C25"));
  undoSkyeChanges();
  const listed = entries();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].waiting, false);
  assert.deepEqual(statusOf(), { text: "Cancelled", tone: "subtle" });
});

test("changes for two requests that wait together are one entry, under the newest, with every piece", () => {
  asSkye(moveStay("T01-ARR", "A4"), () => move("T01-1", "A4"));
  asSkye(moveStay("T02-ARR", "C25"), () => move("T02-1", "C25"));
  const listed = entries();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].requests.length, 2);
  assert.equal(listed[0].id, outputs()[0].id);
  assert.equal(entrySteps(listed[0]).length, 2);
});

test("the page opens as a teammate is brought in: being called, or already looking", () => {
  asSkye(moveStay("T01-ARR", "C25"), () => move("T01-1", "C25"));
  assert.equal(teammatesBroughtIn(skyeReview()), false);
  inviteToCall("Travis Hughes");
  assert.equal(teammatesBroughtIn(skyeReview()), true);
  mock.timers.tick(ANSWER_MS);
  assert.equal(skyeReview()?.signoffs[0]?.state, "asked");
  assert.equal(teammatesBroughtIn(skyeReview()), true);
  // Nothing waiting, nobody to bring in.
  undoSkyeChanges();
  assert.equal(teammatesBroughtIn(skyeReview()), false);
});
