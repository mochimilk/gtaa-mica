// Bringing teammates into the call and taking them off: who can be called in,
// how they ring before they answer, what Skye says, and how the request is
// understood.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { applyAppAction, validateAppAction } from "../src/live/appActions.ts";
import { decisionToRequest } from "../src/live/backendInterpreter.ts";
import { ANSWER_MS, callingNames, endGuestCall, findPerson, guestNames } from "../src/live/callGuests.ts";
import { describeSnapshot } from "../src/live/opsHost.ts";
import { phraseInterpreter } from "../src/live/requestInterpreter.ts";
import { createFakeHost } from "./support/mocks.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => {
  endGuestCall();
  mock.timers.reset();
});

async function understood(utterance: string) {
  return phraseInterpreter.interpret({ utterance, snapshot: createFakeHost().snapshot(), transcript: "", taskHistory: [] });
}

test("people are found by full or first name, in any case", () => {
  assert.equal(findPerson("Marcus Chen"), "Marcus Chen");
  assert.equal(findPerson("marcus"), "Marcus Chen");
  assert.equal(findPerson("  PRIYA "), "Priya Raman");
  assert.equal(findPerson("John"), undefined);
});

test("adding someone calls them, and they join once they answer; Skye says it is the call window only", () => {
  const host = createFakeHost();
  const add = validateAppAction("add_to_call", { person: "marcus" });
  assert.ok(add.ok);
  const result = applyAppAction(add.action, host);
  assert.ok(result.ok);
  assert.deepEqual(host.calls, ["addToCall:Marcus Chen"]);
  assert.match(result.spoken, /^Calling Marcus Chen now\. .*nothing actually reaches them/);

  // Ringing: being called, not on yet.
  assert.deepEqual(callingNames(), ["Marcus Chen"]);
  assert.deepEqual(guestNames(), []);
  assert.deepEqual(host.snapshot().callingGuests, ["Marcus Chen"]);
  assert.match(describeSnapshot(host.snapshot()), /Calling, not answered yet: Marcus Chen\./);
  const ringing = validateAppAction("add_to_call", { person: "Marcus" });
  assert.match(ringing.ok ? "" : ringing.message, /calling Marcus Chen already/);

  // Answered.
  mock.timers.tick(ANSWER_MS);
  assert.deepEqual(callingNames(), []);
  assert.deepEqual(guestNames(), ["Marcus Chen"]);
  assert.deepEqual(host.snapshot().callGuests, ["Marcus Chen"]);
  assert.match(describeSnapshot(host.snapshot()), /Also on the call: Marcus Chen\./);

  // Already on: said, not added twice.
  const again = validateAppAction("add_to_call", { person: "Marcus Chen" });
  assert.ok(!again.ok);
  assert.match(again.ok ? "" : again.message, /already/);

  const remove = validateAppAction("remove_from_call", { person: "Marcus" });
  assert.ok(remove.ok);
  assert.match((applyAppAction(remove.action, host) as { spoken: string }).spoken, /Took Marcus Chen off the call/);
  assert.deepEqual(guestNames(), []);
});

test("taking someone off while they ring stops calling them, and they never join", () => {
  const host = createFakeHost();
  const add = validateAppAction("add_to_call", { person: "Priya" });
  assert.ok(add.ok);
  applyAppAction(add.action, host);
  const remove = validateAppAction("remove_from_call", { person: "Priya" });
  assert.ok(remove.ok);
  assert.match((applyAppAction(remove.action, host) as { spoken: string }).spoken, /^Stopped calling Priya Raman\./);
  mock.timers.tick(ANSWER_MS);
  assert.deepEqual(callingNames(), []);
  assert.deepEqual(guestNames(), []);
});

test("someone not on the people list is not added, and Skye says who can be", () => {
  const result = validateAppAction("add_to_call", { person: "John Smith" });
  assert.ok(!result.ok);
  assert.match(result.ok ? "" : result.message, /I can add Priya Raman, Marcus Chen, Aisha Okafor and Travis Hughes/);
  assert.equal(validateAppAction("remove_from_call", { person: "Aisha" }).ok, false);
});

test("the ways people ask to bring someone in or drop them are understood", async () => {
  for (const utterance of ["let's add Marcus Chen to the call", "get Priya on the call", "loop in Aisha", "call Marcus"]) {
    const result = await understood(utterance);
    assert.equal(result.kind === "action" && result.action.name, "add_to_call", utterance);
  }
  const who = await understood("add someone to the call");
  assert.equal(who.kind, "unclear");
  // Messaging is still not something Mica does.
  assert.equal((await understood("email Marcus the plan")).kind, "unsupported");
  assert.equal((await understood("send a message to the ramp")).kind, "unsupported");

  const add = validateAppAction("add_to_call", { person: "Marcus" });
  assert.ok(add.ok);
  applyAppAction(add.action, createFakeHost());
  const drop = await understood("drop Marcus from the call");
  assert.equal(drop.kind === "action" && drop.action.name, "remove_from_call");
});

test("a model decision names the person, which is checked against the people list", () => {
  const add = decisionToRequest({ kind: "action", action_name: "add_to_call", args: { person: "Aisha Okafor" } });
  assert.deepEqual(add, { kind: "action", action: { name: "add_to_call", person: "Aisha Okafor" } });
  const unknown = decisionToRequest({ kind: "action", action_name: "add_to_call", args: { person: "Bob" } });
  assert.equal(unknown.kind, "unclear");
});
