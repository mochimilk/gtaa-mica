// Skye's helper cursors: extra hands for work that runs in parallel.
//
// DEV NOTE (prototype): this exists for the multi-cursor demo (see
// docs/multi-agent-demo.md), where Skye splits into several cursors to clear
// a closed stand area. What "Skye working as several agents" should mean in
// the product (are they separate agents with their own reasoning, or one
// agent with several hands? who does the user talk to? how is a helper's
// mistake shown, undone or attributed?) is still open, and this module only
// covers the hands.
//
// Each helper is an ordinary AgentCursorController with its own overlay and
// its own pointer id, so its drags run alongside the others' (the chart keeps
// one drag per pointer). They are not primary pointers, so none of them
// scrolls the chart under the others. The pool is fixed and mounted once
// (<AgentHelperCursors />); a helper stays hidden until it is given work.
import { skyePalettes } from "../luma-skye/skye";
import { AgentCursorController, type Point } from "./cursorMotion";

/**
 * A helper: it looks just like Skye's own cursor, with no name. Its tag shows
 * only while it has a task ("XD456/457 → C25").
 */
export type AgentHelper = {
  controller: AgentCursorController;
};

/** How many helpers Skye can split into. */
const HELPER_COUNT = 5;

/** The helpers, in the order work is handed out. Pointer ids 2 onwards; Skye's own cursor is 1. */
export const agentHelpers: readonly AgentHelper[] = Array.from({ length: HELPER_COUNT }, (_, index) => ({
  controller: new AgentCursorController({ pointerId: index + 2 }),
}));

/**
 * The radius of Skye's aura while her helpers work, px: the ring round her
 * orb (see AgentCursor), a loading bar for their work, and where her tethers
 * leave from.
 */
export const AURA_RADIUS = 22;

/**
 * The skye's colours (skyePalettes.luma, the light along the bottom of the
 * screen), as the stylesheet's channels for them: Skye's orb glows in them
 * while her helpers work, and the light along her tethers is theirs.
 */
export const SKYE_COLOURS: Readonly<Record<string, string>> = {
  "--agent-cursor-skye-deep": skyePalettes.luma.deep,
  "--agent-cursor-skye-light": skyePalettes.luma.light,
  "--agent-cursor-skye-core": skyePalettes.luma.core,
  "--agent-cursor-skye-edge": skyePalettes.luma.edge,
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Matches .agent-tether-layer's fade. */
const TETHER_FADE_MS = 240;
/** A line coming or going as the web reshapes round the moving cursors. */
const LINE_FADE_MS = 200;
/** How often light leaves Skye's aura, and the first time, once her helpers are out. */
const PULSE_EVERY_MS = 2_600;
const FIRST_PULSE_MS = 300;
/** The light's speed along a line, px per ms, and its time on any one line: unhurried, so it reads as a glow passing through. */
const PULSE_SPEED = 0.3;
const PULSE_MIN_MS = 500;
const PULSE_MAX_MS = 1_900;
/** The streak behind the light at full speed, px. */
const STREAK = 24;
/** The flare round a helper as the light reaches it. */
const FLASH_MS = 800;

/** Lines, keyed by the two cursors they join (0 is Skye, then each helper by its place in the list). */
const lineKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

let serial = 0;

export type Tethers = {
  /**
   * Tethers `helper` to where its work now comes from: `parent`, the helper
   * whose work made its job, or Skye (null), as every helper is to begin
   * with. A link that would loop back to `helper` goes to Skye instead.
   */
  from(helper: AgentCursorController, parent: AgentCursorController | null): void;
  /** Fades the lines out and removes them. */
  stop(): void;
};

/**
 * Lines between Skye (`main`) and her `helpers` while they work, beneath the
 * dots, redrawn every frame as the cursors move. Each helper is tethered to
 * where its work came from: Skye's aura to begin with, or the helper whose
 * work made its job (`from`), so the lines branch out as the work does.
 * More lines join all of them in triangles, a web over the work, drawn just
 * as the tethers are: what tells the tethers apart is the light that runs
 * down them from the aura every PULSE_EVERY_MS, a glowing orb
 * that splits at each helper down the tethers out of it, and sends a spark
 * along each of its lines in the web. A helper that has not split off yet,
 * or is back inside the aura, has no lines. Stop them with `stop`.
 */
export function showTethers(main: AgentCursorController, helpers: readonly AgentCursorController[]): Tethers {
  const id = `agent-tether-${(serial += 1)}`;
  const layer = document.createElement("div");
  layer.className = "agent-cursor-layer agent-tether-layer";
  layer.setAttribute("aria-hidden", "true");
  for (const [name, value] of Object.entries(SKYE_COLOURS)) layer.style.setProperty(name, value);
  const svg = svgElement("svg", { class: "agent-tethers" }, layer);
  const defs = svgElement("defs", {}, svg);
  // The light's glow: white across its heart, in the skye's blue, fading out.
  const glow = svgElement("radialGradient", { id: `${id}-glow` }, defs);
  svgElement("stop", { offset: 0, class: "agent-tether-glow-heart" }, glow);
  svgElement("stop", { offset: 0.15, class: "agent-tether-glow-heart" }, glow);
  svgElement("stop", { offset: 0.45, class: "agent-tether-glow-light" }, glow);
  svgElement("stop", { offset: 1, class: "agent-tether-glow-rim" }, glow);
  const lineLayer = svgElement("g", { class: "agent-tether-lines" }, svg);
  const flashLayer = svgElement("g", { class: "agent-tether-lights" }, svg);
  const lightLayer = svgElement("g", { class: "agent-tether-lights" }, svg);
  document.body.appendChild(layer);

  const cursors = [main, ...helpers];
  /** Each helper's tether: the cursor it runs from (0, Skye, to begin with). */
  const tetheredTo = helpers.map(() => 0);
  const lines = new Map<string, { a: number; b: number; element: SVGLineElement; shown: number }>();
  const pulses = new Set<Pulse>();
  const flashes = new Set<{ node: number; start: number; element: SVGCircleElement }>();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Where each cursor is this frame, or null while it has no lines, and the
  // lines out of each: its tethers, to the helpers working from it, and the web.
  let points: (Point | null)[] = [];
  let children: number[][] = [];
  let web: number[][] = [];
  let last = performance.now();
  let nextPulse = last + FIRST_PULSE_MS;

  /** Where the line from `from` to `to` ends at `from`: a helper's dot, or Skye's aura. */
  const end = (from: number, to: number): Point => {
    const point = points[from]!;
    if (from !== 0) return point;
    const toward = points[to]!;
    const length = distance(point, toward) || 1;
    return {
      x: point.x + ((toward.x - point.x) / length) * AURA_RADIUS,
      y: point.y + ((toward.y - point.y) / length) * AURA_RADIUS,
    };
  };

  /** Light from `from` along its line to `to`: the orb, or a spark along the web. */
  const send = (from: number, to: number, spark: boolean, wave: Set<string>, now: number) => {
    const length = distance(end(from, to), end(to, from));
    const ms = Math.min(Math.max(length / PULSE_SPEED, PULSE_MIN_MS), PULSE_MAX_MS);
    // The streak fades back along the line from the orb; its gradient follows it.
    const gradient = svgElement("linearGradient", { id: `${id}-pulse-${(serial += 1)}`, gradientUnits: "userSpaceOnUse" }, defs);
    svgElement("stop", { offset: 0, class: "agent-tether-streak-tail" }, gradient);
    svgElement("stop", { offset: 1, class: "agent-tether-streak-head" }, gradient);
    const group = svgElement("g", { class: "agent-tether-pulse" }, lightLayer);
    group.toggleAttribute("data-spark", spark);
    const streak = svgElement("line", { class: "agent-tether-streak", stroke: `url(#${gradient.id})` }, group);
    const orb = svgElement("g", {}, group);
    svgElement("circle", { r: spark ? 6 : 12, fill: `url(#${id}-glow)` }, orb);
    svgElement("circle", { class: "agent-tether-heart", r: spark ? 1.4 : 2.4 }, orb);
    pulses.add({ from, to, start: now, ms, spark, wave, gradient, group, streak, orb });
  };

  /**
   * The light reaching a cursor in one wave: on down the tethers out of it,
   * and a spark along each of its lines in the web not yet lit in the wave.
   */
  const spread = (node: number, wave: Set<string>, now: number) => {
    for (const child of children[node]) send(node, child, false, wave, now);
    for (const other of web[node]) {
      const key = lineKey(node, other);
      if (wave.has(key)) continue;
      wave.add(key);
      send(node, other, true, wave, now);
    }
  };

  const drop = (pulse: Pulse) => {
    pulse.group.remove();
    pulse.gradient.remove();
    pulses.delete(pulse);
  };

  let frame = 0;
  const draw = (now: number) => {
    const elapsed = now - last;
    last = now;
    const centre = main.out ? main.position : null;
    points = cursors.map((cursor, index) => {
      const point = cursor.position;
      if (!centre || !point || !cursor.out) return null;
      return index === 0 || distance(point, centre) > AURA_RADIUS + 2 ? point : null;
    });

    // What shows: each helper's tether, from the cursor its work came from,
    // or Skye once that one has gone; then the rest of the web.
    const wanted = new Set<string>();
    children = cursors.map(() => []);
    web = cursors.map(() => []);
    helpers.forEach((_, index) => {
      const node = index + 1;
      if (!points[node]) return;
      const from = points[tetheredTo[index]] ? tetheredTo[index] : 0;
      children[from].push(node);
      wanted.add(lineKey(node, from));
    });
    const shown = points.flatMap((point, index) => (point ? [index] : []));
    for (const [i, j] of triangulate(shown.map((index) => points[index]!))) {
      const [a, b] = [shown[i], shown[j]];
      if (wanted.has(lineKey(a, b))) continue;
      wanted.add(lineKey(a, b));
      web[a].push(b);
      web[b].push(a);
    }

    for (const key of wanted) {
      if (lines.has(key)) continue;
      const [a, b] = key.split("-").map(Number);
      lines.set(key, { a, b, element: svgElement("line", { class: "agent-tether" }, lineLayer), shown: 0 });
    }
    // Lines fade in and out as the web reshapes; one whose cursor has gone fades where it was.
    for (const [key, line] of lines) {
      const step = elapsed / LINE_FADE_MS;
      line.shown = wanted.has(key) ? Math.min(1, line.shown + step) : line.shown - step;
      if (line.shown <= 0) {
        line.element.remove();
        lines.delete(key);
        continue;
      }
      line.element.setAttribute("opacity", String(line.shown));
      if (!points[line.a] || !points[line.b]) continue;
      const [from, to] = [end(line.a, line.b), end(line.b, line.a)];
      line.element.setAttribute("x1", String(from.x));
      line.element.setAttribute("y1", String(from.y));
      line.element.setAttribute("x2", String(to.x));
      line.element.setAttribute("y2", String(to.y));
    }

    if (!reducedMotion && points[0] && now >= nextPulse) {
      nextPulse = now + PULSE_EVERY_MS;
      spread(0, new Set(), now);
    }
    for (const pulse of [...pulses]) {
      if (!points[pulse.from] || !points[pulse.to] || !wanted.has(lineKey(pulse.from, pulse.to))) {
        drop(pulse);
        continue;
      }
      const t = (now - pulse.start) / pulse.ms;
      if (t >= 1) {
        drop(pulse);
        if (pulse.spark) continue;
        const flash = svgElement("circle", { fill: `url(#${id}-glow)` }, flashLayer);
        flashes.add({ node: pulse.to, start: now, element: flash });
        spread(pulse.to, pulse.wave, now);
        continue;
      }
      // Eased in and out, so it gathers at each cursor before splitting; the
      // streak grows with its speed and draws back into it as it arrives.
      const [a, b] = [end(pulse.from, pulse.to), end(pulse.to, pulse.from)];
      const length = distance(a, b) || 1;
      const along = ((1 - Math.cos(Math.PI * t)) / 2) * length;
      const back = Math.min(STREAK * Math.sin(Math.PI * t), along);
      const head = { x: a.x + ((b.x - a.x) * along) / length, y: a.y + ((b.y - a.y) * along) / length };
      const tail = { x: head.x - ((b.x - a.x) * back) / length, y: head.y - ((b.y - a.y) * back) / length };
      for (const element of [pulse.streak, pulse.gradient]) {
        element.setAttribute("x1", String(tail.x));
        element.setAttribute("y1", String(tail.y));
        element.setAttribute("x2", String(head.x));
        element.setAttribute("y2", String(head.y));
      }
      pulse.orb.setAttribute("transform", `translate(${head.x} ${head.y})`);
    }
    // A flare round the helper the light reached, following it as it moves.
    for (const flash of flashes) {
      const t = (now - flash.start) / FLASH_MS;
      const point = points[flash.node];
      if (t >= 1 || !point) {
        flash.element.remove();
        flashes.delete(flash);
        continue;
      }
      flash.element.setAttribute("cx", String(point.x));
      flash.element.setAttribute("cy", String(point.y));
      flash.element.setAttribute("r", String(6 + 20 * Math.sin((Math.PI / 2) * t)));
      flash.element.setAttribute("opacity", String(0.9 * (1 - t) ** 2));
    }
    frame = requestAnimationFrame(draw);
  };
  draw(last);
  // On the next frame, so the fade in runs.
  requestAnimationFrame(() => layer.setAttribute("data-visible", ""));

  let stopped = false;
  return {
    from(helper, parent) {
      const index = helpers.indexOf(helper);
      if (index < 0) return;
      let from = parent ? helpers.indexOf(parent) + 1 : 0;
      for (let up = from; up !== 0; up = tetheredTo[up - 1]) {
        if (up === index + 1) {
          from = 0;
          break;
        }
      }
      tetheredTo[index] = from;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      layer.removeAttribute("data-visible");
      setTimeout(() => {
        cancelAnimationFrame(frame);
        layer.remove();
      }, TETHER_FADE_MS);
    },
  };
}

/** Light on its way along a line, in one wave of it from Skye's aura (`wave`: the web lines it has lit). */
type Pulse = {
  from: number;
  to: number;
  start: number;
  ms: number;
  spark: boolean;
  wave: Set<string>;
  gradient: SVGLinearGradientElement;
  group: SVGGElement;
  streak: SVGLineElement;
  orb: SVGGElement;
};

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  parent: Element,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return parent.appendChild(element);
}

/**
 * The lines joining `points` in triangles (pairs of indices): their Delaunay
 * triangulation, where every three whose circumcircle holds none of the
 * others make a triangle. There are a handful of points at most, so every
 * three are tried. Points all in a line make no triangle, and each is joined
 * to its nearest instead.
 */
function triangulate(points: readonly Point[]): [number, number][] {
  const edges = new Map<string, [number, number]>();
  const join = (a: number, b: number) => edges.set(lineKey(a, b), [a, b]);
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      for (let c = b + 1; c < points.length; c += 1) {
        const circle = circumcircle(points[a], points[b], points[c]);
        if (!circle) continue;
        const inside = points.some(
          (point, index) =>
            index !== a && index !== b && index !== c && distance(point, circle) < circle.radius * (1 - 1e-9),
        );
        if (inside) continue;
        join(a, b);
        join(b, c);
        join(a, c);
      }
    }
  }
  if (edges.size === 0) {
    points.forEach((point, index) => {
      let nearest = -1;
      points.forEach((other, at) => {
        if (at !== index && (nearest < 0 || distance(point, other) < distance(point, points[nearest]))) nearest = at;
      });
      if (nearest >= 0) join(index, nearest);
    });
  }
  return [...edges.values()];
}

/** The circle through three points, or null when they lie in a line. */
function circumcircle(a: Point, b: Point, c: Point): (Point & { radius: number }) | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;
  const [a2, b2, c2] = [a, b, c].map((p) => p.x * p.x + p.y * p.y);
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, radius: Math.hypot(a.x - x, a.y - y) };
}
