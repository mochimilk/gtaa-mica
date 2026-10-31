// Travis's own voice on an approval call: only a teammate with a voice
// answers, as his own persona, cued the moment his session is up and once
// more if he is not heard; he has said his piece once his words stop and his
// voice is quiet, through a pause between sentences; and he is gone as he
// leaves, or if his session never starts.
import assert from "node:assert/strict";
import test from "node:test";
import { ENDED_IDLE_MS, ENDED_QUIET_MS, SAID_POLL_MS } from "../src/live/callController.ts";
import type { LivePersona } from "../src/live/liveBackend.ts";
import type { LiveOutgoingEvent } from "../src/live/liveEvents.ts";
import type { LiveTransport, TransportHandlers } from "../src/live/liveTransport.ts";
import {
  ANSWER_HEARD_WITHIN_MS,
  ANSWER_IDLE_MS,
  ANSWER_NUDGE_MS,
  TeammateVoice,
} from "../src/live/teammateVoice.ts";
import { createScheduler, flush } from "./support/mocks.ts";

type FakeSession = {
  persona: LivePersona;
  handlers: TransportHandlers;
  sent: LiveOutgoingEvent[];
  closed: boolean;
  resolveConnect: () => void;
  rejectConnect: () => void;
};

function harness() {
  const scheduler = createScheduler();
  const sessions: FakeSession[] = [];
  const played: (MediaStream | null)[] = [];
  let level = 0;
  const voice = new TeammateVoice({
    schedule: scheduler.schedule,
    play: (stream) => played.push(stream),
    level: () => level,
    createTransport: (persona, handlers) => {
      const session: FakeSession = { persona, handlers, sent: [], closed: false, resolveConnect: () => {}, rejectConnect: () => {} };
      sessions.push(session);
      return {
        connect: () =>
          new Promise((resolve, reject) => {
            session.resolveConnect = () => resolve({ sessionId: "live_travis" });
            session.rejectConnect = () => reject(new Error("no session"));
          }),
        send: (event: LiveOutgoingEvent) => {
          session.sent.push(event);
          return true;
        },
        close: () => {
          session.closed = true;
          return Promise.resolve();
        },
      } as unknown as LiveTransport;
    },
  });
  const words = (session: FakeSession, delta: string) =>
    session.handlers.onEvent({ type: "session.output_transcript.delta", role: "agent", delta, startMs: 0, endMs: 100 });
  const cues = (session: FakeSession) => session.sent.map((event) => [event.type, event.content]);
  // Whether he is done is checked as time passes: step through it.
  const pass = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += SAID_POLL_MS) scheduler.advance(SAID_POLL_MS);
  };
  return { scheduler, sessions, played, voice, words, cues, pass, setLevel: (next: number) => (level = next) };
}

test("only a teammate with a voice of his own picks up, muted, as his own persona; ready, he comes off mute as he is cued", async () => {
  const h = harness();
  assert.equal(h.voice.pickUp("Priya Raman"), false);
  assert.equal(await h.voice.answer("Priya Raman", "Answer Skye now."), false);
  assert.equal(h.sessions.length, 0);
  assert.deepEqual(h.voice.muted(), []);

  assert.equal(h.voice.pickUp("Travis Hughes"), true);
  assert.deepEqual(h.voice.muted(), ["Travis Hughes"]);
  assert.deepEqual(h.voice.names(), ["Travis Hughes"]);
  assert.equal(h.sessions.length, 0);

  // Ready ahead of his turn: his session starts, but he stays muted and uncued.
  h.voice.ready("Travis Hughes");
  h.voice.ready("Travis Hughes");
  assert.deepEqual(h.sessions.map((session) => session.persona), ["travis"]);
  h.sessions[0].resolveConnect();
  await flush();
  assert.equal(h.sessions[0].sent.length, 0);
  assert.deepEqual(h.voice.muted(), ["Travis Hughes"]);

  // Cued as commentary, what she asked him to approve going before it as
  // quiet facts, so he knows it without reading it out.
  void h.voice.answer("Travis Hughes", "Answer Skye now.", undefined, "What Skye asked you to approve: XC344/345.");
  await flush();
  assert.deepEqual(h.cues(h.sessions[0]), [
    ["session.thinking.append", "What Skye asked you to approve: XC344/345."],
    ["session.commentary.append", "Answer Skye now."],
  ]);
  assert.deepEqual(h.voice.muted(), []);
  assert.equal(h.sessions.length, 1);
});

test("he has answered once he comes to the end of it and his voice stops, not at a pause on the way", async () => {
  const h = harness();
  let answered: boolean | undefined;
  const ended = (said: string) => /anything else/.test(said);
  void h.voice.answer("Travis Hughes", "Answer Skye now.", ended).then((result) => (answered = result));
  const [session] = h.sessions;
  session.resolveConnect();
  await flush();

  h.words(session, "Yeah, the carousels can take it. Approved for baggage.");
  await flush();
  assert.equal(h.voice.speaking(), "Travis Hughes");
  // A pause on the way, his voice quiet: not done.
  h.pass(ANSWER_IDLE_MS - SAID_POLL_MS);
  await flush();
  assert.equal(answered, undefined);
  h.words(session, " Thanks. Let me know if you need anything else.");
  // At the end of it, but his voice still plays: not yet.
  h.setLevel(0.8);
  h.pass(ENDED_IDLE_MS);
  await flush();
  assert.equal(answered, undefined);
  h.setLevel(0);
  h.pass(ENDED_QUIET_MS);
  await flush();
  assert.equal(answered, true);

  // Never coming to its end, he is done after a longer silence.
  let unended: boolean | undefined;
  void h.voice.answer("Travis Hughes", "Answer Skye now.", ended).then((result) => (unended = result));
  await flush();
  h.words(session, "Yeah, that's fine.");
  await flush();
  h.pass(ANSWER_IDLE_MS - SAID_POLL_MS);
  await flush();
  assert.equal(unended, undefined);
  h.pass(SAID_POLL_MS);
  await flush();
  assert.equal(unended, true);
});

test("not heard, he is cued once more; leaving closes his session and stops his voice; never up, he has not answered", async () => {
  const h = harness();
  const unheard = h.voice.answer("Travis Hughes", "Answer Skye now.");
  h.sessions[0].resolveConnect();
  await flush();
  h.scheduler.advance(ANSWER_NUDGE_MS);
  await flush();
  assert.equal(h.cues(h.sessions[0]).length, 2);
  h.scheduler.advance(ANSWER_HEARD_WITHIN_MS - ANSWER_NUDGE_MS);
  assert.equal(await unheard, false);

  const cut = h.voice.answer("Travis Hughes", "Answer Skye now.");
  await flush();
  h.voice.pickUp("Travis Hughes");
  h.voice.leave("Travis Hughes");
  assert.deepEqual(h.voice.muted(), []);
  assert.equal(await cut, false);
  assert.equal(h.sessions[0].closed, true);
  assert.equal(h.played.at(-1), null);
  assert.deepEqual(h.voice.names(), []);

  const never = h.voice.answer("Travis Hughes", "Answer Skye now.");
  h.sessions[1].rejectConnect();
  assert.equal(await never, false);
  assert.deepEqual(h.voice.names(), []);
});
