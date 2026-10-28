// The Studio's drawings, one-colour symbols per aircraft type: painting the
// 9 × 9 pixels, and edits as drafts until they are saved.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLANK,
  GRID,
  discardDraft,
  draftDrawings as drafts,
  fill,
  isBlank,
  paint,
  paintLine,
  saveDrawing,
  savedDrawings as drawings,
  setDraft,
  type Pixels,
} from "../src/studio/drawings.ts";
import { DEMO_DATA } from "../src/stand-timeline-demo/demoData.ts";
import { AIRCRAFT_MAKER } from "../src/stand-timeline-demo/syntheticFixture.ts";

const at = (row: number, col: number) => row * GRID + col;
const on = (pixels: Pixels) => pixels.flatMap((p, i) => (p ? [i] : []));

test("paint turns one pixel on or off, and returns the same pixels when nothing changes", () => {
  const once = paint(BLANK, at(2, 3), true);
  assert.deepEqual(on(once), [at(2, 3)]);
  assert.equal(paint(once, at(2, 3), true), once);
  assert.ok(isBlank(paint(once, at(2, 3), false)));
});

test("a stroke paints every pixel on the line between where it was seen", () => {
  assert.deepEqual(on(paintLine(BLANK, at(0, 0), at(0, 4), true)), [0, 1, 2, 3, 4].map((c) => at(0, c)));
  assert.deepEqual(on(paintLine(BLANK, at(1, 1), at(4, 4), true)), [1, 2, 3, 4].map((n) => at(n, n)));
  // Backwards too, and a single pixel when it starts and ends on one.
  assert.deepEqual(on(paintLine(BLANK, at(8, 8), at(8, 6), true)), [6, 7, 8].map((c) => at(8, c)));
  assert.deepEqual(on(paintLine(BLANK, at(4, 4), at(4, 4), true)), [at(4, 4)]);
});

test("fill floods the pixels like the one clicked, joined side by side, and stops at the others", () => {
  // A wall down column 4 splits the canvas in two.
  let wall = BLANK;
  for (let row = 0; row < GRID; row++) wall = paint(wall, at(row, 4), true);
  const left = fill(wall, at(0, 0), true);
  assert.equal(on(left).length, GRID * 5);
  assert.equal(left[at(0, 5)], false);
  // Filling the wall off clears it alone; filling it on changes nothing.
  assert.ok(isBlank(fill(wall, at(0, 4), false)));
  assert.equal(fill(wall, at(0, 4), true), wall);
  // Diagonal neighbours are not joined.
  const diagonal = paint(paint(BLANK, at(0, 0), true), at(1, 1), true);
  assert.deepEqual(on(fill(diagonal, at(0, 0), false)), [at(1, 1)]);
});

test("edits stay a draft until saved; a blank one saved takes the drawing away", () => {
  const type = "TEST-TYPE";
  const drawing = paint(BLANK, at(4, 4), true);
  setDraft(type, drawing);
  assert.equal(drafts().get(type), drawing);
  assert.equal(drawings().get(type), undefined);

  saveDrawing(type);
  assert.equal(drawings().get(type), drawing);
  assert.equal(drafts().has(type), false);

  // Back to what is saved: no draft. Discarding drops one.
  setDraft(type, paint(drawing, 0, true));
  setDraft(type, [...drawing]);
  assert.equal(drafts().has(type), false);
  setDraft(type, BLANK);
  discardDraft(type);
  assert.equal(drawings().get(type), drawing);

  setDraft(type, BLANK);
  saveDrawing(type);
  assert.equal(drawings().has(type), false);
});

test("every aircraft type on the board starts with its own drawing", () => {
  const onBoard = new Set([...DEMO_DATA.turnsById.values()].map((turn) => turn.aircraftType).filter(Boolean));
  for (const type of onBoard) assert.ok(drawings().has(type), type);
  for (const [type, pixels] of drawings()) {
    assert.ok(type in AIRCRAFT_MAKER, type);
    assert.equal(pixels.length, GRID * GRID);
    assert.ok(!isBlank(pixels), type);
  }
  // No two alike, so each type reads apart.
  const patterns = [...drawings().values()].map((pixels) => pixels.map(Number).join(""));
  assert.equal(new Set(patterns).size, patterns.length);
});
