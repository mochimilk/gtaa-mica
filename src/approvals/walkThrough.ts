// Skye walking a teammate through the call's shared approval as she briefs
// them (../operations/DisruptionNotice): her cursor comes out of her orb and
// goes to each thing as she says it. Each change she talks about she clicks,
// so it is picked and ringed, each stand is lit as she names it, its bags'
// bars outlined as she says what it means for the carousels (./spotlight),
// then the decision as she asks.
//
// She puts her brief in her own words, so where she is in it is found by
// what she says: each beat of it (teammateBriefScript) has words that mark
// it, a flight, a stand, "bags", looked for in order in her words as they
// arrive. Should she put one another way, it is passed over once she is
// clearly past it. Her words arrive about WORDS_AHEAD_MS before they are
// heard: her cursor sets off as they arrive, so it gets there as she says
// them, and the highlights wait for her voice.
//
// With the approval not on screen, her cursor stays in. Should the user go to
// another page meanwhile, the Chat page stays mounted behind it while she
// walks them through it (../live/outOfSight), so her walk-through goes on
// there, out of sight, and is where she has got to when they come back.
import { agentCursor } from "../components/agent-cursor";
import { pageShift, skyeWorksOn } from "../live/outOfSight";
import type { BriefBeat, BriefScript } from "../operations/disruption";
import { setSpotlight, type Spotlight } from "./spotlight";

/** How far ahead of her voice her words arrive, ms: the highlights wait this long. */
export const WORDS_AHEAD_MS = 500;

/** The shared approval's element `selector` finds, its last when there are several; null when it is not on screen. */
const onPlan = (selector: string) => (): Element | null =>
  [...document.querySelectorAll(`[data-approval-plan] ${selector}`)].at(-1) ?? null;

const change = (stayId: string) => `[data-approval-change="${CSS.escape(stayId)}"]`;

/** What a beat lights, where her cursor goes for it, and whether it clicks there. */
function point(beat: BriefBeat): { spot: Spotlight; target: () => Element | null; clicks: boolean } {
  switch (beat.kind) {
    case "look":
      return { spot: null, target: onPlan("[data-approval-changes]"), clicks: false };
    case "card":
      return { spot: { stayIds: [beat.stayId], stands: [], bags: false }, target: onPlan(change(beat.stayId)), clicks: true };
    case "stand":
      return {
        spot: { stayIds: [beat.stayId], stands: [beat.end], bags: false },
        target: onPlan(`${change(beat.stayId)} [data-approval-stand="${beat.end}"]`),
        clicks: false,
      };
    case "bags":
      return { spot: { stayIds: [beat.stayId], stands: [], bags: true }, target: onPlan("[data-approval-bags] .bags-bar--now"), clicks: false };
    case "others":
      return {
        spot: { stayIds: beat.stayIds, stands: ["from", "to"], bags: false },
        target: onPlan(change(beat.stayIds[0])),
        clicks: true,
      };
    case "ask":
      return { spot: null, target: onPlan("[data-approval-decision]"), clicks: false };
  }
}

/** Resolves once what `find` returns has held still for a few frames, as a page settles, or after a second. */
function settled(find: () => Element | null): Promise<void> {
  return new Promise((resolve) => {
    const until = performance.now() + 1_000;
    let at = "";
    let still = 0;
    const look = () => {
      const box = find()?.getBoundingClientRect();
      const now = box ? `${box.left},${box.top}` : "";
      still = now === at ? still + 1 : 0;
      at = now;
      if (still >= 6 || performance.now() > until) resolve();
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}

/**
 * Where in `said`, from `from` on, she comes to `beat`: just past the first
 * of its words, as a whole word, or `from` for a beat with none; -1 when she
 * has not said any yet.
 */
function reach(beat: BriefBeat, said: string, from: number): number {
  if (!beat.words?.length) return from;
  const escaped = beat.words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const match = new RegExp(`(?<![\\w/])(?:${escaped.join("|")})(?![\\w])`, "i").exec(said.slice(from));
  return match ? from + match.index + match[0].length : -1;
}

/** How far past where a beat comes, in characters, she is before it is passed over unsaid. */
const PASSED_BY = 40;

export type WalkThrough = {
  /** What she has said of her brief so far, as her words arrive. */
  heard: (said: string) => void;
  /** Whether she has come to her ask. */
  asked: () => boolean;
  /** She has said it all: a beat her words never came to is shown now. */
  said: () => void;
  /** Her cursor goes to the decision, as she hands it to the user. */
  toDecision: () => void;
  /** Done: the highlights go, and her cursor goes back into her orb. */
  end: () => void;
};

/** Walks `who` through the shared approval along `script`, as her words of it arrive. */
export function walkThrough({ beats }: BriefScript, who: string): WalkThrough {
  let next = 0;
  /** Where in what she has said the last beat came. */
  let from = 0;
  let ended = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const done = skyeWorksOn("chat", `Walk ${who} through the changes`);
  /** Where her cursor went last. */
  let last: (() => Element | null) | null = null;
  const go = (beat: BriefBeat) => {
    const { target, clicks } = point(beat);
    last = target;
    void (clicks ? agentCursor.click(target) : agentCursor.hover(target));
  };
  const show = (beat: BriefBeat) => {
    const { spot } = point(beat);
    go(beat);
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!ended) setSpotlight(spot);
    }, WORDS_AHEAD_MS);
    timers.add(timer);
  };
  // The page moves under her cursor as it goes out of sight or comes back
  // (its chat list goes, and comes back): once it holds still, she goes back
  // to where she was.
  const follow = () =>
    pageShift("chat").addEventListener(
      "abort",
      () => {
        if (ended) return;
        follow();
        const target = last;
        if (!target) return;
        void settled(target).then(() => {
          if (!ended && last === target) void agentCursor.hover(target);
        });
      },
      { once: true },
    );
  follow();
  return {
    heard(said) {
      if (ended) return;
      while (next < beats.length) {
        // This beat, or, once she is past where it comes, one of the two after
        // it, should she have put this one another way.
        let found = reach(beats[next], said, from);
        let to = next;
        for (let later = next + 1; found < 0 && later < Math.min(beats.length, next + 3); later += 1) {
          if (said.length < beats[next].at) break;
          found = reach(beats[later], said, from);
          to = later;
        }
        if (found < 0) {
          if (said.length < beats[next].at + PASSED_BY) return;
          found = from;
          to = next;
        }
        while (next <= to) show(beats[next++]);
        from = found;
      }
    },
    asked: () => beats.slice(0, next).some((beat) => beat.kind === "ask"),
    said() {
      if (!ended && next < beats.length) show(beats[beats.length - 1]);
      next = beats.length;
    },
    toDecision() {
      if (!ended) go({ kind: "ask", at: 0 });
    },
    end() {
      ended = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      setSpotlight(null);
      done();
      if (agentCursor.out) void agentCursor.recall();
    },
  };
}
