// How Skye's cursor carries out each app action on the real controls.
//
// Every change Skye makes is clicked through the same UI a person would use,
// and all of it on the board: the flight's bar on the timeline (Ctrl-clicked
// to select several), which for a flight waiting for a stand is its bar in
// the No stand lane pinned above the stands (see ./noStandLane); for a stand
// change, the bar dragged up or down to its new stand, as a person drags it;
// a waiting flight dragged straight down out of the lane onto its stand, and
// a stay dragged straight up into the lane to take its stand away; the Views
// and Filters menus and their items. Skye never works in the operations
// panel: the Arrivals and Departures lists are the user's. The clicks are real
// (see cursorMotion.ts), so the UI responds exactly as it does to a person.
// The executor then applies the action once more as a guarantee; every action
// is idempotent, so that changes nothing when the clicks already did it, and
// fixes the result when a click could not land (a control off screen, a menu
// that did not open in time).
//
// Controls are found by data-ops-* attributes set on them for this purpose.
//
// Closing a stand area is the one action Skye carries out with several
// cursors at once (see closeArea below and docs/multi-agent-demo.md).
import {
  agentCursor,
  agentHelpers,
  showTethers,
  type AgentCursorController,
  type ClickOptions,
  type Tethers,
} from "../components/agent-cursor";
import type { AppAction, SelectionMode } from "../live/appActions";
import { rowsViewport, sectionOf } from "../stand-timeline";
import { DEMO_DATA, DEMO_DOMAIN } from "../stand-timeline-demo/demoData";
import {
  areaMoveState,
  assignState,
  checkSwap,
  flightsAtStay,
  occupancyById,
  offBoardStay,
  planDrop,
  setClosure,
  standArea,
  standState,
  stayName,
  stayOfFlight,
  type AreaMove,
  type StandAssign,
} from "./allocation";
import { boardKpis } from "./boardKpis";
import { lateTag } from "./disruption";
import { FIRST_LANE_ROW, isLaneRow } from "./noStandLane";
import { formatDuration, OPS_FLIGHTS_BY_ID, type OpsFlight } from "./operationsData";
import { skyeTakesHold } from "./skyeReview";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pause after a menu opens, so its entrance animation has settled before aiming. */
const MENU_SETTLE_MS = 160;

const isShown = (element: Element | null): element is Element =>
  element instanceof HTMLElement
    ? element.offsetParent !== null || getComputedStyle(element).position === "fixed"
    : element !== null && element.getClientRects().length > 0;

const shown = (selector: string) => {
  const element = document.querySelector(selector);
  return isShown(element) ? element : null;
};

/** Polls until `find` returns something, or gives up after `timeoutMs`. */
async function waitFor<T>(find: () => T | null, signal: AbortSignal, timeoutMs = 1_200): Promise<T | null> {
  const until = performance.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found || signal.aborted || performance.now() > until) return found;
    await wait(30);
  }
}

/* ---------------------------------------------------------------- aiming */

/** Menu items are clicked over their label, a little in from the left. */
function aimAtMenuItem(rect: DOMRect) {
  return {
    x: rect.left + Math.min(rect.width * 0.35, 48) + Math.random() * 24,
    y: rect.top + rect.height / 2 + (Math.random() * 4 - 2),
  };
}

/**
 * The part of the chart where the stands' bars really show: inside its
 * scroller, between the pinned time rulers, below the No stand lane and right
 * of the pinned stand column. The cursor scrolls a bar into this, and aims
 * inside it.
 */
const chartVisibleBox = (scroller: Element): DOMRect => rowsViewport(scroller);

/**
 * Where the rows a bar is among show: the No stand lane's strip for a waiting
 * flight's bar, which only ever scrolls along, or the stands' (chartVisibleBox).
 */
const rowsBoxOf = (selector: string) => (scroller: Element) => {
  const bar = shown(selector);
  return rowsViewport(scroller, bar ? sectionOf(bar) : "body");
};

/**
 * Bars are clicked a little in from their start, where the flight number is,
 * on the part of a long bar that shows.
 */
function aimAtBar(rect: DOMRect) {
  const scroller = document.querySelector(".st-scroller");
  const box = scroller ? chartVisibleBox(scroller) : rect;
  const left = Math.max(rect.left, box.left + 4);
  const right = Math.min(rect.right, box.right - 4);
  const span = Math.max(0, right - left);
  return {
    x: left + Math.min(span * (0.25 + Math.random() * 0.3), 18 + Math.random() * 30),
    y: rect.top + rect.height / 2 + (Math.random() * 4 - 2),
  };
}

/* --------------------------------------------------------------- pieces */

function click(find: () => Element | null, signal: AbortSignal, options: Omit<ClickOptions, "signal"> = {}) {
  return agentCursor.click(find, { signal, ...options });
}

/** Opens the Views or Filters menu, unless it is already open. */
async function openMenu(menu: "views" | "filters", item: string, signal: AbortSignal): Promise<Element | null> {
  if (!shown(item)) {
    await click(() => shown(`[data-ops-menu="${menu}"]`), signal, { last: false });
  }
  const found = await waitFor(() => shown(item), signal);
  if (found) await wait(MENU_SETTLE_MS);
  return found;
}

/* --------------------------------------------------------------- actions */

/** A stay's bar: on its stand, or in the No stand lane while it waits for one. */
const barOf = (stayId: string) => `[data-occupancy-id="${CSS.escape(stayId)}"]`;
/** A flight's bar on a stand; null while it has none. */
const barSelector = (flight: OpsFlight) => (flight.occupancyId ? barOf(flight.occupancyId) : null);

const isBarSelected = (selector: string) => shown(selector)?.getAttribute("aria-pressed") === "true";

/** Clicks a bar on the timeline, scrolling the chart to it first (a bar in the No stand lane only along). */
function clickBar(selector: string, signal: AbortSignal, options: Omit<ClickOptions, "signal"> = {}) {
  return click(() => shown(selector), signal, { aim: aimAtBar, visibleBox: rowsBoxOf(selector), ...options });
}

/**
 * Its bar: on its stand, or, for a flight waiting for one, in the No stand
 * lane. A flight with no stay times has no bar anywhere; there is nothing to
 * click, and the apply selects it.
 */
async function selectFlight(flight: OpsFlight, signal: AbortSignal): Promise<void> {
  const stayId = flight.occupancyId ?? flight.unplacedStay?.stayId;
  if (stayId && shown(barOf(stayId))) await clickBar(barOf(stayId), signal);
}

/**
 * Several flights' bars, as a person selects them: a plain click on the first
 * to start a new selection, then Ctrl-clicks to add each of the others. When
 * adding, every click is a Ctrl-click, and a bar that is already selected is
 * left alone, since Ctrl-clicking it again would deselect it. An arrival and
 * a departure on one stay share a bar, which is clicked once. Flights without
 * a stand have no bar and cannot join a chart selection; the apply says so.
 */
async function selectFlights(flights: readonly OpsFlight[], mode: SelectionMode, signal: AbortSignal): Promise<void> {
  const bars = [...new Set(flights.flatMap((flight) => barSelector(flight) ?? []))];
  let fresh = mode === "replace";
  for (const [index, bar] of bars.entries()) {
    if (signal.aborted) return;
    if (!fresh && isBarSelected(bar)) continue;
    await clickBar(bar, signal, { modifiers: fresh ? undefined : { ctrlKey: true }, last: index === bars.length - 1 });
    fresh = false;
  }
}

/**
 * The details popover's dismiss button when it is open. With the popover
 * closed but something still selected, a click on an empty part of the
 * chart, which clears a selection just the same.
 */
async function clearSelection(signal: AbortSignal): Promise<void> {
  // Skye's own selection has no details popover, and the user's is theirs:
  // an empty part of the chart clears hers, as it would anyone's.
  const empty = emptyChartPoint();
  if (!empty) return;
  await click(() => empty.element, signal, { aim: () => empty.point });
}

/** A point on the chart's grid with no bar under it, near the middle where possible. */
function emptyChartPoint(): { element: Element; point: { x: number; y: number } } | null {
  const scroller = shown(".st-scroller");
  if (!scroller) return null;
  const box = scroller.getBoundingClientRect();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const point = {
      x: box.left + box.width * (0.3 + Math.random() * 0.5),
      y: box.top + box.height * (0.25 + Math.random() * 0.5),
    };
    const hit = document.elementFromPoint(point.x, point.y);
    // A ghost selects its bar when clicked, so it is not empty either; and
    // the No stand lane is left alone, a place for waiting flights.
    if (hit && scroller.contains(hit) && !hit.closest("[data-occupancy-id], [data-ghost-of], .st-header, .st-footer, .st-labels, .st-pinned")) {
      return { element: hit, point };
    }
  }
  return null;
}

/** Where a row is on screen, a stand's or one of the No stand lane's, from its label in the pinned stand column. */
function rowCentre(rowId: string): number | null {
  const label = document.querySelector(`.st-row-label[data-row-id="${CSS.escape(rowId)}"]`);
  const rect = label?.getBoundingClientRect();
  return rect && rect.height > 0 ? rect.top + rect.height / 2 : null;
}

/** Screen pixels per ms along the chart's time axis, as it is drawn now. */
function pixelsPerMs(): number | null {
  const width = shown(".st-plot")?.getBoundingClientRect().width ?? 0;
  return width > 0 ? width / (DEMO_DOMAIN[1] - DEMO_DOMAIN[0]) : null;
}

type DragStayOptions = {
  /** Whose hands: Skye's own cursor by default, or one of its helpers. */
  cursor?: AgentCursorController;
  /** How far along in time it goes; 0 keeps its times. */
  shiftMs?: number;
  /**
   * Whether the cursor may scroll the chart: to bring the bar fully into
   * view first, and waiting at its edge for an off-screen target to scroll
   * into view. Helpers may not: they share the chart, and only the primary
   * pointer scrolls it, so what they are given must show already (inReach).
   */
  scroll?: boolean;
};

/**
 * Drags a stay's bar onto row `rowId`: a stand, or the No stand lane. Keeping
 * its times, it goes straight up or down, landing at the x it was taken at;
 * moved in time (`shiftMs`), it goes across as well. The chart previews the
 * drop as the cursor holds over it, then the drop lands. The bar may be a
 * waiting flight's in the lane, going down onto a stand, or a stay going up
 * into the lane; the lane is always in view, so nothing waits for it to show.
 * The Outputs panel lists the stay as being worked on from the moment the
 * cursor sets off for it, until it lands.
 */
async function dragStay(
  occupancyId: string,
  rowId: string,
  signal: AbortSignal,
  { cursor = agentCursor, shiftMs = 0, scroll = true }: DragStayOptions = {},
): Promise<void> {
  const bar = barOf(occupancyId);
  let grabX: number | null = null;
  skyeTakesHold(occupancyId, isLaneRow(rowId) ? "" : rowId, shiftMs);
  await cursor.drag(
    () => shown(bar),
    () => {
      const y = rowCentre(rowId);
      const perMs = pixelsPerMs();
      return y === null || grabX === null || perMs === null ? null : { x: grabX + shiftMs * perMs, y };
    },
    {
      signal,
      aim: (rect) => {
        const point = aimAtBar(rect);
        grabX = point.x;
        return point;
      },
      visibleBox:
        scroll && !isLaneRow(rowId)
          ? () => {
              const scroller = shown(".st-scroller");
              return scroller ? chartVisibleBox(scroller) : null;
            }
          : undefined,
      scrollBox: rowsBoxOf(bar),
      reveal: scroll,
    },
  );
}

/** A move onto free time: one drag, when the rules allow it. */
async function moveStay(flight: OpsFlight, standId: string, signal: AbortSignal): Promise<void> {
  const stay = stayOfFlight(flight);
  if (stay && planDrop(stay.id, standId).kind === "move") await dragStay(stay.id, standId, signal);
}

/**
 * A swap, when the rules allow it. Stays that overlap in time trade places
 * when one is dropped on the other, so that is one drag; stays that do not
 * would only move, so each is dragged to the other's stand in turn.
 */
async function swapStays(a: OpsFlight, b: OpsFlight, signal: AbortSignal): Promise<void> {
  const first = stayOfFlight(a);
  const second = stayOfFlight(b);
  if (!first || !second || !checkSwap(first.id, second.id).ok) return;
  const [firstStand, secondStand] = [first.rowId, second.rowId];
  const drop = planDrop(first.id, secondStand);
  if (drop.kind === "swap" && drop.otherId === second.id) return dragStay(first.id, secondStand, signal);
  if (drop.kind !== "move") return;
  await dragStay(first.id, secondStand, signal);
  if (!signal.aborted && planDrop(second.id, firstStand).kind === "move") await dragStay(second.id, firstStand, signal);
}

/* ------------------------------------------------- several cursors at once */

/** How many helpers Skye splits into for `count` moves: about one per two moves, two to five. */
const crewSize = (count: number) => Math.min(agentHelpers.length, Math.max(2, Math.ceil(count / 2)));

/** Rounds of work, each after framing the chart on what is left; the apply lands anything after that. */
const MAX_ROUNDS = 5;

/** Kept clear of the work area's edges, px, so nothing is grabbed or dropped half out of view. */
const REACH_MARGIN = 14;

/** A cover running across at least this share of the chart's width is a band, trimmed off the work area. */
const BAND_SHARE = 0.5;

/** What is open over the chart and says so (`data-agent-avoid`: the Ask chat, the call window), on screen now. */
const covers = (): DOMRect[] =>
  [...document.querySelectorAll("[data-agent-avoid]")]
    .map((cover) => cover.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);

/** Whether a point is under any of `rects`, with REACH_MARGIN to spare. */
const covered = (point: { x: number; y: number }, rects: readonly DOMRect[]) =>
  rects.some(
    (rect) =>
      point.x > rect.left - REACH_MARGIN &&
      point.x < rect.right + REACH_MARGIN &&
      point.y > rect.top - REACH_MARGIN &&
      point.y < rect.bottom + REACH_MARGIN,
  );

/**
 * Where bars show and can be worked on: the chart's visible box, less any
 * cover that runs across most of it (a band, such as the Ask chat docked
 * below it), trimmed off the side its middle is on. A narrower cover, such as
 * the call window in a corner, leaves the box whole: what lies under it is
 * out of reach point by point (see inReach). Trimming by a narrow window, or
 * by a tall one's top edge, could leave no box at all, and then nothing
 * would be in reach and every stay would land at once, unanimated.
 */
function workBox(): DOMRect | null {
  const scroller = shown(".st-scroller");
  if (!scroller) return null;
  const box = chartVisibleBox(scroller);
  let { top, bottom } = box;
  for (const rect of covers()) {
    const across = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
    if (across < box.width * BAND_SHARE || rect.bottom <= top || rect.top >= bottom) continue;
    if (rect.top + rect.height / 2 > box.top + box.height / 2) bottom = Math.min(bottom, rect.top);
    else top = Math.max(top, rect.bottom);
  }
  return new DOMRect(box.left, top, box.width, Math.max(0, bottom - top));
}

/** Where a move happens on screen now: its bar and the row it goes to, or null when either is missing. */
function moveSpan(move: AreaMove) {
  const bar = shown(`[data-occupancy-id="${CSS.escape(move.occupancyId)}"]`)?.getBoundingClientRect();
  const rowY = rowCentre(move.standId);
  const perMs = pixelsPerMs();
  if (!bar || rowY === null || perMs === null) return null;
  return { bar, barY: bar.top + bar.height / 2, rowY, shiftPx: move.shiftMs * perMs };
}

/**
 * Whether a helper can drag this move where the chart is now, without
 * scrolling it: enough of the bar shows to take hold of, and the row and
 * time it goes to show too, all clear of anything covering the chart. The
 * helpers share one chart, and none of them scrolls it, so this holds for
 * as long as they work.
 */
function inReach(move: AreaMove): boolean {
  const span = moveSpan(move);
  const box = workBox();
  if (!span || !box) return false;
  const inside = (value: number, low: number, high: number) => value > low + REACH_MARGIN && value < high - REACH_MARGIN;
  const left = Math.max(span.bar.left, box.left + REACH_MARGIN);
  const right = Math.min(span.bar.right, box.right - REACH_MARGIN);
  if (
    right - left < 12 ||
    !inside(span.barY, box.top, box.bottom) ||
    !inside(span.rowY, box.top, box.bottom) ||
    !inside(left + span.shiftPx, box.left, box.right)
  ) {
    return false;
  }
  // Where it is taken hold of (a little in from where it shows; see
  // aimAtBar) and where it is let go, both clear of anything over the chart.
  const over = covers();
  const grabs = [left, Math.min(right, left + 48)];
  return grabs.every(
    (x) => !covered({ x, y: span.barY }, over) && !covered({ x: x + span.shiftPx, y: span.rowY }, over),
  );
}

/** How long the chart must hold still after scrolling to count as settled, ms. */
const SCROLL_STILL_MS = 120;

/** Smooth-scrolls the chart so `point` (on screen now) is centred in the work area, and waits for it to settle. */
async function centreChartOn(point: { x: number; y: number }, signal: AbortSignal): Promise<void> {
  const scroller = shown(".st-scroller");
  const box = workBox();
  if (!(scroller instanceof HTMLElement) || !box) return;
  const left = scroller.scrollLeft + point.x - (box.left + box.width / 2);
  const top = scroller.scrollTop + point.y - (box.top + box.height / 2);
  if (Math.abs(left - scroller.scrollLeft) < 8 && Math.abs(top - scroller.scrollTop) < 8) return;
  // Settled once the scroll ends (scrollend), or after 1.2s where it does not
  // say; then, in case it said so early, once it has held still for a few
  // frames (two looks a frame apart can both fall between the frames of a
  // busy page). A cursor that aimed while the chart still glided would take
  // hold of where a bar was, not where it is, and a helper judging what is in
  // reach would drag to where its row was.
  let ended = false;
  const end = () => (ended = true);
  scroller.addEventListener("scrollend", end, { once: true });
  scroller.scrollTo({ left, top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  await waitFor(() => ended || null, signal, 1_200);
  scroller.removeEventListener("scrollend", end);
  let at = `${scroller.scrollLeft},${scroller.scrollTop}`;
  let since = performance.now();
  await waitFor(
    () => {
      const now = `${scroller.scrollLeft},${scroller.scrollTop}`;
      if (now !== at) {
        at = now;
        since = performance.now();
      }
      return performance.now() - since >= SCROLL_STILL_MS || null;
    },
    signal,
    1_200,
  );
}

/**
 * Frames the chart on work still to do: on the most of it whose rows (the one
 * each move leaves and the one it goes to; the one each flight with no stand
 * lands on) fit in the work area together, so the next round reaches as much
 * as it can.
 */
async function frameMoves(moves: readonly AreaMove[], signal: AbortSignal, assigns: readonly StandAssign[] = []): Promise<void> {
  const box = workBox();
  const spans = [
    ...moves.flatMap((move) => {
      const span = moveSpan(move);
      if (!span) return [];
      const xs = [span.bar.left, Math.min(span.bar.right, span.bar.left + 120) + span.shiftPx];
      return [{ low: Math.min(span.barY, span.rowY), high: Math.max(span.barY, span.rowY), xs }];
    }),
    ...assigns.flatMap((assign) => {
      const stay = flightsAtStay(assign.stayId)[0]?.unplacedStay;
      const point = stay ? landingPoint(assign.standId, stay.start, stay.end, false) : null;
      return point ? [{ low: point.y, high: point.y, xs: [point.x] }] : [];
    }),
  ];
  if (!box || spans.length === 0) return;
  const room = box.height - 4 * REACH_MARGIN;
  let framed = spans.slice(0, 1);
  for (const first of spans) {
    const group = spans.filter((span) => span.low >= first.low && span.high <= first.low + room);
    if (group.length > framed.length) framed = group;
  }
  const y = framed.flatMap((span) => [span.low, span.high]);
  const x = framed.flatMap((span) => span.xs);
  await centreChartOn({ x: (Math.min(...x) + Math.max(...x)) / 2, y: (Math.min(...y) + Math.max(...y)) / 2 }, signal);
}

/** "XD456/457 → C25", "XC338/339 → C24 +15m": a helper's job, on its tag. */
function moveLabel(move: AreaMove): string {
  const occupancy = occupancyById(move.occupancyId);
  const name = occupancy ? stayName(occupancy) : move.occupancyId;
  return `${name} → ${move.standId}${move.shiftMs ? ` +${Math.round(move.shiftMs / 60_000)}m` : ""}`;
}

/** One piece of work for a helper: a stay moved, or a waiting flight given its stand. */
type FixJob = { move: AreaMove } | { assign: StandAssign };

/** Where a job's stay lands: the stand, and its hours there. */
function landing(job: FixJob): { stayId: string; standId: string; start: number; end: number } | null {
  if ("assign" in job) {
    const stay = offBoardStay(job.assign.stayId);
    return stay ? { stayId: stay.id, standId: job.assign.standId, start: stay.start, end: stay.end } : null;
  }
  const stay = occupancyById(job.move.occupancyId);
  const start = job.move.fromStart + job.move.shiftMs;
  return stay ? { stayId: stay.id, standId: job.move.standId, start, end: start + stay.end - stay.start } : null;
}

/**
 * The move that makes room for a job: one taking another stay off the stand
 * the job's stay lands on, at hours that overlap, so the job could only be
 * planned there because of it.
 */
function madeRoomBy(job: FixJob, moves: readonly AreaMove[]): AreaMove | undefined {
  const lands = landing(job);
  if (!lands) return undefined;
  return moves.find((move) => {
    const stay = occupancyById(move.occupancyId);
    if (!stay || stay.id === lands.stayId || move.fromStand !== lands.standId) return false;
    return move.fromStart < lands.end && lands.start < move.fromStart + stay.end - stay.start;
  });
}

/**
 * Hands out a crew's jobs so that one a helper's move made room for
 * (madeRoomBy, among `moves`) is tethered from that helper, its work having
 * made the job, and waits until that move is made; any other is tethered
 * from Skye. The returned function has `helper` do `job` with `work`, or
 * returns null, doing nothing, when the move it waits on is left for a later
 * round. It claims a move before waiting, so a job taken up just after it
 * waits for it rather than for the next round.
 */
function crewJobs(tethers: Tethers, moves: readonly AreaMove[]) {
  const makers = new Map<AreaMove, { helper: AgentCursorController; made: Promise<void> }>();
  return (helper: AgentCursorController, job: FixJob, work: () => Promise<void>): Promise<void> | null => {
    const room = madeRoomBy(job, moves);
    const maker = room && makers.get(room);
    if (room && !maker && areaMoveState(room) === "pending") return null;
    const made = (async () => {
      await maker?.made;
      tethers.from(helper, maker && maker.helper !== helper ? maker.helper : null);
      await work();
    })();
    if ("move" in job) makers.set(job.move, { helper, made });
    return made;
  };
}

/** Has each of `crew` that is not out come out of Skye's dot (or orb) for its next job. */
function spawnCrew(crew: readonly { controller: AgentCursorController }[]): void {
  const from = agentCursor.position;
  if (from) for (const { controller } of crew) controller.spawnFrom(from);
}

/** A helper with nothing more to do goes back into Skye's orb; it comes out again for more (spawnCrew). */
const backToSkye = (helper: AgentCursorController) => helper.retire(() => agentCursor.position);

/** The middle of the screen, where Skye's orb sits while her helpers work. */
const screenCentre = () => ({ x: innerWidth / 2, y: innerHeight / 2 });

/**
 * Keeps Skye's cursor in the middle of the screen while her helpers work:
 * once the window has been resized, it goes back there. Returns the stop.
 */
function holdCentre(signal: AbortSignal): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resized = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void agentCursor.moveTo(screenCentre, { signal }), 150);
  };
  addEventListener("resize", resized);
  return () => {
    clearTimeout(timer);
    removeEventListener("resize", resized);
  };
}

/**
 * Closes a stand area with several cursors at once. The area's closure shows
 * on the chart, the chart glides to it, and Skye's cursor goes to the middle
 * of the screen, over it. There it splits: helpers peel off its dot, which
 * becomes an orb and stays there, each tagged with its job, and between them
 * take the stays off the area, each dragging one stay at a time to where it
 * was planned to go while the others do the same; Skye's tag counts them
 * off, and the ring round her orb fills. Stays out of view wait for the next
 * round: the chart is framed on what is left and the helpers go again. Then
 * they merge back into Skye's orb, and it is a dot again. The apply that
 * follows lands whatever the cursors did not.
 */
async function closeArea(action: Extract<AppAction, { name: "close_area" }>, signal: AbortSignal): Promise<void> {
  setClosure({ area: action.area, from: action.from, to: action.to });
  const todo = action.moves.filter((move) => areaMoveState(move) === "pending");
  let moved = 0;
  const progress = () => {
    agentCursor.setTask(`${action.area} closed · ${moved}/${todo.length} moved`);
    agentCursor.setProgress(todo.length > 0 ? moved / todo.length : 1);
  };

  const band = await waitFor(() => shown("[data-closure-band]"), signal);
  progress();
  if (band) {
    // The whole closure in view first, so as many of its stays as can be are within reach.
    const rect = band.getBoundingClientRect();
    await centreChartOn({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, signal);
    // With nothing on it to move, Skye just shows where it is.
    if (todo.length === 0) {
      await agentCursor.hover(() => shown("[data-closure-band]"), {
        signal,
        visibleBox: chartVisibleBox,
        // Near its top-left, by its label.
        aim: (box) => ({ x: box.left + Math.min(box.width * 0.3, 140), y: box.top + 10 }),
      });
    }
  }
  if (signal.aborted || todo.length === 0) return;
  await agentCursor.moveTo(screenCentre, { signal });
  if (signal.aborted) return;

  const crew = agentHelpers.slice(0, crewSize(todo.length));
  // Lines from Skye out to each helper while it works, and Skye an orb meanwhile.
  const tethers = showTethers(
    agentCursor,
    crew.map(({ controller }) => controller),
  );
  agentCursor.setOrb(true);
  const release = holdCentre(signal);
  const take = crewJobs(tethers, todo);
  let left = todo;
  try {
    for (let round = 0; round < MAX_ROUNDS && left.length > 0 && !signal.aborted; round += 1) {
      if (round > 0) await frameMoves(left, signal);
      spawnCrew(crew);
      const queue = [...left];
      const later: AreaMove[] = [];
      const before = moved;
      await Promise.all(
        // All at once: they split off Skye together, each to its first stay,
        // and each goes back into her once there is nothing left for it.
        crew.map(async ({ controller: helper }) => {
          for (let move = queue.shift(); move && !signal.aborted; move = queue.shift()) {
            if (areaMoveState(move) !== "pending") continue;
            const made = inReach(move)
              ? take(helper, { move }, async () => {
                  helper.setTask(moveLabel(move));
                  await dragStay(move.occupancyId, move.standId, signal, { cursor: helper, shiftMs: move.shiftMs, scroll: false });
                })
              : null;
            if (!made) {
              later.push(move);
              continue;
            }
            await made;
            if (areaMoveState(move) === "done") {
              moved += 1;
              progress();
            }
          }
          helper.setTask(null);
          await backToSkye(helper);
        }),
      );
      left = later.filter((move) => areaMoveState(move) === "pending");
      // Framing brought nothing within reach: more rounds would not either.
      if (round > 0 && moved === before) break;
    }
  } finally {
    // Back into Skye's orb, also when stopped part way; their lines go with
    // them, and the orb becomes a dot again.
    release();
    await Promise.all(crew.map(({ controller: helper }) => backToSkye(helper)));
    tethers.stop();
    agentCursor.setOrb(false);
  }
  if (signal.aborted) return;
  // Back to the area, now clear. The tally goes: the apply lands anything the
  // cursors did not, and Skye's reply says what moved.
  agentCursor.setTask(null);
  const cleared = shown("[data-closure-band]");
  if (cleared) {
    const rect = cleared.getBoundingClientRect();
    await centreChartOn({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, signal);
    await agentCursor.hover(() => shown("[data-closure-band]"), {
      signal,
      aim: (box) => ({ x: box.left + Math.min(box.width * 0.3, 140), y: box.top + 10 }),
    });
  }
}

/**
 * Whether the user has something of their own open that Skye's clicks on the
 * toolbar would get in the way of: a menu they opened (data-opened-by, see
 * ViewsFiltersToolbar) or their selection details. Skye then makes the
 * change without clicking through it; the apply does it.
 */
const userHasOpen = () => !!document.querySelector('[data-opened-by="user"], .ops-popover');

async function setView(view: string, signal: AbortSignal): Promise<void> {
  if (userHasOpen()) return;
  const item = `[data-ops-view="${CSS.escape(view)}"]`;
  if (!(await openMenu("views", item, signal))) return;
  // A radio item closes the menu as it is picked.
  await click(() => shown(item), signal, { aim: aimAtMenuItem });
}

/** Ticks and unticks one filter group's items until they match `values`, then closes the menu. */
async function setFilter(dimension: string, values: readonly string[], signal: AbortSignal): Promise<void> {
  if (userHasOpen()) return;
  const items = `[data-ops-filter-dim="${CSS.escape(dimension)}"]`;
  if (!(await openMenu("filters", items, signal))) return;
  const wanted = new Set(values);
  const toToggle = [...document.querySelectorAll(items)]
    .filter((item) => (item.getAttribute("aria-checked") === "true") !== wanted.has(item.getAttribute("data-ops-filter-value") ?? ""))
    .map((item) => item.getAttribute("data-ops-filter-value") ?? "");
  for (const value of toToggle) {
    if (signal.aborted) return;
    const selector = `${items}[data-ops-filter-value="${CSS.escape(value)}"]`;
    await click(() => shown(selector), signal, { aim: aimAtMenuItem, last: false });
  }
  // Checkbox items keep the menu open; close it the way it was opened.
  await click(() => shown(`[data-ops-menu="filters"]`), signal);
}

async function resetFilters(signal: AbortSignal): Promise<void> {
  if (userHasOpen()) return;
  const item = "[data-ops-filter-reset]";
  if (!(await openMenu("filters", item, signal))) return;
  const reset = shown(item);
  const disabled = reset?.getAttribute("aria-disabled") === "true" || reset?.hasAttribute("disabled");
  // Nothing to reset: close the menu again instead.
  await click(() => (disabled ? shown(`[data-ops-menu="filters"]`) : shown(item)), signal, {
    aim: disabled ? undefined : aimAtMenuItem,
  });
}

/**
 * Where a stay with no stand would sit on `standId`, on screen now: the
 * middle of its hours on that stand's row, kept (with `inView`) to the part
 * of the chart that shows. Null when the row or the chart is not laid out.
 */
function landingPoint(standId: string, start: number, end: number, inView = true): { x: number; y: number } | null {
  const y = rowCentre(standId);
  const plot = shown(".st-plot")?.getBoundingClientRect();
  const perMs = pixelsPerMs();
  if (y === null || !plot || perMs === null) return null;
  const x0 = plot.left + (start - DEMO_DOMAIN[0]) * perMs;
  const x1 = plot.left + (end - DEMO_DOMAIN[0]) * perMs;
  const box = workBox();
  if (!inView || !box) return { x: (x0 + x1) / 2, y };
  const low = Math.max(x0, box.left + REACH_MARGIN);
  const high = Math.min(x1, box.right - REACH_MARGIN);
  return { x: low <= high ? (low + high) / 2 : Math.min(Math.max((x0 + x1) / 2, box.left), box.right), y };
}

/**
 * One flight waiting for a stand, carried straight down out of the No stand
 * lane onto its stand, as a person drags it. The chart glides to the stand at
 * the flight's hours first when they are out of view (the lane, pinned above
 * the stands, glides along with it), so the drop lands where it shows; then
 * Skye takes hold of its bar, its ghost shows on the stand, and it is let go
 * there.
 */
async function placeWaiting(
  assign: StandAssign,
  signal: AbortSignal,
  /** A helper's hands, with `prepare` false: it does not move the chart (they share one), so the stand must already show. */
  { cursor = agentCursor, prepare = true }: { cursor?: AgentCursorController; prepare?: boolean } = {},
): Promise<void> {
  const stay = offBoardStay(assign.stayId);
  if (!stay) return;
  if (prepare) {
    const point = landingPoint(assign.standId, stay.start, stay.end, false);
    if (point && !landingShows(point)) await centreChartOn(point, signal);
  }
  if (signal.aborted) return;
  await dragStay(assign.stayId, assign.standId, signal, { cursor, scroll: prepare });
}

/**
 * Whether a helper can carry this waiting flight down without scrolling: its
 * stand at its hours shows in the work area, and its bar shows in the lane
 * above, where it is taken hold of and, straight below, let go, all clear of
 * anything covering the chart.
 */
function assignInReach(assign: StandAssign): boolean {
  const stay = offBoardStay(assign.stayId);
  const scroller = shown(".st-scroller");
  const bar = shown(barOf(assign.stayId))?.getBoundingClientRect();
  const point = stay ? landingPoint(assign.standId, stay.start, stay.end) : null;
  if (!stay || !scroller || !bar || !point || !landingShows(point)) return false;
  const lane = rowsViewport(scroller, "pinned");
  const left = Math.max(bar.left, lane.left + REACH_MARGIN);
  const right = Math.min(bar.right, lane.right - REACH_MARGIN);
  if (right - left < 12) return false;
  const barY = bar.top + bar.height / 2;
  const over = covers();
  // Where it is taken hold of (a little in from where it shows; see aimAtBar).
  return [left, Math.min(right, left + 48)].every(
    (x) => !covered({ x, y: barY }, over) && !covered({ x, y: point.y }, over),
  );
}

/** "XB240 → B14": a helper's job carrying a waiting flight down, on its tag. */
function assignLabel(assign: StandAssign): string {
  const stay = offBoardStay(assign.stayId);
  return `${stay ? stayName(stay) : assign.stayId} → ${assign.standId}`;
}

/** Whether a point on the chart shows in the work area, clear of anything over it. */
function landingShows(point: { x: number; y: number }): boolean {
  const box = workBox();
  return (
    !!box &&
    point.y > box.top + REACH_MARGIN &&
    point.y < box.bottom - REACH_MARGIN &&
    point.x > box.left &&
    point.x < box.right &&
    !covered(point, covers())
  );
}

/**
 * Giving stands: each waiting flight carried down out of the No stand lane
 * onto its stand, one at a time, even when asked to place them all, with
 * Skye's tag counting them off. A flight already on its stand is skipped.
 */
async function assignStands(action: Extract<AppAction, { name: "assign_stands" }>, signal: AbortSignal): Promise<void> {
  const todo = action.assigns.filter((assign) => assignState(assign) === "pending");
  if (todo.length === 0) return;
  try {
    for (const [index, assign] of todo.entries()) {
      if (signal.aborted) return;
      if (assignState(assign) !== "pending") continue;
      if (todo.length > 1) agentCursor.setTask(`Placing ${index + 1} of ${todo.length} · ${assignLabel(assign)}`);
      await placeWaiting(assign, signal);
    }
  } finally {
    agentCursor.setTask(null);
  }
}

const jobPending = (job: FixJob) =>
  "move" in job ? areaMoveState(job.move) === "pending" : assignState(job.assign) === "pending";

/**
 * Fixing everything at once, with helpers, as closing an area does. The chart
 * glides to the work and Skye splits in the middle of the screen, her orb
 * staying there: between them the helpers drag the stays
 * that clear the conflicts and carry the waiting flights down out of the No
 * stand lane onto their stands, each taking the next job as it comes free.
 * The lane is pinned above the stands and holds still while they work (see
 * OperationsContext's boardHeld), so a waiting flight is within reach whenever
 * its stand shows at its hours. Work out of view waits for the next round,
 * framed on what is left. Skye's tag counts it all off, and the ring round
 * her orb fills. A job one helper's move made room for waits for that move,
 * and its helper is tethered from that one (see crewJobs). What the helpers
 * could not reach in any round Skye then does herself, so everything is seen
 * to move; the apply lands anything left after that.
 */
async function fixAll(action: Extract<AppAction, { name: "fix_all" }>, signal: AbortSignal): Promise<void> {
  const what = action.scope === "conflicts" ? "the conflicts" : "everything";
  await crewWork(
    action.moves.filter((move) => areaMoveState(move) === "pending"),
    action.assigns.filter((assign) => assignState(assign) === "pending"),
    signal,
    (done, total) => `Fixing ${what} · ${done}/${total} done`,
  );
}

/**
 * The helpers at work on `moves` and `assigns` (see fixAll), with `tag` on
 * Skye's orb counting them off.
 */
async function crewWork(
  moves: readonly AreaMove[],
  assigns: readonly StandAssign[],
  signal: AbortSignal,
  tag: (done: number, total: number) => string,
): Promise<void> {
  const total = moves.length + assigns.length;
  if (total === 0) return;
  let done = 0;
  const progress = () => {
    agentCursor.setTask(tag(done, total));
    agentCursor.setProgress(done / total);
  };
  const tally = (finished: boolean) => {
    if (!finished) return;
    done += 1;
    progress();
  };
  progress();

  // The chart framed on the first of the work, and Skye in the middle of the screen, over it.
  await frameMoves(moves, signal, assigns);
  await agentCursor.moveTo(screenCentre, { signal });
  if (signal.aborted) return;

  const crew = agentHelpers.slice(0, crewSize(total));
  const tethers = showTethers(
    agentCursor,
    crew.map(({ controller }) => controller),
  );
  agentCursor.setOrb(true);
  const release = holdCentre(signal);
  const take = crewJobs(tethers, moves);
  const queue: FixJob[] = [];
  let later: FixJob[] = [];

  /** Has `helper` do `job` (see crewJobs), or null when it is out of reach or waits for a later round. */
  const start = (helper: AgentCursorController, job: FixJob): Promise<void> | null => {
    if ("move" in job) {
      const { move } = job;
      return inReach(move)
        ? take(helper, job, async () => {
            helper.setTask(moveLabel(move));
            await dragStay(move.occupancyId, move.standId, signal, { cursor: helper, scroll: false });
          })
        : null;
    }
    const { assign } = job;
    return assignInReach(assign)
      ? take(helper, job, async () => {
          helper.setTask(assignLabel(assign));
          await placeWaiting(assign, signal, { cursor: helper, prepare: false });
        })
      : null;
  };

  const work = async (helper: AgentCursorController) => {
    for (let job = queue.shift(); job && !signal.aborted; job = queue.shift()) {
      if (!jobPending(job)) continue;
      const made = start(helper, job);
      if (!made) {
        later.push(job);
        continue;
      }
      await made;
      tally("move" in job ? areaMoveState(job.move) === "done" : assignState(job.assign) === "done");
    }
    helper.setTask(null);
    await backToSkye(helper);
  };

  let left: FixJob[] = [...moves.map((move) => ({ move })), ...assigns.map((assign) => ({ assign }))];
  try {
    for (let round = 0; round < MAX_ROUNDS && left.length > 0 && !signal.aborted; round += 1) {
      // Work out of reach, conflicts and waiting flights alike: the chart
      // framed on what is left, and the helpers go again.
      if (round > 0) {
        await frameMoves(
          left.flatMap((job) => ("move" in job ? [job.move] : [])),
          signal,
          left.flatMap((job) => ("assign" in job ? [job.assign] : [])),
        );
      }
      const before = done;
      queue.push(...left);
      later = [];
      // All at once: they split off Skye together, each to its first job,
      // and each goes back into her once there is nothing left for it.
      spawnCrew(crew);
      await Promise.all(crew.map(({ controller }) => work(controller)));
      left = later.filter(jobPending);
      // Framing brought nothing within reach: more rounds would not either.
      if (round > 0 && done === before) break;
    }
  } finally {
    // Back into Skye's orb, also when stopped part way; their lines go with
    // them, and the orb becomes a dot again.
    for (const { controller } of crew) controller.setTask(null);
    release();
    await Promise.all(crew.map(({ controller: helper }) => backToSkye(helper)));
    tethers.stop();
    agentCursor.setOrb(false);
  }

  // What the helpers could not reach in any round, Skye carries herself,
  // scrolling as she goes.
  try {
    for (const job of left) {
      if (signal.aborted) return;
      if (!jobPending(job)) continue;
      if ("move" in job) {
        await dragStay(job.move.occupancyId, job.move.standId, signal);
        tally(areaMoveState(job.move) === "done");
      } else {
        await placeWaiting(job.assign, signal);
        tally(assignState(job.assign) === "done");
      }
    }
  } finally {
    agentCursor.setTask(null);
  }
}

/* -------------------------------------------- weighing a disruption first */

/** How long a helper rests on what it looks at, ms: long enough to read its tag. */
const CHECK_DWELL_MS = 420;
/** How long the helpers stay on what would wait before they start moving it, ms. */
const POINT_OUT_MS = 1_800;
/** The most a sweep looks at: past this, more looks only make it longer. */
const MAX_CHECKS = 28;

/** One look a helper takes while Skye weighs a disruption: a stay's bar, or a stand at a stay's hours. */
type Check = { label: string; at: () => { x: number; y: number } | null };

/** The middle of a stay's bar where it shows in the work area, or null when it does not show there. */
function barPoint(stayId: string): { x: number; y: number } | null {
  const rect = shown(barOf(stayId))?.getBoundingClientRect();
  const box = workBox();
  if (!rect || !box) return null;
  const left = Math.max(rect.left, box.left + REACH_MARGIN);
  const right = Math.min(rect.right, box.right - REACH_MARGIN);
  const point = { x: (left + right) / 2, y: rect.top + rect.height / 2 };
  return right > left && landingShows(point) ? point : null;
}

/** A stand at `stayId`'s hours, where it shows in the work area. */
function slotPoint(standId: string, stayId: string): { x: number; y: number } | null {
  const stay = occupancyById(stayId);
  const point = stay ? landingPoint(standId, stay.start, stay.end) : null;
  return point && landingShows(point) ? point : null;
}

/**
 * What Skye looks at to weigh a late stay's knock-on, most telling first:
 * each aircraft that would wait for its stand, and how long; then, for each
 * stay she will move, the stands she tries before the one she picks and why
 * each will not do, and that one; then the other stays around it, to show
 * they are clear. Only what shows on the chart now.
 */
function disruptionChecks(action: Extract<AppAction, { name: "resolve_disruption" }>): Check[] {
  const late = occupancyById(action.stayId);
  if (!late) return [];
  const holds = boardKpis(standState()).holds.filter((hold) => hold.standId === late.rowId);
  const checks: Check[] = holds.map((hold) => ({
    label: `${hold.label} · would wait ${formatDuration(hold.minutes)}`,
    at: () => barPoint(hold.stayId),
  }));
  for (const move of action.moves) {
    for (const tried of action.considered.filter((entry) => entry.occupancyId === move.occupancyId)) {
      checks.push({ label: `${tried.standId} · ${tried.reason}`, at: () => slotPoint(tried.standId, move.occupancyId) });
    }
    checks.push({ label: `${move.standId} · free ✓`, at: () => slotPoint(move.standId, move.occupancyId) });
  }
  // Everything else around it: on the late stay's pier and the stands it
  // could use, from when it gets in until the last aircraft it holds is due.
  const looked = new Set([late.id, ...holds.map((hold) => hold.stayId)]);
  const until = Math.max(late.end, ...holds.map((hold) => hold.due + hold.minutes * 60_000));
  const piers = new Set([late.rowId, ...action.moves.map((move) => move.standId)].map((stand) => standArea(stand)));
  const around = DEMO_DATA.occupancies
    .filter((o) => !looked.has(o.id) && piers.has(standArea(o.rowId)) && o.start < until && late.start < o.end)
    .sort((a, b) => a.start - b.start);
  for (const other of around) checks.push({ label: `${stayName(other)} · clear`, at: () => barPoint(other.id) });
  return checks.filter((check) => check.at() !== null).slice(0, MAX_CHECKS);
}

/**
 * A late flight's knock-on, weighed across the plan and then cleared, with
 * every helper Skye has. The chart frames the work and Skye goes to the late
 * stay's bar, saying how late it is. Then she splits, her echoes fanning out
 * across the board at once: to each aircraft that would wait for its stand
 * (saying how long), to the stands she tries for what she will move (saying
 * why each will not do, and which will), and over the stays around them,
 * while her ring fills with what has been checked. They stop on what would
 * wait, a beat, so it is clear what the problem is; then the helpers move
 * what the late stay runs into, as fixAll does, and merge back into her.
 */
async function resolveDisruption(action: Extract<AppAction, { name: "resolve_disruption" }>, signal: AbortSignal): Promise<void> {
  const late = occupancyById(action.stayId);
  if (!late) return;
  const pending = action.moves.filter((move) => areaMoveState(move) === "pending");
  const name = stayName(late);

  // The late stay, and the stands its stays go to, in view; Skye on the late one.
  await frameMoves(pending, signal);
  agentCursor.setTask(lateTag());
  await agentCursor.hover(() => shown(barOf(late.id)), { signal, aim: aimAtBar, visibleBox: chartVisibleBox });
  if (signal.aborted) return;
  await wait(600);

  const checks = disruptionChecks(action);
  if (checks.length > 0) {
    await agentCursor.moveTo(screenCentre, { signal });
    if (signal.aborted) return;
    const crew = agentHelpers.slice(0, Math.min(agentHelpers.length, Math.max(3, Math.ceil(checks.length / 4))));
    const tethers = showTethers(
      agentCursor,
      crew.map(({ controller }) => controller),
    );
    agentCursor.setOrb(true);
    const release = holdCentre(signal);
    let checked = 0;
    const progress = () => {
      agentCursor.setTask(`Weighing ${name} · ${checked}/${checks.length} checked`);
      agentCursor.setProgress(checked / checks.length);
    };
    progress();
    const queue = [...checks];
    try {
      spawnCrew(crew);
      // All at once, each taking the next look as it comes free.
      await Promise.all(
        crew.map(async ({ controller: helper }) => {
          for (let check = queue.shift(); check && !signal.aborted; check = queue.shift()) {
            const at = check.at();
            if (at) {
              helper.setTask(check.label);
              await helper.moveTo(() => check.at() ?? at, { signal });
              await wait(CHECK_DWELL_MS);
            }
            checked += 1;
            progress();
          }
        }),
      );
      if (signal.aborted) return;
      // Then each stops on what would wait, so the problem is plain before anything moves.
      const holds = boardKpis(standState()).holds.filter((hold) => hold.standId === late.rowId);
      const minutes = holds.reduce((sum, hold) => sum + hold.minutes, 0);
      agentCursor.setTask(
        holds.length > 0
          ? `${holds.length} aircraft would wait · ${formatDuration(minutes)} gate hold`
          : `${name} runs into ${action.moves.length} stays`,
      );
      await Promise.all(
        crew.map(async ({ controller: helper }, index) => {
          const hold = holds[index];
          const at = hold ? barPoint(hold.stayId) : null;
          if (!hold || !at) {
            helper.setTask(null);
            await backToSkye(helper);
            return;
          }
          helper.setTask(`Conflict · waits ${formatDuration(hold.minutes)}`);
          await helper.moveTo(() => barPoint(hold.stayId) ?? at, { signal });
        }),
      );
      await wait(POINT_OUT_MS);
    } finally {
      for (const { controller } of crew) controller.setTask(null);
      release();
      await Promise.all(crew.map(({ controller: helper }) => backToSkye(helper)));
      tethers.stop();
      agentCursor.setOrb(false);
    }
  }
  if (signal.aborted) return;
  await crewWork(pending, [], signal, (done, total) => `Clearing ${name}'s knock-on · ${done}/${total} moved`);
}

/**
 * Taking stays off their stands: each stay's bar dragged straight up into the
 * No stand lane, where it waits at its own hours. A stay no longer on the
 * stand it was asked off is left alone.
 */
async function unassignStands(action: Extract<AppAction, { name: "unassign_stands" }>, signal: AbortSignal): Promise<void> {
  for (const release of action.stays) {
    if (signal.aborted) return;
    if (occupancyById(release.stayId)?.rowId !== release.standId) continue;
    await dragStay(release.stayId, FIRST_LANE_ROW, signal);
  }
}

/** Shows the call window when it is closed on a call, with the People button (data-call-toggle). */
async function showCallWindow(ready: () => Element | null, signal: AbortSignal): Promise<void> {
  if (ready() || !shown("[data-call-toggle]")) return;
  await click(() => shown("[data-call-toggle]"), signal, { last: false });
  await waitFor(ready, signal, 800);
}

/**
 * Calling someone in, as a person does: on a call, from the call window's
 * Add people menu (the window shown first if it is closed); off one, from the
 * People list, with the call button on their row.
 */
async function addToCall(person: string, signal: AbortSignal): Promise<void> {
  const add = () => shown("[data-call-add]");
  await showCallWindow(add, signal);
  if (add()) {
    await click(add, signal, { last: false });
    const item = `[data-call-invite="${CSS.escape(person)}"]`;
    if (await waitFor(() => shown(item), signal)) {
      await wait(MENU_SETTLE_MS);
      await click(() => shown(item), signal, { aim: aimAtMenuItem });
    }
    return;
  }
  const people = () => shown("[data-call-people]");
  if (!people()) return;
  await click(people, signal, { last: false });
  const call = `[data-call-person="${CSS.escape(person)}"]`;
  if (await waitFor(() => shown(call), signal)) {
    await wait(MENU_SETTLE_MS);
    await click(() => shown(call), signal);
  }
}

/** Taking someone off the call: the remove button on their tile in the call window. */
async function removeFromCall(person: string, signal: AbortSignal): Promise<void> {
  const remove = () => shown(`[data-call-remove="${CSS.escape(person)}"]`);
  await showCallWindow(remove, signal);
  if (remove()) await click(remove, signal);
}

/**
 * Carries `action` out with Skye's cursor, resolving once its clicks are
 * done. Reads have nothing to click and resolve at once.
 */
export async function playAgentGesture(action: AppAction, signal: AbortSignal): Promise<void> {
  // A finished multi-cursor task's tally does not follow Skye into the next one.
  if (action.name !== "close_area") agentCursor.setTask(null);
  switch (action.name) {
    case "select_flight": {
      const flight = OPS_FLIGHTS_BY_ID.get(action.flightId);
      if (flight) await selectFlight(flight, signal);
      return;
    }
    case "select_flights":
      return selectFlights(
        action.flightIds.flatMap((id) => OPS_FLIGHTS_BY_ID.get(id) ?? []),
        action.mode,
        signal,
      );
    case "move_stay": {
      const flight = OPS_FLIGHTS_BY_ID.get(action.flightId);
      if (flight) await moveStay(flight, action.standId, signal);
      return;
    }
    case "swap_stays": {
      const [a, b] = action.flightIds.map((id) => OPS_FLIGHTS_BY_ID.get(id));
      if (a && b) await swapStays(a, b, signal);
      return;
    }
    case "close_area":
      return closeArea(action, signal);
    case "assign_stands":
      return assignStands(action, signal);
    case "fix_all":
      return fixAll(action, signal);
    case "resolve_disruption":
      return resolveDisruption(action, signal);
    case "unassign_stands":
      return unassignStands(action, signal);
    case "add_to_call":
      return addToCall(action.person, signal);
    case "remove_from_call":
      return removeFromCall(action.person, signal);
    case "clear_selection":
      return clearSelection(signal);
    case "set_view":
      return setView(action.view, signal);
    case "set_filter":
      return setFilter(action.dimension, action.values, signal);
    case "reset_filters":
      return resetFilters(signal);
    case "acknowledge_alert":
    case "unacknowledge_alert":
      // The Alerts menu has no control for this; the executor applies it.
      return;
    default:
      return;
  }
}
