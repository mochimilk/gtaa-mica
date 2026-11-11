// Skye on screen.
//
// When Skye changes something in the app, her orb pops out of the dock (the
// Ask pill), moves to the control like a person would, and really clicks it:
// the pointer, mouse and click events are dispatched at the orb's centre, with
// any key Skye holds (Ctrl to add to a selection), so the app reacts exactly
// as it does to a person. This file is the motion and the click; it knows
// nothing of React or of Mica's actions. The overlay element is supplied by
// <AgentCursor />, the dock by `setHome`, and callers say what to click.
//
// She stays out wherever her last click left her until recalled (`recall`:
// the Ask pill's button, and Mica after each task, so every task starts from
// the dock; see LiveCallProvider), travelling back to the dock and settling
// into her place there. A task that starts before then carries on from where
// she is. Left idle, she breathes and her name tag dims. With no dock on screen
// she appears mid-screen, and a recall fades her out where she is.
//
// What makes her moves read as a hand on a mouse rather than a tween:
//   - a curved path (a wrist arcs), with a minimum-jerk speed profile:
//     slow away, fast through the middle, slow onto the target
//   - travel time from Fitts's law: longer and smaller-target moves take longer
//   - a small overshoot that is corrected, and a faint tremor along the way
//   - an aim point near where a person would click, not the exact centre
//   - a short dwell before pressing, press and release as separate beats,
//     and a slight drift away after the click
//
// Everything is driven by requestAnimationFrame on one fixed element, so a
// React re-render never interrupts a move.
//
// Skye can also work with several cursors at once (see agentSwarm.ts): extra
// controllers, each with its own overlay and pointer id, her echoes, split off
// from her orb (`spawnFrom`) and merge back into it (`retire`). Meanwhile she
// directs them from where she was put (`moveTo`, `setDirecting`), the ring
// round her filling as they work (`setProgress`). Their pointer events are not
// primary, as a second finger's are not, so they never drive what only the
// primary pointer should (the chart's autoscroll).
//
// Every cursor hovers as a mouse does, wherever it goes and whatever it is
// doing (Skye aside while she directs, when she is not a hand): what comes under it gets
// the pointer and mouse over, out, enter and leave events a mouse sends, so
// what the app does on hover it does for Skye too (a bar's labels brighten, a
// tooltip shows, a menu item takes focus); and, as no script can set :hover,
// what is under it and everything it sits in carries `data-agent-hover`, which
// the app's styles give :hover's looks (see HOVER_ATTR). It turns into the
// hand (a little larger) over anything a person's pointer would.

export type Point = { x: number; y: number };

/** A cursor's state: "arrow" while travelling, "hand" (a little larger) over something clickable. */
export type CursorVariant = "arrow" | "hand";

export type ClickOptions = {
  /** Aborting stops the gesture and fades the cursor; the click is not performed. */
  signal?: AbortSignal;
  /** Where on the target to aim, in viewport pixels. Defaults to near its centre. */
  aim?: (rect: DOMRect) => Point;
  /**
   * False for a click partway through a sequence (opening a menu before
   * picking from it): the hand does not relax away from the control.
   */
  last?: boolean;
  /** Keys held through the click, as Ctrl is held to add to a selection. */
  modifiers?: Modifiers;
  /**
   * The part of `scroller` where content really shows, for a scroll region
   * with pinned rulers or a gutter over its edges. Defaults to its whole box.
   */
  visibleBox?: (scroller: HTMLElement) => DOMRect;
};

export type Modifiers = { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean };

export type DragOptions = {
  /** Aborting lets go at once, as a cancelled drag (pointercancel); nothing is dropped. */
  signal?: AbortSignal;
  /** Where on the source to take hold of it. Defaults to near its centre. */
  aim?: (rect: DOMRect) => Point;
  /**
   * Where the drag's target shows. A target outside it is waited for at the
   * box's nearest edge, where the page scrolls during a drag.
   */
  visibleBox?: () => DOMRect | null;
  /** As ClickOptions.visibleBox, for bringing the source into view first. */
  scrollBox?: (scroller: HTMLElement) => DOMRect;
  /**
   * Whether to bring the source into view first, scrolling its list; true by
   * default. A cursor sharing the page with others (Skye's helpers) leaves
   * the scrolling to the primary one, and takes hold of what already shows.
   */
  reveal?: boolean;
};

const FADE_MS = 180;
/** Skye popping out of the dock; matches agent-cursor-orb-pop, and the recall button's delay (askSkye.css). */
const POP_MS = 320;
/** How far her orb starts from, popping out of the dock's thinking dots rather than its orb. */
const POP_FROM_DOTS = 0.5;
/**
 * Back in the dock, how long she stays over her place before fading: long
 * enough for the dock's own orb to start drawing beneath her.
 */
const DOCK_MS = 360;
/** How long the cursor sits still before it rests: it breathes and its name tag dims. */
const IDLE_MS = 12_000;
/**
 * How quickly Skye works: each reach, settle, press and hold takes this share
 * of the time a person's would. 1 is a person's pace; lower is quicker.
 */
const PACE = 0.7;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });

const rand = (min: number, max: number) => min + Math.random() * (max - min);
/** A pause in Skye's work, between `min` and `max` ms at a person's pace, at hers (PACE). */
const beat = (min: number, max: number) => rand(min, max) * PACE;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Minimum-jerk position profile: the speed curve of a natural reach. */
const minimumJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, s: number): Point {
  const u = 1 - s;
  const a = u * u * u;
  const b = 3 * u * u * s;
  const c = 3 * u * s * s;
  const d = s * s * s;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/**
 * Whether enough of `rect` shows inside `box` to click it without scrolling:
 * all of a small control, or a decent piece of a large one (a whole chart).
 */
function inView(rect: DOMRect, box: DOMRect): boolean {
  const width = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
  const height = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
  return width >= Math.min(rect.width, 60) - 1 && height >= Math.min(rect.height, 40) - 1;
}

const inside = (p: Point, r: DOMRect) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The nearest ancestor that scrolls on the given axis and actually overflows. */
function scrollParent(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrollsY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const scrollsX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    if (scrollsY || scrollsX) return node;
  }
  return null;
}

/** How far from an element's edge Skye's orb (32px across) rests when she points at it from beside it. */
const BESIDE_GAP = 22;

/**
 * An aim for pointing at something from beside it rather than on top of it, so
 * what it says stays readable: just off its `side`, on the other side when
 * there is no room there.
 */
export const aimBeside =
  (side: "left" | "right" | "above" | "below" = "right") =>
  (rect: DOMRect): Point => {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    switch (side) {
      case "left":
        return { x: rect.left - BESIDE_GAP >= BESIDE_GAP ? rect.left - BESIDE_GAP : rect.right + BESIDE_GAP, y };
      case "right":
        return { x: rect.right + BESIDE_GAP <= innerWidth - BESIDE_GAP ? rect.right + BESIDE_GAP : rect.left - BESIDE_GAP, y };
      case "above":
        return { x, y: rect.top - BESIDE_GAP >= BESIDE_GAP ? rect.top - BESIDE_GAP : rect.bottom + BESIDE_GAP };
      case "below":
        return { x, y: rect.bottom + BESIDE_GAP <= innerHeight - BESIDE_GAP ? rect.bottom + BESIDE_GAP : rect.top - BESIDE_GAP };
    }
  };

function defaultAim(rect: DOMRect): Point {
  // People click near the middle, a little off it.
  return {
    x: rect.left + rect.width / 2 + rand(-1, 1) * Math.min(rect.width * 0.2, 12),
    y: rect.top + rect.height / 2 + rand(-1, 1) * Math.min(rect.height * 0.15, 3),
  };
}

/** The pointer a cursor's events carry: Skye's main cursor is pointer 1, the primary one. */
type PointerInfo = { pointerId: number; isPrimary: boolean };

export type AgentCursorOptions = {
  /** Pointer id for its events; 1 (the default) is the primary pointer. */
  pointerId?: number;
};

export class AgentCursorController {
  #pointer: PointerInfo;
  #root: HTMLElement | null = null;
  /** Where the cursor is, or was last; kept while hidden so the next task starts from there. */
  #pos: Point | null = null;
  #visible = false;
  /** Told when the cursor goes out or comes back, for the recall button. */
  #listeners = new Set<() => void>();
  /** True while a drag holds the button down: every move is sent as a pointermove. */
  #holding = false;
  /** True while a gesture runs; the post-click drift yields to it. */
  #busy = false;
  /** Gestures run one after another, each starting where the last one left the cursor. */
  #queue: Promise<void> = Promise.resolve();
  /** Skye's place in the dock, which she leaves from and returns to. */
  #home: HTMLElement | null = null;
  /** True while she is out of the dock; its place shows the recall button meanwhile. */
  #away = false;
  /** True once she is back over her place, until she has faded into it. */
  #docking = false;
  /** The trip back to the dock, aborted when a new gesture starts. */
  #homing: AbortController | null = null;
  /** Dims the cursor once it has sat still for IDLE_MS. */
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** True while Skye directs her helpers (setDirecting). */
  #directing = false;
  /** What its tag shows it doing (setTask). */
  #task: string | null = null;
  /** What it is over (hoverAt), and everything that sits in, innermost first. */
  #hovered: Element[] = [];
  /** Whether what it is over would turn a person's pointer into the hand. */
  #overClickable = false;

  /** Every cursor, so what they are over can follow the page as it scrolls under them. */
  static #all = new Set<AgentCursorController>();
  static #rehover = 0;

  constructor({ pointerId = 1 }: AgentCursorOptions = {}) {
    this.#pointer = { pointerId, isPrimary: pointerId === 1 };
    AgentCursorController.#all.add(this);
    if (AgentCursorController.#all.size === 1 && typeof addEventListener === "function") {
      // A scroll moves the page under a cursor that holds still: once a frame
      // at most, each then hovers what has come under it, as a mouse would.
      addEventListener(
        "scroll",
        () => {
          AgentCursorController.#rehover ||= requestAnimationFrame(() => {
            AgentCursorController.#rehover = 0;
            for (const cursor of AgentCursorController.#all) if (cursor.#visible) cursor.#hoverAt(cursor.#pos);
          });
        },
        { capture: true, passive: true },
      );
    }
  }

  /** Called by <AgentCursor /> with its overlay element, and with null on unmount. */
  attach(root: HTMLElement | null): void {
    this.#root = root;
    if (!root) {
      this.#visible = false;
      this.#hoverAt(null);
      clearTimeout(this.#idleTimer);
    }
  }

  /**
   * Registers Skye's place in the dock as her home. While she is out, it
   * carries `data-agent-away`. Returns the
   * unregistering function, which only clears the home it registered.
   */
  setHome(element: HTMLElement | null): () => void {
    this.#home?.removeAttribute("data-agent-away");
    this.#home = element;
    element?.toggleAttribute("data-agent-away", this.#away);
    return () => {
      if (this.#home !== element) return;
      element?.removeAttribute("data-agent-away");
      this.#home = null;
    };
  }

  /** True while the cursor is out in the app, from its first click until it is back in the dock. */
  get out(): boolean {
    return this.#visible && !this.#docking;
  }

  /** True while it shows at all: while out, and as it fades back into the dock. Skye's renderer runs only then. */
  get shown(): boolean {
    return this.#visible;
  }

  /** True while Skye directs her helpers (setDirecting). */
  get directing(): boolean {
    return this.#directing;
  }

  /** What its tag shows it doing ("Pier B closed · 3/11 moved"), or null. */
  get task(): string | null {
    return this.#task;
  }

  /** Calls `listener` whenever `out`, `shown`, `directing` or `task` changes; returns the unsubscribe. For useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * Brings the cursor back into the dock, after any gesture under way. A
   * gesture started meanwhile turns it round again.
   */
  recall(): Promise<void> {
    this.#homing?.abort();
    const homing = new AbortController();
    this.#homing = homing;
    const run = this.#queue.then(() => this.#goHome(homing.signal));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** True while a gesture runs, including scrolling to its target. */
  get active(): boolean {
    return this.#busy;
  }

  /** Where the cursor is, or was last; null before its first gesture. */
  get position(): Point | null {
    return this.#pos;
  }

  /**
   * Shows what this cursor is doing on its tag, beside its name or, for a
   * helper with none, on its own (for example "XA109 → C27"), or clears it
   * with null. Wakes a resting cursor.
   */
  setTask(text: string | null): void {
    const task = this.#root?.querySelector<HTMLElement>(".agent-cursor-task");
    if (task) task.textContent = text ?? "";
    this.#root?.toggleAttribute("data-task", !!text);
    if (text !== this.#task) {
      this.#task = text;
      this.#notify();
    }
    if (!this.#visible) return;
    this.#wake();
    if (!this.#busy) this.#armIdle();
  }

  /**
   * Puts its name tag away, or brings it back: for pointing at something
   * closely, as Skye does walking a teammate through a plan, when the tag
   * would sit over what she is showing. Her orb says who it is.
   */
  setTagless(on: boolean): void {
    this.#root?.toggleAttribute("data-tagless", on);
  }

  /**
   * Marks Skye as directing her helpers (see agentSwarm.ts) rather than one
   * more hand: her orb takes on their light, with the ring round it, and
   * hovers nothing. Her tag stays, and she does not dim or breathe meanwhile,
   * as she is still at work.
   */
  setDirecting(on: boolean): void {
    this.#directing = on;
    this.#root?.toggleAttribute("data-directing", on);
    this.#hoverAt(on ? null : this.#pos);
    this.#wake();
    if (!on && this.#visible && !this.#busy) this.#armIdle();
    this.#notify();
  }

  /**
   * Fills the ring round the orb (setDirecting) `share` of the way round, from 0
   * to 1: how much of its helpers' work is done.
   */
  setProgress(share: number): void {
    const aura = this.#root?.querySelector<SVGElement>(".agent-cursor-aura");
    aura?.style.setProperty("--agent-cursor-progress", String(clamp(share, 0, 1)));
  }

  /**
   * Where a hidden cursor will appear for its next gesture: for a helper,
   * Skye's orb, so it reads as splitting off from her. Does
   * nothing while the cursor is out.
   */
  spawnFrom(point: Point): void {
    if (!this.#visible) this.#pos = point;
  }

  /**
   * Moves to the element `resolveTarget` returns and rests there, without
   * clicking: to show where Skye is about to work. Scrolls it into view
   * first, as a click does. Resolves once there.
   */
  hover(resolveTarget: () => Element | null, options: Omit<ClickOptions, "last" | "modifiers"> = {}): Promise<void> {
    return this.#enqueue(async () => {
      const { signal, aim = defaultAim, visibleBox } = options;
      let target = resolveTarget();
      if (!this.#root || !target || signal?.aborted) return;
      await this.#appear(target, aim, signal);
      target = await this.#reveal(target, resolveTarget, visibleBox, signal);
      if (signal?.aborted) return;
      const point = aim(target.getBoundingClientRect());
      if (prefersReducedMotion()) this.#place(point, "arrow");
      else await this.#travel(point, null, signal);
    });
  }

  /**
   * Moves to `point` on screen and rests there, as `hover` does over an
   * element: for a place not over anything in particular, such as the middle
   * of the screen. `point` is read once the cursor is out. Resolves once there.
   */
  moveTo(point: () => Point, options: { signal?: AbortSignal } = {}): Promise<void> {
    return this.#enqueue(async () => {
      const { signal } = options;
      if (!this.#root || signal?.aborted) return;
      await this.#appear(document.documentElement, point, signal);
      if (signal?.aborted) return;
      if (prefersReducedMotion()) this.#place(point(), "arrow");
      else await this.#travel(point(), null, signal);
    });
  }

  /**
   * Puts a helper cursor away after the gestures before it: it travels to
   * `to` (Skye's orb), shrinks into it and is gone. Without `to`,
   * or with reduced motion, it fades where it is.
   */
  retire(to?: () => Point | null): Promise<void> {
    return this.#enqueue(async () => {
      if (!this.#visible) return;
      const point = prefersReducedMotion() ? null : (to?.() ?? null);
      if (point) await this.#travel(point, null);
      this.#hoverAt(null);
      this.#root?.setAttribute("data-merge", "");
      this.#root?.removeAttribute("data-visible");
      this.setTask(null);
      await sleep(FADE_MS);
      this.#root?.removeAttribute("data-merge");
      this.#visible = false;
      clearTimeout(this.#idleTimer);
      this.#notify();
    });
  }

  /**
   * Moves to the element `resolveTarget` returns and clicks it, resolving once
   * the click has been dispatched. Resolves straight away, without a gesture,
   * when there is no overlay or no target on screen: callers must not depend on
   * the cursor for the change itself.
   *
   * The target is resolved lazily (and again after any scrolling) because the
   * element can re-render or move while the cursor is on its way.
   */
  click(resolveTarget: () => Element | null, options: ClickOptions = {}): Promise<void> {
    return this.#enqueue(() => this.#click(resolveTarget, options));
  }

  /**
   * Presses on the element `resolveSource` returns, drags to the point
   * `resolveTarget` returns, and lets go there, dispatching the pointer and
   * mouse events a real drag sends (no click). While the target point is
   * outside `visibleBox`, the cursor holds at the box's nearest edge, where
   * the page is expected to scroll as it does under a person's drag, until
   * the target comes into view. Resolves once released; like `click`, it
   * resolves without a gesture when there is nothing to drag.
   */
  drag(resolveSource: () => Element | null, resolveTarget: () => Point | null, options: DragOptions = {}): Promise<void> {
    return this.#enqueue(() => this.#drag(resolveSource, resolveTarget, options));
  }

  /** Runs one gesture after the ones before it, marked busy while it runs. */
  #enqueue(gesture: () => Promise<void>): Promise<void> {
    // On its way home, the cursor turns round and carries on from where it is.
    this.#homing?.abort();
    const run = this.#queue.then(async () => {
      this.#busy = true;
      this.#wake();
      try {
        await gesture();
      } finally {
        this.#busy = false;
        if (this.#visible) this.#armIdle();
      }
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #click(
    resolveTarget: () => Element | null,
    { signal, aim = defaultAim, last = true, modifiers, visibleBox }: ClickOptions,
  ): Promise<void> {
    let target = resolveTarget();
    if (!this.#root || !target || signal?.aborted) return;
    const reduced = prefersReducedMotion();

    await this.#appear(target, aim, signal);
    target = await this.#reveal(target, resolveTarget, visibleBox, signal);
    if (signal?.aborted) return;

    const rect = target.getBoundingClientRect();
    const point = aim(rect);
    if (reduced) this.#place(point, "hand");
    else await this.#travel(point, target, signal);
    if (signal?.aborted) return;

    this.#setVariant(isClickable(target) ? "hand" : "arrow");
    // The key goes down before the press, so it shows while Skye settles.
    if (modifiers) this.#root?.setAttribute("data-modifier", "");
    // Settle on the target before committing.
    await sleep(reduced ? 80 : beat(140, 260), signal);
    if (signal?.aborted) {
      this.#root?.removeAttribute("data-modifier");
      return;
    }

    // Press and release are separate beats; the click lands on release.
    this.#root?.setAttribute("data-pressed", "");
    const receiver = dispatchPress(target, point, this.#pointer, modifiers);
    await sleep(beat(70, 110));
    this.#root?.removeAttribute("data-pressed");
    dispatchRelease(receiver, point, this.#pointer, modifiers);
    this.#ripple(point);
    this.#root?.removeAttribute("data-modifier");
    // The click may have opened, closed or moved what is under it.
    this.#hoverAt(this.#pos);

    // Afterwards the hand relaxes, a small drift, and the cursor stays there.
    if (!reduced && last) void this.#drift();
  }

  async #drag(
    resolveSource: () => Element | null,
    resolveTarget: () => Point | null,
    { signal, aim = defaultAim, visibleBox, scrollBox, reveal = true }: DragOptions,
  ): Promise<void> {
    let source = resolveSource();
    if (!this.#root || !source || signal?.aborted) return;
    const reduced = prefersReducedMotion();

    await this.#appear(source, aim, signal);
    if (reveal) source = await this.#reveal(source, resolveSource, scrollBox, signal);
    if (signal?.aborted) return;

    const grab = aim(source.getBoundingClientRect());
    if (reduced) this.#place(grab, "hand");
    else await this.#travel(grab, source, signal);
    if (signal?.aborted) return;
    this.#setVariant("hand");
    await sleep(reduced ? 80 : beat(160, 260), signal);
    if (signal?.aborted) return;

    // Press and hold: from here every move is sent, as the mouse would.
    this.#root?.setAttribute("data-pressed", "");
    dispatchPress(source, grab, this.#pointer);
    this.#holding = true;
    let ready = false;
    try {
      await sleep(beat(90, 140), signal);
      const deadline = performance.now() + 4_000;
      let target = resolveTarget();
      while (target && !signal?.aborted) {
        const box = visibleBox?.();
        const margin = 44;
        if (!box || (target.y >= box.top + margin && target.y <= box.bottom - margin) || performance.now() > deadline) {
          break;
        }
        // Out of view: hold at the edge it lies beyond, where the page scrolls.
        // Beyond the margin, not the box: a target just inside the top is
        // still above, and holding at the bottom would scroll it away again.
        const above = target.y < box.top + margin;
        const edge = { x: clamp(target.x, box.left + 8, box.right - 8), y: above ? box.top + 10 : box.bottom - 10 };
        if (Math.hypot(edge.x - (this.#pos?.x ?? 0), edge.y - (this.#pos?.y ?? 0)) > 4) {
          await this.#travel(edge, null, signal, false);
        }
        else {
          this.#place(edge);
          await nextFrame();
        }
        target = resolveTarget();
      }
      if (!target || signal?.aborted) return;
      // Straight, not arced: a sideways swing would drag the bar along in time on its way.
      const reach = (to: Point) => (reduced ? Promise.resolve(this.#place(to)) : this.#travel(to, null, signal, false));
      await reach(target);
      if (signal?.aborted) return;
      // A beat over the drop, so the preview shows before letting go. The page
      // can still have been scrolling as the cursor came away from its edge,
      // moving the target out from under it: then it follows the target to
      // where it settled first, so the drop lands on the row meant, not the
      // one beside it.
      for (let follows = 0; ; follows += 1) {
        await sleep(reduced ? 150 : beat(380, 520), signal);
        if (signal?.aborted) return;
        const settled = resolveTarget();
        if (!settled || follows >= 3 || Math.hypot(settled.x - target.x, settled.y - target.y) < 3) break;
        target = settled;
        await reach(target);
        if (signal?.aborted) return;
      }
      ready = !signal?.aborted;
    } finally {
      this.#holding = false;
      this.#root?.removeAttribute("data-pressed");
      const at = this.#pos;
      // Drop over the target; anything else (aborted, target gone) cancels,
      // so nothing is left held and nothing lands where it was not meant to.
      if (at) {
        if (ready) dispatchDrop(at, this.#pointer);
        else dispatchCancel(at, this.#pointer);
      }
    }
    if (ready && this.#pos) this.#ripple(this.#pos);
    // Dropped, the bar lands under the cursor once the board has drawn it there.
    await nextFrame();
    this.#hoverAt(this.#pos);
  }

  /**
   * Shows the cursor for a gesture: out of the dock, where it was last, or
   * mid-screen the first time.
   */
  async #appear(target: Element, aim: (rect: DOMRect) => Point, signal?: AbortSignal): Promise<void> {
    const reduced = prefersReducedMotion();
    const home = reduced ? null : this.#homePoint();
    if (!this.#visible) {
      if (home) {
        await this.#leaveHome(home, signal);
      } else {
        // With no dock to leave from: where it was last, or mid-screen the first time.
        this.#place(reduced ? aim(target.getBoundingClientRect()) : this.#startPoint(), "arrow");
        this.#show();
        // A beat for the hand to find the mouse.
        await sleep(reduced ? 120 : beat(160, 240), signal);
      }
    } else {
      // Still out from the last task, or turned round on its way home: carry on from there.
      this.#setDocking(false);
      if (home) this.#setAway(true);
      this.#show();
    }
  }

  /**
   * Brings the target into view the way a person would: over the list, then
   * scroll it. Returns the target as it is afterwards, since it may have
   * re-rendered.
   */
  async #reveal(
    target: Element,
    resolveTarget: () => Element | null,
    visibleBox: ((scroller: HTMLElement) => DOMRect) | undefined,
    signal?: AbortSignal,
  ): Promise<Element> {
    if (prefersReducedMotion() || signal?.aborted) return target;
    const scroller = scrollParent(target);
    if (!scroller) return target;
    const box = visibleBox?.(scroller) ?? scroller.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (inView(rect, box)) return target;
    // Over the list, on the side the target is hidden towards.
    const inset = rand(24, 48);
    const entry = {
      x: clamp(rect.left + Math.min(rect.width / 2, 40), box.left + 16, box.right - 16),
      y: clamp(rect.top + rect.height / 2, box.top + inset, box.bottom - inset),
    };
    await this.#travel(entry, null, signal);
    await this.#scrollIntoView(scroller, target, box, signal);
    return resolveTarget() ?? target;
  }

  /**
   * Skye pops out of the dock: her orb, lifted off where it sits, swells and
   * settles before she sets off. With the dock showing its thinking dots
   * rather than the orb, she grows out of them.
   */
  async #leaveHome(home: Point, signal?: AbortSignal): Promise<void> {
    const root = this.#root;
    // Read before she shows: the dock's place empties for the recall button then.
    const fromDots = !!this.#home?.querySelector("[data-agent-spinner]");
    root?.style.setProperty("--agent-cursor-pop-from", String(fromDots ? POP_FROM_DOTS : 1));
    this.#snap(() => {
      root?.setAttribute("data-launch", "");
      this.#place(home, "arrow");
      this.#show();
    });
    this.#setAway(true);
    await sleep(POP_MS, signal);
    root?.removeAttribute("data-launch");
  }

  /**
   * On recall, Skye travels back to the dock and settles over her place, where
   * its own orb starts up beneath her (`out` turns false), and fades into it.
   * Without a dock on screen she just fades where she is. Aborted when a new
   * gesture starts.
   */
  async #goHome(signal: AbortSignal): Promise<void> {
    if (signal.aborted || !this.#visible) return;
    this.#wake();
    const home = prefersReducedMotion() ? null : this.#homePoint();
    if (home) {
      await this.#travel(home, null, signal);
      if (signal.aborted) return;
      this.#setDocking(true);
      this.#setAway(false);
      await sleep(DOCK_MS, signal);
      if (signal.aborted) return;
    }
    this.#setAway(false);
    this.#hoverAt(null);
    this.#root?.removeAttribute("data-visible");
    // Counted as visible until the fade finishes, so a follow-up in that
    // moment carries on rather than reappearing.
    setTimeout(() => {
      if (this.#root?.hasAttribute("data-visible") || !this.#visible) return;
      this.#visible = false;
      this.#setDocking(false);
      this.#notify();
    }, FADE_MS);
  }

  /** Where Skye's place in the dock is, when it is on screen to leave from or return to. */
  #homePoint(): Point | null {
    const home = this.#home;
    if (!home?.isConnected) return null;
    const rect = home.getBoundingClientRect();
    if (rect.width === 0 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
      return null;
    }
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /* ------------------------------------------------------------- motion */

  /**
   * One human-like reach to `to`, with an overshoot that is then corrected.
   * `arc` false keeps it on the straight line there, as a hand dragging
   * something along one axis does.
   */
  async #travel(to: Point, target: Element | null, signal?: AbortSignal, arc = true): Promise<void> {
    const from = this.#pos ?? to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 2) {
      this.#place(to);
      return;
    }

    const targetRect = target?.getBoundingClientRect() ?? null;
    const width = targetRect ? Math.max(16, Math.min(targetRect.width, targetRect.height)) : 24;
    // Fitts's law, with some person-to-person variation, at Skye's pace.
    const duration = clamp(260 + 165 * Math.log2(distance / width + 1), 320, 1_150) * beat(0.92, 1.08);

    const ux = dx / distance;
    const uy = dy / distance;
    // The arc bends to one side, as a wrist does, more for longer moves.
    const bend = arc ? (Math.random() < 0.5 ? -1 : 1) * Math.min(distance * rand(0.06, 0.16), 110) : 0;
    const nx = -uy * bend;
    const ny = ux * bend;
    // Most reaches overshoot slightly and come back.
    const overshoot = distance > 60 && Math.random() < 0.75 ? clamp(distance * rand(0.015, 0.035), 3, 14) : 0;
    const end = { x: to.x + ux * overshoot, y: to.y + uy * overshoot };
    const c1 = { x: from.x + dx * 0.3 + nx, y: from.y + dy * 0.3 + ny };
    const c2 = { x: from.x + dx * 0.78 + nx * 0.35, y: from.y + dy * 0.78 + ny * 0.35 };
    const tremor = rand(0, Math.PI * 2);

    await this.#animate(duration, signal, (t) => {
      const point = cubic(from, c1, c2, end, minimumJerk(t));
      // Faint tremor, strongest mid-move, gone at both ends.
      const shake = Math.sin(t * 23 + tremor) * 0.7 * Math.sin(Math.PI * t);
      point.x += -uy * shake;
      point.y += ux * shake;
      this.#place(point, targetRect && inside(point, targetRect) && target && isClickable(target) ? "hand" : "arrow");
    });

    if (overshoot > 0 && !signal?.aborted) {
      const back = { ...end };
      await this.#animate(beat(110, 170), signal, (t) => {
        const s = minimumJerk(t);
        this.#place({ x: back.x + (to.x - back.x) * s, y: back.y + (to.y - back.y) * s });
      });
    }
    if (!signal?.aborted) this.#place(to);
  }

  /** Smooth-scrolls `scroller` so `target` is comfortably in view, and waits for it to settle. */
  async #scrollIntoView(scroller: HTMLElement, target: Element, box: DOMRect, signal?: AbortSignal): Promise<void> {
    const rect = target.getBoundingClientRect();
    const top = scroller.scrollTop + (rect.top + rect.height / 2) - (box.top + box.height / 2);
    const left = scroller.scrollLeft + (rect.left + rect.width / 2) - (box.left + box.width / 2);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        scroller.removeEventListener("scrollend", finish);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      scroller.addEventListener("scrollend", finish, { once: true });
      signal?.addEventListener("abort", finish, { once: true });
      // scrollend does not fire when nothing moved, or where unsupported.
      setTimeout(finish, 700);
      scroller.scrollTo({ top, left, behavior: "smooth" });
    });
    await sleep(beat(80, 140), signal);
  }

  /** The slight relaxation of the hand after a click. */
  async #drift(): Promise<void> {
    await sleep(rand(350, 550));
    const from = this.#pos;
    if (!from || !this.#visible || this.#busy) return;
    const to = { x: from.x + rand(6, 16), y: from.y + rand(4, 12) };
    await this.#animate(rand(450, 650), undefined, (t) => {
      if (this.#busy) return false;
      const s = minimumJerk(t);
      this.#place({ x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s });
    });
  }

  /** Runs `frame` once per animation frame for `duration`; `frame` may return false to stop early. */
  #animate(
    duration: number,
    signal: AbortSignal | undefined,
    frame: (t: number) => boolean | void,
  ): Promise<void> {
    return new Promise((resolve) => {
      // Timed from the first frame: a frame's time can be earlier than now,
      // when the page is busy, and a time before the start would run the
      // path backwards, flinging the cursor off past where it set out from.
      let start: number | undefined;
      const step = (now: number) => {
        if (signal?.aborted || !this.#root) return resolve();
        start ??= now;
        const t = Math.min(1, (now - start) / duration);
        if (frame(t) === false || t >= 1) return resolve();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /* --------------------------------------------------------- appearance */

  /**
   * Where the cursor shows up: where it was last, kept inside the window in
   * case it was resized, or the middle of the screen the first time.
   */
  #startPoint(): Point {
    if (this.#pos) {
      return { x: clamp(this.#pos.x, 8, innerWidth - 8), y: clamp(this.#pos.y, 8, innerHeight - 8) };
    }
    return { x: innerWidth / 2 + rand(-24, 24), y: innerHeight / 2 + rand(-16, 16) };
  }

  #place(point: Point, variant?: CursorVariant): void {
    this.#pos = point;
    const root = this.#root;
    if (!root) return;
    root.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
    if (this.#holding) dispatchMove(point, this.#pointer);
    // Near the right edge the name tag goes to the left, so it is never cut off.
    root.toggleAttribute("data-tag-left", point.x > innerWidth - 96);
    if (!this.#visible) {
      if (variant) this.#setVariant(variant);
      return;
    }
    this.#hoverAt(point);
    // Over the page, what is under it says arrow or hand, as for a person's
    // pointer; holding a drag, it stays the hand that took hold.
    const over = this.#hovered[0];
    if (over && !this.#holding) this.#setVariant(this.#overClickable ? "hand" : "arrow");
    else if (variant) this.#setVariant(variant);
  }

  /**
   * Hovers what is at `point` now, as a mouse over it would (see the file's
   * head), or nothing (null, or while directing): what it leaves is told so and
   * loses `data-agent-hover`, and what it comes onto is told and gains it.
   */
  #hoverAt(point: Point | null): void {
    // At work on a page out of sight (data-skye-away, see agent-cursor.css),
    // it is not over the one on screen.
    const target =
      point && !this.#directing && this.#root && !document.documentElement.hasAttribute("data-skye-away")
        ? document.elementFromPoint(point.x, point.y)
        : null;
    const was = this.#hovered;
    if ((was[0] ?? null) === target) return;
    const now: Element[] = [];
    for (let node: Element | null = target; node; node = node.parentElement) now.push(node);
    this.#hovered = now;
    this.#overClickable = !!target && isClickable(target);
    markHovered(was, -1);
    markHovered(now, 1);
    dispatchHover(was, now, point ?? this.#pos ?? { x: 0, y: 0 }, this.#pointer, this.#holding);
  }

  #setVariant(variant: CursorVariant): void {
    if (this.#root && this.#root.dataset.variant !== variant) this.#root.dataset.variant = variant;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  #setDocking(docking: boolean): void {
    if (this.#docking === docking) return;
    this.#docking = docking;
    this.#root?.toggleAttribute("data-docking", docking);
    this.#notify();
  }

  #show(): void {
    const was = this.#visible;
    this.#visible = true;
    if (!was) this.#notify();
    this.#root?.setAttribute("data-visible", "");
  }

  #ripple(point: Point): void {
    const root = this.#root;
    if (!root?.parentElement) return;
    const ring = document.createElement("span");
    ring.className = "agent-cursor-ripple";
    ring.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
    root.parentElement.appendChild(ring);
    ring.addEventListener("animationend", () => ring.remove(), { once: true });
    setTimeout(() => ring.remove(), 1_000);
  }

  /** Applies `change` at once, without the transitions it would otherwise run. */
  #snap(change: () => void): void {
    const root = this.#root;
    if (!root) return change();
    root.setAttribute("data-snap", "");
    change();
    // Commits the new state before transitions come back on.
    void root.getBoundingClientRect();
    root.removeAttribute("data-snap");
  }

  /** Brings a dimmed cursor back to full strength, and stops the idle countdown. */
  #wake(): void {
    clearTimeout(this.#idleTimer);
    this.#root?.removeAttribute("data-idle");
  }

  /** Starts the countdown to dimming a cursor left sitting in the app. */
  #armIdle(): void {
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      if (this.#visible && !this.#busy && !this.#directing) this.#root?.setAttribute("data-idle", "");
    }, IDLE_MS);
  }

  /** Marks Skye's place in the dock as empty while she is out. */
  #setAway(away: boolean): void {
    this.#away = away;
    this.#home?.toggleAttribute("data-agent-away", away);
  }
}

/** Whether a person's pointer would turn into a hand over this element. */
function isClickable(element: Element): boolean {
  return /\bpointer\b/.test(getComputedStyle(element).cursor);
}

/* --------------------------------------------------------------- clicking */

function mouseInit(point: Point, buttons: number, modifiers: Modifiers = {}): MouseEventInit {
  return {
    ...modifiers,
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x + screenX,
    screenY: point.y + screenY,
    button: 0,
    buttons,
  };
}

/**
 * What a real click at `point` would land on: the deepest element there, as
 * long as it belongs to the target. When something else covers the target
 * (the chat panel, say), the target itself still receives the click.
 */
function receiverAt(target: Element, point: Point): Element {
  const hit = document.elementFromPoint(point.x, point.y);
  return hit && target.contains(hit) ? hit : target;
}

/** Pointer event fields for a cursor's pointer. */
const pointerInit = (init: MouseEventInit, pointer: PointerInfo): PointerEventInit => ({
  ...init,
  ...pointer,
  pointerType: "mouse",
});

/** Events Skye's cursors are dispatching right now (they are handled synchronously, as they are sent). */
let sending = 0;

/**
 * Whether the event being handled now is one of Skye's cursors' (Skye or a
 * helper), not the user's. The user and Skye work the board side by side, so
 * the app tells their clicks apart by this: a Skye click selects for Skye,
 * and never dismisses or re-targets what the user has open.
 */
export const isSkyeEvent = (): boolean => sending > 0;

/** Sends one of Skye's events, marked as Skye's while it is handled. */
function send(target: EventTarget, event: Event): void {
  sending += 1;
  try {
    target.dispatchEvent(event);
  } finally {
    sending -= 1;
  }
}

/** Press: pointerdown then mousedown, as a mouse sends them. */
function dispatchPress(target: Element, point: Point, pointer: PointerInfo, modifiers?: Modifiers): Element {
  const receiver = receiverAt(target, point);
  const init = mouseInit(point, 1, modifiers);
  send(receiver, new PointerEvent("pointerdown", pointerInit(init, pointer)));
  send(receiver, new MouseEvent("mousedown", init));
  return receiver;
}

/** Release: pointerup, mouseup, then the click itself. */
function dispatchRelease(receiver: Element, point: Point, pointer: PointerInfo, modifiers?: Modifiers): void {
  if (!receiver.isConnected) return;
  const init = mouseInit(point, 0, modifiers);
  send(receiver, new PointerEvent("pointerup", pointerInit(init, pointer)));
  send(receiver, new MouseEvent("mouseup", init));
  send(receiver, new MouseEvent("click", { ...init, detail: 1 }));
}

/** A move with the button held, to whatever is under the point; it bubbles to the window. */
function dispatchMove(point: Point, pointer: PointerInfo): void {
  const under = document.elementFromPoint(point.x, point.y) ?? document.body;
  const init = mouseInit(point, 1);
  send(under, new PointerEvent("pointermove", pointerInit(init, pointer)));
  send(under, new MouseEvent("mousemove", init));
}

/** Letting go at the end of a drag: pointerup and mouseup, and no click. */
function dispatchDrop(point: Point, pointer: PointerInfo): void {
  const under = document.elementFromPoint(point.x, point.y) ?? document.body;
  const init = mouseInit(point, 0);
  send(under, new PointerEvent("pointerup", pointerInit(init, pointer)));
  send(under, new MouseEvent("mouseup", init));
}

/** An interrupted drag: nothing is dropped. */
function dispatchCancel(point: Point, pointer: PointerInfo): void {
  const init = mouseInit(point, 0);
  send(document.body, new PointerEvent("pointercancel", pointerInit(init, pointer)));
}

/* --------------------------------------------------------------- hovering */

/**
 * On what one of Skye's cursors is over, and everything that sits in, as
 * :hover is: styles that give something a look on :hover give it the same
 * on `:is(:hover, [data-agent-hover])`.
 */
const HOVER_ATTR = "data-agent-hover";

/** How many of Skye's cursors are over each element, so it keeps HOVER_ATTR while any is. */
const hoverCounts = new Map<Element, number>();

/** One cursor comes onto (`by` 1) or leaves (-1) each of `elements`. */
function markHovered(elements: readonly Element[], by: 1 | -1): void {
  for (const element of elements) {
    const count = (hoverCounts.get(element) ?? 0) + by;
    if (count > 0) hoverCounts.set(element, count);
    else hoverCounts.delete(element);
    element.toggleAttribute(HOVER_ATTR, count > 0);
  }
}

/**
 * Moving from what `was` lists to what `now` does (each innermost first):
 * out and over at the innermost of each, leave on each it is no longer in
 * (innermost first) and enter on each it has come into (outermost first),
 * pointer then mouse, as a mouse sends them.
 */
function dispatchHover(was: readonly Element[], now: readonly Element[], point: Point, pointer: PointerInfo, holding: boolean): void {
  const init = mouseInit(point, holding ? 1 : 0);
  const [from, to] = [was[0] ?? null, now[0] ?? null];
  const still = new Set(now);
  const already = new Set(was);
  const pair = (target: Element, type: "out" | "over" | "leave" | "enter", relatedTarget: Element | null) => {
    if (!target.isConnected) return;
    const bubbles = type === "out" || type === "over";
    const each = { ...init, bubbles, cancelable: bubbles, relatedTarget };
    send(target, new PointerEvent(`pointer${type}`, pointerInit(each, pointer)));
    send(target, new MouseEvent(`mouse${type}`, each));
  };
  if (from) pair(from, "out", to);
  for (const element of was) if (!still.has(element)) pair(element, "leave", to);
  if (to) pair(to, "over", from);
  for (const element of [...now].reverse()) if (!already.has(element)) pair(element, "enter", from);
}

/** The one cursor Skye has. */
export const agentCursor = new AgentCursorController();
