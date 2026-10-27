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
  settleMs?: number;
  contextSyncMs?: number;
};

/** Quiet gap after which the agent is treated as no longer speaking. */
export const SPEECH_IDLE_MS = 1_200;

/**
 * Sent as instructions once the session is up, so Skye speaks first, the way
 * a coworker picks up a call. App-authored; never built from caller text.
 */
export const GREETING_INSTRUCTIONS =
  "A coworker just called you and you picked up. Speak first, in English, with a short, natural, casual " +
  "greeting in your own words, the way you would answer a colleague on the stand-allocation desk; vary it " +
  "from call to call. Do not introduce yourself or explain what you can do. Then stop and listen.";

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
      this.#eventSeq += 1;
      transport.send(injectionEvent("instructions", `mica_inj_${this.#eventSeq}`, null, GREETING_INSTRUCTIONS));
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

  /** The user changed the board by hand. */
  noteContextChange(revision: number): void {
    if (this.#state.phase !== "connected") return;
    this.#executor.noteContextChange(revision);
  }

  async #release(): Promise<void> {
    this.#cancelSpeechTimer?.();
    this.#cancelSpeechTimer = null;
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
