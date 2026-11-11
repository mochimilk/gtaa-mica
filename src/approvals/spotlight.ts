// What Skye points at on the call's shared approval as she walks a teammate
// through it (./walkThrough), for its panes to show (./ApprovalsCall): the
// changes she means, ringed in the brand's colour; the stand on them she is
// naming, its tag in the brand's colour; and, as she says what a change does
// to the bags, their bars on the carousels, outlined in it; or the carousel
// maintenance she has moved, its card ringed. Null while she is not walking
// anyone through.

export type Spotlight = {
  stayIds: readonly string[];
  stands: readonly ("from" | "to")[];
  bags: boolean;
  maintenance?: boolean;
} | null;

let current: Spotlight = null;
const listeners = new Set<() => void>();

/** For useSyncExternalStore. */
export const spotlight = (): Spotlight => current;
export function subscribeSpotlight(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSpotlight(next: Spotlight): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}
