// The written record of a task: what happened, who did it and when, in the
// order it happened, for anyone who missed a spoken update or stepped away.
// The Outputs panel's Activity (OutputsPanel) reads it. Skye's own part is what
// she was asked to say or did, written down, rather than a transcript of her
// voice, so it reads the same with no audio; it says what her narration leaves
// to the screen (who, when, the figures), not each word of it.

/** What kind of thing happened, for how the panel draws it. */
export type ActivityKind = "news" | "action" | "said" | "question" | "approval" | "applied" | "cancelled";

export type ActivityEntry = {
  id: string;
  /** When (Date.now()). */
  at: number;
  /** "Skye", "You", a teammate's name, or where news came from. */
  who: string;
  kind: ActivityKind;
  text: string;
};

let entries: readonly ActivityEntry[] = [];
const listeners = new Set<() => void>();
let ids = 0;

/** For useSyncExternalStore. */
export const activity = (): readonly ActivityEntry[] => entries;
export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function logActivity(who: string, kind: ActivityKind, text: string, at = Date.now()): void {
  entries = [...entries, { id: `activity-${(ids += 1)}`, at, who, kind, text }];
  for (const listener of listeners) listener();
}
