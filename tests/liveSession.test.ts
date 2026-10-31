// Broker session-creation contract. Synthetic env, mocked upstream, no key.
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveSessionRequest,
  createLiveSession,
  describeLiveConfig,
  LIVE_SESSIONS_URL,
  MICA_GREETING,
  MICA_LIVE_INSTRUCTIONS,
  parseLiveSessionResponse,
  readLiveConfig,
  TRAVIS_LIVE_INSTRUCTIONS,
  validateSdpOffer,
} from "../server/live-session.mjs";
import { FAKE_ANSWER_SDP, FAKE_OFFER_SDP } from "./support/mocks.ts";

/** A complete, deliberately fake configuration. Never a real key. */
const ENV = {
  OPENAI_API_KEY: "test-not-a-real-key",
  MICA_LIVE_MODEL: "gpt-live-1",
  MICA_LIVE_VOICE: "marin",
  MICA_LIVE_DELEGATION: "client",
};

test("configuration requires a key and accepts only client delegation", () => {
  assert.equal(readLiveConfig(ENV).ok, true);

  const noKey = readLiveConfig({ ...ENV, OPENAI_API_KEY: "" });
  assert.equal(noKey.ok, false);
  assert.equal(noKey.ok === false && noKey.code, "missing_api_key");

  const wrongMode = readLiveConfig({ ...ENV, MICA_LIVE_DELEGATION: "responses" });
  assert.equal(wrongMode.ok, false);
  assert.equal(wrongMode.ok === false && wrongMode.code, "invalid_delegation");

  // Blank values fall back to Mica's defaults rather than failing.
  const defaulted = readLiveConfig({ OPENAI_API_KEY: "x" });
  assert.equal(defaulted.ok && defaulted.config.model, "gpt-live-1");
  assert.equal(defaulted.ok && defaulted.config.voice, "marin");
});

test("health description never exposes the key", () => {
  const described = describeLiveConfig(ENV);
  assert.equal(described.apiKeyConfigured, true);
  assert.equal(described.ready, true);
  assert.equal(JSON.stringify(described).includes(ENV.OPENAI_API_KEY), false);

  assert.equal(describeLiveConfig({}).apiKeyConfigured, false);
  assert.equal(describeLiveConfig({}).ready, false);
});

test("SDP validation accepts one audio track and rejects video", () => {
  assert.equal(validateSdpOffer(FAKE_OFFER_SDP).ok, true);
  // Audio only, no data channel, is still fine.
  assert.equal(validateSdpOffer("v=0\r\nm=audio 9 RTP/AVP 111").ok, true);

  for (const bad of [
    undefined,
    "",
    "no-version-line\r\nm=audio 9 RTP/AVP 111",
    // Video must not reach a paid session.
    "v=0\r\nm=audio 9 RTP/AVP 111\r\nm=video 9 RTP/AVP 96",
    // Two audio sections.
    "v=0\r\nm=audio 9 RTP/AVP 111\r\nm=audio 9 RTP/AVP 111",
    // No media at all.
    "v=0\r\no=- 0 0 IN IP4 127.0.0.1",
  ]) {
    const result = validateSdpOffer(bad);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    assert.equal(result.ok === false && result.code, "invalid_sdp");
  }
});

test("session request matches the documented WebRTC shape", () => {
  const config = readLiveConfig(ENV);
  assert.ok(config.ok);
  const body = buildLiveSessionRequest({ config: config.config, sdp: FAKE_OFFER_SDP });

  assert.equal(body.session.model, "gpt-live-1");
  assert.equal(body.session.audio.output.voice, "marin");
  assert.equal(body.session.delegation.type, "client");
  assert.equal(body.session.store, false);
  assert.equal(body.transport.type, "webrtc");
  assert.equal(body.transport.sdp, FAKE_OFFER_SDP);
  // WebRTC negotiates audio on the media tracks.
  assert.equal("format" in body.session.audio, false);
  assert.ok(body.session.instructions.includes("no allocation backend"));
  // Skye's session starts with a greeting in its input, so she speaks first.
  assert.deepEqual(body.session.input, [
    { type: "message", role: "developer", content: [{ type: "input_text", text: MICA_GREETING }] },
  ]);
  // A session that should not speak first has none.
  const quiet = buildLiveSessionRequest({ config: config.config, sdp: FAKE_OFFER_SDP, greeting: null });
  assert.equal("input" in quiet.session, false);
});

test("response parsing requires both the session id and the answer", () => {
  const good = parseLiveSessionResponse({ session: { id: "live_1" }, transport: { sdp: FAKE_ANSWER_SDP } });
  assert.deepEqual(good, { ok: true, sessionId: "live_1", sdp: FAKE_ANSWER_SDP });

  for (const bad of [null, {}, { session: { id: "live_1" } }, { transport: { sdp: "x" } }]) {
    assert.equal(parseLiveSessionResponse(bad).ok, false);
  }
});

test("missing key answers 503 without calling upstream", async () => {
  let called = 0;
  const result = await createLiveSession({
    env: { ...ENV, OPENAI_API_KEY: "" },
    sdp: FAKE_OFFER_SDP,
    fetchImpl: (() => {
      called += 1;
      throw new Error("upstream must not be called");
    }) as unknown as typeof fetch,
  });

  assert.equal(called, 0);
  assert.equal(result.status, 503);
  assert.equal((result.body as { error: { code: string } }).error.code, "missing_api_key");
});

test("a successful create forwards the key as a bearer token and returns the answer", async () => {
  let seenUrl = "";
  let seenAuth = "";
  let seenBody: Record<string, unknown> = {};

  const result = await createLiveSession({
    env: ENV,
    sdp: FAKE_OFFER_SDP,
    fetchImpl: (async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      seenAuth = String((init.headers as Record<string, string>).Authorization);
      seenBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ session: { id: "live_9" }, transport: { sdp: FAKE_ANSWER_SDP } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });

  assert.equal(seenUrl, LIVE_SESSIONS_URL);
  assert.equal(seenAuth, `Bearer ${ENV.OPENAI_API_KEY}`);
  assert.equal((seenBody as { session: { model: string } }).session.model, "gpt-live-1");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    sessionId: "live_9",
    sdp: FAKE_ANSWER_SDP,
    model: "gpt-live-1",
    voice: "marin",
  });
});

test("Travis's session is his own: his instructions and voice, ripple unless set; any other persona is refused", async () => {
  const seen: { body?: { session: { instructions: string; input?: unknown; audio: { output: { voice: string } } } } } = {};
  const upstream = (async (_url: string, init: RequestInit) => {
    seen.body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ session: { id: "live_t" }, transport: { sdp: FAKE_ANSWER_SDP } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const travis = await createLiveSession({ env: ENV, sdp: FAKE_OFFER_SDP, persona: "travis", fetchImpl: upstream });
  assert.equal(travis.status, 200);
  assert.equal(travis.body.voice, "ripple");
  assert.equal(seen.body?.session.instructions, TRAVIS_LIVE_INSTRUCTIONS);
  // He speaks only when cued, never first.
  assert.equal(seen.body?.session.input, undefined);
  assert.equal(seen.body?.session.audio.output.voice, "ripple");

  await createLiveSession({ env: { ...ENV, MICA_TRAVIS_VOICE: "cedar" }, sdp: FAKE_OFFER_SDP, persona: "travis", fetchImpl: upstream });
  assert.equal(seen.body?.session.audio.output.voice, "cedar");

  // Skye's is still hers.
  await createLiveSession({ env: ENV, sdp: FAKE_OFFER_SDP, fetchImpl: upstream });
  assert.equal(seen.body?.session.instructions, MICA_LIVE_INSTRUCTIONS);
  assert.equal(seen.body?.session.audio.output.voice, "marin");

  let called = 0;
  const unused = (() => {
    called += 1;
    throw new Error("upstream must not be called");
  }) as unknown as typeof fetch;
  for (const persona of ["priya", 3, null]) {
    const refused = await createLiveSession({ env: ENV, sdp: FAKE_OFFER_SDP, persona, fetchImpl: unused });
    assert.equal(refused.status, 400);
    assert.equal((refused.body as { error: { code: string } }).error.code, "invalid_persona");
  }
  assert.equal(called, 0);
});

test("upstream errors are replaced with fixed messages, never echoed", async () => {
  // A provider auth error can quote part of the key; none of it may reach the
  // browser, and truncation is not redaction.
  const leaky = "Incorrect API key provided: sk-live-ABCDEF123456. Check your key.";

  const cases: { status: number; expectStatus: number; expectCode: string }[] = [
    { status: 401, expectStatus: 502, expectCode: "upstream_rejected_key" },
    { status: 403, expectStatus: 502, expectCode: "upstream_rejected_key" },
    { status: 429, expectStatus: 429, expectCode: "upstream_rate_limited" },
    { status: 500, expectStatus: 502, expectCode: "upstream_unavailable" },
    { status: 400, expectStatus: 502, expectCode: "upstream_rejected_request" },
  ];

  for (const entry of cases) {
    const result = await createLiveSession({
      env: ENV,
      sdp: FAKE_OFFER_SDP,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: leaky, code: "invalid_api_key" } }), {
          status: entry.status,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch,
    });

    assert.equal(result.status, entry.expectStatus);
    const body = result.body as { error: { code: string; message: string } };
    assert.equal(body.error.code, entry.expectCode);
    assert.equal(body.error.message.includes("sk-live"), false);
    assert.equal(body.error.message.includes("Incorrect API key"), false);
    assert.equal(JSON.stringify(result.body).includes(ENV.OPENAI_API_KEY), false);
  }
});

test("a malformed upstream success is reported, not passed through", async () => {
  const result = await createLiveSession({
    env: ENV,
    sdp: FAKE_OFFER_SDP,
    fetchImpl: (async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch,
  });
  assert.equal(result.status, 502);
  assert.equal((result.body as { error: { code: string } }).error.code, "invalid_upstream_response");
});

test("an aborted caller stops the upstream call", async () => {
  const aborter = new AbortController();
  const result = await createLiveSession({
    env: ENV,
    sdp: FAKE_OFFER_SDP,
    signal: aborter.signal,
    fetchImpl: ((_url: string, init: RequestInit) => {
      // The signal Mica passes must be the one that aborts the request.
      aborter.abort();
      return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError", signal: init.signal }));
    }) as unknown as typeof fetch,
  });

  // 499: the client went away, so there is nobody to answer.
  assert.equal(result.status, 499);
});

test("session instructions describe what Mica really shows and can do, and nothing more", () => {
  assert.match(MICA_LIVE_INSTRUCTIONS, /support a stand allocator/);
  assert.match(MICA_LIVE_INSTRUCTIONS, /synthetic demo fixtures/);
  assert.match(MICA_LIVE_INSTRUCTIONS, /That is everything Mica can do/);
  assert.match(MICA_LIVE_INSTRUCTIONS, /no allocation backend/);
  // Stand changes are demo-only, checked by sample rules only, and suggestions need a yes.
  assert.match(MICA_LIVE_INSTRUCTIONS, /against sample rules only/);
  assert.match(MICA_LIVE_INSTRUCTIONS, /conflicts from late stays are not checked/);
  // Flights with no stand can be given one; the ones that can't are explained.
  assert.match(MICA_LIVE_INSTRUCTIONS, /give a stand to flights that have none/);
  assert.match(MICA_LIVE_INSTRUCTIONS, /you read back why/);
  assert.match(MICA_LIVE_INSTRUCTIONS, /take flights off their stands/);
  assert.doesNotMatch(MICA_LIVE_INSTRUCTIONS, /cannot give a stand/);
  assert.match(MICA_LIVE_INSTRUCTIONS, /never present a change or a suggestion as operationally validated/);
  assert.match(MICA_LIVE_INSTRUCTIONS, /Never make a suggested change without a yes/);
});
