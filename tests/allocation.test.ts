// Demo stand changes: the two sample rules, drops, swaps, the suggestion,
// and Skye's actions over them, including the confirmed-suggestion loop.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { applyAppAction, validateAppAction } from "../src/live/appActions.ts";
import { phraseInterpreter } from "../src/live/requestInterpreter.ts";
import {
  applyPlan,
  checkSwap,
  hasStandChanges,
  occupancyById,
  planDrop,
  resetStands,
  suggestBest,
} from "../src/operations/allocation.ts";
import { OPS_FLIGHTS_BY_ID } from "../src/operations/operationsData.ts";
import { createFakeHost } from "./support/mocks.ts";

afterEach(() => resetStands());

const standOf = (occupancyId: string) => occupancyById(occupancyId)?.rowId;

test("a stay drops onto free time on a stand that takes its aircraft", () => {
  // XA101/102, an A320 on A1, onto C25, which is empty all day.
  assert.deepEqual(planDrop("T01-1", "C25"), { kind: "move", occupancyId: "T01-1", standId: "C25" });
  assert.deepEqual(planDrop("T01-1", "A1"), { kind: "stay", occupancyId: "T01-1" });
});

test("a widebody cannot go on a narrowbody stand", () => {
  const plan = planDrop("T06-1", "A1");
  assert.equal(plan.kind, "conflict");
  assert.match(plan.kind === "conflict" ? plan.reason : "", /B788, a widebody, and A1 is a narrowbody stand/);
});

test("landing on one stay swaps with it when both fit, and is blocked when not", () => {
  // XA103/104 on A1 and XC332/333 on A3 overlap in time and can trade.
  assert.deepEqual(planDrop("T02-1", "A3"), { kind: "swap", occupancyId: "T02-1", otherId: "T08-1" });
  assert.deepEqual(checkSwap("T02-1", "T08-1"), { ok: true });

  // XA101/102 onto A2 lands on XB212/213, which would then overlap XA103/104 on A1.
  const blocked = planDrop("T01-1", "A2");
  assert.equal(blocked.kind, "conflict");
  assert.deepEqual(blocked.kind === "conflict" && blocked.blockingIds, ["T05-1"]);
  assert.equal(checkSwap("T01-1", "T01-1").ok, false);
});

test("a change moves the stay and its flights, and reset puts it back", () => {
  assert.equal(applyPlan({ kind: "swap", occupancyId: "T02-1", otherId: "T08-1" }), true);
  assert.equal(standOf("T02-1"), "A3");
  assert.equal(standOf("T08-1"), "A1");
  assert.equal(OPS_FLIGHTS_BY_ID.get("T02-ARR")?.standId, "A3");
  assert.equal(hasStandChanges(), true);

  resetStands();
  assert.equal(standOf("T02-1"), "A1");
  assert.equal(OPS_FLIGHTS_BY_ID.get("T02-ARR")?.standId, "A1");
  assert.equal(hasStandChanges(), false);
});

test("the suggestion widens the tightest gap on the stands it touches", () => {
  const best = suggestBest();
  assert.ok(best);
  assert.ok(best.after > best.before);
  // It only proposes: nothing has moved.
  assert.equal(hasStandChanges(), false);
});

test("Skye moves and swaps stays, and refuses what the rules do not allow", () => {
  const host = createFakeHost();

  const move = validateAppAction("move_stay", { flightId: "T01-ARR", standId: "c25" });
  assert.ok(move.ok);
  const moved = applyAppAction(move.action, host);
  assert.ok(moved.ok && moved.mutated);
  assert.match(moved.ok ? moved.spoken : "", /^Moved XA101\/102 from A1 to C25\. It's a demo change/);
  assert.equal(standOf("T01-1"), "C25");
  // Again, it is already there: done, not an error.
  assert.ok(applyAppAction(move.action, host).ok);

  const wide = validateAppAction("move_stay", { flightId: "T06-ARR", standId: "A4" });
  assert.ok(wide.ok);
  const refused = applyAppAction(wide.action, host);
  assert.equal(refused.ok === false && refused.code, "conflict");

  assert.equal(validateAppAction("move_stay", { flightId: "U01", standId: "C25" }).ok, false);
  assert.equal(validateAppAction("move_stay", { flightId: "T01-ARR", standId: "Z9" }).ok, false);
});

test("a swap is carried out once, even after the drag on screen has made it", () => {
  const host = createFakeHost();
  const swap = validateAppAction("swap_stays", { flightIds: ["T02-ARR", "T08-ARR"] });
  assert.ok(swap.ok);
  assert.deepEqual(swap.ok && swap.action, { name: "swap_stays", flightIds: ["T02-ARR", "T08-ARR"], stands: ["A1", "A3"] });

  // Skye's drag already swapped them; applying must not swap them back.
  applyPlan({ kind: "swap", occupancyId: "T02-1", otherId: "T08-1" });
  const result = applyAppAction(swap.action, host);
  assert.ok(result.ok);
  assert.equal(standOf("T02-1"), "A3");
  assert.equal(host.calls.length, 0);

  // Without the drag, applying makes the swap.
  resetStands();
  assert.ok(applyAppAction(swap.action, host).ok);
  assert.equal(standOf("T02-1"), "A3");
  // The swap, then the next conflict selected as Skye offers it.
  assert.deepEqual(host.calls[0], "swap:T02-1:T08-1");
  assert.ok(host.calls.slice(1).every((call) => call.startsWith("selectFlights:")));
});

test("a suggestion is offered, not made, and a yes carries out exactly it", async () => {
  const host = createFakeHost();
  const suggest = validateAppAction("suggest_move", { flightId: null });
  assert.ok(suggest.ok);
  const offered = applyAppAction(suggest.action, host);
  assert.ok(offered.ok && !offered.mutated && offered.proposal);
  assert.match(offered.ok ? offered.spoken : "", /Want me to do it\?$/);
  assert.equal(hasStandChanges(), false);

  const history = [
    { utterance: "find the best move", action: "suggest_move", outcome: "applied" as const, result: offered.ok ? offered.spoken : "", proposal: offered.ok ? offered.proposal : undefined },
  ];
  const request = (utterance: string, taskHistory = history) => ({ utterance, snapshot: host.snapshot(), transcript: "", taskHistory });

  const yes = await phraseInterpreter.interpret(request("yes, do it"));
  assert.equal(yes.kind, "action");
  assert.equal(yes.kind === "action" && yes.action.name, offered.ok && offered.proposal?.name);

  // A yes with nothing offered does nothing of the sort.
  const unprompted = await phraseInterpreter.interpret(request("yes", []));
  assert.notEqual(unprompted.kind === "action" && unprompted.action.name, "move_stay");
});

test("the phrase matcher reads moves, swaps and requests for a suggestion", async () => {
  const host = createFakeHost();
  const ask = async (utterance: string) =>
    phraseInterpreter.interpret({ utterance, snapshot: host.snapshot(), transcript: "", taskHistory: [] });

  assert.deepEqual(await ask("move XA101 to C25"), {
    kind: "action",
    action: { name: "move_stay", flightId: "T01-ARR", standId: "C25" },
  });
  const swap = await ask("swap XA103 with XC332");
  assert.equal(swap.kind === "action" && swap.action.name, "swap_stays");
  assert.deepEqual(await ask("what's the best swap?"), { kind: "action", action: { name: "suggest_move", flightId: null } });
  assert.deepEqual(await ask("suggest a better stand for XA101"), {
    kind: "action",
    action: { name: "suggest_move", flightId: "T01-ARR" },
  });
  assert.equal((await ask("move XA101")).kind, "unclear");
});
