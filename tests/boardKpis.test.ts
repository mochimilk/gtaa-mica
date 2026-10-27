// The board's KPIs (the strip above the chart): conflicts, flights with no
// stand, stand use and free stand time, now and in the plan.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  applyAssigns,
  applyPlan,
  planAssign,
  planDrop,
  resetStands,
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

test("the fixture: two conflicts and five flights with no stand, as the plan has them", () => {
  const now = boardKpis(standState());
  // XA103/104 runs late off A1 at 08:20; XA107/108 was due onto A4 at 09:05.
  assert.deepEqual(
    now.conflicts.map((c) => [c.label, c.standId, c.start]),
    [
      ["XA103/104", "A1", at("08:20")],
      ["XA107/108", "A4", at("09:05")],
    ],
  );
  // Four waiting in the No stand lane, earliest first, and XB241 with no stay times.
  assert.deepEqual(now.waiting.map((w) => w.label), ["XC350", "XB240", "XA130", "XD480"]);
  assert.equal(now.noStand, 5);
  assert.equal(now.untimed, 1);
  assert.equal(now.hourlyUse.length, 12);
  assert.deepEqual(now, planKpis());
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
  // XB210/211 off A1, out of XA103/104's way: one conflict left.
  assert.ok(applyPlan(planDrop("T03-1", "C25")));
  assert.equal(boardKpis(standState()).conflicts.length, 1);

  // XB240 gets a stand; XB210/211 (two flights) loses its own.
  assert.deepEqual(applyAssigns(planAssign(["U01-1"]).assigns), ["U01-1"]);
  assert.deepEqual(unassignStays(["T03-1"]), ["T03-1"]);
  assert.equal(boardKpis(standState()).noStand, 5 - 1 + 2);

  // The plan's own figures never change.
  assert.equal(planKpis().conflicts.length, 2);
  assert.equal(planKpis().noStand, 5);
});
