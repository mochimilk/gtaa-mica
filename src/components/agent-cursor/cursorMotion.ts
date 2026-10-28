// Skye's own on-screen cursor.
//
// When Skye changes something in the app, its orb leaves the Ask pill as a
// second cursor, a dot, moves to the control like a person would, and really
// clicks it: the pointer, mouse and click events are dispatched at the dot's
// centre, with any key Skye holds (Ctrl to add to a selection), so the app
// reacts exactly as it does to a person. This file is the motion and the
// click; it knows nothing of React or of Mica's actions. The overlay element
// is supplied by <AgentCursor />, the orb by `setHome`, and callers say what
// to click.
//
// It takes off from the orb as the orb's thinking dots, picked up mid-spin:
// they close into one dot as they do into their check (Luma's merge: out a
// little, then snapped together), spinning faster as they close (as a skater
// does), and that dot pops and becomes the cursor.
// The dot then stays out wherever its last click left it until recalled
// (`recall`: the Ask pill's button, and Mica after each task, so every task
// starts from the orb; see LiveCallProvider), travelling to the orb and
// growing into it. A task that starts before then carries on from where the
// dot is. Left idle, it breathes and its name tag dims. With no orb on screen the dot appears
// mid-screen, and a recall fades it out where it is.
//
// What makes it read as a hand on a mouse rather than a tween:
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
// controllers, each with its own overlay and pointer id, split off from the
// main cursor (`spawnFrom`) and merge back into it (`retire`). Meanwhile the
// main cursor is an orb (`setOrb`), Skye itself, directing them from where
// it was put (`moveTo`), its ring filling as they work (`setProgress`). Their
// pointer events are not primary, as a second finger's are not, so they never
// drive what only the primary pointer should (the chart's autoscroll).

export type Point = { x: number; y: number };

/** The dot's state: "arrow" while travelling, "hand" (a little larger) over something clickable. */
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
/** The dot growing back into the orb; matches --agent-cursor-morph. */
const MORPH_MS = 360;
/** The orb shrinking back into the dot (setOrb); matches .agent-cursor-orb's transition. */
const ORB_SHRINK_MS = 200;
/** How long the cursor sits still before it rests: it breathes and its name tag dims. */
const IDLE_MS = 12_000;
/**
 * How quickly Skye works: each reach, settle, press and hold takes this share
 * of the time a person's would. 1 is a person's pace; lower is quicker.
 */
const PACE = 0.7;

/*
 * Taking off from the orb: the thinking dots close into one dot, and that dot
 * pops into the cursor. The spinner is the orb's (AskInput), Luma's
 * StepStatusIcon: four r 3 dots at 80% on a 4√2 orbit in a 20px box, one turn
 * every 1.25s. The dots meet as that spinner's do on the way to its check,
 * value for value: spread out by 39% over 208ms (easeOutSine), then snapped
 * to the centre by 417ms (easeInExpo), each dipped dot growing back over
 * 208ms (easeOutCubic). Only the spin differs: rather than easing to a stop,
 * it speeds up as they close.
 */
const SPIN_MS = 1_250;
const SPREAD_MS = 208;
const MERGE_MS = 417;
const SPREAD = 1.39;
const DOT_OPACITY = 0.8;
/** The dots' distance from the centre, in the spinner's units; it is measured when the spinner shows. */
const DOT_ORBIT = 4 * Math.SQRT2;
const POP_MS = 280;
const LAUNCH_MS = MERGE_MS + POP_MS;

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

const smoothstep = (from: number, to: number, t: number) => {
  const u = clamp((t - from) / (to - from), 0, 1);
  return u * u * (3 - 2 * u);
};

/** CSS's cubic-bezier() timing function, solved for x by bisection. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

// The thinking dots' merge easings (StepStatusIcon).
const easeOutSine = cubicBezier(0.61, 1, 0.88, 1);
const easeOutCubic = cubicBezier(0.33, 1, 0.68, 1);
const easeInExpo = cubicBezier(0.7, 0, 0.84, 0);

/** Where the orb's thinking dots are, in viewport pixels from the orb's centre. */
type SpinnerState = {
  /** The spinner's centre. */
  centre: Point;
  /** The first dot's angle, clockwise from 12 o'clock, degrees; the others follow at quarter turns. */
  turn: number;
  orbit: number;
  /** Pixels per unit of the spinner's 20px box. */
  unit: number;
  /** Each dot's scale, as it dips passing the lower left. */
  scales: number[];
  fill: string;
};

/** How far round the orb's spinner is, and each dot's size, so the cursor can take over in step. */
function spinnerState(spinner: Element | null, home: Point): SpinnerState | null {
  const svg = spinner?.querySelector("svg");
  // Its four dots come first; the ring and check they close into follow.
  const dots = Array.from(svg?.querySelectorAll("circle") ?? []).slice(0, 4);
  if (!svg || dots.length < 4) return null;
  const box = svg.getBoundingClientRect();
  const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  // Centres move with the spin but not with a dip, which scales each dot about its own.
  const first = dots[0].getBoundingClientRect();
  const x = first.left + first.width / 2 - centre.x;
  const y = first.top + first.height / 2 - centre.y;
  return {
    centre: { x: centre.x - home.x, y: centre.y - home.y },
    turn: (((Math.atan2(x, -y) * 180) / Math.PI) % 360 + 360) % 360,
    orbit: Math.hypot(x, y),
    unit: box.width / (svg.viewBox.baseVal?.width || box.width),
    scales: dots.map((dot) => {
      const transform = getComputedStyle(dot).transform;
      return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
    }),
    fill: getComputedStyle(dots[0]).fill,
  };
}

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
  /** Skye's orb, which the cursor leaves from and returns to. */
  #home: HTMLElement | null = null;
  /** True while the cursor is out of the orb; the orb shows empty meanwhile. */
  #away = false;
  /** The trip back to the orb, aborted when a new gesture starts. */
  #homing: AbortController | null = null;
  /** Dims the cursor once it has sat still for IDLE_MS. */
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** True while the cursor is an orb (setOrb). */
  #orb = false;
  /** True from setOrb(true) until the orb has shrunk back into the dot after setOrb(false). */
  #orbShown = false;
  /** Ends `orbShown` once the shrink has run. */
  #orbTimer: ReturnType<typeof setTimeout> | undefined;

  constructor({ pointerId = 1 }: AgentCursorOptions = {}) {
    this.#pointer = { pointerId, isPrimary: pointerId === 1 };
  }

  /** Called by <AgentCursor /> with its overlay element, and with null on unmount. */
  attach(root: HTMLElement | null): void {
    this.#root = root;
    if (!root) {
      this.#visible = false;
      clearTimeout(this.#idleTimer);
    }
  }

  /**
   * Registers Skye's orb as the cursor's home. While the cursor is out, the
   * orb carries `data-agent-away`, so it can step aside. Returns the
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

  /** True while the cursor is out in the app, from its first click until it is recalled. */
  get out(): boolean {
    return this.#visible;
  }

  /**
   * True while any of the orb shows (setOrb): from when it starts to
   * grow until it has shrunk back into the dot. Its renderer runs only then.
   */
  get orbShown(): boolean {
    return this.#orbShown;
  }

  /** Calls `listener` whenever `out` or `orbShown` changes; returns the unsubscribe. For useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * Brings the cursor back into the orb, after any gesture under way. A
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
    if (!this.#visible) return;
    this.#wake();
    if (!this.#busy) this.#armIdle();
  }

  /**
   * Shows the cursor as an orb, glowing, while its helpers work (see
   * agentSwarm.ts): Skye itself, directing them, rather than one more hand.
   * The dot swells into the orb, and with `on` false the orb shrinks back
   * into the dot. Its tag stays, and it does not dim or breathe meanwhile,
   * as it is still at work.
   */
  setOrb(on: boolean): void {
    clearTimeout(this.#orbTimer);
    this.#orb = on;
    this.#root?.toggleAttribute("data-orb", on);
    this.#wake();
    if (on) this.#setOrbShown(true);
    else {
      this.#orbTimer = setTimeout(() => this.#setOrbShown(false), ORB_SHRINK_MS);
      if (this.#visible && !this.#busy) this.#armIdle();
    }
  }

  /**
   * Fills the ring round the orb (setOrb) `share` of the way round, from 0
   * to 1: how much of its helpers' work is done.
   */
  setProgress(share: number): void {
    const aura = this.#root?.querySelector<SVGElement>(".agent-cursor-aura");
    aura?.style.setProperty("--agent-cursor-progress", String(clamp(share, 0, 1)));
  }

  /**
   * Where a hidden cursor will appear for its next gesture: for a helper,
   * the main cursor's dot, so it reads as splitting off from it. Does
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
   * `to` (the main cursor's dot), shrinks into it and is gone. Without `to`,
   * or with reduced motion, it fades where it is.
   */
  retire(to?: () => Point | null): Promise<void> {
    return this.#enqueue(async () => {
      if (!this.#visible) return;
      const point = prefersReducedMotion() ? null : (to?.() ?? null);
      if (point) await this.#travel(point, null);
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
        const edge = { x: clamp(target.x, box.left + 8, box.right - 8), y: target.y < box.top ? box.top + 10 : box.bottom - 10 };
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
      if (reduced) this.#place(target);
      // Straight, not arced: a sideways swing would drag the bar along in time on its way.
      else await this.#travel(target, null, signal, false);
      if (signal?.aborted) return;
      // A beat over the drop, so the preview shows before letting go.
      await sleep(reduced ? 150 : beat(380, 520), signal);
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
  }

  /**
   * Shows the cursor for a gesture: out of the orb, where it was last, or
   * mid-screen the first time.
   */
  async #appear(target: Element, aim: (rect: DOMRect) => Point, signal?: AbortSignal): Promise<void> {
    const reduced = prefersReducedMotion();
    const home = reduced ? null : this.#homePoint();
    if (!this.#visible) {
      if (home) {
        // Out of the orb: it shrinks into the dot where it sits.
        await this.#leaveHome(home, signal);
      } else {
        // With no orb to leave from: where it was last, or mid-screen the first time.
        const start = reduced ? aim(target.getBoundingClientRect()) : this.#startPoint();
        this.#snap(() => this.#morph(false));
        this.#place(start, "arrow");
        this.#show();
        // A beat for the hand to find the mouse.
        await sleep(reduced ? 120 : beat(160, 240), signal);
      }
    } else {
      // Still out from the last task, or turned round on its way home:
      // carry on from there, a dot again.
      this.#morph(false);
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
   * The orb becomes the cursor. Its thinking dots carry on in the overlay,
   * picked up where the orb's are, which step aside beneath them at once.
   * They close into one dot as they would into their check: out a little,
   * then snapped together, spinning faster the closer they get. That dot
   * pops, and the cursor's own dot fades in over it. With the orb showing
   * rather than its thinking dots, the dots fade in as the orb shrinks away.
   */
  async #leaveHome(home: Point, signal?: AbortSignal): Promise<void> {
    const root = this.#root;
    const body = root?.querySelector<HTMLElement>(".agent-cursor-body");
    const group = root?.querySelector<HTMLElement>(".agent-cursor-swarm");
    const swarm = Array.from(group?.querySelectorAll<HTMLElement>(":scope > span") ?? []);
    if (!root || !body || !group || swarm.length === 0) {
      this.#snap(() => {
        this.#morph(false);
        this.#place(home, "arrow");
        this.#show();
      });
      this.#setAway(true);
      return;
    }

    // Read before the orb steps aside: the spinner is gone once the cursor is out.
    const spinner = spinnerState(this.#home?.querySelector("[data-agent-spinner]") ?? null, home);
    // Without it, the dots start square to the orb, at the spinner's size.
    const start = spinner ?? { centre: { x: 0, y: 0 }, turn: 0, orbit: DOT_ORBIT, unit: 1, scales: [1, 1, 1, 1], fill: "" };
    // Time on the spinner's clock, which runs slower as the dots spread and faster as they close.
    let spun = 0;
    let last = 0;
    const frame = (ms: number) => {
      // Out a little, then in: slow to start, sudden at the end.
      const spread =
        ms < SPREAD_MS
          ? 1 + (SPREAD - 1) * easeOutSine(ms / SPREAD_MS)
          : SPREAD * (1 - easeInExpo(clamp((ms - SPREAD_MS) / (MERGE_MS - SPREAD_MS), 0, 1)));
      // Spinning faster as they close, as a skater pulling in their arms.
      spun += (ms - last) * Math.min(10, 1 / Math.max(spread, 0.01) ** 2);
      last = ms;
      const turn = start.turn + (spun / SPIN_MS) * 360;
      const regrow = easeOutCubic(clamp(ms / SPREAD_MS, 0, 1));
      // Once merged, the dot overshoots and settles, and the cursor's own dot takes over.
      const pop = clamp((ms - MERGE_MS) / POP_MS, 0, 1);
      const swell = 1 + 0.7 * Math.sin(2 * Math.PI * pop) * (1 - pop) ** 2;
      const handover = smoothstep(0.35, 0.85, pop);
      swarm.forEach((dot, i) => {
        const angle = ((turn + i * 90) * Math.PI) / 180;
        const radius = start.orbit * spread;
        const x = start.centre.x + radius * Math.sin(angle);
        const y = start.centre.y - radius * Math.cos(angle);
        const scale = start.unit * (start.scales[i] + (1 - start.scales[i]) * regrow) * swell;
        dot.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      });
      // On the group, as the spinner's is, so dots that overlap as they meet show no darker.
      group.style.opacity = String(DOT_OPACITY * (spinner ? 1 : Math.min(1, ms / 150)) * (1 - handover));
      body.style.opacity = String(handover);
    };

    this.#snap(() => {
      this.#morph(false);
      if (start.fill) root.style.setProperty("--agent-cursor-swarm-fill", start.fill);
      else root.style.removeProperty("--agent-cursor-swarm-fill");
      root.setAttribute("data-launch", "");
      frame(0);
      this.#place(home, "arrow");
      this.#show();
    });
    this.#setAway(true);
    try {
      await this.#animate(LAUNCH_MS, signal, (t) => frame(t * LAUNCH_MS));
    } finally {
      root.removeAttribute("data-launch");
      body.style.opacity = "";
      group.style.opacity = "";
      for (const dot of swarm) dot.style.transform = "";
    }
  }

  /**
   * On recall, the cursor travels back to the orb and grows into it, and the
   * orb comes back as the dot fades. Without an orb on screen it just fades
   * where it is. Aborted when a new gesture starts.
   */
  async #goHome(signal: AbortSignal): Promise<void> {
    if (signal.aborted || !this.#visible) return;
    this.#wake();
    const home = prefersReducedMotion() ? null : this.#homePoint();
    if (home) {
      await this.#travel(home, null, signal);
      if (signal.aborted) return;
      this.#morph(true);
      this.#setAway(false);
      await sleep(MORPH_MS, signal);
      if (signal.aborted) return;
    }
    this.#setAway(false);
    this.#root?.removeAttribute("data-visible");
    // Counted as visible until the fade finishes, so a follow-up in that
    // moment carries on rather than reappearing.
    setTimeout(() => {
      if (this.#root?.hasAttribute("data-visible") || !this.#visible) return;
      this.#visible = false;
      this.#notify();
    }, FADE_MS);
  }

  /** Where the orb is, when it is on screen to leave from or return to. */
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
    if (variant) this.#setVariant(variant);
  }

  #setVariant(variant: CursorVariant): void {
    if (this.#root && this.#root.dataset.variant !== variant) this.#root.dataset.variant = variant;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  #setOrbShown(shown: boolean): void {
    if (this.#orbShown === shown) return;
    this.#orbShown = shown;
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

  /** Whether the dot shows as the orb, at the orb's size and colours. */
  #morph(on: boolean): void {
    this.#root?.toggleAttribute("data-morph", on);
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
      if (this.#visible && !this.#busy && !this.#orb) this.#root?.setAttribute("data-idle", "");
    }, IDLE_MS);
  }

  /** Marks the orb as empty while its cursor is out. */
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

/** The one cursor Skye has. */
export const agentCursor = new AgentCursorController();
