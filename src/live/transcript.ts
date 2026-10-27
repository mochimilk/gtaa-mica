// Ordered transcript accumulation for a GPT-Live call.
//
// GPT-Live's transcript deltas have no item id and no event marking the end of
// a turn, and "delivery can be uneven". So Mica keeps every delta with its
// `start_ms`/`end_ms` and orders by timeline position, not arrival order. This
// log is the only way to reconstruct what the user asked for when a delegation
// arrives, since `session.delegation.created` carries no task text.
import type { TranscriptRole } from "./liveEvents.ts";

export type TranscriptSegment = {
  role: TranscriptRole;
  text: string;
  startMs: number;
  endMs: number;
  /** Arrival order, used only to break ties at identical `startMs`. */
  seq: number;
};

/** How far back from a delegation offset the user's request is looked for. */
export const DEFAULT_LOOKBACK_MS = 20_000;

/**
 * A silence this long inside one speaking turn separates two requests. Only
 * used when the agent did not speak in between, which is the stronger signal.
 */
const SILENCE_MS = 2_500;

/**
 * Deltas are fragments, often mid-sentence, and usually carry their own
 * spacing (`"What is"`, `" the stand"`). Two fragments that are contiguous on
 * the timeline are joined as-is; any gap at all gets a separator when neither
 * side already has whitespace.
 *
 * The threshold is zero on purpose. Fusing two words ("Show me" + "the board"
 * → "Show methe board") badly damages interpretation, while a spurious space
 * inside a word split across a gap is nearly harmless: identifier matching
 * strips whitespace before comparing. So this errs towards separating.
 */
const GAP_MS = 0;

function joinSegments(segments: readonly TranscriptSegment[]): string {
  let text = "";
  let previousEnd: number | null = null;
  for (const segment of segments) {
    const gapped = previousEnd !== null && segment.startMs - previousEnd > GAP_MS;
    if (text !== "" && gapped && !/\s$/.test(text) && !/^\s/.test(segment.text)) text += " ";
    text += segment.text;
    previousEnd = segment.endMs;
  }
  return text.replace(/\s+/g, " ").trim();
}

/** One speaker's consecutive words: a turn as a chat would show it. */
export type TranscriptTurn = {
  role: TranscriptRole;
  text: string;
};

export class TranscriptLog {
  #segments: TranscriptSegment[] = [];
  #seq = 0;
  /** Set once the stored order is known to be stale. */
  #sorted = true;
  #listeners = new Set<(role: TranscriptRole, text: string) => void>();

  /**
   * Calls `listener` with each delta as it arrives (Skye's words as she says
   * them, say); returns the unsubscribe.
   */
  subscribe(listener: (role: TranscriptRole, text: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  append(role: TranscriptRole, text: string, startMs: number, endMs: number): void {
    if (text === "") return;
    const previous = this.#segments[this.#segments.length - 1];
    const segment: TranscriptSegment = {
      role,
      text,
      startMs,
      endMs: Math.max(startMs, endMs),
      seq: this.#seq++,
    };
    // Out-of-order arrival is expected, so only mark for re-sorting instead of
    // sorting on every delta.
    if (previous && segment.startMs < previous.startMs) this.#sorted = false;
    this.#segments.push(segment);
    for (const listener of this.#listeners) listener(role, text);
  }

  #ordered(): readonly TranscriptSegment[] {
    if (!this.#sorted) {
      this.#segments.sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
      this.#sorted = true;
    }
    return this.#segments;
  }

  /** Every delta in timeline order. */
  segments(): readonly TranscriptSegment[] {
    return [...this.#ordered()];
  }

  /**
   * The conversation as speaker turns in timeline order, oldest first. A late
   * delta can land inside an earlier turn, so callers should treat the list as
   * a fresh reading each time rather than append-only.
   */
  turns(): TranscriptTurn[] {
    const turns: TranscriptTurn[] = [];
    let role: TranscriptRole | null = null;
    let run: TranscriptSegment[] = [];
    const flush = () => {
      if (run.length === 0 || role === null) return;
      const text = joinSegments(run);
      if (text !== "") turns.push({ role, text });
      run = [];
    };
    for (const segment of this.#ordered()) {
      if (segment.role !== role) {
        flush();
        role = segment.role;
      }
      run.push(segment);
    }
    flush();
    return turns;
  }

  /** Whole conversation as text, newest last, with speaker labels. */
  transcriptText(): string {
    return this.turns()
      .map((turn) => `${turn.role === "user" ? "User" : "Skye"}: ${turn.text}`)
      .join("\n");
  }

  /**
   * The user's words leading up to `offsetMs` — the reconstruction input for a
   * delegation.
   *
   * `aheadMs` allows for deltas whose `start_ms` sits slightly past the
   * delegation offset: the model can delegate the moment it understands the
   * request, while the tail of the same utterance is still being transcribed.
   */
  userRequestAt(offsetMs: number, lookbackMs = DEFAULT_LOOKBACK_MS, aheadMs = 2_000): string {
    const from = offsetMs - lookbackMs;
    const to = offsetMs + aheadMs;
    // Every role is considered, because the agent speaking is what marks a
    // turn boundary.
    const inWindow = this.#ordered().filter((segment) => segment.endMs >= from && segment.startMs <= to);

    const run: TranscriptSegment[] = [];
    for (let index = inWindow.length - 1; index >= 0; index -= 1) {
      const segment = inWindow[index];

      if (segment.role === "agent") {
        // A reply that began before this delegation ends the request: anything
        // earlier belongs to the previous exchange, however short the pause
        // was. A reply that began after the delegation is the agent starting
        // to answer *this* request, so it is skipped rather than treated as a
        // boundary.
        if (segment.startMs <= offsetMs) break;
        continue;
      }

      const next = run[0];
      // Within one turn, a long silence still separates two requests.
      if (next && next.startMs - segment.endMs > SILENCE_MS) break;
      run.unshift(segment);
    }
    return joinSegments(run);
  }

  /** Latest timeline position seen, for separating playback from task state. */
  lastActivityMs(): number | null {
    const ordered = this.#ordered();
    return ordered.length === 0 ? null : ordered[ordered.length - 1].endMs;
  }

  clear(): void {
    this.#segments = [];
    this.#seq = 0;
    this.#sorted = true;
  }
}
