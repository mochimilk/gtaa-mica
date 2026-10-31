// A teammate's own voice on an approval call: Travis, answering Skye once she
// has asked baggage to approve (see ../operations/DisruptionNotice). A second
// GPT-Live session, the broker's "travis" persona, in his own voice. He hears
// nobody: his microphone is silence, so the user cannot talk to him, and what
// Skye asked reaches him in the app's cue. He picks up muted (pickUp),
// comes off mute as he is cued, speaks only then, and his session closes as
// he leaves the call.
//
// His session starts as Skye comes to her ask (ready), so it is up by the time
// she has finished, and he is cued then: a session left waiting more than a
// couple of seconds often never answers. He is cued as Skye is (her `say`):
// as commentary, the channel GPT-Live says aloud, with what she asked him
// to approve before it as quiet facts (thinking), so he knows it without
// reading it out. As with Skye (./callController), there is no
// end-of-response event: he is speaking while his words arrive
// (SPEECH_IDLE_MS, for his tile), and has said his piece once he has come to
// the end of what he was asked to say (answer's `ended`) and his voice has
// stopped; failing that, after a silence longer than he pauses between his
// sentences (ANSWER_IDLE_MS, ANSWER_QUIET_MS).
import { ENDED_IDLE_MS, ENDED_QUIET_MS, QUIET_LEVEL, SAID_POLL_MS, SPEECH_IDLE_MS } from "./callController.ts";
import type { LivePersona } from "./liveBackend.ts";
import { injectionEvent } from "./liveEvents.ts";
import type { CancelFn, LiveTransport, ScheduleFn, TransportHandlers } from "./liveTransport.ts";

/** The teammates with a voice of their own, and whose session each one's is. */
export const TEAMMATE_PERSONAS: Readonly<Record<string, LivePersona>> = { "Travis Hughes": "travis" };

/** Not heard this long after his cue, ms, he is cued once more. */
export const ANSWER_NUDGE_MS = 4_000;

/** How long a cued teammate has to be heard, ms; past that, he is taken not to answer. */
export const ANSWER_HEARD_WITHIN_MS = 10_000;

/** How long he can go on once heard, ms, before he is taken to be done regardless. */
export const ANSWER_SAID_WITHIN_MS = 30_000;

/**
 * Short of the end of what he was asked to say, he is done after no words for
 * this long, ms, and his voice quiet for ANSWER_QUIET_MS; at its end, sooner
 * (ENDED_IDLE_MS, ENDED_QUIET_MS). As Skye's (SAID_IDLE_MS, SAID_QUIET_MS).
 */
export const ANSWER_IDLE_MS = 1_500;
export const ANSWER_QUIET_MS = 900;

export type TeammateVoiceDeps = {
  /** A transport for one teammate's session, as `persona`, with silence for a microphone. */
  createTransport: (persona: LivePersona, handlers: TransportHandlers) => LiveTransport;
  /** Plays a teammate's voice; null once he has left. */
  play: (stream: MediaStream | null) => void;
  /** How loud his voice is as it plays (0–1, see VoiceMeter); without it, his words alone say when he is done. */
  level?: () => number;
  schedule?: ScheduleFn;
};

type Voice = {
  transport: LiveTransport;
  aborter: AbortController;
  /** Resolves true once his session is up, false when it could not start or he left first. */
  up: Promise<boolean>;
  /** Told of each of his words as it arrives (true), and that he has left (false). */
  words: Set<(heard: boolean) => void>;
  /** What he has said since he was last cued. */
  said: string;
  cancelQuiet: CancelFn | null;
};

const defaultSchedule: ScheduleFn = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

export class TeammateVoice {
  #deps: TeammateVoiceDeps;
  #schedule: ScheduleFn;
  #voices = new Map<string, Voice>();
  #speaking: string | null = null;
  #muted: readonly string[] = [];
  #listeners = new Set<() => void>();
  #eventSeq = 0;

  constructor(deps: TeammateVoiceDeps) {
    this.#deps = deps;
    this.#schedule = deps.schedule ?? defaultSchedule;
  }

  /** Who is speaking, for their tile; null when nobody is. For useSyncExternalStore. */
  speaking = (): string | null => this.#speaking;

  /** Who is on the call muted, until they answer; for their tiles. For useSyncExternalStore. */
  muted = (): readonly string[] => this.#muted;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  #setSpeaking(name: string | null): void {
    if (this.#speaking === name) return;
    this.#speaking = name;
    this.#notify();
  }

  #setMuted(name: string, muted: boolean): void {
    if (this.#muted.includes(name) === muted) return;
    this.#muted = muted ? [...this.#muted, name] : this.#muted.filter((who) => who !== name);
    this.#notify();
  }

  /** Whether `name` has a voice of his own to answer with. */
  voiced(name: string): boolean {
    return name in TEAMMATE_PERSONAS;
  }

  /** `name` picks up, muted, to answer once it is his turn (answer). False for anyone without a voice of his own. */
  pickUp(name: string): boolean {
    if (!this.voiced(name)) return false;
    this.#setMuted(name, true);
    return true;
  }

  /** Starts `name`'s session ahead of his turn, so it is up as he is cued (see the file's head). */
  ready(name: string): void {
    this.#join(name);
  }

  /** Who is on the call to answer: picked up, or with a voice on. */
  names(): string[] {
    return [...new Set([...this.#muted, ...this.#voices.keys()])];
  }

  /** Brings `name`'s voice onto the call, starting his session; undefined for anyone without a voice of his own. */
  #join(name: string): Voice | undefined {
    const persona = TEAMMATE_PERSONAS[name];
    if (!persona) return undefined;
    const joined = this.#voices.get(name);
    if (joined) return joined;
    const transport = this.#deps.createTransport(persona, {
      onEvent: (event) => {
        if (this.#voices.get(name) !== voice) return;
        if (event.type === "session.output_transcript.delta") this.#heard(name, voice, event.delta);
        else if (event.type === "session.closed") this.leave(name);
      },
      onRemoteStream: (stream) => {
        if (this.#voices.get(name) === voice) this.#deps.play(stream);
      },
      onConnectionLost: () => {
        if (this.#voices.get(name) === voice) this.leave(name);
      },
    });
    const aborter = new AbortController();
    const voice: Voice = { transport, aborter, up: Promise.resolve(false), words: new Set(), said: "", cancelQuiet: null };
    this.#voices.set(name, voice);
    voice.up = transport.connect(aborter.signal).then(
      () => this.#voices.get(name) === voice,
      () => {
        if (this.#voices.get(name) === voice) this.leave(name);
        return false;
      },
    );
    return voice;
  }

  /**
   * Has `name` say what `cue` asks (app-authored, never caller text), knowing
   * `context` without saying it: his session starts, unless it has (ready),
   * and once it is up he comes off mute and is cued, and cued once more
   * should he not be heard within ANSWER_NUDGE_MS. Resolves true once he has
   * said it, `ended` saying when what he has said comes to its end (see the
   * file's head); false when he never got to (no voice of his own, no
   * session, he left, or he was not heard within ANSWER_HEARD_WITHIN_MS).
   */
  async answer(
    name: string,
    cue: string,
    ended: (said: string) => boolean = () => false,
    context?: string,
  ): Promise<boolean> {
    const voice = this.#join(name);
    if (!voice || !(await voice.up) || this.#voices.get(name) !== voice) return false;
    this.#setMuted(name, false);
    voice.said = "";
    const append = (kind: "thinking" | "commentary", content: string) => {
      this.#eventSeq += 1;
      voice.transport.send(injectionEvent(kind, `mica_teammate_${this.#eventSeq}`, null, content));
    };
    const send = () => append("commentary", cue);
    if (context) append("thinking", context);
    send();
    let heard = await this.#nextWords(voice, ANSWER_NUDGE_MS);
    if (!heard && this.#voices.get(name) === voice) {
      send();
      heard = await this.#nextWords(voice, ANSWER_HEARD_WITHIN_MS - ANSWER_NUDGE_MS);
    }
    if (!heard) return false;
    await this.#whenSaid(name, voice, ended);
    return this.#voices.get(name) === voice;
  }

  /** Takes `name` off the call: his session closes, and he is not heard again. */
  leave(name: string): void {
    this.#setMuted(name, false);
    const voice = this.#voices.get(name);
    if (!voice) return;
    this.#voices.delete(name);
    voice.cancelQuiet?.();
    for (const told of [...voice.words]) told(false);
    voice.aborter.abort();
    void voice.transport.close();
    this.#deps.play(null);
    if (this.#speaking === name) this.#setSpeaking(null);
  }

  /** Everyone's, as the call ends. */
  leaveAll(): void {
    for (const name of this.names()) this.leave(name);
  }

  /** His words arriving: he is speaking, for his tile, until SPEECH_IDLE_MS passes without any. */
  #heard(name: string, voice: Voice, delta: string): void {
    voice.said += delta;
    for (const told of [...voice.words]) told(true);
    voice.cancelQuiet?.();
    voice.cancelQuiet = this.#schedule(() => {
      voice.cancelQuiet = null;
      if (this.#speaking === name) this.#setSpeaking(null);
    }, SPEECH_IDLE_MS);
    this.#setSpeaking(name);
  }

  /** Resolves true when he is next heard, false after `timeoutMs` or once he leaves. */
  #nextWords(voice: Voice, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const settle = (heard: boolean) => {
        voice.words.delete(settle);
        cancel();
        resolve(heard);
      };
      voice.words.add(settle);
      const cancel = this.#schedule(() => settle(false), timeoutMs);
    });
  }

  /**
   * Resolves once he has said his piece: come to its end (`ended`), no words
   * for ENDED_IDLE_MS and his voice quiet for ENDED_QUIET_MS; or, short of
   * that, ANSWER_IDLE_MS and ANSWER_QUIET_MS; or once he leaves, or after
   * ANSWER_SAID_WITHIN_MS regardless.
   */
  #whenSaid(name: string, voice: Voice, ended: (said: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      let waited = 0;
      let sinceWords = 0;
      let sinceLoud = 0;
      const told = () => {
        sinceWords = 0;
      };
      voice.words.add(told);
      const poll = () => {
        waited += SAID_POLL_MS;
        sinceWords += SAID_POLL_MS;
        sinceLoud = (this.#deps.level?.() ?? 0) >= QUIET_LEVEL ? 0 : sinceLoud + SAID_POLL_MS;
        const said =
          (ended(voice.said) && sinceWords >= ENDED_IDLE_MS && sinceLoud >= ENDED_QUIET_MS) ||
          (sinceWords >= ANSWER_IDLE_MS && sinceLoud >= ANSWER_QUIET_MS);
        if (said || waited >= ANSWER_SAID_WITHIN_MS || this.#voices.get(name) !== voice) {
          voice.words.delete(told);
          resolve();
        } else this.#schedule(poll, SAID_POLL_MS);
      };
      this.#schedule(poll, SAID_POLL_MS);
    });
  }
}
