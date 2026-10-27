// What Skye shows of the alerts while she talks about them: the Alerts window,
// compact (about two and a half alerts tall), with the alert she is on picked
// out. Hers, apart from the user's own Alerts window: it only shows while the
// user has none of Ask Skye's windows open, and opening theirs takes over
// (see AlertsMenu).

/** The alert Skye is on, or null while she has not reached one; null state when she is not talking about them. */
export type SkyeAlerts = { mentioned: string | null } | null;

let state: SkyeAlerts = null;
const listeners = new Set<() => void>();

function set(next: SkyeAlerts): void {
  if (next === state || (next && state && next.mentioned === state.mentioned)) return;
  state = next;
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore. */
export const skyeAlerts = (): SkyeAlerts => state;
export function subscribeSkyeAlerts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens Skye's compact Alerts, picking out `mentioned` (or keeping what was, with null). */
export function showSkyeAlerts(mentioned: string | null = null): void {
  set({ mentioned: mentioned ?? state?.mentioned ?? null });
}

/** Closes Skye's compact Alerts. */
export const hideSkyeAlerts = (): void => set(null);
