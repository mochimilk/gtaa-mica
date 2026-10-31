// The board's KPIs (the strip under the chart): conflicts, gate hold, flights
// with no stand, stand use and free stand time, now and in the plan.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  applyAssigns,
  applyPlan,
  planAssign,
  planDrop,
  resetStands,
  setRunningLate,
  standState,
  unassignStays,
  type Closure,
  type StandState,
  type StayPlace,
} from "../src/operations/allocation.ts";
import { boardKpis, planKpis } from "../src/operations/boardKpis.ts";
import { utcAt } from "../src/stand-timeline-demo/adapter.ts";

afterEach(() => resetStands());

const at = (hhmm: string) => utcAt("2026-01-15", hhmm);
/** The window, 05:00–17:00, in minutes; and the sample stands. */
const DAY = 12 * 60;
const STANDS = 29;

/** A board with only these stays on it, and this closure. */
const board = (closure: Closure | null, ...stays: [string, string, string, string][]): StandState => ({
  stays: new Map(stays.map(([id, rowId, from, to]): [string, StayPlace] => [id, { rowId, start: at(from), end: at(to) }])),
  closure,
});

test("the fixture: no conflicts, nobody waiting for a stand, and five flights with no stand, as the plan has them", () => {
  const now = boardKpis(standState());
  // The late stays it has (XA103/104 off A1, XA107/108 onto A4) run into nothing.
  assert.deepEqual(now.conflicts, []);
  assert.deepEqual(now.holds, []);
  assert.equal(now.gateHoldMinutes, 0);
  // Four waiting in the No stand lane, earliest first, and XB241 with no stay times.
  assert.deepEqual(now.waiting.map((w) => w.label), ["XC350", "XB240", "XA130", "XD480"]);
  assert.equal(now.noStand, 5);
  assert.equal(now.untimed, 1);
  assert.equal(now.hourlyUse.length, 12);
  assert.deepEqual(now, planKpis());
});

test("gate hold: a late departure holds the next arrival, and the knock-on holds the ones after", () => {
  // Due on B11 08:40–11:40, XD472/473 gets in 1h 50m late and leaves at 13:30.
  assert.ok(setRunningLate("T24-1", 110, 110));
  const kpis = boardKpis(standState());
  // XC344/345 is due at 11:50 and gets on at 13:30; off at 14:35, so XB232/233
  // (due 13:05) waits until then, and so on down B11's bank.
  assert.deepEqual(
    kpis.holds.map((hold) => [hold.label, hold.standId, hold.due, hold.minutes]),
    [
      ["XC344/345", "B11", at("11:50"), 100],
      ["XB232/233", "B11", at("13:05"), 90],
      ["XA117/118", "B11", at("13:55"), 80],
      ["XC336/337", "B11", at("14:45"), 70],
      ["XA109/110", "B11", at("15:45"), 55],
    ],
  );
  assert.equal(kpis.gateHoldMinutes, 395);
  // Only the first runs into its ghost; the rest are the knock-on.
  assert.deepEqual(kpis.conflicts.map((c) => [c.label, c.standId, c.start]), [["XD472/473", "B11", at("11:40")]]);
  // News, not a change: the plan takes it in.
  assert.equal(planKpis().gateHoldMinutes, 395);
});

test("free stand time is the stretches of an hour or more on open stands", () => {
  // C25: in use 09:00–10:00 and 10:45–12:00, so free 05:00–09:00 and 12:00–17:00;
  // the 45 minutes between are too short to count. Every other stand is free all day.
  const kpis = boardKpis(board(null, ["T03-1", "C25", "09:00", "10:00"], ["U01-1", "C25", "10:45", "12:00"]));
  assert.equal(kpis.windows, (STANDS - 1) + 2);
  assert.equal(kpis.freeMinutes, (STANDS - 1) * DAY + 4 * 60 + 5 * 60);
  assert.equal(kpis.standUse, (60 + 75) / (STANDS * DAY));
  assert.equal(kpis.hourlyUse[4].from, at("09:00"));
  assert.equal(kpis.hourlyUse[4].use, 1 / STANDS);
});

test("a late departure keeps its stand in use until it is expected to leave; a late arrival's ghost does not", () => {
  // XD450/451 on A2 07:45–11:40, 35 minutes late in and 30 late out: in use 07:45–12:10.
  const kpis = boardKpis(board(null, ["T06-1", "A2", "07:45", "11:40"]));
  assert.equal(Math.round(kpis.standUse * STANDS * DAY), 265);
  assert.equal(kpis.freeMinutes, (STANDS - 1) * DAY + (2 * 60 + 45) + (4 * 60 + 50));
});

test("a closed area's stands are out of use while it is closed: that time is neither in use nor free", () => {
  // Pier C's eight stands closed 13:00–15:00, with C25 in use 09:00–10:00.
  const pierC = 8;
  const kpis = boardKpis(board({ area: "Pier C", from: at("13:00"), to: at("15:00") }, ["T03-1", "C25", "09:00", "10:00"]));
  // The other stands: one window each. Pier C's: before and after the closure, and C25 also before its stay.
  assert.equal(kpis.windows, (STANDS - pierC) + (pierC - 1) * 2 + 3);
  assert.equal(kpis.freeMinutes, (STANDS - pierC) * DAY + (pierC - 1) * (DAY - 120) + (4 * 60 + 3 * 60 + 2 * 60));
  assert.equal(kpis.standUse, 60 / (STANDS * DAY - pierC * 120));
  assert.equal(kpis.hourlyUse[8].from, at("13:00"));
  assert.equal(kpis.hourlyUse[8].use, 0);
});

test("the figures follow the board, while the plan's stay as they were", () => {
  assert.ok(setRunningLate("T24-1", 110, 110));
  // XC344/345 off B11, out of XD472/473's way: the conflict goes, but
  // XB232/233 still waits for B11, and the knock-on behind it.
  assert.ok(applyPlan(planDrop("T25-1", "A3")));
  const one = boardKpis(standState());
  assert.equal(one.conflicts.length, 1);
  assert.deepEqual(one.holds.map((hold) => hold.label), ["XB232/233", "XA117/118", "XC336/337"]);
  // XB232/233 off too: nobody waits.
  assert.ok(applyPlan(planDrop("T26-1", "B10")));
  assert.equal(boardKpis(standState()).conflicts.length, 0);
  assert.equal(boardKpis(standState()).gateHoldMinutes, 0);

  // XB240 gets a stand; XB210/211 (two flights) loses its own.
  assert.deepEqual(applyAssigns(planAssign(["U01-1"]).assigns), ["U01-1"]);
  assert.deepEqual(unassignStays(["T03-1"]), ["T03-1"]);
  assert.equal(boardKpis(standState()).noStand, 5 - 1 + 2);

  // The plan's own figures stay as they were.
  assert.equal(planKpis().conflicts.length, 1);
  assert.equal(planKpis().gateHoldMinutes, 395);
  assert.equal(planKpis().noStand, 5);
});
