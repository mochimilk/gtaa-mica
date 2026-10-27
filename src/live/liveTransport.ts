// The GPT-Live WebRTC transport.
//
// Order matters here, and it is the order the WebRTC guide prescribes:
//   1. microphone track
//   2. the `oai-events` data channel, created BEFORE the offer
//   3. create the offer, set it locally, wait for ICE gathering
//   4. POST the offer through Mica's broker, which returns the answer
//   5. apply the answer, then wait for `session.started`
//
// `session.start` is never sent: the HTTP request starts the session, and
// sending it on the data channel is explicitly forbidden for WebRTC. Audio is
// carried on media tracks, so no audio events are sent or expected either.
import { LiveCallError, type LiveSessionGrant } from "./liveBackend.ts";
import {
  closeEvent,
  muteEvent,
  parseLiveEvent,
  type LiveIncomingEvent,
  type LiveOutgoingEvent,
} from "./liveEvents.ts";

export type CancelFn = () => void;
export type ScheduleFn = (callback: () => void, delayMs: number) => CancelFn;

export type TransportDeps = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createPeerConnection: () => RTCPeerConnection;
  /** Posts the offer to Mica's broker and returns the session and answer. */
  requestSession: (sdp: string, signal: AbortSignal) => Promise<LiveSessionGrant>;
  schedule?: ScheduleFn;
};

export type TransportHandlers = {
  onEvent: (event: LiveIncomingEvent) => void;
  /** The agent's audio, for playback. */
  onRemoteStream?: (stream: MediaStream) => void;
  /**
   * The caller's own microphone, once acquired, for a level meter only. The
   * transport still owns it: it stops the tracks on teardown, and mute gates
   * them here, so a meter reads silence while muted.
   */
  onLocalStream?: (stream: MediaStream) => void;
  /** The session dropped without a `session.closed`. */
  onConnectionLost?: (reason: string) => void;
};

/** ICE gathering is given this long; a partial candidate set is still sent. */
export const ICE_TIMEOUT_MS = 8_000;
/** How long to wait for `session.started` after the answer is applied. */
export const SESSION_START_TIMEOUT_MS = 15_000;
/** Bounded wait for `session.closed` before tearing the connection down anyway. */
export const SESSION_CLOSE_TIMEOUT_MS = 2_000;
/** Mute/unmute acknowledgements are best-effort; the track is already gated. */
export const MUTE_ACK_TIMEOUT_MS = 1_500;

const defaultSchedule: ScheduleFn = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

type PendingWait = {
  matches: (event: LiveIncomingEvent) => boolean;
  resolve: (event: LiveIncomingEvent | null) => void;
  cancelTimer: CancelFn;
};

export class LiveTransport {
  #deps: TransportDeps;
  #handlers: TransportHandlers;
  #schedule: ScheduleFn;

  #pc: RTCPeerConnection | null = null;
  #channel: RTCDataChannel | null = null;
  #microphone: MediaStream | null = null;
  #remote: MediaStream | null = null;
  #waits = new Set<PendingWait>();
  #eventSeq = 0;
  #started = false;
  #torndown = false;
  /**
   * Desired input mute state, held on the transport rather than derived at
   * connect time. A mute chosen while the microphone is still being acquired
   * must apply to the track before it is ever added to the connection.
   */
  #muted = false;
  /** Set once close() ran, so a late connection drop is not reported as a loss. */
  #closing = false;

  constructor(deps: TransportDeps, handlers: TransportHandlers) {
    this.#deps = deps;
    this.#handlers = handlers;
    this.#schedule = deps.schedule ?? defaultSchedule;
  }

  get sessionStarted(): boolean {
    return this.#started;
  }

  /* ------------------------------------------------------------- waiting */

  /** Resolves with the first matching event, or null on timeout. */
  #waitFor(matches: (event: LiveIncomingEvent) => boolean, timeoutMs: number): Promise<LiveIncomingEvent | null> {
    return new Promise((resolve) => {
      const wait: PendingWait = {
        matches,
        resolve,
        cancelTimer: this.#schedule(() => {
          this.#waits.delete(wait);
          resolve(null);
        }, timeoutMs),
      };
      this.#waits.add(wait);
    });
  }

  #deliver(event: LiveIncomingEvent): void {
    for (const wait of [...this.#waits]) {
      if (!wait.matches(event)) continue;
      this.#waits.delete(wait);
      wait.cancelTimer();
      wait.resolve(event);
    }
    if (event.type === "session.started") this.#started = true;
    this.#handlers.onEvent(event);
  }

  #failWaits(): void {
    for (const wait of [...this.#waits]) {
      this.#waits.delete(wait);
      wait.cancelTimer();
      wait.resolve(null);
    }
  }

  /* ------------------------------------------------------------ connecting */

  /**
   * Brings the session up. Aborting (a hangup during connect) tears down
   * everything that was created so far and throws `cancelled`.
   */
  async connect(signal: AbortSignal): Promise<{ sessionId: string }> {
    const abortCheck = () => {
      if (signal.aborted) throw new LiveCallError("cancelled", "The call was cancelled.");
    };

    try {
      abortCheck();

      // 1. Microphone. A denial here is the most common real failure, and the
      //    only one the user can fix themselves.
      let microphone: MediaStream;
      try {
        microphone = await this.#deps.getUserMedia({ audio: true });
      } catch (error) {
        const name = (error as { name?: string } | undefined)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          throw new LiveCallError(
            "microphone_denied",
            "Mica needs microphone access for voice. Allow it in your browser or system settings, then call again.",
          );
        }
        if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          throw new LiveCallError("microphone_missing", "No microphone was found.");
        }
        throw new LiveCallError("microphone_failed", "Mica could not start the microphone.");
      }

      // A hangup can land while the permission prompt is open. The stream
      // arrives after teardown has already run, so it must be released here:
      // teardown has nothing to find, and an un-stopped track leaves the
      // recording indicator on.
      if (signal.aborted || this.#torndown) {
        this.#stopStream(microphone);
        throw new LiveCallError("cancelled", "The call was cancelled.");
      }
      this.#microphone = microphone;
      // Apply any mute requested while the microphone was being acquired,
      // before the track is attached to the connection.
      this.#applyMuteToTracks();
      this.#handlers.onLocalStream?.(microphone);

      const pc = this.#deps.createPeerConnection();
      this.#pc = pc;

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        this.#remote = stream ?? new MediaStream([event.track]);
        this.#handlers.onRemoteStream?.(this.#remote);
      };
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if ((state === "failed" || state === "disconnected") && !this.#closing) {
          this.#handlers.onConnectionLost?.(state);
        }
      };

      // 2. Event channel first: the guide is explicit that it must exist
      //    before the offer is created, or it is not in the negotiated SDP.
      const channel = pc.createDataChannel("oai-events");
      this.#channel = channel;
      channel.onmessage = (event) => {
        const parsed = typeof event.data === "string" ? parseLiveEvent(event.data) : null;
        if (parsed) this.#deliver(parsed);
      };
      channel.onclose = () => {
        if (!this.#closing && this.#started) this.#handlers.onConnectionLost?.("data channel closed");
      };

      // 3. Microphone track, then the offer.
      for (const track of this.#microphone.getAudioTracks()) {
        pc.addTrack(track, this.#microphone);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      abortCheck();

      await this.#waitForIceGathering(pc, signal);
      abortCheck();

      const localSdp = pc.localDescription?.sdp ?? offer.sdp;
      if (!localSdp) throw new LiveCallError("offer_failed", "Mica could not build a WebRTC offer.");

      // 4. The broker holds the key and starts the session.
      const grant = await this.#deps.requestSession(localSdp, signal);
      abortCheck();

      // 5. Apply the answer, then wait for the session to report itself up.
      //    The waiter is registered *before* the answer is applied: the data
      //    channel can open and deliver `session.started` while
      //    setRemoteDescription is still settling, and a waiter registered
      //    afterwards would miss it and time out on a working session.
      const startedWait = this.#waitFor((event) => event.type === "session.started", SESSION_START_TIMEOUT_MS);
      await pc.setRemoteDescription({ type: "answer", sdp: grant.sdp });
      abortCheck();

      if (!this.#started && !(await startedWait)) {
        throw new LiveCallError("session_start_timeout", "The voice session did not start in time.");
      }
      abortCheck();

      return { sessionId: grant.sessionId };
    } catch (error) {
      // Any failure or cancellation during connect releases the microphone and
      // the connection; nothing is left running.
      await this.#teardown();
      throw error instanceof LiveCallError
        ? error
        : new LiveCallError("connect_failed", "Mica could not connect the voice session.");
    }
  }

  /**
   * Waits for a complete candidate set. On timeout the offer is sent with
   * whatever was gathered rather than failing the call outright.
   */
  #waitForIceGathering(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        cancelTimer();
        pc.removeEventListener("icegatheringstatechange", onChange);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const onChange = () => {
        if (pc.iceGatheringState === "complete") finish();
      };
      const cancelTimer = this.#schedule(finish, ICE_TIMEOUT_MS);
      pc.addEventListener("icegatheringstatechange", onChange);
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  /* -------------------------------------------------------------- sending */

  #nextEventId(prefix: string): string {
    this.#eventSeq += 1;
    return `mica_${prefix}_${this.#eventSeq}`;
  }

  /** Sends an event if the channel is open. Returns false when it is not. */
  send(event: LiveOutgoingEvent): boolean {
    if (this.#channel?.readyState !== "open") return false;
    this.#channel.send(JSON.stringify(event));
    return true;
  }

  #applyMuteToTracks(): void {
    for (const track of this.#microphone?.getAudioTracks() ?? []) {
      track.enabled = !this.#muted;
    }
  }

  /** The mute state the caller last asked for. */
  get muted(): boolean {
    return this.#muted;
  }

  /**
   * Real mute: the outgoing track is disabled so nothing is captured locally,
   * *and* the session is told, so the model stops treating input as speech.
   *
   * The desired state is recorded synchronously, so calling this before or
   * during connect is honoured once the microphone exists.
   *
   * Muting deliberately has no effect on delegated work already running.
   */
  async setMuted(muted: boolean): Promise<void> {
    this.#muted = muted;
    this.#applyMuteToTracks();
    const eventId = this.#nextEventId(muted ? "mute" : "unmute");
    if (!this.send({ ...muteEvent(eventId, muted), event_id: eventId })) return;
    const ackType = muted ? "session.input_audio.muted" : "session.input_audio.unmuted";
    // Best effort: the track is already gated, so a missing ack is not fatal.
    await this.#waitFor(
      (event) => event.type === ackType && (!("clientEventId" in event) || event.clientEventId === eventId),
      MUTE_ACK_TIMEOUT_MS,
    );
  }

  /* -------------------------------------------------------------- closing */

  /**
   * Graceful shutdown: ask for `session.close`, wait a bounded time for
   * `session.closed`, then release everything regardless. A disconnected
   * session never blocks cleanup.
   */
  async close(): Promise<void> {
    if (this.#torndown) return;
    this.#closing = true;

    if (this.#channel?.readyState === "open") {
      // Registered before sending, as the server-controls guide requires.
      const closed = this.#waitFor((event) => event.type === "session.closed", SESSION_CLOSE_TIMEOUT_MS);
      this.send(closeEvent());
      await closed;
    }
    await this.#teardown();
  }

  #stopStream(stream: MediaStream | null): void {
    for (const track of stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // Already ended.
      }
    }
  }

  /**
   * Releases everything currently held. Deliberately has no "already done"
   * early return: a resource can be acquired *after* a first teardown (a
   * microphone promise that resolves post-hangup), and it still has to be
   * released. Running twice is harmless because every handle is nulled.
   */
  async #teardown(): Promise<void> {
    this.#torndown = true;
    this.#failWaits();

    this.#stopStream(this.#microphone);
    this.#microphone = null;

    if (this.#channel) {
      this.#channel.onmessage = null;
      this.#channel.onclose = null;
      try {
        this.#channel.close();
      } catch {
        // Already closed with the connection.
      }
      this.#channel = null;
    }

    if (this.#pc) {
      this.#pc.ontrack = null;
      this.#pc.onconnectionstatechange = null;
      try {
        this.#pc.close();
      } catch {
        // Already closed.
      }
      this.#pc = null;
    }

    this.#stopStream(this.#remote);
    this.#remote = null;
  }
}
