// What Skye says in the chat without being asked: news she brings up (the
// disruption), what she tells a teammate she has called in, a decision she
// logs. Off a call only: on one she says it aloud, and the call's transcript
// joins the chat (voiceMessages.ts), so posting it too would say it twice.
//
// Pure and React-free, as voiceMessages.ts is: the chat merges the notes into
// its list whenever they change, and again after Coral settles a typed reply
// (which replaces the whole list). Merging twice changes nothing.
import type { ChatMessage } from "@coral-ai/chat";

/**
 * `after` is the message it first went after (null at the start), once it
 * has been shown: a typed reply settling drops it, and it goes back there,
 * so the conversation keeps its order.
 */
export type SkyeNote = { id: string; text: string; after?: string | null };

let notes: readonly SkyeNote[] = [];
let ids = 0;
const listeners = new Set<() => void>();

/** For useSyncExternalStore. */
export const skyeNotes = (): readonly SkyeNote[] => notes;
export function subscribeSkyeNotes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Skye says `text` in the chat, as a reply of hers. */
export function postSkyeNote(text: string): void {
  notes = [...notes, { id: `mica-note-${(ids += 1)}`, text }];
  for (const listener of listeners) listener();
}

/**
 * The message list with every note in it, as Skye's: one never shown goes at
 * the end, and one shown before goes back after the message it first went
 * after (at the end when that is gone). Each note shown for the first time
 * remembers that message. Returns the same array when nothing changed, so
 * callers can skip a state update; merging again changes nothing.
 */
export function mergeSkyeNotes(messages: readonly ChatMessage[], posted: readonly SkyeNote[]): ChatMessage[] {
  const current = messages as ChatMessage[];
  const shown = new Set(messages.map((message) => message.id));
  const missing = posted.filter((note) => !shown.has(note.id));
  if (missing.length === 0) return current;
  const next = [...current];
  for (const note of missing) {
    const message: ChatMessage = { id: note.id, role: "assistant", content: note.text };
    const anchor = note.after === undefined ? -2 : note.after === null ? -1 : next.findIndex((entry) => entry.id === note.after);
    if (note.after === undefined) note.after = next.at(-1)?.id ?? null;
    if (anchor === -2 || (anchor === -1 && note.after !== null)) next.push(message);
    else next.splice(anchor + 1, 0, message);
  }
  return next;
}
