// The Studio's drawings: a 9 × 9 pixel symbol per aircraft type (e.g. every
// A320 shares one), drawn in the Studio and shown in the middle of the bars
// of every aircraft of that type on the board (see
// stand-timeline-demo/theme.tsx). Symbols are one colour: each pixel is on or
// off, and is drawn in whatever text colour it sits in, so a symbol reads the
// same on a dimmed bar or anywhere its colour is changed. Saved changes to
// the samples persist in this browser; edits not yet saved are drafts, kept
// while the app is open. Every sample aircraft type starts with a drawing.
import { useSyncExternalStore } from "react";

/** The canvas is GRID × GRID pixels. */
export const GRID = 9;

/** A drawing: whether each pixel is on, row by row from the top left. */
export type Pixels = readonly boolean[];

/** A canvas with nothing on it. */
export const BLANK: Pixels = Object.freeze(new Array<boolean>(GRID * GRID).fill(false));

export const isBlank = (pixels: Pixels) => !pixels.includes(true);
export const samePixels = (a: Pixels, b: Pixels) => a.length === b.length && a.every((on, i) => on === b[i]);

/** `pixels` with the one at `index` turned on or off; the same array when nothing changes. */
export function paint(pixels: Pixels, index: number, on: boolean): Pixels {
  if (pixels[index] === on) return pixels;
  const next = [...pixels];
  next[index] = on;
  return next;
}

/**
 * `pixels` with every pixel on the straight line from `from` to `to` turned
 * on or off, so a quick stroke leaves no gaps between the pixels it was seen at.
 */
export function paintLine(pixels: Pixels, from: number, to: number, on: boolean): Pixels {
  let [x, y] = [from % GRID, Math.floor(from / GRID)];
  const [x1, y1] = [to % GRID, Math.floor(to / GRID)];
  const [dx, dy] = [Math.abs(x1 - x), -Math.abs(y1 - y)];
  const [sx, sy] = [x < x1 ? 1 : -1, y < y1 ? 1 : -1];
  let err = dx + dy;
  let next = pixels;
  for (;;) {
    next = paint(next, y * GRID + x, on);
    if (x === x1 && y === y1) return next;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Flood fill: the pixel at `index`, and every pixel like it joined to it side by side, turned on or off. */
export function fill(pixels: Pixels, index: number, on: boolean): Pixels {
  const target = pixels[index];
  if (target === on) return pixels;
  const next = [...pixels];
  const stack = [index];
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (next[i] !== target) continue;
    next[i] = on;
    const col = i % GRID;
    if (col > 0) stack.push(i - 1);
    if (col < GRID - 1) stack.push(i + 1);
    if (i >= GRID) stack.push(i - GRID);
    if (i < GRID * (GRID - 1)) stack.push(i + GRID);
  }
  return next;
}

/** A drawing from GRID rows of GRID characters: "#" for a pixel that is on. */
const art = (rows: string[]): Pixels => rows.join("").split("").map((ch) => ch === "#");

/**
 * Each sample aircraft type's starting drawing, by type: an abstract, linear
 * pattern, different for every type, so each reads apart on the board.
 */
const SAMPLE_DRAWINGS: ReadonlyMap<string, Pixels> = new Map([
  // A checkered diamond.
  ["A319", art([
    "....#....",
    "...#.#...",
    "..#.#.#..",
    ".#.#.#.#.",
    "#.#.#.#.#",
    ".#.#.#.#.",
    "..#.#.#..",
    "...#.#...",
    "....#....",
  ])],
  // Vertical stripes.
  ["A320", art([
    "#.#.#.#.#",
    "#.#.#.#.#",
    "#.#.#.#.#",
    "#.#.#.#.#",
    "#.#.#.#.#",
    "#.#.#.#.#",
    "#.#.#.#.#",
    "#.#.#.#.#",
    "#.#.#.#.#",
  ])],
  // Three bars.
  ["A321", art([
    "#########",
    ".........",
    ".........",
    ".........",
    "#########",
    ".........",
    ".........",
    ".........",
    "#########",
  ])],
  // A diamond ring.
  ["A339", art([
    "....#....",
    "...###...",
    "..##.##..",
    ".##...##.",
    "##.....##",
    ".##...##.",
    "..##.##..",
    "...###...",
    "....#....",
  ])],
  // Stacked bars, short and long.
  ["B38M", art([
    "..#####..",
    ".........",
    "#########",
    ".........",
    "..#####..",
    ".........",
    "#########",
    ".........",
    "..#####..",
  ])],
  // Woven bars.
  ["B738", art([
    "#...#...#",
    ".###.###.",
    "#########",
    ".###.###.",
    "#########",
    ".###.###.",
    "#########",
    ".###.###.",
    "#...#...#",
  ])],
  // A comb.
  ["B77W", art([
    ".#.#.#.#.",
    ".#.#.#.#.",
    ".#.#.#.#.",
    ".#.#.#.#.",
    "#########",
    ".#.#.#.#.",
    ".#.#.#.#.",
    ".#.#.#.#.",
    ".#.#.#.#.",
  ])],
  // Scattered dots.
  ["B788", art([
    "#...#...#",
    ".........",
    "..#...#..",
    ".........",
    "#...#...#",
    ".........",
    "..#...#..",
    ".........",
    "#...#...#",
  ])],
  // Stacked zigzags.
  ["B789", art([
    "#...#...#",
    ".#.#.#.#.",
    "..#...#..",
    "#...#...#",
    ".#.#.#.#.",
    "..#...#..",
    "#...#...#",
    ".#.#.#.#.",
    "..#...#..",
  ])],
  // Crosses.
  ["E195", art([
    ".#.....#.",
    "###...###",
    ".#.....#.",
    "....#....",
    "...###...",
    "....#....",
    ".#.....#.",
    "###...###",
    ".#.....#.",
  ])],
]);

/**
 * Only what differs from the samples is stored, by type: a drawing, or null
 * for a sample's taken away. So a change to the samples (a new pattern)
 * reaches every type not edited here.
 */
const STORAGE_KEY = "mica.studio.symbolChanges";
/** Pixels are stored as a string of "1" (on) and "0" (off), row by row. */
const STORED_PIXELS = new RegExp(`^[01]{${GRID * GRID}}$`);

/** A stored drawing's pixels, from `{ pixels }`; undefined when unreadable. */
function readStored(value: unknown): Pixels | undefined {
  const { pixels } = (value ?? {}) as Record<string, unknown>;
  if (typeof pixels !== "string" || !STORED_PIXELS.test(pixels)) return undefined;
  return pixels.split("").map((b) => b === "1");
}

/** The samples, with the changes saved in this browser; the samples alone when storage is unavailable. */
function load(): ReadonlyMap<string, Pixels> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return SAMPLE_DRAWINGS;
    const drawings = new Map(SAMPLE_DRAWINGS);
    for (const [type, value] of Object.entries(parsed)) {
      const drawing = readStored(value);
      if (value === null) drawings.delete(type);
      else if (drawing) drawings.set(type, drawing);
    }
    return drawings;
  } catch {
    return SAMPLE_DRAWINGS;
  }
}

function persist() {
  const changes: Record<string, { pixels: string } | null> = {};
  for (const [type, pixels] of saved) {
    const sample = SAMPLE_DRAWINGS.get(type);
    if (!sample || !samePixels(pixels, sample)) changes[type] = { pixels: pixels.map(Number).join("") };
  }
  for (const type of SAMPLE_DRAWINGS.keys()) if (!saved.has(type)) changes[type] = null;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(changes));
  } catch {
    // Not kept past this session; the drawings still show while the app is open.
  }
}

let saved = load();
let drafts: ReadonlyMap<string, Pixels> = new Map();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Each aircraft type's saved drawing, by type; a new map whenever one changes. */
export const savedDrawings = () => saved;

/** Each aircraft type's unsaved edits, by type; a new map whenever one changes. */
export const draftDrawings = () => drafts;

/** savedDrawings, re-rendering when they change. */
export const useDrawings = () => useSyncExternalStore(subscribe, savedDrawings);

/** draftDrawings, re-rendering when they change. */
export const useDrafts = () => useSyncExternalStore(subscribe, draftDrawings);

/** Sets the aircraft type's unsaved edits. Edits that match what is saved (or a blank canvas, with nothing saved) are no draft. */
export function setDraft(aircraftType: string, pixels: Pixels) {
  const same = samePixels(pixels, saved.get(aircraftType) ?? BLANK);
  if (same ? !drafts.has(aircraftType) : drafts.get(aircraftType) === pixels) return;
  const next = new Map(drafts);
  if (same) next.delete(aircraftType);
  else next.set(aircraftType, pixels);
  drafts = next;
  emit();
}

/** Drops the aircraft type's unsaved edits, back to its saved drawing. */
export function discardDraft(aircraftType: string) {
  if (!drafts.has(aircraftType)) return;
  const next = new Map(drafts);
  next.delete(aircraftType);
  drafts = next;
  emit();
}

/** Saves the aircraft type's edits as its drawing. A blank canvas takes its drawing away. */
export function saveDrawing(aircraftType: string) {
  const draft = drafts.get(aircraftType);
  if (!draft) return;
  const nextSaved = new Map(saved);
  if (isBlank(draft)) nextSaved.delete(aircraftType);
  else nextSaved.set(aircraftType, draft);
  saved = nextSaved;
  const nextDrafts = new Map(drafts);
  nextDrafts.delete(aircraftType);
  drafts = nextDrafts;
  persist();
  emit();
}
