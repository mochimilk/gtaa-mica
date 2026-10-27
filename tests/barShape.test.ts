// The chart's bar shapes (stand-timeline/geometry.ts, barPath): round ends as
// a rounded rectangle, a taper's point, a zigzag's teeth, ends that never
// reach past the bar's middle, and outlines grown parallel to their bar.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ROUND_ENDS, barEndDepth, barPath } from "../src/stand-timeline/geometry.ts";

const BOX = { x: 0, y: 0, width: 100, height: 34 };

test("round ends draw a rounded rectangle", () => {
  assert.equal(
    barPath(BOX, ROUND_ENDS, 8),
    "M92,0A8,8 0 0 1 100,8L100,26A8,8 0 0 1 92,34L8,34A8,8 0 0 1 0,26L0,8A8,8 0 0 1 8,0Z",
  );
});

test("a tapered start comes to a point at mid-height, its shoulders 0.3 of the height in", () => {
  assert.equal(barEndDepth("taper", 34), 10.2);
  assert.equal(barPath(BOX, { start: "taper", end: "round" }, 0), "M100,0L100,34L10.2,34L0,17L10.2,0Z");
});

test("a zigzagged end has three teeth reaching out to its edge", () => {
  assert.equal(
    barPath(BOX, { start: "round", end: "zigzag" }, 0),
    "M95.92,0L100,5.67L95.92,11.33L100,17L95.92,22.67L100,28.33L95.92,34L0,34L0,0Z",
  );
});

test("on a narrow bar, neither end reaches past the middle", () => {
  assert.equal(barPath({ x: 0, y: 0, width: 6, height: 34 }, { start: "taper", end: "taper" }, 0), "M6,17L3,34L0,17L3,0Z");
});

test("an outline grows the bar all round, its corners rounder to stay concentric", () => {
  assert.equal(barPath(BOX, ROUND_ENDS, 8, 1.5), barPath({ x: -1.5, y: -1.5, width: 103, height: 37 }, ROUND_ENDS, 9.5));
});

test("an outline's taper stays parallel to the bar's, so its point sits further out", () => {
  // 1.5px off each sloping edge puts the point 1.5 / sin(59°) ≈ 1.75px out.
  assert.match(barPath(BOX, { start: "taper", end: "round" }, 0, 1.5), /L-1\.75,17L/);
});
