// The No stand lane: waiting flights laid out above the stands, and what a
// drop into or out of it does.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Occupancy } from "../src/stand-timeline/index.ts";
import { occupancyById, offBoardStay, resetStands, unassignStays } from "../src/operations/allocation.ts";
import {
  FIRST_LANE_ROW,
  isLaneRow,
  keepsTimes,
  layoutLane,
  noStandLane,
  planBoardDrop,
  waitingFlight,
} from "../src/operations/noStandLane.ts";
import { DEMO_DATA } from "../src/stand-timeline-demo/demoData.ts";

afterEach(() => resetStands());

const HOUR = 3_600_000;
const stay = (id: string, start: number, end: number): Occupancy => ({ id, rowId: "", start: start * HOUR, end: end * HOUR });
const rowOf = (lane: ReturnType<typeof layoutLane>, id: string) => lane.stays.find((s) => s.id === id)?.rowId;

test("waiting stays share a row unless they overlap, earliest first", () => {
  const lane = layoutLane([stay("b", 2, 4), stay("a", 1, 3), stay("c", 3, 5), stay("d", 5, 6)]);
  assert.deepEqual(
    lane.rows.map((row) => row.id),
    ["no-stand-1", "no-stand-2"],
  );
  assert.equal(rowOf(lane, "a"), "no-stand-1");
  assert.equal(rowOf(lane, "b"), "no-stand-2");
  // c starts as a ends; d after both.
  assert.equal(rowOf(lane, "c"), "no-stand-1");
  assert.equal(rowOf(lane, "d"), "no-stand-1");
  // Copies on their lane rows: the stays themselves keep no stand.
  assert.ok(lane.stays.every((s) => isLaneRow(s.rowId)));
});

test("the lane keeps one row when nothing is waiting", () => {
  const lane = layoutLane([]);
  assert.deepEqual(
    lane.rows.map((row) => row.id),
    [FIRST_LANE_ROW],
  );
  assert.equal(lane.stays.length, 0);
});

test("held, the lane keeps its rows as stays leave, and new ones fill gaps", () => {
  const before = layoutLane([stay("a", 1, 3), stay("b", 2, 4)]);
  // a leaves: b stays on the second row, and the lane stays two rows tall.
  const after = layoutLane([stay("b", 2, 4)], before);
  assert.equal(after.rows.length, 2);
  assert.equal(rowOf(after, "b"), "no-stand-2");
  // A new stay goes on the first row it fits, the emptied one.
  const joined = layoutLane([stay("b", 2, 4), stay("e", 2, 3)], after);
  assert.equal(rowOf(joined, "e"), "no-stand-1");
  // Released, it packs again.
  assert.equal(layoutLane([stay("b", 2, 4)]).rows.length, 1);
});

test("the fixture's waiting flights are in the lane; one with no stay times is not", () => {
  const lane = noStandLane();
  const ids = lane.stays.map((s) => s.id).sort();
  assert.deepEqual(ids, ["U01-1", "U02-1", "U03-1", "U04-1"]);
  // XC350 (09:10–10:30) and XB240 (09:45–11:10) overlap.
  assert.equal(lane.rows.length, 2);
});

test("a waiting flight dropped on a stand that takes it gets it, keeping its times", () => {
  const drop = planBoardDrop("U01-1", "C25", 45 * 60_000);
  assert.deepEqual(drop, { kind: "assign", stayId: "U01-1", standId: "C25" });
  assert.ok(keepsTimes("U01-1", "C25"));
});

test("a waiting flight dropped where it cannot go is refused, with the stays in the way", () => {
  const busy = DEMO_DATA.occupancies.find((o) => o.rowId === "A1" && o.start < offBoardStay("U01-1")!.end && offBoardStay("U01-1")!.start < o.end);
  assert.ok(busy, "a stay on A1 overlapping XB240");
  const drop = planBoardDrop("U01-1", "A1");
  assert.equal(drop.kind, "conflict");
  assert.ok(drop.kind === "conflict" && drop.blockingIds.includes(busy.id));
});

test("dropped back in the lane, a waiting flight stays put", () => {
  assert.equal(planBoardDrop("U01-1", "no-stand-2").kind, "stay");
});

test("a stay dropped in the lane loses its stand; one with no flight is refused", () => {
  assert.deepEqual(planBoardDrop("T01-1", FIRST_LANE_ROW), { kind: "unassign", stayId: "T01-1", standId: "A1" });
  assert.ok(keepsTimes("T01-1", FIRST_LANE_ROW));
  const flightless = DEMO_DATA.occupancies.find((o) => !waitingFlight(o.id) && !DEMO_DATA.endpoints.get(o.id));
  if (flightless) assert.equal(planBoardDrop(flightless.id, FIRST_LANE_ROW).kind, "conflict");
});

test("a stay on a stand dropped on another stand is planned as before", () => {
  const drop = planBoardDrop("T01-1", "A1");
  assert.equal(drop.kind, "stay");
  assert.ok(!keepsTimes("T01-1", "A1"));
});

test("a stay taken off its stand shows up in the lane, and picking its bar picks its flight", () => {
  unassignStays(["T01-1"]);
  assert.equal(occupancyById("T01-1"), undefined);
  assert.ok(noStandLane().stays.some((s) => s.id === "T01-1"));
  assert.equal(waitingFlight("T01-1")?.id, "T01-ARR");
  assert.equal(waitingFlight("T02-1"), undefined);
});
