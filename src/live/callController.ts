// The one call controller.
//
// Ask Skye reads and drives this object through `LiveCallProvider`, so there
// is a single source of truth for whether Mica is on a call, whether the mic is
// muted, and what the agent is doing. React only subscribes to it.
//
// Two activity signals are tracked separately, because GPT-Live has no
// per-response completion event and continuous audio gives no turn boundary:
//   - `agentSpeaking` follows output transcript activity (playback)
//   - `working` follows the executor (delegated app work)
// Conflating them would make the orb go calm while a task was still running.
import type { AppAction } from "./appActions.ts";
import { DelegationExecutor, type ExecutorLogEntry, type ScheduleFn } from "./executor.ts";
import { injectionEvent, type LiveIncomingEvent } from "./liveEvents.ts";
import { LiveCallError } from "./liveBackend.ts";
import type { LiveTransport, TransportHandlers } from "./liveTransport.ts";
import type { OperationsHost } from "./opsHost.ts";
import type { RequestInterpreter } from "./requestInterpreter.ts";
import { TranscriptLog } from "./transcript.ts";

export type CallPhase =
  /** No call. */
  | "idle"
  /** Asking for the microphone. */
  | "starting"
  /** Negotiating with GPT-Live. */
  | "connecting"
  /** `session.started` received; the clock runs from here. */
  | "connected"
  /** Hanging up. */
  | "closing"
  /** Failed; `error` explains why and the user can call again. */
  | "failed";

export type LiveCallState = {
  phase: CallPhase;
  /** Only set once the session is actually up, never during connect. */
  startedAt: number | null;
  muted: boolean;
  sessionId: string | null;
  error: { code: string; message: string } | null;
  agentSpeaking: boolean;
  working: boolean;
};

export type ControllerDeps = {
  /** Builds a transport for one call. */
  createTransport: (handlers: TransportHandlers) => LiveTransport;
  host: OperationsHost;
  interpreter?: RequestInterpreter;
  now?: () => number;
  schedule?: ScheduleFn;
  onRemoteStream?: (stream: MediaStream | null) => void;
  /** The caller's microphone while a call holds it, for a level meter; null once released. */
  onLocalStream?: (stream: MediaStream | null) => void;
  onLog?: (entry: ExecutorLogEntry) => void;
  /** How loud Skye's voice is as it plays (0–1, see VoiceMeter), to tell when she has finished saying something. */
  outputLevel?: () => number;
  settleMs?: number;
  contextSyncMs?: number;
};

/** Quiet gap after which the agent is treated as no longer speaking. */
export const SPEECH_IDLE_MS = 1_200;

/** How long what Skye raises herself (`offer`) waits for her to finish what she is saying, ms. */
export const OFFER_QUIET_WITHIN_MS = 10_000;

/** How long, once asked, Skye has to be heard raising it, ms; past that the offer resolves unheard. */
export const OFFER_HEARD_WITHIN_MS = 8_000;

/** How long what Skye says (`speak`) can go on once she is heard, ms; past that it is taken as said. */
export const SPOKEN_WITHIN_MS = 60_000;

/**
 * What she says is said once no words of it have come for SAID_IDLE_MS and
 * her voice has been quiet for SAID_QUIET_MS: longer than she pauses between
 * sentences, which SPEECH_IDLE_MS is not. Her voice is quiet below
 * QUIET_LEVEL (0–1, as VoiceMeter reads it). Checked every SAID_POLL_MS.
 */
export const SAID_IDLE_MS = 1_500;
export const SAID_QUIET_MS = 900;
export const QUIET_LEVEL = 0.3;
export const SAID_POLL_MS = 100;

/**
 * Once her words come to NEAR_END of what she was given to say (by length;
 * she says it in her own words), she is done sooner: no words for
 * NEAR_END_IDLE_MS and her voice quiet for NEAR_END_QUIET_MS, so whoever
 * answers her does not leave a long gap.
 */
export const NEAR_END = 0.85;
export const NEAR_END_IDLE_MS = 800;
export const NEAR_END_QUIET_MS = 400;

/**
 * Once what she has said is known to have come to its end (speak's `ended`),
 * she is done as soon as her words have stopped for ENDED_IDLE_MS and her
 * voice for ENDED_QUIET_MS. Her words run ahead of her voice, so going by them
 * alone, whoever answers her could start while she is still heard.
 */
export const ENDED_IDLE_MS = 300;
export const ENDED_QUIET_MS = 300;

/**
 * Before she is given something new to say, her words have stopped
 * (SPEECH_IDLE_MS) and her voice has been quiet this long, ms: steered while
 * she is still heard, she can be cut off mid-sentence.
 */
export const QUIET_GAP_MS = 300;

/**
 * Sent as commentary once the session is up, so Skye speaks first, the way a
 * coworker picks up a call, as GPT-Live's guide has a session greet; the
 * session also starts with a greeting of its own in its input
 * (server/live-session.mjs). App-authored; never built from caller text.
 */
export const GREETING_INSTRUCTIONS =
  "A coworker just called you and you picked up. Speak first, in English, with a short, natural, casual " +
  "greeting in your own words, the way you would answer a colleague on the stand-allocation desk; vary it " +
  "from call to call. Do not introduce yourself or explain what you can do. Then stop and listen.";

/** Put before what Skye is to say herself (see `say`), as commentary. App-authored; what follows is too. */
export const SAY_INSTRUCTIONS =
  "Say this to the caller now, briefly and in your own words, without adding anything that is not in it: ";

const IDLE_STATE: LiveCallState = {
  phase: "idle",
  startedAt: null,
  muted: false,
  sessionId: null,
  error: null,
  agentSpeaking: false,
  working: false,
};

const defaultSchedule: ScheduleFn = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

/** Reasons that mean the session ended normally rather than broke. */
const EXPECTED_CLOSE_REASONS = new Set(["close_requested", "remote_hangup"]);

export class LiveCallController {
  #deps: ControllerDeps;
  #now: () => number;
  #schedule: ScheduleFn;

  #state: LiveCallState = IDLE_STATE;
  #listeners = new Set<() => void>();
  /**
   * Transcript listeners are separate from state listeners: deltas arrive many
   * times a second, and only a view of the conversation needs them.
   */
  #transcriptListeners = new Set<() => void>();
  /** Counts calls placed, so a view can tell one call's turns from the next. */
  #callNumber = 0;

  #transcript = new TranscriptLog();
  #executor: DelegationExecutor;
  #transport: LiveTransport | null = null;
  #aborter: AbortController | null = null;
  /** Guards against events and results from a previous call. */
  #generation = 0;
  #eventSeq = 0;
  #cancelSpeechTimer: (() => void) | null = null;
  /** Waiting for Skye's voice (see #nextSpeech): each called with true when she is next heard, false when the call ends. */
  #speechWaiters = new Set<(heard: boolean) => void>();
  /** What Skye hears, held off by the app (holdInput), apart from the user's own mute. */
  #held = false;
  /** Told each of Skye's words as it arrives (see speak). */
  #wordListeners = new Set<(delta: string) => void>();

  constructor(deps: ControllerDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => Date.now());
    this.#schedule = deps.schedule ?? defaultSchedule;
    this.#executor = new DelegationExecutor({
      host: deps.host,
      transcript: this.#transcript,
      interpreter: deps.interpreter,
      settleMs: deps.settleMs,
      contextSyncMs: deps.contextSyncMs,
      schedule: this.#schedule,
      onLog: deps.onLog,
      inject: (kind, delegationId, content) => {
        this.#eventSeq += 1;
        this.#transport?.send(injectionEvent(kind, `mica_inj_${this.#eventSeq}`, delegationId, content));
      },
      onBusyChange: (working) => this.#patch({ working }),
    });
  }

  /* --------------------------------------------------------------- store */

  getState(): LiveCallState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #patch(changes: Partial<LiveCallState>): void {
    const next = { ...this.#state, ...changes };
    const same = (Object.keys(next) as (keyof LiveCallState)[]).every((key) => {
      if (key === "error") {
        return next.error?.code === this.#state.error?.code && next.error?.message === this.#state.error?.message;
      }
      return next[key] === this.#state[key];
    });
    if (same) return;
    this.#state = next;
    for (const listener of [...this.#listeners]) listener();
  }

  /** True while there is a call to show, including while it is connecting. */
  get active(): boolean {
    return this.#state.phase !== "idle" && this.#state.phase !== "failed";
  }

  get transcript(): TranscriptLog {
    return this.#transcript;
  }

  /** The current or most recent call, starting at 1; 0 before the first call. */
  get callNumber(): number {
    return this.#callNumber;
  }

  /** Notified whenever the call transcript changes, including when a new call clears it. */
  subscribeTranscript(listener: () => void): () => void {
    this.#transcriptListeners.add(listener);
    return () => this.#transcriptListeners.delete(listener);
  }

  #notifyTranscript(): void {
    for (const listener of [...this.#transcriptListeners]) listener();
  }

  /* --------------------------------------------------------------- events */

  #onEvent(generation: number, event: LiveIncomingEvent): void {
    // Late events from a previous call must not move current state.
    if (generation !== this.#generation) return;

    switch (event.type) {
      case "session.input_transcript.delta":
        this.#transcript.append("user", event.delta, event.startMs, event.endMs);
        this.#notifyTranscript();
        break;
      case "session.output_transcript.delta":
        this.#transcript.append("agent", event.delta, event.startMs, event.endMs);
        this.#notifyTranscript();
        this.#markSpeaking();
        for (const listener of [...this.#wordListeners]) listener(event.delta);
        for (const heard of [...this.#speechWaiters]) heard(true);
        break;
      case "session.delegation.created":
        this.#executor.handleDelegation(event);
        break;
      case "session.closed":
        this.#onRemoteClose(event.reason);
        break;
      case "error":
        // Session-level errors are reported but do not themselves end the
        // call; `session.closed` does that if the session is terminated.
        this.#deps.onLog?.({
          delegationId: null,
          outcome: "rejected",
          detail: `live error ${event.code ?? "unknown"}: ${event.message}`,
        });
        break;
      default:
        break;
    }
  }

  /**
   * Playback activity, not task state. There is no end-of-response event, so
   * speech is treated as finished after a quiet gap.
   */
  #markSpeaking(): void {
    this.#cancelSpeechTimer?.();
    this.#patch({ agentSpeaking: true });
    this.#cancelSpeechTimer = this.#schedule(() => {
      this.#cancelSpeechTimer = null;
      this.#patch({ agentSpeaking: false });
    }, SPEECH_IDLE_MS);
  }

  #onRemoteClose(reason: string | null): void {
    const unexpected = reason !== null && !EXPECTED_CLOSE_REASONS.has(reason);
    // Invalidate first: a connect still in flight for this generation must not
    // be able to report "connected" after the session has already ended.
    this.#generation += 1;
    this.#executor.cancelAll(`session closed (${reason ?? "unknown"})`);
    void this.#release();
    if (unexpected) {
      this.#patch({
        ...IDLE_STATE,
        phase: "failed",
        error: { code: `session_closed_${reason}`, message: "The voice session ended unexpectedly." },
      });
    } else {
      this.#patch(IDLE_STATE);
    }
  }

  #onConnectionLost(reason: string): void {
    if (!this.active) return;
    // As with a remote close: invalidate so a pending connect cannot resurrect
    // this call or clobber a newer one.
    this.#generation += 1;
    this.#executor.cancelAll(`connection lost (${reason})`);
    void this.#release();
    this.#patch({
      ...IDLE_STATE,
      phase: "failed",
      error: { code: "connection_lost", message: "The voice connection dropped." },
    });
  }

  /* --------------------------------------------------------------- actions */

  /** Places a call. Safe to call again while one is already up (no-op). */
  async start(): Promise<void> {
    if (this.active) return;

    this.#generation += 1;
    const generation = this.#generation;
    const aborter = new AbortController();
    this.#aborter = aborter;

    this.#callNumber += 1;
    this.#transcript.clear();
    this.#notifyTranscript();
    this.#executor.reset();
    this.#held = false;
    // A mute chosen before the call is placed survives into it.
    this.#patch({ ...IDLE_STATE, muted: this.#state.muted, phase: "starting" });

    const transport = this.#deps.createTransport({
      onEvent: (event) => this.#onEvent(generation, event),
      onRemoteStream: (stream) => {
        if (generation === this.#generation) this.#deps.onRemoteStream?.(stream);
      },
      onLocalStream: (stream) => {
        if (generation === this.#generation) this.#deps.onLocalStream?.(stream);
      },
      onConnectionLost: (reason) => {
        if (generation === this.#generation) this.#onConnectionLost(reason);
      },
    });
    this.#transport = transport;
    // Seeded synchronously, so the microphone track is gated the moment it is
    // acquired rather than after the session is up.
    if (this.#state.muted) void transport.setMuted(true);

    try {
      // The microphone prompt happens inside connect(); "connecting" is set
      // immediately after so the UI does not claim to be negotiating while it
      // is really waiting on a permission dialog.
      this.#patch({ phase: "connecting" });
      const { sessionId } = await transport.connect(aborter.signal);
      if (generation !== this.#generation) {
        // Superseded by a newer call attempt, a remote close or a dropped
        // connection; drop this one without touching state.
        await transport.close();
        return;
      }
      this.#patch({ phase: "connected", startedAt: this.#now(), sessionId, error: null });
      // Now that the channel exists, tell the session about an existing mute.
      if (this.#state.muted) await transport.setMuted(true);
      // Initial board context, as quiet facts.
      this.#executor.syncNow();
      // Then Skye answers with a hello rather than waiting for the caller.
      this.#prompt(GREETING_INSTRUCTIONS);
    } catch (error) {
      if (generation !== this.#generation) return;
      const failure =
        error instanceof LiveCallError ? error : new LiveCallError("connect_failed", "Mica could not start voice.");
      this.#transport = null;
      this.#deps.onRemoteStream?.(null);
      this.#deps.onLocalStream?.(null);
      if (failure.code === "cancelled") {
        // A hangup during connect is not a failure to report.
        this.#patch(IDLE_STATE);
        return;
      }
      this.#patch({ ...IDLE_STATE, phase: "failed", error: { code: failure.code, message: failure.message } });
    }
  }

  /**
   * Hangs up. Works at any point, including mid-connect, and always ends with
   * the microphone released even if the session never answered.
   */
  async hangup(): Promise<void> {
    if (this.#state.phase === "idle") {
      this.#patch(IDLE_STATE);
      return;
    }
    // Invalidate first: anything still in flight belongs to a dead call.
    this.#generation += 1;
    this.#patch({ phase: "closing" });
    this.#executor.cancelAll("call ended");
    this.#aborter?.abort();
    await this.#release();
    this.#patch(IDLE_STATE);
  }

  /** Mute never cancels work in progress; it only gates the microphone. */
  async setMuted(muted: boolean): Promise<void> {
    this.#patch({ muted });
    await this.#transport?.setMuted(muted);
  }

  /**
   * Holds what Skye hears off, without muting the user: while a teammate
   * answers her aloud (./teammateVoice), so she does not take his words,
   * from the speakers, for the caller's. She hears silence meanwhile, not a
   * muted session (LiveTransport.hold). Released, the user's own mute is
   * what applies. Only for the call it is held on.
   */
  holdInput(held: boolean): void {
    if (this.#held === held) return;
    this.#held = held;
    this.#transport?.hold(held);
  }

  /**
   * A request typed in the chat, run by the same executor as voice requests,
   * with or without a call. Resolves with the reply, or null if a newer
   * request replaced it.
   */
  runTypedRequest(text: string): Promise<string | null> {
    return this.#executor.handleTypedRequest(text);
  }

  /**
   * The chat's Stop. Cancels the typed request in progress, if that is what
   * is running; a voice request is left alone. The cancelled request resolves
   * to null and changes nothing on the board.
   */
  cancelTypedRequest(): boolean {
    return this.#executor.cancelTyped();
  }

  /**
   * Has Skye say `text` on the call, in her own words, as she says hello:
   * app-authored, never caller text. Only while connected; returns whether
   * she was asked to. For what Skye brings up herself (see `offer`), and for
   * a reply to a request the app made for the user (the disruption's Run).
   */
  say(text: string): boolean {
    return this.#prompt(`${SAY_INSTRUCTIONS}${text}`);
  }

  /**
   * As `say`, once Skye has finished what she is saying (as `offer` waits),
   * resolving once she has said it: true when she was heard and has since
   * finished (SAID_IDLE_MS, SAID_QUIET_MS; sooner near its end, NEAR_END,
   * and sooner still once `ended` says what she has said has come to its
   * end, ENDED_IDLE_MS), false when she was not heard (no call, the call
   * ended, or nothing within OFFER_HEARD_WITHIN_MS). For what has to follow
   * her words, as a teammate's answer follows her brief. `onWords` hears
   * what she has said of it so far, as her words arrive.
   */
  async speak(text: string, onWords?: (said: string) => void, ended?: (said: string) => boolean): Promise<boolean> {
    if (this.#state.phase !== "connected") return false;
    await this.#whenQuiet(OFFER_QUIET_WITHIN_MS);
    let said = "";
    const hear = (delta: string) => {
      said += delta;
      onWords?.(said);
    };
    this.#wordListeners.add(hear);
    try {
      if (!this.say(text) || !(await this.#nextSpeech(OFFER_HEARD_WITHIN_MS))) return false;
      await this.#whenSaid(
        SPOKEN_WITHIN_MS,
        () => said.length >= NEAR_END * text.length,
        () => ended?.(said) ?? false,
      );
      return this.#state.phase === "connected";
    } finally {
      this.#wordListeners.delete(hear);
    }
  }

  /**
   * Resolves once Skye has finished what she is saying: no words for
   * SAID_IDLE_MS and her voice quiet for SAID_QUIET_MS, or, once `nearEnd`
   * says she is near its end, NEAR_END_IDLE_MS and NEAR_END_QUIET_MS, or,
   * once `ended` says she has come to it, ENDED_IDLE_MS and ENDED_QUIET_MS;
   * or once the call is not up, or after `timeoutMs` regardless.
   */
  #whenSaid(timeoutMs: number, nearEnd: () => boolean = () => false, ended: () => boolean = () => false): Promise<void> {
    return new Promise((resolve) => {
      let waited = 0;
      let sinceWords = 0;
      let sinceLoud = 0;
      const heard = () => {
        sinceWords = 0;
      };
      this.#wordListeners.add(heard);
      const poll = () => {
        waited += SAID_POLL_MS;
        sinceWords += SAID_POLL_MS;
        sinceLoud = (this.#deps.outputLevel?.() ?? 0) >= QUIET_LEVEL ? 0 : sinceLoud + SAID_POLL_MS;
        const said =
          (sinceWords >= SAID_IDLE_MS && sinceLoud >= SAID_QUIET_MS) ||
          (nearEnd() && sinceWords >= NEAR_END_IDLE_MS && sinceLoud >= NEAR_END_QUIET_MS) ||
          (ended() && sinceWords >= ENDED_IDLE_MS && sinceLoud >= ENDED_QUIET_MS);
        if (said || waited >= timeoutMs || this.#state.phase !== "connected") {
          this.#wordListeners.delete(heard);
          resolve();
        } else this.#schedule(poll, SAID_POLL_MS);
      };
      this.#schedule(poll, SAID_POLL_MS);
    });
  }

  /**
   * Skye brings something up herself, offering to do `proposal` (the
   * disruption notice): kept as her offer, `said` being what the user is
   * told, so a yes, said or typed, carries it out; and raised on a call,
   * once she has finished what she is saying. With `cue`, she is steered to
   * put it in her own words (see headsUpCue) rather than asked to say `said`.
   *
   * Resolves true as she is heard raising it, so what goes with it on screen
   * can show as she speaks; false when she is not (no call, the call ended,
   * or nothing heard within OFFER_HEARD_WITHIN_MS).
   */
  offer(said: string, proposal: AppAction, cue?: string): Promise<boolean> {
    this.#executor.offer(said, proposal);
    const raise = () => {
      if (!(cue ? this.#prompt(cue) : this.say(said))) return Promise.resolve(false);
      return this.#nextSpeech(OFFER_HEARD_WITHIN_MS);
    };
    if (this.#state.phase !== "connected") return Promise.resolve(false);
    // Not over herself: steered mid-sentence, her next words could still be the last one's.
    return this.#whenQuiet(OFFER_QUIET_WITHIN_MS).then(raise);
  }

  /** Resolves true when Skye is next heard, false after `timeoutMs` or when the call ends. */
  #nextSpeech(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const settle = (heard: boolean) => {
        this.#speechWaiters.delete(settle);
        cancel();
        resolve(heard);
      };
      this.#speechWaiters.add(settle);
      const cancel = this.#schedule(() => settle(false), timeoutMs);
    });
  }

  /**
   * Resolves once Skye is not speaking, by her words (agentSpeaking) and by
   * her voice, quiet for QUIET_GAP_MS, as her words run ahead of it; or once
   * the call is not up, or after `timeoutMs` regardless.
   */
  #whenQuiet(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let waited = 0;
      let sinceLoud = 0;
      const poll = () => {
        waited += SAID_POLL_MS;
        sinceLoud = (this.#deps.outputLevel?.() ?? 0) >= QUIET_LEVEL ? 0 : sinceLoud + SAID_POLL_MS;
        const quiet = !this.#state.agentSpeaking && sinceLoud >= QUIET_GAP_MS;
        if (quiet || waited >= timeoutMs || this.#state.phase !== "connected") resolve();
        else this.#schedule(poll, SAID_POLL_MS);
      };
      this.#schedule(poll, SAID_POLL_MS);
    });
  }

  /**
   * Has Skye say something now: app-authored, never caller text, sent as
   * commentary, the channel GPT-Live says aloud in its own words. Not as
   * instructions: those stay with the session for the rest of the call, and
   * can cut her off mid-sentence. Only while connected.
   */
  #prompt(content: string): boolean {
    if (this.#state.phase !== "connected" || !this.#transport) return false;
    this.#eventSeq += 1;
    this.#transport.send(injectionEvent("commentary", `mica_inj_${this.#eventSeq}`, null, content));
    return true;
  }

  /** The user changed the board by hand. */
  noteContextChange(revision: number): void {
    if (this.#state.phase !== "connected") return;
    this.#executor.noteContextChange(revision);
  }

  async #release(): Promise<void> {
    this.#cancelSpeechTimer?.();
    this.#cancelSpeechTimer = null;
    this.#held = false;
    for (const heard of [...this.#speechWaiters]) heard(false);
    const transport = this.#transport;
    this.#transport = null;
    // Abort before dropping the controller, or a connect still waiting on the
    // microphone prompt or the broker would run to completion unattended.
    this.#aborter?.abort();
    this.#aborter = null;
    this.#deps.onRemoteStream?.(null);
    this.#deps.onLocalStream?.(null);
    await transport?.close();
  }

  async dispose(): Promise<void> {
    this.#generation += 1;
    this.#executor.dispose();
    await this.#release();
    this.#listeners.clear();
    this.#transcriptListeners.clear();
  }
}
