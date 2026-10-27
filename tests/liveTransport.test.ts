// WebRTC lifecycle, with a fake peer connection and a fake microphone.
// No real media, no real connection, no network.
import assert from "node:assert/strict";
import test from "node:test";
import { LiveCallError } from "../src/live/liveBackend.ts";
import { LiveTransport, type TransportDeps } from "../src/live/liveTransport.ts";
import type { LiveIncomingEvent } from "../src/live/liveEvents.ts";
import {
  createFakePeerConnection,
  createFakeStream,
  createScheduler,
  eventsChannel,
  FAKE_ANSWER_SDP,
  flush,
  type FakePeerConnection,
  type FakePeerOptions,
  type FakeStream,
} from "./support/mocks.ts";

type Harness = {
  transport: LiveTransport;
  peer: FakePeerConnection;
  microphone: FakeStream;
  events: LiveIncomingEvent[];
  streams: (MediaStream | null)[];
  lost: string[];
  scheduler: ReturnType<typeof createScheduler>;
  requested: string[];
};

function harness(
  overrides: {
    peerOptions?: FakePeerOptions;
    getUserMedia?: TransportDeps["getUserMedia"];
    requestSession?: TransportDeps["requestSession"];
  } = {},
): Harness {
  const scheduler = createScheduler();
  const microphone = createFakeStream();
  const peer = createFakePeerConnection(overrides.peerOptions);
  const events: LiveIncomingEvent[] = [];
  const streams: (MediaStream | null)[] = [];
  const lost: string[] = [];
  const requested: string[] = [];

  const transport = new LiveTransport(
    {
      getUserMedia: overrides.getUserMedia ?? (() => Promise.resolve(microphone as unknown as MediaStream)),
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      requestSession:
        overrides.requestSession ??
        ((sdp) => {
          requested.push(sdp);
          return Promise.resolve({ sessionId: "live_1", sdp: FAKE_ANSWER_SDP });
        }),
      schedule: scheduler.schedule,
    },
    {
      onEvent: (event) => events.push(event),
      onRemoteStream: (stream) => streams.push(stream),
      onConnectionLost: (reason) => lost.push(reason),
    },
  );

  return { transport, peer, microphone, events, streams, lost, scheduler, requested };
}

/** Delivers session.started as soon as the channel exists. */
const startWhenAsked = (peer: FakePeerConnection) =>
  eventsChannel(peer).deliver({ type: "session.started", session: { id: "live_1" } });

/**
 * Closes a connected transport under the virtual clock.
 *
 * `close()` waits a bounded time for `session.closed`, and with a virtual
 * scheduler that wait only ends when the clock is advanced or the event is
 * delivered. Awaiting it directly deadlocks the test, so every test that just
 * needs the transport shut down uses this; the tests that assert the close
 * handshake itself drive it by hand.
 */
async function closeUnderVirtualClock(h: Harness): Promise<void> {
  const closing = h.transport.close();
  await flush(2);
  h.scheduler.advance(2_000);
  await closing;
}

test("connect follows the documented order and never sends session.start", async () => {
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  const result = await h.transport.connect(new AbortController().signal);

  assert.deepEqual(result, { sessionId: "live_1" });

  // The event channel is created before the offer, or it is not in the SDP.
  const channel = eventsChannel(h.peer);
  assert.equal(channel.label, "oai-events");
  // The microphone track was added to the connection.
  assert.deepEqual(h.peer.addedTracks, h.microphone.tracks);
  // The offer was set locally and the answer applied.
  assert.equal(h.peer.localDescription?.type, "offer");
  assert.deepEqual(h.peer.remoteDescription, { type: "answer", sdp: FAKE_ANSWER_SDP });
  assert.equal(h.requested.length, 1);

  // Nothing resembling session.start, and no audio events, were ever sent.
  const sentTypes = channel.sent.map((event) => event.type);
  assert.equal(sentTypes.includes("session.start"), false);
  assert.equal(sentTypes.some((type) => String(type).includes("input_audio.append")), false);

  await closeUnderVirtualClock(h);
});

test("session.started delivered during setRemoteDescription is not missed", async () => {
  // The waiter must be registered before the answer is applied: the channel
  // can open and deliver the event while setRemoteDescription is settling.
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  const connected = await h.transport.connect(new AbortController().signal);
  assert.equal(connected.sessionId, "live_1");
  assert.equal(h.transport.sessionStarted, true);
  // It resolved immediately, with no timer having to fire.
  assert.equal(h.scheduler.pending, 0);
  await closeUnderVirtualClock(h);
});

test("a denied microphone is reported as something the user can fix", async () => {
  const h = harness({
    getUserMedia: () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })),
  });

  await assert.rejects(
    () => h.transport.connect(new AbortController().signal),
    (error: unknown) => {
      assert.ok(error instanceof LiveCallError);
      assert.equal(error.code, "microphone_denied");
      assert.match(error.message, /microphone access/i);
      return true;
    },
  );
  // No connection was built, so there is nothing to clean up.
  assert.equal(h.peer.channels.length, 0);
});

test("a missing microphone and an unknown failure are distinguished", async () => {
  const missing = harness({
    getUserMedia: () => Promise.reject(Object.assign(new Error("none"), { name: "NotFoundError" })),
  });
  await assert.rejects(() => missing.transport.connect(new AbortController().signal), {
    code: "microphone_missing",
  });

  const other = harness({ getUserMedia: () => Promise.reject(new Error("boom")) });
  await assert.rejects(() => other.transport.connect(new AbortController().signal), {
    code: "microphone_failed",
  });
});

test("a failing session request tears down the microphone and the connection", async () => {
  const h = harness({
    requestSession: () => Promise.reject(new LiveCallError("missing_api_key", "Voice is not configured.")),
  });

  await assert.rejects(() => h.transport.connect(new AbortController().signal), { code: "missing_api_key" });

  // Nothing is left running after a failed connect.
  assert.equal(h.microphone.tracks[0].stopped, 1);
  assert.equal(h.peer.closed, 1);
});

test("hanging up while the microphone is still pending releases it", async () => {
  // The race: teardown runs before getUserMedia resolves, so the stream
  // arrives with nothing holding it. It must still be stopped, or the
  // recording indicator stays on.
  let resolveMedia: ((stream: MediaStream) => void) | undefined;
  const microphone = createFakeStream();
  const h = harness({
    getUserMedia: () =>
      new Promise<MediaStream>((resolve) => {
        resolveMedia = resolve;
      }),
  });

  const connecting = h.transport.connect(new AbortController().signal);
  // Hang up before the permission prompt is answered.
  await h.transport.close();
  resolveMedia?.(microphone as unknown as MediaStream);

  await assert.rejects(() => connecting, { code: "cancelled" });
  assert.equal(microphone.tracks[0].stopped, 1, "the late microphone was never stopped");
});

test("aborting mid-connect cancels and cleans up", async () => {
  const aborter = new AbortController();
  const h = harness({
    requestSession: (_sdp, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new LiveCallError("cancelled", "The call was cancelled.")));
      }),
  });

  const connecting = h.transport.connect(aborter.signal);
  await flush(2);
  aborter.abort();

  await assert.rejects(() => connecting, { code: "cancelled" });
  assert.equal(h.microphone.tracks[0].stopped, 1);
  assert.equal(h.peer.closed, 1);
});

test("the offer waits for ICE gathering, but not forever", async () => {
  const h = harness({ peerOptions: { iceComplete: false, onSetRemoteDescription: startWhenAsked } });
  const connecting = h.transport.connect(new AbortController().signal);

  await flush(2);
  // Still gathering, so the offer has not been sent.
  assert.equal(h.requested.length, 0);

  h.peer.finishIce();
  await connecting;
  assert.equal(h.requested.length, 1);

  // And a stalled gathering falls back to sending what was collected.
  const stalled = harness({ peerOptions: { iceComplete: false, onSetRemoteDescription: startWhenAsked } });
  const second = stalled.transport.connect(new AbortController().signal);
  await flush(2);
  assert.equal(stalled.requested.length, 0);
  stalled.scheduler.advance(8_000);
  await second;
  assert.equal(stalled.requested.length, 1);
});

test("a session that never starts times out", async () => {
  // No session.started is ever delivered.
  const h = harness();
  const connecting = h.transport.connect(new AbortController().signal);
  await flush(4);
  h.scheduler.advance(15_000);

  await assert.rejects(() => connecting, { code: "session_start_timeout" });
  assert.equal(h.microphone.tracks[0].stopped, 1);
});

test("mute disables the track and tells the session", async () => {
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  await h.transport.connect(new AbortController().signal);
  const channel = eventsChannel(h.peer);

  const muting = h.transport.setMuted(true);
  // The track is gated immediately, not after the acknowledgement.
  assert.equal(h.microphone.tracks[0].enabled, false);
  const muteEvent = channel.sent.at(-1) as { type: string; event_id: string };
  assert.equal(muteEvent.type, "session.input_audio.mute");
  channel.deliver({ type: "session.input_audio.muted", client_event_id: muteEvent.event_id });
  await muting;
  assert.equal(h.transport.muted, true);

  const unmuting = h.transport.setMuted(false);
  assert.equal(h.microphone.tracks[0].enabled, true);
  assert.equal((channel.sent.at(-1) as { type: string }).type, "session.input_audio.unmute");
  channel.deliver({
    type: "session.input_audio.unmuted",
    client_event_id: (channel.sent.at(-1) as { event_id: string }).event_id,
  });
  await unmuting;
  assert.equal(h.transport.muted, false);
});

test("a missing mute acknowledgement is not fatal", async () => {
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  await h.transport.connect(new AbortController().signal);

  const muting = h.transport.setMuted(true);
  h.scheduler.advance(1_500);
  await muting;
  // The track is what actually stops capture, so this still holds.
  assert.equal(h.microphone.tracks[0].enabled, false);
});

test("mute requested before the microphone exists is applied to it", async () => {
  // Otherwise the first moments of a muted call are captured and sent.
  let resolveMedia: ((stream: MediaStream) => void) | undefined;
  const microphone = createFakeStream();
  const h = harness({
    peerOptions: { onSetRemoteDescription: startWhenAsked },
    getUserMedia: () =>
      new Promise<MediaStream>((resolve) => {
        resolveMedia = resolve;
      }),
  });

  void h.transport.setMuted(true);
  const connecting = h.transport.connect(new AbortController().signal);
  await flush(2);
  resolveMedia?.(microphone as unknown as MediaStream);
  await connecting;

  assert.equal(microphone.tracks[0].enabled, false, "the track was live while the call was muted");
  await closeUnderVirtualClock(h);
});

test("closing asks for session.close and waits for session.closed", async () => {
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  await h.transport.connect(new AbortController().signal);
  const channel = eventsChannel(h.peer);

  const closing = h.transport.close();
  await flush(2);
  assert.equal((channel.sent.at(-1) as { type: string }).type, "session.close");
  // Still draining: cleanup has not happened yet.
  assert.equal(h.microphone.tracks[0].stopped, 0);

  channel.deliver({ type: "session.closed", reason: "close_requested", usage: { seconds: 3 } });
  await closing;

  assert.equal(h.microphone.tracks[0].stopped, 1);
  assert.equal(h.peer.closed, 1);
  assert.ok(h.events.some((event) => event.type === "session.closed"));
});

test("a session that never confirms the close is still cleaned up", async () => {
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  await h.transport.connect(new AbortController().signal);

  const closing = h.transport.close();
  await flush(2);
  // No session.closed arrives; the bounded fallback takes over.
  h.scheduler.advance(2_000);
  await closing;

  assert.equal(h.microphone.tracks[0].stopped, 1);
  assert.equal(h.peer.closed, 1);
});

test("closing twice is safe", async () => {
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  await h.transport.connect(new AbortController().signal);
  const channel = eventsChannel(h.peer);
  const first = h.transport.close();
  await flush(2);
  channel.deliver({ type: "session.closed", reason: "close_requested" });
  await first;
  await h.transport.close();
  assert.equal(h.microphone.tracks[0].stopped, 1);
  assert.equal(h.peer.closed, 1);
});

test("a dropped connection is reported, but not after a deliberate close", async () => {
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  await h.transport.connect(new AbortController().signal);

  h.peer.setConnectionState("failed");
  assert.deepEqual(h.lost, ["failed"]);

  const quiet = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  await quiet.transport.connect(new AbortController().signal);
  const closing = quiet.transport.close();
  quiet.peer.setConnectionState("disconnected");
  quiet.scheduler.advance(2_000);
  await closing;
  // Hanging up is not a connection loss.
  assert.deepEqual(quiet.lost, []);
});

test("the agent's audio is handed to the host for playback", async () => {
  const remote = createFakeStream();
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  const connecting = h.transport.connect(new AbortController().signal);
  await flush(2);
  h.peer.ontrack?.({ streams: [remote], track: remote.tracks[0] });
  await connecting;

  assert.equal(h.streams.length, 1);
  assert.equal(h.streams[0], remote as unknown as MediaStream);

  const closing = h.transport.close();
  h.scheduler.advance(2_000);
  await closing;
  // The remote tracks are released with everything else.
  assert.equal(remote.tracks[0].stopped, 1);
});

test("transcript and delegation events reach the host", async () => {
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  await h.transport.connect(new AbortController().signal);
  const channel = eventsChannel(h.peer);

  channel.deliver({ type: "session.input_transcript.delta", delta: "hello", start_ms: 10, end_ms: 20 });
  channel.deliver({
    type: "session.delegation.created",
    offset_ms: 30,
    delegation: { id: "item_1", target: "client" },
  });
  channel.deliver({ type: "garbage" });

  const types = h.events.map((event) => event.type);
  assert.ok(types.includes("session.input_transcript.delta"));
  assert.ok(types.includes("session.delegation.created"));
  // Unknown events are surfaced, not thrown.
  assert.ok(types.includes("unknown"));

  await closeUnderVirtualClock(h);
});

test("sending on a closed channel reports failure instead of throwing", async () => {
  const h = harness({ peerOptions: { onSetRemoteDescription: startWhenAsked } });
  await h.transport.connect(new AbortController().signal);
  const closing = h.transport.close();
  h.scheduler.advance(2_000);
  await closing;

  assert.equal(h.transport.send({ type: "session.thinking.append", content: "x" }), false);
});
