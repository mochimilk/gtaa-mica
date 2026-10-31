// Call lifecycle: phases, failures, reconnect, mute, and the separation of
// playback activity from backend task state.
import assert from "node:assert/strict";
import test from "node:test";
import {
  ENDED_IDLE_MS,
  ENDED_QUIET_MS,
  GREETING_INSTRUCTIONS,
  LiveCallController,
  NEAR_END_IDLE_MS,
  OFFER_HEARD_WITHIN_MS,
  QUIET_GAP_MS,
  SAID_POLL_MS,
  SAY_INSTRUCTIONS,
  SPEECH_IDLE_MS,
  type LiveCallState,
} from "../src/live/callController.ts";
import { callFailureText } from "../src/live/callFailure.ts";
import { LiveCallError } from "../src/live/liveBackend.ts";
import type { LiveIncomingEvent, LiveOutgoingEvent } from "../src/live/liveEvents.ts";
import type { LiveTransport, TransportHandlers } from "../src/live/liveTransport.ts";
import type { InterpretedRequest, RequestInterpreter } from "../src/live/requestInterpreter.ts";
import { createFakeHost, createScheduler, flush, type FakeHost } from "./support/mocks.ts";

type FakeTransport = {
  handlers: TransportHandlers;
  sent: LiveOutgoingEvent[];
  calls: string[];
  muted: boolean;
  /** The app's hold on the microphone (holdInput), apart from the session's mute. */
  held: boolean;
  /** Settles the pending connect. */
  resolveConnect: (sessionId?: string) => void;
  rejectConnect: (error: unknown) => void;
  readonly connectSignal: AbortSignal | undefined;
  transport: LiveTransport;
};

type Harness = {
  controller: LiveCallController;
  host: FakeHost;
  scheduler: ReturnType<typeof createScheduler>;
  states: LiveCallState[];
  transports: FakeTransport[];
  readonly latest: FakeTransport;
  streams: (MediaStream | null)[];
  localStreams: (MediaStream | null)[];
};

function harness(options: { interpreter?: RequestInterpreter; level?: () => number } = {}): Harness {
  const scheduler = createScheduler();
  const host = createFakeHost();
  const states: LiveCallState[] = [];
  const transports: FakeTransport[] = [];
  const streams: (MediaStream | null)[] = [];
  const localStreams: (MediaStream | null)[] = [];

  const controller = new LiveCallController({
    host,
    interpreter: options.interpreter,
    schedule: scheduler.schedule,
    now: () => 1_700_000_000_000,
    settleMs: 400,
    onRemoteStream: (stream) => streams.push(stream),
    onLocalStream: (stream) => localStreams.push(stream),
    outputLevel: options.level,
    createTransport: (handlers) => {
      let resolve: ((value: { sessionId: string }) => void) | null = null;
      let reject: ((error: unknown) => void) | null = null;
      let connectSignal: AbortSignal | undefined;

      const fake: FakeTransport = {
        handlers,
        sent: [],
        calls: [],
        muted: false,
        held: false,
        resolveConnect(sessionId = "live_1") {
          resolve?.({ sessionId });
        },
        rejectConnect(error) {
          reject?.(error);
        },
        get connectSignal() {
          return connectSignal;
        },
        transport: {
          connect(signal: AbortSignal) {
            connectSignal = signal;
            fake.calls.push("connect");
            return new Promise<{ sessionId: string }>((resolveNext, rejectNext) => {
              resolve = resolveNext;
              reject = rejectNext;
            });
          },
          send(event: LiveOutgoingEvent) {
            fake.sent.push(event);
            return true;
          },
          setMuted(muted: boolean) {
            fake.muted = muted;
            fake.calls.push(`setMuted:${muted}`);
            return Promise.resolve();
          },
          hold(held: boolean) {
            fake.held = held;
          },
          close() {
            fake.calls.push("close");
            return Promise.resolve();
          },
        } as unknown as LiveTransport,
      };

      transports.push(fake);
      return fake.transport;
    },
  });

  controller.subscribe(() => states.push(controller.getState()));

  return {
    controller,
    host,
    scheduler,
    states,
    transports,
    streams,
    localStreams,
    get latest() {
      return transports[transports.length - 1];
    },
  };
}

/** Brings a call up. */
async function connect(h: Harness): Promise<void> {
  const starting = h.controller.start();
  await flush(2);
  h.latest.resolveConnect();
  await starting;
}

/** Lets `ms` pass, as Skye's voice is checked: a step at a time. */
async function pass(h: Harness, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += SAID_POLL_MS) {
    h.scheduler.advance(SAID_POLL_MS);
    await flush(1);
  }
  await flush();
}

/** What Skye was given to say, as commentary: her greeting, then what she says herself. */
const prompts = (h: Harness) =>
  h.latest.sent.filter((event) => event.type === "session.commentary.append").map((event) => event.content);

/** Her words arriving, as she says something. */
const agentSays = (h: Harness, delta: string) =>
  h.latest.handlers.onEvent({ type: "session.output_transcript.delta", role: "agent", delta, startMs: 0, endMs: 100 });

test("a call reports starting, connecting and connected in order", async () => {
  const h = harness();
  await connect(h);

  assert.deepEqual(
    h.states.map((state) => state.phase),
    ["starting", "connecting", "connected"],
  );
  const state = h.controller.getState();
  assert.equal(state.sessionId, "live_1");
  // The clock starts when the session does, not when dialling began.
  assert.equal(state.startedAt, 1_700_000_000_000);
  assert.equal(state.error, null);
  assert.equal(h.controller.active, true);

  // Board context is sent as quiet facts once the session is up.
  const thinking = h.latest.sent.filter((event) => event.type === "session.thinking.append");
  assert.equal(thinking.length, 1);
  assert.equal(thinking[0].delegation_id, null);
});

test("once connected, the agent is told to greet the caller first, once, as commentary", async () => {
  const h = harness();
  await connect(h);

  const greeting = h.latest.sent.filter((event) => event.type === "session.commentary.append");
  assert.equal(greeting.length, 1);
  assert.equal(greeting[0].delegation_id, null);
  assert.equal(greeting[0].content, GREETING_INSTRUCTIONS);
  // Never as instructions, which stay with the session and can cut her off.
  assert.equal(h.latest.sent.some((event) => event.type === "session.instructions.append"), false);
  // After the board context, so the agent already has it when it speaks.
  const types = h.latest.sent.map((event) => event.type);
  assert.ok(types.indexOf("session.thinking.append") < types.indexOf("session.commentary.append"));
});

test("what Skye raises herself is steered by its cue as given, or said as written without one, as commentary", async () => {
  const h = harness();
  const proposal = { name: "brief" } as const;
  // Off a call nothing is sent, but the offer is kept.
  h.controller.offer("Heads-up: it's late.", proposal, "Tell them briefly, in your own words.");
  await connect(h);
  assert.deepEqual(prompts(h), [GREETING_INSTRUCTIONS]);

  void h.controller.offer("Heads-up: it's late.", proposal, "Tell them briefly, in your own words.");
  await pass(h, QUIET_GAP_MS);
  assert.equal(prompts(h).at(-1), "Tell them briefly, in your own words.");
  void h.controller.offer("Heads-up: it's late.", proposal);
  await pass(h, QUIET_GAP_MS);
  assert.equal(prompts(h).at(-1), `${SAY_INSTRUCTIONS}Heads-up: it's late.`);
  assert.equal(h.latest.sent.some((event) => event.type === "session.instructions.append"), false);
});

test("what Skye raises herself waits until she is done speaking, and resolves as she is heard raising it", async () => {
  const h = harness();
  const proposal = { name: "brief" } as const;
  assert.equal(await h.controller.offer("Heads-up: it's late.", proposal), false);
  await connect(h);

  // Mid-greeting: the cue waits for her to finish.
  agentSays(h, "Hey, what's up");
  let heard: boolean | undefined;
  void h.controller.offer("Heads-up: it's late.", proposal, "Tell them.").then((result) => (heard = result));
  await pass(h, SPEECH_IDLE_MS - SAID_POLL_MS);
  assert.equal(prompts(h).at(-1), GREETING_INSTRUCTIONS);
  await pass(h, SAID_POLL_MS);
  assert.equal(prompts(h).at(-1), "Tell them.");
  assert.equal(heard, undefined);
  agentSays(h, "Quick heads-up");
  await flush();
  assert.equal(heard, true);

  // Not heard in time, or the call ends first: unheard.
  await pass(h, SPEECH_IDLE_MS);
  const timedOut = h.controller.offer("Heads-up: it's late.", proposal);
  await pass(h, QUIET_GAP_MS);
  h.scheduler.advance(OFFER_HEARD_WITHIN_MS);
  assert.equal(await timedOut, false);
  const hungUp = h.controller.offer("Heads-up: it's late.", proposal);
  await h.controller.hangup();
  await pass(h, SAID_POLL_MS);
  assert.equal(await hungUp, false);
});

test("her words run ahead of her voice: what she raises waits until she can't be heard", async () => {
  let level = 0;
  const h = harness({ level: () => level });
  await connect(h);

  agentSays(h, "Hey, what's up");
  level = 0.8;
  void h.controller.offer("Heads-up: it's late.", { name: "brief" }, "Tell them.");
  // Her words have stopped, but she is still heard.
  await pass(h, SPEECH_IDLE_MS + QUIET_GAP_MS);
  assert.equal(prompts(h).at(-1), GREETING_INSTRUCTIONS);
  level = 0;
  await pass(h, QUIET_GAP_MS);
  assert.equal(prompts(h).at(-1), "Tell them.");
});

test("what Skye speaks resolves once she has said it; what she hears can be held off without muting the user", async () => {
  const h = harness();
  assert.equal(await h.controller.speak("Travis, it's Skye."), false);
  await connect(h);

  let said: boolean | undefined;
  const heard: string[] = [];
  void h.controller.speak("Travis, it's Skye. Can you approve?", (words) => heard.push(words)).then((result) => (said = result));
  await pass(h, QUIET_GAP_MS);
  assert.equal(prompts(h).at(-1), `${SAY_INSTRUCTIONS}Travis, it's Skye. Can you approve?`);
  agentSays(h, "Travis, it's Skye.");
  await flush();
  // A pause between sentences is not the end of it.
  await pass(h, SPEECH_IDLE_MS);
  assert.equal(said, undefined);
  agentSays(h, " Can you approve?");
  await flush();
  assert.deepEqual(heard, ["Travis, it's Skye.", "Travis, it's Skye. Can you approve?"]);
  // At the end of what she was given to say, she is done sooner.
  await pass(h, NEAR_END_IDLE_MS);
  assert.equal(said, true);

  // Held, the session hears silence, not a mute: the user is not muted, nor
  // is the session told to be, and the user's own mute stays theirs.
  h.controller.holdInput(true);
  assert.equal(h.latest.held, true);
  assert.equal(h.latest.muted, false);
  assert.equal(h.controller.getState().muted, false);
  await h.controller.setMuted(false);
  assert.equal(h.latest.held, true);
  h.controller.holdInput(false);
  assert.equal(h.latest.held, false);
  await h.controller.setMuted(true);
  h.controller.holdInput(true);
  h.controller.holdInput(false);
  assert.equal(h.latest.muted, true);
  assert.equal(h.latest.held, false);
});

test("at the end of what she says, she is done once her voice stops too, so whoever answers her doesn't talk over her", async () => {
  let level = 0;
  const h = harness({ level: () => level });
  await connect(h);

  let said: boolean | undefined;
  const asked = (words: string) => /approve/.test(words);
  void h.controller.speak("Hey Travis. Can you approve?", undefined, asked).then((result) => (said = result));
  await pass(h, QUIET_GAP_MS);
  agentSays(h, "Hey Travis. Can you approve?");
  // All her words are in, and she has come to her ask, but her voice still plays.
  level = 0.8;
  await pass(h, ENDED_IDLE_MS * 3);
  assert.equal(said, undefined);
  level = 0;
  await pass(h, ENDED_QUIET_MS);
  assert.equal(said, true);
});

test("an unconfigured backend surfaces its reason and leaves no call running", async () => {
  const h = harness();
  const starting = h.controller.start();
  await flush(2);
  h.latest.rejectConnect(new LiveCallError("missing_api_key", "Voice is not configured: this server has no OPENAI_API_KEY."));
  await starting;

  const state = h.controller.getState();
  assert.equal(state.phase, "failed");
  assert.equal(state.error?.code, "missing_api_key");
  assert.match(state.error?.message ?? "", /not configured/);
  // Not "active", so the navbar offers Call again rather than hang-up.
  assert.equal(h.controller.active, false);
  assert.equal(state.startedAt, null);
  // Playback is torn down so no stale audio element keeps a stream.
  assert.deepEqual(h.streams, [null]);
});

test("hanging up during connect is not reported as a failure", async () => {
  const h = harness();
  const starting = h.controller.start();
  await flush(2);

  await h.controller.hangup();
  // The transport sees the abort, so an in-flight connect stops rather than
  // completing unattended.
  assert.equal(h.latest.connectSignal?.aborted, true);
  h.latest.rejectConnect(new LiveCallError("cancelled", "The call was cancelled."));
  await starting;

  const state = h.controller.getState();
  assert.equal(state.phase, "idle");
  assert.equal(state.error, null);
  assert.ok(h.latest.calls.includes("close"));
});

test("a connect that lands after a hangup cannot resurrect the call", async () => {
  const h = harness();
  const starting = h.controller.start();
  await flush(2);
  await h.controller.hangup();

  // The transport answers anyway; the result belongs to a dead call.
  h.latest.resolveConnect("live_late");
  await starting;

  assert.equal(h.controller.getState().phase, "idle");
  assert.equal(h.controller.getState().sessionId, null);
});

test("mute chosen before the call is honoured, and reaches the transport first", async () => {
  const h = harness();
  await h.controller.setMuted(true);
  assert.equal(h.controller.getState().muted, true);

  const starting = h.controller.start();
  await flush(2);
  // Seeded before connect resolves, so the track is gated the moment it is
  // acquired rather than after the session is up.
  assert.deepEqual(h.latest.calls.slice(0, 2), ["setMuted:true", "connect"]);
  h.latest.resolveConnect();
  await starting;

  assert.equal(h.controller.getState().muted, true);
  assert.equal(h.latest.muted, true);
});

test("muting does not cancel work in progress", async () => {
  // Muting the microphone is not a cancellation signal, and neither is the
  // user talking over the agent.
  // A holder, not a bare `let`: TypeScript does not treat a closure
  // assignment as narrowing, so a plain variable stays `null` at the call site.
  const pending: { resolve: ((value: InterpretedRequest) => void) | null } = { resolve: null };
  const h = harness({
    interpreter: {
      id: "slow",
      interpret: () =>
        new Promise<InterpretedRequest>((resolve) => {
          pending.resolve = resolve;
        }),
    },
  });
  await connect(h);

  h.latest.handlers.onEvent({
    type: "session.input_transcript.delta",
    role: "user",
    delta: "show me arrivals",
    startMs: 0,
    endMs: 900,
  } satisfies LiveIncomingEvent);
  h.latest.handlers.onEvent({
    type: "session.delegation.created",
    delegationId: "item_1",
    target: "client",
    offsetMs: 1_000,
  } satisfies LiveIncomingEvent);
  assert.equal(h.controller.getState().working, true);

  h.scheduler.advance(400);
  await flush();
  await h.controller.setMuted(true);

  // Still working: the job was neither cancelled nor abandoned.
  assert.equal(h.controller.getState().working, true);
  assert.equal(h.controller.getState().muted, true);

  pending.resolve?.({ kind: "action", action: { name: "set_view", view: "arrivals" } });
  await flush();

  assert.deepEqual(h.host.calls, ["setView:arrivals"]);
  assert.equal(h.controller.getState().working, false);
});

test("hanging up cancels work in progress", async () => {
  const h = harness({
    interpreter: { id: "never", interpret: () => new Promise<InterpretedRequest>(() => {}) },
  });
  await connect(h);

  h.latest.handlers.onEvent({
    type: "session.input_transcript.delta",
    role: "user",
    delta: "clear the selection",
    startMs: 0,
    endMs: 900,
  });
  h.latest.handlers.onEvent({
    type: "session.delegation.created",
    delegationId: "item_1",
    target: "client",
    offsetMs: 1_000,
  });
  assert.equal(h.controller.getState().working, true);

  await h.controller.hangup();
  assert.equal(h.controller.getState().working, false);
  assert.deepEqual(h.host.calls, []);
});

test("agent speech is tracked separately from task work", async () => {
  // GPT-Live has no per-response completion event, so playback and task state
  // must not be conflated.
  const h = harness();
  await connect(h);

  h.latest.handlers.onEvent({
    type: "session.output_transcript.delta",
    role: "agent",
    delta: "Here they are",
    startMs: 100,
    endMs: 600,
  });
  assert.equal(h.controller.getState().agentSpeaking, true);
  assert.equal(h.controller.getState().working, false);

  // Speech ends after a quiet gap, since nothing announces it.
  h.scheduler.advance(SPEECH_IDLE_MS);
  assert.equal(h.controller.getState().agentSpeaking, false);
});

test("an unexpected remote close is reported; a requested one is not", async () => {
  const h = harness();
  await connect(h);
  h.latest.handlers.onEvent({ type: "session.closed", reason: "connection_lost", usageSeconds: 4 });
  await flush();

  assert.equal(h.controller.getState().phase, "failed");
  assert.equal(h.controller.getState().error?.code, "session_closed_connection_lost");

  const quiet = harness();
  await connect(quiet);
  quiet.latest.handlers.onEvent({ type: "session.closed", reason: "close_requested", usageSeconds: 4 });
  await flush();
  assert.equal(quiet.controller.getState().phase, "idle");
  assert.equal(quiet.controller.getState().error, null);
});

test("a dropped connection ends the call and cannot be overtaken", async () => {
  const h = harness();
  await connect(h);
  h.latest.handlers.onConnectionLost?.("failed");
  await flush();

  assert.equal(h.controller.getState().phase, "failed");
  assert.equal(h.controller.getState().error?.code, "connection_lost");
  assert.ok(h.latest.calls.includes("close"));
});

test("a call can be placed again after a failure", async () => {
  const h = harness();
  const first = h.controller.start();
  await flush(2);
  h.latest.rejectConnect(new LiveCallError("connect_failed", "Mica could not connect."));
  await first;
  assert.equal(h.controller.getState().phase, "failed");

  // Retrying builds a fresh transport and clears the error.
  await connect(h);
  assert.equal(h.transports.length, 2);
  const state = h.controller.getState();
  assert.equal(state.phase, "connected");
  assert.equal(state.error, null);
  assert.equal(state.sessionId, "live_1");
});

test("the same delegation id is accepted again by a later call", async () => {
  const h = harness();
  await connect(h);
  h.latest.handlers.onEvent({
    type: "session.input_transcript.delta",
    role: "user",
    delta: "clear the selection",
    startMs: 0,
    endMs: 900,
  });
  h.latest.handlers.onEvent({
    type: "session.delegation.created",
    delegationId: "item_1",
    target: "client",
    offsetMs: 1_000,
  });
  h.scheduler.advance(400);
  await flush();
  assert.deepEqual(h.host.calls, ["clearSelection"]);

  await h.controller.hangup();
  await connect(h);

  // A new session starts with a clean transcript and no remembered ids.
  h.latest.handlers.onEvent({
    type: "session.input_transcript.delta",
    role: "user",
    delta: "clear the selection",
    startMs: 0,
    endMs: 900,
  });
  h.latest.handlers.onEvent({
    type: "session.delegation.created",
    delegationId: "item_1",
    target: "client",
    offsetMs: 1_000,
  });
  h.scheduler.advance(400);
  await flush();
  assert.deepEqual(h.host.calls, ["clearSelection", "clearSelection"]);
});

test("events from a previous call are ignored", async () => {
  const h = harness();
  await connect(h);
  const stale = h.latest;
  await h.controller.hangup();

  stale.handlers.onEvent({
    type: "session.output_transcript.delta",
    role: "agent",
    delta: "late",
    startMs: 0,
    endMs: 100,
  });
  stale.handlers.onConnectionLost?.("failed");
  await flush();

  const state = h.controller.getState();
  assert.equal(state.phase, "idle");
  assert.equal(state.agentSpeaking, false);
  assert.equal(state.error, null);
});

test("starting twice does not open a second session", async () => {
  const h = harness();
  await connect(h);
  await h.controller.start();
  assert.equal(h.transports.length, 1);
});

test("hand-made board changes only sync while connected", async () => {
  const h = harness();
  // No call: nothing to send to.
  h.controller.noteContextChange(2);
  h.scheduler.advance(2_000);
  await flush();
  assert.equal(h.transports.length, 0);

  await connect(h);
  const before = h.latest.sent.length;
  h.controller.noteContextChange(h.host.bumpRevision());
  h.scheduler.advance(1_200);
  await flush();

  const sent = h.latest.sent.slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "session.thinking.append");
  assert.equal(sent[0].delegation_id, null);
});

test("disposing releases the transport", async () => {
  const h = harness();
  await connect(h);
  await h.controller.dispose();
  assert.ok(h.latest.calls.includes("close"));
});

/* ------------------------------------------------- Ask Skye (navbar chat) */

test("a call that drops after an applied action keeps the change and never claims the board is unchanged", async () => {
  const h = harness();
  await connect(h);
  h.latest.handlers.onEvent({
    type: "session.input_transcript.delta",
    role: "user",
    delta: "show me arrivals",
    startMs: 0,
    endMs: 900,
  });
  h.latest.handlers.onEvent({ type: "session.delegation.created", delegationId: "item_1", target: "client", offsetMs: 1_000 });
  h.scheduler.advance(400);
  await flush();
  assert.deepEqual(h.host.calls, ["setView:arrivals"]);

  // The connection then drops: the call fails after the action was applied.
  h.latest.handlers.onConnectionLost?.("failed");
  await flush();
  const state = h.controller.getState();
  assert.equal(state.phase, "failed");

  // The applied change is not rolled back...
  assert.equal(h.host.snapshot().view, "arrivals");
  assert.deepEqual(h.host.calls, ["setView:arrivals"]);
  // ...so the failure text must not say nothing changed, and says it stays.
  const text = callFailureText(state) ?? "";
  assert.doesNotMatch(text, /nothing (was|has been) changed/i);
  assert.match(text, /already changed on the board stays/);

  // The same holds for an unexpected remote close.
  const closed = harness();
  await connect(closed);
  closed.latest.handlers.onEvent({ type: "session.closed", reason: "connection_lost", usageSeconds: 4 });
  await flush();
  assert.doesNotMatch(callFailureText(closed.controller.getState()) ?? "", /nothing (was|has been) changed/i);
});

test("a call that fails before the session starts reports only its reason", async () => {
  const h = harness();
  const starting = h.controller.start();
  await flush(2);
  h.latest.rejectConnect(new LiveCallError("backend_unreachable", "Mica's voice backend is not running."));
  await starting;
  const state = h.controller.getState();
  assert.equal(state.phase, "failed");
  assert.equal(callFailureText(state), "Mica's voice backend is not running.");
  assert.equal(callFailureText({ ...state, phase: "idle", error: null }), null);
});

test("transcript turns are published per call, and a new call starts empty", async () => {
  const h = harness();
  let notified = 0;
  h.controller.subscribeTranscript(() => (notified += 1));
  assert.equal(h.controller.callNumber, 0);

  await connect(h);
  assert.equal(h.controller.callNumber, 1);
  h.latest.handlers.onEvent({ type: "session.input_transcript.delta", role: "user", delta: "Which flights", startMs: 0, endMs: 400 });
  h.latest.handlers.onEvent({ type: "session.input_transcript.delta", role: "user", delta: " need attention?", startMs: 400, endMs: 900 });
  h.latest.handlers.onEvent({ type: "session.output_transcript.delta", role: "agent", delta: "Showing them now.", startMs: 1_200, endMs: 1_800 });
  assert.deepEqual(h.controller.transcript.turns(), [
    { role: "user", text: "Which flights need attention?" },
    { role: "agent", text: "Showing them now." },
  ]);
  const afterFirst = notified;
  assert.ok(afterFirst >= 4, "clearing at start plus each delta notifies");

  await h.controller.hangup();
  await connect(h);
  assert.equal(h.controller.callNumber, 2);
  assert.deepEqual(h.controller.transcript.turns(), []);
  assert.ok(notified > afterFirst);
});

test("Stop cancels a typed request but never voice work", async () => {
  const pending: { resolve: ((value: InterpretedRequest) => void) | null } = { resolve: null };
  const h = harness({
    interpreter: {
      id: "slow",
      interpret: () =>
        new Promise<InterpretedRequest>((resolve) => {
          pending.resolve = resolve;
        }),
    },
  });

  // Typed: stopped before the interpreter answers, so nothing is applied.
  const typed = h.controller.runTypedRequest("show me arrivals");
  await flush();
  assert.equal(h.controller.getState().working, true);
  assert.equal(h.controller.cancelTypedRequest(), true);
  assert.equal(h.controller.getState().working, false);
  pending.resolve?.({ kind: "action", action: { name: "set_view", view: "arrivals" } });
  assert.equal(await typed, null);
  assert.deepEqual(h.host.calls, []);

  // Voice: Stop in the chat leaves a delegated request alone.
  await connect(h);
  h.latest.handlers.onEvent({ type: "session.input_transcript.delta", role: "user", delta: "show me departures", startMs: 0, endMs: 900 });
  h.latest.handlers.onEvent({ type: "session.delegation.created", delegationId: "item_1", target: "client", offsetMs: 1_000 });
  h.scheduler.advance(400);
  await flush();
  assert.equal(h.controller.cancelTypedRequest(), false);
  pending.resolve?.({ kind: "action", action: { name: "set_view", view: "departures" } });
  await flush();
  assert.deepEqual(h.host.calls, ["setView:departures"]);
});

test("the microphone stream is shared for metering while the call holds it, and released after", async () => {
  const h = harness();
  const starting = h.controller.start();
  await flush(2);
  const microphone = { id: "mic" } as unknown as MediaStream;
  h.latest.handlers.onLocalStream?.(microphone);
  h.latest.resolveConnect();
  await starting;
  assert.deepEqual(h.localStreams, [microphone]);

  await h.controller.hangup();
  assert.equal(h.localStreams.at(-1), null);
});
