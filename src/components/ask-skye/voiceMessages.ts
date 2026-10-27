// Folds a GPT-Live call's transcript into the chat's message list, so what was
// said on a call reads in the same conversation as what was typed.
//
// Pure and React-free: the chat calls it whenever the transcript changes, and
// again after Coral settles a typed reply (Coral replaces its whole list with
// the snapshot it sent, which drops anything added meanwhile). Calling it twice
// with the same input changes nothing, so re-applying is always safe.
import type { ChatMessage } from "@coral-ai/chat";
import type { TranscriptTurn } from "../../live/transcript.ts";

/** Coral message `type` for spoken turns; the assistant's are drawn by a custom renderer. */
export const VOICE_MESSAGE_TYPE = "mica-voice";

export function voiceMessageId(call: number, index: number): string {
  return `mica-voice-${call}-${index}`;
}

function toMessage(call: number, index: number, turn: TranscriptTurn): ChatMessage {
  return {
    id: voiceMessageId(call, index),
    role: turn.role === "user" ? "user" : "assistant",
    content: turn.text,
    type: VOICE_MESSAGE_TYPE,
    metadata: { spoken: true, call },
  };
}

/**
 * The message list with `call`'s turns in it.
 *
 * Turns already shown are updated in place, as their text grows or a late
 * delta changes who said what; new turns are appended; and turns the
 * transcript no longer has (two runs merged by a late delta) are removed. Turns
 * from earlier calls, and typed messages, are never touched. Returns the same
 * array when nothing changed, so callers can skip a state update.
 */
export function mergeVoiceTurns(
  messages: readonly ChatMessage[],
  call: number,
  turns: readonly TranscriptTurn[],
): ChatMessage[] {
  const current = messages as ChatMessage[];
  if (call <= 0) return current;
  const prefix = `mica-voice-${call}-`;
  const wanted = new Map(turns.map((turn, index) => [voiceMessageId(call, index), toMessage(call, index, turn)]));
  const shown = new Set<string>();
  let changed = false;

  const next: ChatMessage[] = [];
  for (const message of messages) {
    if (!message.id?.startsWith(prefix)) {
      next.push(message);
      continue;
    }
    const replacement = wanted.get(message.id);
    if (!replacement) {
      changed = true;
      continue;
    }
    shown.add(message.id);
    if (replacement.content !== message.content || replacement.role !== message.role) {
      next.push(replacement);
      changed = true;
    } else {
      next.push(message);
    }
  }
  for (const [id, message] of wanted) {
    if (shown.has(id)) continue;
    next.push(message);
    changed = true;
  }
  return changed ? next : current;
}
