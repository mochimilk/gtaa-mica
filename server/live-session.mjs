// Pure GPT-Live session-creation logic for Mica's local voice backend.
//
// Everything here is side-effect free apart from the injected `fetchImpl`, so
// the whole request/response contract can be unit tested without a key and
// without ever reaching api.openai.com. The HTTP plumbing lives in
// micaLiveServer.mjs.
//
// Reference: https://developers.openai.com/api/docs/guides/voice-webrtc
//            https://developers.openai.com/api/docs/guides/live-conversations

/** The only model this adapter is written against. */
export const DEFAULT_LIVE_MODEL = "gpt-live-1";
/** GPT-Live output voice used by Mica. */
export const DEFAULT_LIVE_VOICE = "marin";
/**
 * Mica executes app actions itself, so delegation targets the client. No other
 * mode is accepted: `responses` delegation would need a separate backend model
 * choice that this project has not made.
 */
export const REQUIRED_DELEGATION = "client";
/** REST equivalent of `client.live.create`. */
export const LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";

/** Largest SDP offer accepted, well above a realistic single-audio-track offer. */
export const MAX_SDP_BYTES = 64 * 1024;

/**
 * App-authored session instructions. Kept server-side and never built from
 * caller input: the live guides are explicit that appended/initial
 * instructions must not carry untrusted text.
 *
 * The wording deliberately states Mica's real limits, so the model does not
 * narrate capabilities the prototype does not have.
 */
export const MICA_LIVE_INSTRUCTIONS = [
  "You are Skye, the assistant inside Mica, a stand-occupancy prototype for the fictional Norvara Intl Airport. You support a stand allocator: the person who plans which aircraft holds which stand, and when.",
  "Talk like a relaxed coworker on the stand-allocation desk: casual, brief and specific. This is a spoken conversation with a colleague looking at the stand chart.",
  "Mica shows one demo day: a stand timeline of aircraft stays, arrivals and departures with flight number, origin or destination, estimated time, stand, aircraft type and registration, how long each stay holds its stand, tows, late stays, flights with no stand, and demo alerts. The alerts include conflicts: a late stay whose delay runs into another stay on its stand.",
  "All flights, stands, times and alerts are synthetic demo fixtures. Never imply they are live operations data.",
  "Through the client you can find flights, select a flight to show its details, select several flights together or add flights to what is already selected (as Ctrl-clicking their bars does), move a stay to another stand or swap two stays' stands, give a stand to flights that have none (one onto a named stand, or each onto the first free stand that fits), take flights off their stands, close a stand area and move what is on it, suggest the move or swap that most widens the tightest gap between stays, say what is selected, switch the view between all activity, needs attention, arrivals, departures and tows, set or reset the carrier, stand-area and aircraft-type filters, read out all the open demo alerts or just the conflicts, acknowledge or reopen alerts, and bring teammates from Mica's people list into this call or take them off it. That is everything Mica can do.",
  "When the user wants it all fixed at once (\"fix all the alerts\", \"just fix everything\", \"clear all the conflicts\"), delegate it: Mica clears every conflict it can and gives every waiting flight a stand in one go, with Skye's helper cursors working together, then says the outcome in a sentence and that the details are in Outputs. Pass that on in one short sentence, without going through the moves, then go straight to the approval.",
  "Bringing someone into the call (\"add Marcus Chen\", \"get Priya on\") is something you can do: delegate it. They only show on Mica's call window and nothing reaches them, so say that plainly, and never say you can't add people.",
  "Stand changes are demo changes on this screen only: Mica has no allocation backend, nothing is saved or sent, and a stay keeps its times. Each flight with no stand has synthetic stay times to place it by, or none at all. When asked to give stands to flights, delegate it; Mica places what fits, and for each flight it cannot place you read back why.",
  "Mica checks a stand change against sample rules only: no overlap with another stay on the stand, the stand's sample size fits the aircraft, and nothing on a closed area. It has no other allocation rules, and conflicts from late stays are not checked, so never present a change or a suggestion as operationally validated.",
  "When the user asks for the best or a better move or swap, delegate it to get Mica's suggestion, read it back, and ask whether to do it. Only when they agree, delegate again to carry it out. Never make a suggested change without a yes.",
  "When the user wants to get going, however they say it (what the day looks like, how the stands are looking, what's on the docket, anything open, what's next, going over the alerts), delegate it: Mica returns every open item, a few words each, and an offer to take it all as one plan. Go through every item it gives, in its order, without skipping or summarising any: one quick beat each, like a colleague handing over the desk, with no explanation or extra detail on any of them. Keep Mica's counts exactly as given: open items are not all conflicts, so never call them that. Put the offer in your own words and vary it, but keep what it promises (what stays where it is, everything else worked in around it) and ask before doing it; never offer to just fix everything. When they say yes, delegate again to do it. If they would rather take one item at a time (\"just the A1 one first\"), delegate that instead; after each change Mica offers the next.",
  "You cannot change flight times, send messages, or affect anything outside this demo screen.",
  "Delegate any request that needs to read or change the Mica screen to the client, which owns selection, views, filters and demo-alert acknowledgement.",
  "After delegating, wait for the client's result before describing what happened. Never claim an action succeeded until the client reports it.",
  "If the client reports that a request is unsupported or unclear, say that directly and offer what Mica can do instead.",
].join(" ");

/**
 * Error codes this module can produce. The HTTP layer maps them to statuses;
 * none of them ever carries a credential or upstream secret.
 */
export const LiveConfigError = {
  missingApiKey: "missing_api_key",
  invalidModel: "invalid_model",
  invalidVoice: "invalid_voice",
  invalidDelegation: "invalid_delegation",
};

const isNonEmptyString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value.trim().length > 0;

/**
 * @typedef {object} LiveConfig
 * @property {string} apiKey
 * @property {string} model
 * @property {string} voice
 * @property {"client"} delegation
 */

/**
 * @typedef {object} ConfigFailure
 * @property {false} ok
 * @property {string} code
 * @property {string} message
 */

/**
 * Reads and validates the server-only GPT-Live settings.
 *
 * `OPENAI_API_KEY` is only ever checked for presence; it is never logged,
 * echoed, trimmed into a message, or returned to a caller.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, config: LiveConfig } | ConfigFailure}
 */
export function readLiveConfig(env) {
  const model = env.MICA_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  const voice = env.MICA_LIVE_VOICE?.trim() || DEFAULT_LIVE_VOICE;
  const delegation = env.MICA_LIVE_DELEGATION?.trim() || REQUIRED_DELEGATION;

  if (delegation !== REQUIRED_DELEGATION) {
    return {
      ok: false,
      code: LiveConfigError.invalidDelegation,
      message: `MICA_LIVE_DELEGATION must be "${REQUIRED_DELEGATION}"; Mica executes app actions on the client.`,
    };
  }
  if (!/^[\w.:-]{1,80}$/.test(model)) {
    return { ok: false, code: LiveConfigError.invalidModel, message: "MICA_LIVE_MODEL is not a valid model id." };
  }
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(voice)) {
    return { ok: false, code: LiveConfigError.invalidVoice, message: "MICA_LIVE_VOICE is not a valid voice name." };
  }
  // Checked last so a misconfigured model/voice is reported even without a key.
  if (!isNonEmptyString(env.OPENAI_API_KEY)) {
    return {
      ok: false,
      code: LiveConfigError.missingApiKey,
      message: "Voice is not configured: this server has no OPENAI_API_KEY. See docs/gpt-live-voice.md.",
    };
  }

  return {
    ok: true,
    config: { apiKey: /** @type {string} */ (env.OPENAI_API_KEY), model, voice, delegation: REQUIRED_DELEGATION },
  };
}

/**
 * Config readiness for the health route: booleans and names only, never the key.
 * @param {Record<string, string | undefined>} env
 */
export function describeLiveConfig(env) {
  const result = readLiveConfig(env);
  const model = env.MICA_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  const voice = env.MICA_LIVE_VOICE?.trim() || DEFAULT_LIVE_VOICE;
  const delegation = env.MICA_LIVE_DELEGATION?.trim() || REQUIRED_DELEGATION;
  return {
    ready: result.ok,
    apiKeyConfigured: isNonEmptyString(env.OPENAI_API_KEY),
    model,
    voice,
    delegation,
    ...(result.ok ? {} : { code: result.code, message: result.message }),
  };
}

/**
 * Validates a browser SDP offer before it is forwarded upstream.
 *
 * @param {unknown} sdp
 * @returns {{ ok: true, sdp: string } | { ok: false, code: string, message: string }}
 */
export function validateSdpOffer(sdp) {
  if (typeof sdp !== "string" || sdp.length === 0) {
    return { ok: false, code: "invalid_sdp", message: "An SDP offer string is required." };
  }
  if (Buffer.byteLength(sdp, "utf8") > MAX_SDP_BYTES) {
    return { ok: false, code: "invalid_sdp", message: "SDP offer is too large." };
  }
  // Minimal structural check: a session description starts with the version
  // line, and Mica's offer is always exactly one audio track plus the
  // `oai-events` data channel. Any other media kind — notably video — is
  // rejected rather than forwarded to a paid session.
  if (!sdp.startsWith("v=0")) {
    return { ok: false, code: "invalid_sdp", message: "SDP offer must start with the v=0 session line." };
  }
  const mediaKinds = sdp
    .split(/\r?\n/)
    .filter((line) => line.startsWith("m="))
    .map((line) => line.slice(2).split(/[ /]/, 1)[0]);
  const audioCount = mediaKinds.filter((kind) => kind === "audio").length;
  const dataCount = mediaKinds.filter((kind) => kind === "application").length;
  if (audioCount !== 1 || dataCount > 1 || mediaKinds.length !== audioCount + dataCount) {
    return {
      ok: false,
      code: "invalid_sdp",
      message: "SDP offer must describe exactly one audio track and at most one data channel.",
    };
  }
  return { ok: true, sdp };
}

/**
 * Builds the `POST /v1/live/sessions` body, equivalent to
 * `client.live.create({ session, transport })`.
 *
 * `audio.format` is deliberately omitted: WebRTC negotiates audio on the media
 * tracks, and the WebRTC guide says to leave it out.
 *
 * `store: false` is Mica's session storage choice: the prototype does not ask
 * the API to retain this session's conversation for later retrieval. It is not
 * a claim about provider-side retention generally — operational logging,
 * abuse-prevention retention and account settings are outside this flag and
 * outside anything this repository can verify.
 *
 * @param {{ config: LiveConfig, sdp: string, instructions?: string }} input
 */
export function buildLiveSessionRequest({ config, sdp, instructions = MICA_LIVE_INSTRUCTIONS }) {
  return {
    session: {
      model: config.model,
      instructions,
      audio: { output: { voice: config.voice } },
      delegation: { type: config.delegation },
      store: false,
    },
    transport: { type: "webrtc", sdp },
  };
}

/**
 * Pulls the two values the browser needs out of the upstream response.
 *
 * @param {unknown} payload
 * @returns {{ ok: true, sessionId: string, sdp: string } | { ok: false, code: string, message: string }}
 */
export function parseLiveSessionResponse(payload) {
  const body = /** @type {any} */ (payload);
  const sessionId = body?.session?.id;
  const sdp = body?.transport?.sdp;
  if (!isNonEmptyString(sessionId) || !isNonEmptyString(sdp)) {
    return {
      ok: false,
      code: "invalid_upstream_response",
      message: "GPT-Live did not return a session id and answer SDP.",
    };
  }
  return { ok: true, sessionId, sdp };
}

/** How long the upstream session-creation call may take. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * Browser-facing messages. These are fixed strings chosen by Mica, never
 * upstream text: a provider auth error can quote part of the API key, and
 * truncating such a body is redaction only by luck. The upstream status and
 * error *code* are logged locally for the operator; the body is not.
 */
const SAFE_MESSAGES = {
  upstream_rejected_key: "Voice is unavailable: GPT-Live rejected this server's credentials.",
  upstream_rate_limited: "Voice is busy: GPT-Live is rate limiting this project. Try again shortly.",
  upstream_unavailable: "Voice is unavailable: GPT-Live could not start a session. Try again shortly.",
  upstream_timeout: "Voice timed out while starting the session.",
  upstream_unreachable: "Voice is unavailable: this server could not reach GPT-Live.",
  invalid_upstream_response: "Voice is unavailable: GPT-Live returned an unexpected session response.",
  upstream_rejected_request: "Voice is unavailable: GPT-Live rejected Mica's session request.",
};

/** @param {string} code */
function safeError(code) {
  const messages = /** @type {Record<string, string>} */ (SAFE_MESSAGES);
  return { error: { code, message: messages[code] ?? "Voice is unavailable." } };
}

/**
 * Maps an upstream status to one of Mica's own codes.
 * @param {number} status
 */
function upstreamCode(status) {
  if (status === 401 || status === 403) return "upstream_rejected_key";
  if (status === 429) return "upstream_rate_limited";
  if (status >= 500) return "upstream_unavailable";
  return "upstream_rejected_request";
}

/**
 * Creates a GPT-Live WebRTC session.
 *
 * Returns an HTTP-shaped result rather than throwing, so the server layer has
 * no error-translation logic of its own.
 *
 * @param {object} input
 * @param {Record<string, string | undefined>} input.env
 * @param {unknown} input.sdp
 * @param {typeof fetch} [input.fetchImpl]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function createLiveSession({ env, sdp, fetchImpl = fetch, signal }) {
  const offer = validateSdpOffer(sdp);
  if (!offer.ok) return { status: 400, body: { error: { code: offer.code, message: offer.message } } };

  const configured = readLiveConfig(env);
  if (!configured.ok) {
    // 503: the route exists and the request was fine, the server is not set up.
    const status = configured.code === LiveConfigError.missingApiKey ? 503 : 500;
    return { status, body: { error: { code: configured.code, message: configured.message } } };
  }

  const request = buildLiveSessionRequest({ config: configured.config, sdp: offer.sdp });

  // Bounded upstream call that also aborts when the caller goes away (client
  // disconnect or a hangup during connect), so an abandoned connect attempt
  // cannot leave a paid session being created in the background.
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const upstreamSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response;
  try {
    response = await fetchImpl(LIVE_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configured.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: upstreamSignal,
    });
  } catch {
    // The exception text is discarded on purpose; it can contain request
    // details and is not needed to tell the user what to do.
    if (signal?.aborted) return { status: 499, body: safeError("upstream_unreachable") };
    const code = timeout.aborted ? "upstream_timeout" : "upstream_unreachable";
    console.warn(`[mica-live] session creation failed (${code})`);
    return { status: code === "upstream_timeout" ? 504 : 502, body: safeError(code) };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = upstreamCode(response.status);
    // Status and upstream code only: upstream messages can quote credentials.
    const upstreamErrorCode = /** @type {any} */ (payload)?.error?.code;
    console.warn(
      `[mica-live] GPT-Live returned ${response.status}` +
        `${isNonEmptyString(upstreamErrorCode) ? ` (${String(upstreamErrorCode).slice(0, 64)})` : ""}`,
    );
    return { status: code === "upstream_rate_limited" ? 429 : 502, body: safeError(code) };
  }

  const parsed = parseLiveSessionResponse(payload);
  if (!parsed.ok) return { status: 502, body: safeError("invalid_upstream_response") };

  return {
    status: 200,
    body: { sessionId: parsed.sessionId, sdp: parsed.sdp, model: configured.config.model, voice: configured.config.voice },
  };
}
