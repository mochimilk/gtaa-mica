// Late stays: the ghosts the chart draws for them, which of those run into
// another stay (drawn red), and the late departures' estimates.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { applyPlan, planDrop, resetStands } from "../src/operations/allocation.ts";
import { OPS_FLIGHTS_BY_ID } from "../src/operations/operationsData.ts";
import { utcAt } from "../src/stand-timeline-demo/adapter.ts";
import { DEMO_DATA } from "../src/stand-timeline-demo/demoData.ts";
import { ghostClashes, ghostKey, ghostSpan } from "../src/stand-timeline-demo/delays.ts";

afterEach(() => resetStands());

const at = (hhmm: string) => utcAt("2026-01-15", hhmm);
const MIN = 60_000;
const clashes = () => ghostClashes(DEMO_DATA.occupancies, DEMO_DATA.delays);
const stay = (id: string) => DEMO_DATA.occupancies.find((o) => o.id === id)!;

test("a late stay's ghosts reach back to its scheduled on-block and on to its expected off-block", () => {
  // XD450/451 on A2 07:45–11:40: 35 minutes late in, 30 late out.
  const t06 = stay("T06-1");
  const delay = DEMO_DATA.delays.get("T06-1");
  assert.deepEqual(ghostSpan(t06, delay, "start"), [at("07:10"), at("07:45")]);
  assert.deepEqual(ghostSpan(t06, delay, "end"), [at("11:40"), at("12:10")]);
  // On time: no ghosts.
  assert.equal(DEMO_DATA.delays.get("T03-1"), undefined);
  assert.equal(ghostSpan(stay("T03-1"), undefined, "end"), null);
});

test("the fixture has two ghosts that run into another stay, and two that do not", () => {
  const found = clashes();
  assert.deepEqual([...found.keys()].sort(), [ghostKey("T02-1", "end"), ghostKey("T11-1", "start")]);
  // XA103/104 leaves A1 at 09:15, after XB210/211 arrives at 09:00.
  assert.deepEqual(found.get(ghostKey("T02-1", "end"))?.map((o) => o.id), ["T03-1"]);
  // XA107/108 was scheduled onto A4 at 09:05, while XB214/215 is there until 09:20.
  assert.deepEqual(found.get(ghostKey("T11-1", "start"))?.map((o) => o.id), ["T10-1"]);
  // XA111/112 leaves B14 at 09:00, clear of the 09:10 tow-in.
  assert.equal(found.has(ghostKey("T19-1", "end")), false);
});

test("a clash follows the stays as they move", () => {
  // XB210/211 moves off A1: XA103/104's late departure no longer runs into anything.
  assert.ok(applyPlan(planDrop("T03-1", "C25")));
  assert.equal(clashes().has(ghostKey("T02-1", "end")), false);

  // The B14 tow-in pulled 20 minutes earlier, to 08:50, lands inside XA111/112's 08:45–09:00 ghost.
  assert.ok(applyPlan(planDrop("T21-2", "B14", -20 * MIN)));
  assert.deepEqual(clashes().get(ghostKey("T19-1", "end"))?.map((o) => o.id), ["T21-2"]);
});

test("a late departure's estimate is its expected off-block, and moves with its stay", () => {
  // Scheduled off A1 at 08:20, 55 minutes late.
  assert.equal(OPS_FLIGHTS_BY_ID.get("T02-DEP")?.estimate, at("09:15"));
  // A late arrival's estimate is already its bar's start.
  assert.equal(OPS_FLIGHTS_BY_ID.get("T11-ARR")?.estimate, at("10:05"));

  assert.ok(applyPlan(planDrop("T02-1", "A1", -20 * MIN)));
  assert.equal(OPS_FLIGHTS_BY_ID.get("T02-DEP")?.estimate, at("08:55"));
});
