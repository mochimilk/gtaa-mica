// The desktop app's own key (Settings → API), tested without launching
// Electron: a synthetic environment and a mocked upstream, never a real key.
import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_INTERPRETER_MODEL,
  appVoiceEnv,
  createAppVoice,
  MAX_BODY_CHARS,
  maskApiKey,
  readApiKey,
} from "../electron/appVoice.mjs";
import { RESPONSES_URL } from "../server/interpret.mjs";
import { LIVE_SESSIONS_URL } from "../server/live-session.mjs";
import { FAKE_ANSWER_SDP, FAKE_OFFER_SDP } from "./support/mocks.ts";

const KEY = "sk-test-not-a-real-key-0000";
const WINDOW = 1;
const OTHER_WINDOW = 2;

type Seen = { url: string; authorization: string | null; body: Record<string, any> };

/** An upstream that records what it was sent and answers as GPT-Live would. */
function recordingUpstream(seen: Seen[]) {
  return (async (url: string, init: RequestInit) => {
    seen.push({
      url: String(url),
      authorization: new Headers(init.headers).get("Authorization"),
      body: JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify({ session: { id: "live_1" }, transport: { sdp: FAKE_ANSWER_SDP } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/** An upstream that never answers, until the request is abandoned. */
function hangingUpstream(signals: AbortSignal[]) {
  return ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      signals.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;
}

const offer = JSON.stringify({ sdp: FAKE_OFFER_SDP });

const interpretation = () =>
  JSON.stringify({
    utterance: "select XA101",
    revision: 4,
    transcript: "User: select XA101",
    taskHistory: [],
    board: {
      summary: "View all.",
      allowedFlights: ["T01-ARR — XA101 (arrival, stand A1)"],
      selectedFlights: [],
      openAlerts: [],
      acknowledgedAlerts: [],
      allowedViews: ["all"],
      allowedFilterValues: { carrier: ["XA"], area: ["Pier A"], type: ["A320"] },
    },
  });

test("only keys shaped like OpenAI's are taken, without what a paste brings along", () => {
  assert.equal(readApiKey(KEY), KEY);
  assert.equal(readApiKey(`  ${KEY}\n`), KEY);
  assert.equal(readApiKey("sk-proj-" + "a".repeat(120)), "sk-proj-" + "a".repeat(120));
  // A key copied across a wrapped line, or with a zero-width space in it.
  assert.equal(readApiKey("sk-test-not-a-\nreal-key-0000"), KEY);
  assert.equal(readApiKey("sk-test-not-a-​real-key-0000﻿"), KEY);

  assert.equal(readApiKey(undefined), null);
  assert.equal(readApiKey(42), null);
  assert.equal(readApiKey(""), null);
  assert.equal(readApiKey("sk-short"), null);
  assert.equal(readApiKey("pk-test-not-a-real-key-0000"), null);
  assert.equal(readApiKey("sk-test-not-a-réal-key-0000"), null);
  assert.equal(readApiKey("sk-" + "a".repeat(501)), null);
  // Nothing that could break out of the Authorization header survives.
  assert.doesNotMatch(readApiKey("sk-test-not-a-real-key-0000\r\nX-Other: 1") ?? "", /\s/);
});

test("the page sees a key masked, as OpenAI's dashboard shows it", () => {
  assert.equal(maskApiKey(KEY), "sk-test-…0000");
  assert.equal(maskApiKey("sk-proj-" + "a".repeat(120) + "WXYZ"), "sk-proj-…WXYZ");
  assert.equal(maskApiKey("sk-" + "A1b2".repeat(12)), "sk-…A1b2");

  const voice = createAppVoice({ env: {}, fetchImpl: recordingUpstream([]) });
  voice.setKey(WINDOW, "openai", KEY);
  assert.deepEqual(voice.describeKey(WINDOW), { provider: "openai", hint: "sk-test-…0000" });
});

test("a key is only taken for a provider Mica calls", () => {
  const voice = createAppVoice({ env: {}, fetchImpl: recordingUpstream([]) });
  assert.equal(voice.setKey(WINDOW, "anthropic", KEY), false);
  assert.equal(voice.setKey(WINDOW, undefined, KEY), false);
  assert.equal(voice.describeKey(WINDOW), null);
});

test("calls use the window's key, never the app's own environment's", () => {
  const env = appVoiceEnv(KEY, { OPENAI_API_KEY: "sk-from-the-environment-0000", MICA_LIVE_VOICE: "cedar" });
  assert.equal(env.OPENAI_API_KEY, KEY);
  assert.equal(env.MICA_LIVE_VOICE, "cedar");
  // The project's chosen interpreter, as the packaged app has no .env.
  assert.equal(env.MICA_INTERPRETER_MODEL, APP_INTERPRETER_MODEL);
  assert.equal(appVoiceEnv(KEY, { MICA_INTERPRETER_MODEL: " other-model " }).MICA_INTERPRETER_MODEL, "other-model");
});

test("a window with no key goes to the broker, and keys are per window", async () => {
  const seen: Seen[] = [];
  const voice = createAppVoice({ env: {}, fetchImpl: recordingUpstream(seen) });

  assert.equal(voice.describeKey(WINDOW), null);
  assert.equal(await voice.request(WINDOW, "r1", "session", offer), null);
  assert.equal(await voice.request(WINDOW, "r2", "health", undefined), null);

  assert.equal(voice.setKey(WINDOW, "openai", KEY), true);
  assert.equal(voice.describeKey(WINDOW)?.provider, "openai");
  assert.equal(voice.describeKey(OTHER_WINDOW), null);
  assert.equal(await voice.request(OTHER_WINDOW, "r3", "session", offer), null);
  assert.equal(seen.length, 0);
});

test("a session goes to GPT-Live on the window's key, which never comes back", async () => {
  const seen: Seen[] = [];
  const voice = createAppVoice({ env: {}, fetchImpl: recordingUpstream(seen) });
  voice.setKey(WINDOW, "openai", KEY);

  const result = await voice.request(WINDOW, "r1", "session", JSON.stringify({ sdp: FAKE_OFFER_SDP, persona: "travis" }));
  assert.equal(result?.status, 200);
  assert.equal(result?.body.sdp, FAKE_ANSWER_SDP);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, LIVE_SESSIONS_URL);
  assert.equal(seen[0].authorization, `Bearer ${KEY}`);
  // Only the persona's name comes from the page; its voice is the app's.
  assert.equal(seen[0].body.session.audio.output.voice, "ripple");
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test("an interpretation goes to the project's interpreter model on the window's key", async () => {
  const seen: Seen[] = [];
  const voice = createAppVoice({ env: {}, fetchImpl: recordingUpstream(seen) });
  voice.setKey(WINDOW, "openai", KEY);

  await voice.request(WINDOW, "r1", "interpret", interpretation());
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, RESPONSES_URL);
  assert.equal(seen[0].authorization, `Bearer ${KEY}`);
  assert.equal(seen[0].body.model, APP_INTERPRETER_MODEL);
});

test("health reports readiness and nothing of the key", async () => {
  const voice = createAppVoice({ env: {}, fetchImpl: recordingUpstream([]) });
  voice.setKey(WINDOW, "openai", KEY);

  const result = await voice.request(WINDOW, "r1", "health", undefined);
  assert.equal(result?.status, 200);
  assert.equal(result?.body.ready, true);
  assert.equal((result?.body.interpreter as { ready: boolean }).ready, true);
  assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.equal(JSON.stringify(result).includes("sk-"), false);
});

test("forgetting a window's key abandons what it was waiting on", async () => {
  const signals: AbortSignal[] = [];
  const voice = createAppVoice({ env: {}, fetchImpl: hangingUpstream(signals) });
  voice.setKey(WINDOW, "openai", KEY);

  const pending = voice.request(WINDOW, "r1", "session", offer);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals.length, 1);
  voice.forget(WINDOW);

  assert.equal(signals[0].aborted, true);
  assert.equal((await pending)?.status, 499);
  assert.equal(voice.describeKey(WINDOW), null);
  assert.equal(await voice.request(WINDOW, "r2", "session", offer), null);
});

test("the page can abandon one request, and only its own", async () => {
  const signals: AbortSignal[] = [];
  const voice = createAppVoice({ env: {}, fetchImpl: hangingUpstream(signals) });
  voice.setKey(WINDOW, "openai", KEY);
  voice.setKey(OTHER_WINDOW, "openai", KEY);

  const mine = voice.request(WINDOW, "r1", "session", offer);
  const theirs = voice.request(OTHER_WINDOW, "r1", "session", offer);
  await new Promise((resolve) => setImmediate(resolve));
  voice.abort(WINDOW, "r1");

  assert.equal((await mine)?.status, 499);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  voice.forget(OTHER_WINDOW);
  await theirs;
});

test("a malformed key keeps the one the window had", () => {
  const voice = createAppVoice({ env: {}, fetchImpl: recordingUpstream([]) });
  voice.setKey(WINDOW, "openai", KEY);
  assert.equal(voice.setKey(WINDOW, "openai", "not a key"), false);
  assert.equal(voice.describeKey(WINDOW)?.provider, "openai");
  assert.equal(voice.setKey(OTHER_WINDOW, "openai", "not a key"), false);
  assert.equal(voice.describeKey(OTHER_WINDOW), null);
});

test("requests are checked as the broker checks them", async () => {
  const seen: Seen[] = [];
  const voice = createAppVoice({ env: {}, fetchImpl: recordingUpstream(seen) });
  voice.setKey(WINDOW, "openai", KEY);
  const code = async (requestId: unknown, route: unknown, body: unknown) =>
    ((await voice.request(WINDOW, requestId, route, body))?.body.error as { code: string } | undefined)?.code;

  assert.equal(await code("r1", "keys", offer), "not_found");
  assert.equal(await code("r1", undefined, offer), "not_found");
  assert.equal(await code(undefined, "session", offer), "invalid_request");
  assert.equal(await code("x".repeat(65), "session", offer), "invalid_request");
  assert.equal(await code("r1", "session", undefined), "payload_too_large");
  assert.equal(await code("r1", "session", "x".repeat(MAX_BODY_CHARS + 1)), "payload_too_large");
  assert.equal(await code("r1", "session", "{"), "invalid_json");
  assert.equal(await code("r1", "session", JSON.stringify({ sdp: "not sdp" })), "invalid_sdp");
  assert.equal(seen.length, 0);
});
