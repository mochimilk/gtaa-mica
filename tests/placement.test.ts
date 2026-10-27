// Where a popover about several selected stays goes: by the line between
// them, clear of every selected bar, inside the chart.
import assert from "node:assert/strict";
import test from "node:test";
import { BAR_CLEARANCE, placeBeside, placedBox, type Box } from "../src/operations/placement.ts";

const walls: Box = { left: 0, top: 0, right: 1200, bottom: 800 };
const size = { width: 280, height: 160 };
const gap = 16;
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test("with room beside the line, it sits right by it", () => {
  // Two short bars on rows far apart; the line's middle is well clear of both.
  const bars: Box[] = [
    { left: 100, top: 100, right: 220, bottom: 134 },
    { left: 100, top: 500, right: 220, bottom: 534 },
  ];
  assert.deepEqual(placeBeside({ x: 90, y: 317 }, size, bars, walls, gap), { kind: "beside", position: "after", align: "center", gap });
});

test("it never covers a selected bar: with no clear side by the line, it sits just clear of the pair", () => {
  // Neighbouring stands at the same hours: the line's middle is in the 6px
  // between them, and the lower bar reaches far past it.
  const bars: Box[] = [
    { left: 300, top: 300, right: 520, bottom: 334 },
    { left: 300, top: 340, right: 900, bottom: 374 },
  ];
  const point = { x: 400, y: 337 };
  const placement = placeBeside(point, size, bars, walls, gap);
  const box = placedBox(placement, point, size);
  const keepOff = (bar: Box) => ({ left: bar.left - BAR_CLEARANCE, top: bar.top - BAR_CLEARANCE, right: bar.right + BAR_CLEARANCE, bottom: bar.bottom + BAR_CLEARANCE });
  for (const bar of bars) assert.equal(overlaps(box, keepOff(bar)), false);
  // Right above or below the pair, by the line, not out past the long bar's end.
  assert.ok(box.bottom <= 300 - BAR_CLEARANCE || box.top >= 374 + BAR_CLEARANCE);
  assert.ok(box.left <= point.x && box.right >= point.x, "over the line");
  assert.ok(Math.min(Math.abs(box.bottom - 300), Math.abs(box.top - 374)) <= BAR_CLEARANCE + 8, "close to the pair");
});

test("it keeps inside the chart's walls", () => {
  // By the right wall: after would leave the chart, so it goes before.
  assert.deepEqual(placeBeside({ x: 1180, y: 400 }, size, [], walls, gap), { kind: "beside", position: "before", align: "center", gap });
  // By the top wall: centred beside it would leave the chart, so it goes below.
  assert.deepEqual(placeBeside({ x: 600, y: 20 }, size, [], walls, gap), { kind: "beside", position: "below", align: "center", gap });
});

test("with no clear side, it takes the clear spot nearest the line", () => {
  // Bars hem the point in on every side it could open from.
  const bars: Box[] = [
    { left: 0, top: 360, right: 1200, bottom: 394 },
    { left: 0, top: 406, right: 1200, bottom: 440 },
    { left: 380, top: 0, right: 420, bottom: 800 },
  ];
  const point = { x: 400, y: 400 };
  const placement = placeBeside(point, size, bars, walls, gap);
  assert.equal(placement.kind, "near");
  if (placement.kind === "near") {
    const box = placedBox(placement, point, size);
    assert.ok(bars.every((bar) => !overlaps(box, bar)));
    assert.ok(box.left >= walls.left && box.right <= walls.right && box.top >= walls.top && box.bottom <= walls.bottom);
  }
});

test("once placed, it stays put while that place is still clear", () => {
  const bars: Box[] = [{ left: 100, top: 100, right: 220, bottom: 134 }];
  // Below suits it, though after would be tried first.
  const below = { kind: "beside", position: "below", align: "center", gap } as const;
  assert.deepEqual(placeBeside({ x: 600, y: 300 }, size, bars, walls, gap, below), below);
  // Scrolled so below would leave the chart: it moves.
  assert.notDeepEqual(placeBeside({ x: 600, y: 700 }, size, bars, walls, gap, below), below);
});

test("two stays on one stand: it points at the middle of the line from just below them", () => {
  // The screenshot's case: XA103/104 and XB210/211 both on A1, the dashed
  // line between them at the bars' mid-height.
  const bars: Box[] = [
    { left: 30, top: 90, right: 452, bottom: 147 },
    { left: 617, top: 90, right: 935, bottom: 147 },
  ];
  const point = { x: 535, y: 118 };
  const placement = placeBeside(point, size, bars, walls, gap);
  assert.equal(placement.kind, "beside");
  assert.ok(placement.kind === "beside" && placement.position === "below" && placement.align === "center");
  const box = placedBox(placement, point, size);
  // Centred on the line's middle, just clear of the bars.
  assert.equal(box.left + size.width / 2, point.x);
  assert.ok(box.top >= 147 + BAR_CLEARANCE && box.top <= 147 + BAR_CLEARANCE + 4);
});
