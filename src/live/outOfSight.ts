// Skye working out of sight: on a page the user has left.
//
// The page Skye's cursor is at work on stays mounted while the user is on
// another (App): the board always, the Chat page while she walks a teammate
// through the call's shared approval there. It is laid out where it shows but
// not drawn, and inert (outOfSightStyle), so her work there carries on, at her
// own pace, clicked through as it would be on screen, and it is as she left it
// when the user comes back. Her cursors there go out of sight with it
// (data-skye-away on the root element, agent-cursor.css), and the nav rail
// says where she is, beside that page's entry (AppNavRail).
//
// She counts as at work on a page from when she starts there (skyeWorksOn)
// until her cursor is back in her orb, or she sets to work elsewhere. A page
// moves under her cursor as it goes out of sight or comes back (only the page
// on screen has its left panel), so whatever she has hold of there she lets
// go of then (pageShift), to take hold of it again where it is.
import { useLayoutEffect, useSyncExternalStore, type CSSProperties } from "react";
import { agentCursor } from "../components/agent-cursor";
import type { AppPage } from "../components/nav-rail";

/**
 * Where Skye's cursor is at work: the page, what she is doing there ("Close
 * Pier B, 09:00–13:00"), if it says, and which stint of work it is. Work that
 * follows on the same page, her cursor still out, is the same stint.
 */
export type SkyeAt = { page: AppPage; doing: string | null; stint: number };

/** A page out of sight behind the one on screen: laid out where it shows, so Skye can work on it, but not drawn. */
export const outOfSightStyle: CSSProperties = { position: "absolute", inset: 0, visibility: "hidden" };

let shown: AppPage | null = null;
let at: SkyeAt | null = null;
/** Stands for the work under way, if any, so only its own `done` ends it. */
let work: object | null = null;
let stints = 0;
const shifts = new Map<AppPage, AbortController>();
const listeners = new Set<() => void>();

const markAway = () => document.documentElement.toggleAttribute("data-skye-away", !!at && at.page !== shown);

function set(next: SkyeAt | null): void {
  at = next;
  markAway();
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore: where Skye's cursor is at work, or null. */
export const skyeAt = (): SkyeAt | null => at;
export function subscribeSkyeAt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const useSkyeAt = (): SkyeAt | null => useSyncExternalStore(subscribeSkyeAt, skyeAt);

/** Whether `page` is the one on screen. */
export const pageShown = (page: AppPage): boolean => shown === page;

/** Aborted when `page` next goes out of sight or comes back. */
export function pageShift(page: AppPage): AbortSignal {
  let shift = shifts.get(page);
  if (!shift) shifts.set(page, (shift = new AbortController()));
  return shift.signal;
}

/**
 * Marks `page` as the one on screen. In a layout effect, so whatever waits on
 * pageShift lets go before the pages are next drawn in their new places.
 */
export function useShownPage(page: AppPage): void {
  useLayoutEffect(() => {
    const was = shown;
    shown = page;
    markAway();
    for (const moved of [was, page]) {
      if (!moved) continue;
      // Taken out first, so what waits on it can wait on the next one as it hears.
      const shift = shifts.get(moved);
      shifts.delete(moved);
      shift?.abort();
    }
  }, [page]);
}

/**
 * Skye's cursor sets to work on `page`, doing `doing`, or, with null, on what
 * shows on every page (the call window). Returns `done`, for when that work
 * is, which says whether it was still the work under way: her cursor goes on
 * counting as at work there until it is back in her orb.
 */
export function skyeWorksOn(page: AppPage | null, doing: string | null = null): () => boolean {
  const mine = page ? {} : null;
  work = mine;
  set(page ? { page, doing, stint: at?.page === page ? at.stint : (stints += 1) } : null);
  return () => {
    // Unless newer work has taken over from this.
    if (!mine || work !== mine) return false;
    work = null;
    if (!agentCursor.out) set(null);
    return true;
  };
}

// Back in her orb with nothing under way, she is at work nowhere.
agentCursor.subscribe(() => {
  if (at && !work && !agentCursor.out) set(null);
});
