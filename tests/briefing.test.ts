// Getting going: the priority order of open alerts, the quick pass Skye
// gives over them with an offer to take them as one plan, and working
// through them one at a time instead, with a yes each.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { applyAppAction, openWork, validateAppAction, type AppAction } from "../src/live/appActions.ts";
import { injectionByteLength, MAX_INJECTION_BYTES } from "../src/live/liveEvents.ts";
import { phraseInterpreter } from "../src/live/requestInterpreter.ts";
import { applyPlan, occupancyById, resetStands, setRunningLate } from "../src/operations/allocation.ts";
import { currentAlerts } from "../src/operations/boardAlerts.ts";
import { landDisruption } from "../src/operations/disruption.ts";
import { fixFor, movesLateStay } from "../src/operations/priorities.ts";
import { createFakeHost } from "./support/mocks.ts";

// The plan starts clear; the day's news makes two conflicts. XA103/104 runs
// 55 minutes late off A1, into XB210/211; and the disruption: XD472/473 is
// 1h 50m late onto B11 and off it, and runs into the two arrivals behind it.
setRunningLate("T02-1", 0, 55);
landDisruption();

afterEach(() => resetStands());

function brief(host = createFakeHost()) {
  const validated = validateAppAction("brief");
  assert.ok(validated.ok);
  const result = applyAppAction(validated.action, host);
  assert.ok(result.ok);
  return result;
}

test("alerts are listed most pressing first: conflicts, flights that can be placed, flights that can't, notices", () => {
  assert.deepEqual(
    currentAlerts().map((alert) => alert.id),
    [
      "ALERT-CLASH-T02-1-end",
      "ALERT-CLASH-T24-1-end",
      "ALERT-U01",
      "ALERT-U04",
      "ALERT-U02",
      "ALERT-U03",
      "ALERT-U05",
      "ALERT-T09-TOWS",
      "ALERT-T12-WINDOW",
    ],
  );
});

test("a conflict's fix moves a stay to a nearby free stand, clearing it without adding one", () => {
  const conflict = currentAlerts()[0];
  const fix = fixFor(conflict);
  assert.equal(fix?.kind, "move");
  // XB210/211, the stay XA103/104 runs into on A1, to a stand in Pier B.
  assert.deepEqual(fix && { stayId: fix.stayId, standId: fix.standId }, { stayId: "T03-1", standId: "B12" });
  applyPlan({ kind: "move", occupancyId: "T03-1", standId: "B12" });
  const ids = currentAlerts().map((alert) => alert.id);
  assert.equal(ids.includes(conflict.id), false);
  assert.equal(ids.filter((id) => id.startsWith("ALERT-CLASH")).length, 1);
});

test("a late stay running into several: everything it runs into moves, and the late aircraft keeps its stand", () => {
  const conflict = currentAlerts()[1];
  assert.deepEqual(conflict.conflict?.intoIds, ["T25-1", "T26-1"]);
  // No one move clears it, so both arrivals behind XD472/473 move, rather than XD472/473 itself.
  const fix = fixFor(conflict);
  assert.equal(fix?.kind, "knock_on");
  assert.deepEqual(
    fix?.kind === "knock_on" && fix.moves.map((move) => [move.occupancyId, move.standId]),
    [
      ["T25-1", "A3"],
      ["T26-1", "B10"],
    ],
  );
  assert.equal(fix?.flightId, "T24-DEP");
});

test("the rundown names every open item, a few words each, and offers to take them as one plan", () => {
  const { spoken, proposal } = brief();
  assert.equal(
    spoken,
    "9 open items. A1 conflict, XA103/104 55m late. B11 conflict, XD472/473 1h 50m late. " +
      "XB240, XC350, XA130 and XD480 need stands. XB241 has no stay times yet. " +
      "For info: XD452/453 is towed twice and XC335 departs after 17:00 UTC. " +
      "I can take it as one plan: the late aircraft stay put and I fit everything else around them. Want me to?",
  );
  assert.ok(injectionByteLength(spoken) <= MAX_INJECTION_BYTES);
  assert.equal(proposal?.name, "fix_all");
  assert.ok(proposal?.name === "fix_all" && proposal.scope === "all");
});

test("a yes to the rundown carries out the plan, says the outcome in a sentence and points to Outputs", () => {
  const host = createFakeHost();
  const proposal = brief(host).proposal;
  assert.ok(proposal);
  const { name, ...args } = proposal;
  const validated = validateAppAction(name, args);
  assert.ok(validated.ok);
  const done = applyAppAction(validated.action, host);
  assert.ok(done.ok);
  assert.equal(
    done.spoken,
    "Done: the late aircraft stayed put, both conflicts are clear and 4 flights have stands. XB241 is still open. The details are in Outputs.",
  );
  assert.equal(occupancyById("T03-1")?.rowId, "B12");
  // XD472/473 keeps B11; the two arrivals it ran into moved, and the rest keep B11, now clear.
  assert.deepEqual(
    ["T24-1", "T25-1", "T26-1", "T27-1", "T16-1"].map((id) => occupancyById(id)?.rowId),
    ["B11", "A3", "B10", "B11", "B11"],
  );
  assert.equal(currentAlerts().filter((alert) => alert.kind === "conflict").length, 0);
  // What's left is said, with nothing more to offer.
  const after = brief(host);
  assert.equal(
    after.spoken,
    "3 open items. XB241 has no stay times yet. For info: XD452/453 is towed twice and XC335 departs after 17:00 UTC.",
  );
  assert.equal(after.proposal, undefined);
});

test("one at a time instead: after a change, each yes works through the next", () => {
  const host = createFakeHost();
  let proposal: AppAction | undefined = { name: "move_stay", flightId: "T03-ARR", standId: "B12" };
  const said: string[] = [];
  for (let step = 0; step < 10 && proposal; step += 1) {
    const { name, ...args } = proposal;
    const validated = validateAppAction(name, args);
    assert.ok(validated.ok);
    const result = applyAppAction(validated.action, host);
    assert.ok(result.ok);
    assert.ok(injectionByteLength(result.spoken) <= MAX_INJECTION_BYTES);
    said.push(result.spoken);
    proposal = result.proposal;
  }
  assert.match(
    said[0],
    /That clears the A1 conflict\. Next up: the B11 conflict: .+; moving XC344\/345 to A3 and XB232\/233 to B10 clears it\./,
  );
  // A yes to that clears XD472/473's knock-on in one go, said in a line (gate hold says what it cleared).
  assert.match(said[1], /^Done: XD472\/473 keeps B11 and 2 flights move, so gate hold is down from .+ to none\. .*Next up: XB240/);
  assert.doesNotMatch(said[1], /That clears the B11 conflict/);
  // Two conflicts and four placeable flights, one at a time.
  assert.equal(said.length, 6);
  assert.match(brief(host).spoken, /^3 open items\. XB241 has no stay times yet/);
});

test("a plan that moves a late aircraft is told apart, so Skye never promises to keep them", () => {
  // XB210/211 is what XA103/104 runs into; XA103/104 is the late one.
  assert.equal(movesLateStay([{ occupancyId: "T03-1" }]), false);
  assert.equal(movesLateStay([{ occupancyId: "T02-1" }]), true);
});

test("the change Skye's cursor already made still counts as clearing what was open before", () => {
  const host = createFakeHost();
  const before = openWork(host);
  // The drag lands first; the apply that follows finds it done.
  applyPlan({ kind: "move", occupancyId: "T03-1", standId: "B12" });
  const validated = validateAppAction("move_stay", { flightId: "T03-ARR", standId: "B12" });
  assert.ok(validated.ok);
  const result = applyAppAction(validated.action, host, before);
  assert.ok(result.ok);
  assert.match(result.spoken, /That clears the A1 conflict\. Next up:/);
  assert.equal(occupancyById("T03-1")?.rowId, "B12");
});

test("with nothing open, the rundown says so", () => {
  const host = createFakeHost({
    acknowledged: currentAlerts().map((alert) => alert.id),
  });
  assert.match(brief(host).spoken, /^Nothing's open/);
});

test("the ways people start a shift or ask what's next all get the rundown", async () => {
  const host = createFakeHost();
  for (const utterance of [
    "start my day",
    "what's on the docket",
    "are there any open items",
    "catch me up",
    "what's next",
    "next",
    "where do things stand",
    "go over the alerts",
    "what does my day look like",
    "how's the stand looking",
    "how are the stands looking",
    "how are we looking",
  ]) {
    const result = await phraseInterpreter.interpret({ utterance, snapshot: host.snapshot(), transcript: "", taskHistory: [] });
    assert.equal(result.kind === "action" && (result.action as AppAction).name, "brief", utterance);
  }
});

test("what a reply talks about comes with cues, which select nothing until fired", () => {
  const host = createFakeHost();
  const result = brief(host);
  // Nothing selected by the rundown itself.
  assert.deepEqual(host.snapshot().selection.occupancyIds, []);
  // A cue for each thing it names: the A1 conflict, the B11 conflict, each
  // waiting flight, then the one that can't be placed.
  const cues = result.cues ?? [];
  assert.equal(cues.length, 7);
  assert.deepEqual(cues.slice(2).map((cue) => cue.words), [["XB240"], ["XC350"], ["XA130"], ["XD480"], ["XB241"]]);
  assert.ok(cues[0].words.includes("A1 conflict") && cues[0].words.includes("XB210"));
  cues[0].show();
  assert.deepEqual([...host.snapshot().selection.occupancyIds].sort(), ["T02-1", "T03-1"]);
  // The late stay and everything it runs into.
  assert.ok(cues[1].words.includes("B11 conflict"));
  cues[1].show();
  assert.deepEqual([...host.snapshot().selection.occupancyIds].sort(), ["T24-1", "T25-1", "T26-1"]);
  // A flight with no stand is picked in its list.
  const waiting = validateAppAction("find_flights", { query: "no stand" });
  assert.ok(waiting.ok);
  const found = applyAppAction(waiting.action, host);
  assert.ok(found.ok);
  found.cues?.[0].show();
  assert.equal(host.snapshot().selection.flightId, "U01");
});

test("fix everything clears every conflict and places every waiting flight that can be, in one go", async () => {
  const host = createFakeHost();
  const result = await phraseInterpreter.interpret({ utterance: "just fix everything", snapshot: host.snapshot(), transcript: "", taskHistory: [] });
  assert.equal(result.kind === "action" && result.action.name, "fix_all");
  const action = (result as { action: AppAction }).action;
  assert.ok(action.name === "fix_all");
  // XB210/211 off A1, and the two arrivals XD472/473 runs into off B11.
  assert.equal(action.moves.length, 3);
  assert.equal(action.conflictsCleared, 2);
  assert.equal(action.assigns.length, 4);
  const done = applyAppAction(action, host);
  assert.ok(done.ok);
  assert.match(done.spoken, /^Done: the late aircraft stayed put, both conflicts are clear and 4 flights have stands\. XB241 is still open\./);
  assert.equal(currentAlerts().filter((alert) => alert.kind === "conflict").length, 0);
  assert.deepEqual(
    currentAlerts().filter((alert) => alert.kind === "no_stand").map((alert) => alert.id),
    ["ALERT-U05"],
  );
  // Only the conflicts, when that is what was asked.
  resetStands();
  const conflicts = await phraseInterpreter.interpret({ utterance: "clear all the conflicts", snapshot: host.snapshot(), transcript: "", taskHistory: [] });
  assert.equal(conflicts.kind === "action" && conflicts.action.name === "fix_all" && conflicts.action.scope, "conflicts");
  // Only the waiting flights is still one at a time.
  const waiting = await phraseInterpreter.interpret({ utterance: "fix all the unassigned flights", snapshot: host.snapshot(), transcript: "", taskHistory: [] });
  assert.equal(waiting.kind === "action" && waiting.action.name, "assign_stands");
});
