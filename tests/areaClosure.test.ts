// Dragging stays in time, closing a stand area, and Skye's close_area action
// that clears it (the multi-cursor demo; see docs/multi-agent-demo.md).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { applyAppAction, validateAppAction } from "../src/live/appActions.ts";
import { decisionToRequest } from "../src/live/backendInterpreter.ts";
import {
  matchAreaClosure,
  phraseInterpreter,
  withDemoShortcuts,
  type RequestInterpreter,
} from "../src/live/requestInterpreter.ts";
import {
  aircraftSize,
  applyPlan,
  currentClosure,
  describePlan,
  fitsStand,
  hasStandChanges,
  occupancyById,
  planAreaClosure,
  planDrop,
  resetStands,
  setClosure,
  standArea,
} from "../src/operations/allocation.ts";
import { OPS_FLIGHTS_BY_ID } from "../src/operations/operationsData.ts";
import { utcAt } from "../src/stand-timeline-demo/adapter.ts";
import { DEMO_DATA, DEMO_DOMAIN } from "../src/stand-timeline-demo/demoData.ts";
import { createFakeHost } from "./support/mocks.ts";

afterEach(() => resetStands());

const at = (hhmm: string) => utcAt("2026-01-15", hhmm);
const MIN = 60_000;

/** Stays on Pier B at some point between 09:00 and 13:00. */
const onPierBInWindow = () =>
  DEMO_DATA.occupancies.filter((o) => standArea(o.rowId) === "Pier B" && o.start < at("13:00") && at("09:00") < o.end);

/** Every pair of stays sharing a stand at the same time. */
function overlapsOnStands(): string[] {
  const out: string[] = [];
  for (const a of DEMO_DATA.occupancies) {
    for (const b of DEMO_DATA.occupancies) {
      if (a.id < b.id && a.rowId === b.rowId && a.start < b.end && b.start < a.end) out.push(`${a.id}/${b.id}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------ in time */

test("a stay can be dragged along in time, on its stand or onto another", () => {
  // XA101/102 on A1 04:10–06:05; XA103/104 follows there at 06:40.
  assert.deepEqual(planDrop("T01-1", "A1", 30 * MIN), {
    kind: "move",
    occupancyId: "T01-1",
    standId: "A1",
    shiftMs: 30 * MIN,
  });
  assert.match(describePlan(planDrop("T01-1", "A1", 30 * MIN)), /^move XA101\/102 on A1 30m later, to 04:40–06:35$/);
  assert.equal(planDrop("T01-1", "C25", -15 * MIN).kind, "move");

  // 45 minutes later it would run into XA103/104: blocked, never a swap.
  const late = planDrop("T01-1", "A1", 45 * MIN);
  assert.equal(late.kind, "conflict");
  assert.deepEqual(late.kind === "conflict" && late.blockingIds, ["T02-1"]);

  assert.ok(applyPlan(planDrop("T01-1", "A1", 30 * MIN)));
  const stay = occupancyById("T01-1");
  assert.equal(stay?.start, at("04:40"));
  assert.equal(stay?.end, at("06:35"));
  // The flights at the stay follow it.
  assert.equal(OPS_FLIGHTS_BY_ID.get("T01-ARR")?.estimate, at("04:40"));
  assert.equal(OPS_FLIGHTS_BY_ID.get("T01-DEP")?.estimate, at("06:35"));
  assert.equal(hasStandChanges(), true);

  resetStands();
  assert.equal(occupancyById("T01-1")?.start, at("04:10"));
  assert.equal(OPS_FLIGHTS_BY_ID.get("T01-ARR")?.estimate, at("04:10"));
  assert.equal(hasStandChanges(), false);
});

test("a stay moved in time cannot overlap its own aircraft's other stays", () => {
  // XD452/453 is towed B11 → R1 (08:50–13:20) → A3 (from 13:40).
  const plan = planDrop("T09-2", "R1", 30 * MIN);
  assert.equal(plan.kind, "conflict");
  assert.match(plan.kind === "conflict" ? plan.reason : "", /would be on two stands at once: it is on A3/);
  assert.equal(planDrop("T09-2", "R1", 15 * MIN).kind, "move");
});

/* ------------------------------------------------------------- closure */

test("nothing may be dropped on a closed area while it is closed", () => {
  setClosure({ area: "Pier B", from: at("09:00"), to: at("13:00") });
  // XB210/211, 09:00–10:15 on A1, onto narrowbody B14 during the closure.
  const plan = planDrop("T03-1", "B14");
  assert.equal(plan.kind, "conflict");
  assert.match(plan.kind === "conflict" ? plan.reason : "", /^B14 is closed 09:00–13:00 \(Pier B\)\.$/);
  // Before the closure starts, B14 is free to use.
  assert.equal(planDrop("T01-1", "B14").kind, "move");

  // Reopened, the drop is allowed again: there it lands on XA114 and trades with it.
  resetStands();
  assert.equal(currentClosure(), null);
  assert.equal(planDrop("T03-1", "B14").kind, "swap");
});

test("closing Pier B 09:00–13:00 finds every stay on it a stand elsewhere", () => {
  const before = onPierBInWindow().map((o) => o.id).sort();
  const plan = planAreaClosure("Pier B", at("09:00"), at("13:00"));
  assert.deepEqual(plan.stuck, []);
  assert.deepEqual(plan.moves.map((move) => move.occupancyId).sort(), before);
  for (const move of plan.moves) {
    assert.notEqual(standArea(move.standId), "Pier B");
    const stay = occupancyById(move.occupancyId);
    assert.ok(stay && fitsStand(stay, move.standId), `${move.occupancyId} fits ${move.standId}`);
  }
  // The widebody that stays longest is placed first, so it is not held back.
  const longest = plan.moves.find((move) => move.occupancyId === "T18-1");
  assert.equal(longest?.shiftMs, 0);
  assert.equal(aircraftSize(occupancyById("T18-1")!), "wide");

  // Carried out together, the moves clash with nothing and with each other.
  for (const move of plan.moves) {
    assert.ok(applyPlan(planDrop(move.occupancyId, move.standId, move.shiftMs)), move.occupancyId);
  }
  assert.deepEqual(overlapsOnStands(), []);
  assert.deepEqual(onPierBInWindow(), []);
});

/* ---------------------------------------------------------- the action */

test("close_area validates the area and the window, and plans the moves", () => {
  const ok = validateAppAction("close_area", { area: "pier b", from: "09:00", to: "13:00" });
  assert.ok(ok.ok && ok.action.name === "close_area");
  assert.equal(ok.action.area, "Pier B");
  assert.equal(ok.action.from, at("09:00"));
  assert.equal(ok.action.moves.length, onPierBInWindow().length);

  const shorthand = validateAppAction("close_area", { area: "B" });
  assert.ok(shorthand.ok && shorthand.action.name === "close_area");
  // No window given: the whole day on the chart.
  assert.deepEqual([shorthand.action.from, shorthand.action.to], [...DEMO_DOMAIN]);
  const remote = validateAppAction("close_area", { area: "remote stands", from: null, to: "12:00" });
  assert.ok(remote.ok && remote.action.name === "close_area" && remote.action.area === "Remote");

  assert.equal(validateAppAction("close_area", { area: "Pier Z" }).ok, false);
  assert.equal(validateAppAction("close_area", { area: "Pier B", from: "9am", to: "13:00" }).ok, false);
  assert.equal(validateAppAction("close_area", { area: "Pier B", from: "13:00", to: "09:00" }).ok, false);
});

test("close_area clears the area, closes it and selects what moved", () => {
  const host = createFakeHost();
  const close = validateAppAction("close_area", { area: "Pier B", from: "09:00", to: "13:00" });
  assert.ok(close.ok && close.action.name === "close_area");
  const count = close.action.moves.length;

  const result = applyAppAction(close.action, host);
  assert.ok(result.ok && result.mutated);
  assert.match(result.spoken, new RegExp(`^Closed Pier B 09:00–13:00 and moved ${count} stays off it, several at once: `));
  assert.deepEqual(host.calls, [`closeArea:Pier B:${count}`]);
  assert.deepEqual(currentClosure(), { area: "Pier B", from: at("09:00"), to: at("13:00") });
  assert.deepEqual(onPierBInWindow(), []);
  assert.equal(host.snapshot().selection.occupancyIds.length, count);
});

test("close_area lands only what the cursors left, and reports what it could not move", () => {
  const host = createFakeHost();
  const close = validateAppAction("close_area", { area: "Pier B", from: "09:00", to: "13:00" });
  assert.ok(close.ok && close.action.name === "close_area");
  const [first, second, ...rest] = close.action.moves;

  // Skye's helpers already dragged the first; the user moved the second elsewhere meanwhile.
  applyPlan(planDrop(first.occupancyId, first.standId, first.shiftMs));
  applyPlan({ kind: "move", occupancyId: second.occupancyId, standId: "R4", shiftMs: 8 * 60 * MIN });

  const result = applyAppAction(close.action, host);
  assert.ok(result.ok);
  assert.deepEqual(host.calls, [`closeArea:Pier B:${rest.length}`]);
  assert.match(result.spoken, /I couldn't move .+ on R4, so it is still in the closed area\./);
  assert.equal(occupancyById(first.occupancyId)?.rowId, first.standId);
});

/* ------------------------------------------------------ understanding it */

test("the closure is understood from how people say it", () => {
  assert.deepEqual(matchAreaClosure("Pier B is closed from 9 to 1 for an inspection — move everything off it"), {
    area: "Pier B",
    from: "09:00",
    to: "13:00",
  });
  assert.deepEqual(matchAreaClosure("Close pier C between 10 and 2"), { area: "Pier C", from: "10:00", to: "14:00" });
  assert.deepEqual(matchAreaClosure("Pier D is down for maintenance 09:30-11:45"), {
    area: "Pier D",
    from: "09:30",
    to: "11:45",
  });
  assert.deepEqual(matchAreaClosure("Pier A lost power until 1pm"), { area: "Pier A", from: null, to: "13:00" });
  assert.deepEqual(matchAreaClosure("move everything off the remote stands"), { area: "Remote", from: null, to: null });

  for (const other of ["only show pier b", "filter to pier b", "clear the filters", "move XA101 to C25", "close the details"]) {
    assert.equal(matchAreaClosure(other), null, other);
  }
});

test("the phrase matcher, the demo shortcut and the model all reach close_area", async () => {
  const host = createFakeHost();
  const request = (utterance: string) => ({ utterance, snapshot: host.snapshot(), transcript: "", taskHistory: [] });

  const phrase = await phraseInterpreter.interpret(request("Pier B is closed from 9 to 1, move everything off it"));
  assert.ok(phrase.kind === "action" && phrase.action.name === "close_area" && phrase.action.area === "Pier B");

  // The shortcut answers before the interpreter it wraps, which is never asked.
  const asked: string[] = [];
  const inner: RequestInterpreter = {
    id: "inner",
    interpret: async ({ utterance }) => {
      asked.push(utterance);
      return { kind: "unclear", hint: "?" };
    },
  };
  const wrapped = withDemoShortcuts(inner);
  const shortcut = await wrapped.interpret(request("Pier B is closed from 9 to 1, move everything off it"));
  assert.ok(shortcut.kind === "action" && shortcut.action.name === "close_area");
  assert.deepEqual(asked, []);
  assert.equal((await wrapped.interpret(request("select XA101"))).kind, "unclear");
  assert.deepEqual(asked, ["select XA101"]);

  const decided = decisionToRequest({
    kind: "action",
    action_name: "close_area",
    args: { area: "Pier B", from: "09:00", to: "13:00", flightId: null, standId: null },
  });
  assert.ok(decided.kind === "action" && decided.action.name === "close_area");
  assert.equal(decided.action.moves.length, onPierBInWindow().length);
});
