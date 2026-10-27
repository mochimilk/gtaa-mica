// Typed GPT-Live data-channel events, plus defensive parsing.
//
// Only the events Mica actually relies on are modelled. Anything else arriving
// on the channel is passed through as `{ type }` and ignored, so a new upstream
// event never breaks a call.
//
// References:
//   https://developers.openai.com/api/docs/guides/live-conversations
//   https://developers.openai.com/api/docs/guides/live-delegation
//   https://developers.openai.com/api/docs/guides/voice-webrtc

/** Which side of the conversation a transcript delta belongs to. */
export type TranscriptRole = "user" | "agent";

export type LiveTranscriptDelta = {
  type: "session.input_transcript.delta" | "session.output_transcript.delta";
  role: TranscriptRole;
  delta: string;
  /** Milliseconds from session start. Deltas can arrive out of order. */
  startMs: number;
  endMs: number;
};

export type LiveSessionStarted = { type: "session.started"; sessionId: string | null };

export type LiveSessionClosed = {
  type: "session.closed";
  /** `close_requested | expired | content | remote_hangup | connection_lost` and anything added later. */
  reason: string | null;
  usageSeconds: number | null;
};

export type LiveDelegationCreated = {
  type: "session.delegation.created";
  delegationId: string;
  /** "client" for app-executed work; "responses" when the API runs it instead. */
  target: string;
  /** Position in the session timeline; NOT the task text. */
  offsetMs: number;
};

/** Acknowledgement of one of our injections or mute commands. */
export type LiveAck = {
  type:
    | "session.commentary.appended"
    | "session.thinking.appended"
    | "session.instructions.appended"
    | "session.input_audio.muted"
    | "session.input_audio.unmuted";
  clientEventId: string | null;
};

export type LiveErrorEvent = {
  type: "error";
  code: string | null;
  message: string;
  clientEventId: string | null;
};

export type LiveUnknownEvent = { type: "unknown"; raw: string };

export type LiveIncomingEvent =
  | LiveTranscriptDelta
  | LiveSessionStarted
  | LiveSessionClosed
  | LiveDelegationCreated
  | LiveAck
  | LiveErrorEvent
  | LiveUnknownEvent;

/* ------------------------------------------------------------- outgoing */

/** The three app-to-model injection channels. */
export type InjectionKind = "commentary" | "thinking" | "instructions";

export const INJECTION_EVENT_TYPE: Record<InjectionKind, string> = {
  // Spoken: the model paraphrases it aloud.
  commentary: "session.commentary.append",
  // Quiet: available for reasoning, not spoken on append.
  thinking: "session.thinking.append",
  // App-authored steering, never caller text.
  instructions: "session.instructions.append",
};

export type LiveOutgoingEvent = {
  type: string;
  event_id?: string;
  delegation_id?: string | null;
  content?: string;
};

/**
 * Injected `content` is capped at 500 tokens upstream, and there is no
 * tokenizer in this app to measure against.
 *
 * A character budget cannot bound tokens: dense identifiers tokenize at
 * roughly one or two characters per token, and non-Latin scripts can cost
 * several tokens per character. What *is* a hard bound is bytes. The tokenizers
 * models use are byte-level BPE over UTF-8, so every token covers at least one
 * byte and therefore `tokens <= utf8Bytes`. Keeping content at or under 480
 * UTF-8 bytes cannot exceed 500 tokens for any input, in any script.
 *
 * Mica's own injections are one or two sentences, so the budget is only
 * reached by a long board summary, which truncates gracefully.
 */
export const MAX_INJECTION_BYTES = 480;

const utf8 = new TextEncoder();

/** UTF-8 length, the quantity the budget is expressed in. */
export function injectionByteLength(text: string): number {
  return utf8.encode(text).length;
}

/**
 * Splits text into user-perceived characters so truncation never lands inside
 * a multi-byte code point or splits a combining mark from its base.
 */
function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Segmenter === "function") {
    return [...new Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(
      (entry) => entry.segment,
    );
  }
  // Code points are still safe for UTF-8; only combining marks may separate.
  return [...text];
}

/** Trims to the byte budget, on a word boundary when one is close enough. */
export function clampInjectionContent(content: string, limitBytes = MAX_INJECTION_BYTES): string {
  const text = content.trim().replace(/\s+/g, " ");
  if (injectionByteLength(text) <= limitBytes) return text;

  // "…" is three UTF-8 bytes; reserve them so the result still fits.
  const budget = limitBytes - 3;
  let bytes = 0;
  let cut = "";
  for (const grapheme of graphemes(text)) {
    const size = injectionByteLength(grapheme);
    if (bytes + size > budget) break;
    bytes += size;
    cut += grapheme;
  }
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > cut.length * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.trimEnd()}…`;
}

/**
 * Builds one injection event.
 *
 * `delegationId` is the delegation being answered, or null for session-wide
 * context, exactly as the delegation guide requires.
 */
export function injectionEvent(
  kind: InjectionKind,
  eventId: string,
  delegationId: string | null,
  content: string,
): LiveOutgoingEvent {
  return {
    type: INJECTION_EVENT_TYPE[kind],
    event_id: eventId,
    delegation_id: delegationId,
    content: clampInjectionContent(content),
  };
}

export function muteEvent(eventId: string, muted: boolean): LiveOutgoingEvent {
  return { type: muted ? "session.input_audio.mute" : "session.input_audio.unmute", event_id: eventId };
}

/** Graceful shutdown request. Never `session.start`, which WebRTC forbids. */
export function closeEvent(): LiveOutgoingEvent {
  return { type: "session.close" };
}

/* -------------------------------------------------------------- parsing */

const asString = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Parses one data-channel message. Returns null only for unparseable JSON or a
 * message with no `type`; everything else becomes a typed or unknown event.
 */
export function parseLiveEvent(data: string): LiveIncomingEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  const event = payload as Record<string, unknown>;
  const type = asString(event?.type);
  if (!type) return null;

  switch (type) {
    case "session.started": {
      const session = event.session as Record<string, unknown> | undefined;
      return { type: "session.started", sessionId: asString(session?.id) ?? asString(event.session_id) };
    }
    case "session.closed": {
      const usage = event.usage as Record<string, unknown> | undefined;
      return { type: "session.closed", reason: asString(event.reason), usageSeconds: asNumber(usage?.seconds) };
    }
    case "session.input_transcript.delta":
    case "session.output_transcript.delta": {
      const delta = asString(event.delta);
      if (delta === null) return { type: "unknown", raw: type };
      const startMs = asNumber(event.start_ms) ?? 0;
      return {
        type,
        role: type === "session.input_transcript.delta" ? "user" : "agent",
        delta,
        startMs,
        endMs: asNumber(event.end_ms) ?? startMs,
      };
    }
    case "session.delegation.created": {
      const delegation = event.delegation as Record<string, unknown> | undefined;
      const delegationId = asString(delegation?.id);
      if (!delegationId) return { type: "unknown", raw: type };
      return {
        type: "session.delegation.created",
        delegationId,
        target: asString(delegation?.target) ?? "client",
        offsetMs: asNumber(event.offset_ms) ?? 0,
      };
    }
    case "session.commentary.appended":
    case "session.thinking.appended":
    case "session.instructions.appended":
    case "session.input_audio.muted":
    case "session.input_audio.unmuted":
      return { type, clientEventId: asString(event.client_event_id) };
    case "error": {
      const error = event.error as Record<string, unknown> | undefined;
      return {
        type: "error",
        code: asString(error?.code) ?? asString(error?.type),
        message: asString(error?.message) ?? "The voice session reported an error.",
        clientEventId: asString(error?.client_event_id),
      };
    }
    default:
      return { type: "unknown", raw: type };
  }
}
