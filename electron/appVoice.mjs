// Skye in the desktop app on the user's own OpenAI key, from Settings → API.
// Kept free of Electron so it can be tested without launching it; main.mjs
// wires it to the window and its IPC.
//
// The page hands the key over once and can never read it back, only a masked
// form of it. It is kept here, in the main process's memory, for the one
// window that set it, and
// forgotten when that window reloads, navigates or closes: nothing writes it
// to disk, to process.env (which child processes inherit) or to a log. The
// main process then answers the voice broker's routes (micaLiveServer.mjs)
// itself, with the broker's own session and interpreter code, so the key
// travels only in the Authorization header of Mica's requests to
// api.openai.com, never in a request the page makes.
import { createLiveSession, describeLiveConfig } from "../server/live-session.mjs";
import { describeInterpreter, interpretRequest } from "../server/interpret.mjs";

/** The broker's routes the app answers, by the last segment of their paths. */
export const APP_VOICE_ROUTES = ["session", "interpret", "health"];

/** Who a key can be for: the broker's code calls api.openai.com only. */
export const APP_VOICE_PROVIDERS = ["openai"];

/** As the broker's cap: a body is one SDP offer, or one interpretation. */
export const MAX_BODY_CHARS = 96 * 1024;

/**
 * The interpreter model chosen for this project (.env.example), which the
 * packaged app has no .env to read. MICA_INTERPRETER_MODEL still overrides it.
 */
export const APP_INTERPRETER_MODEL = "gpt-6-luna";

/**
 * Checks the shape of a key the page hands over: OpenAI decides whether it
 * works, on the first call. A key has no spaces, so any a paste brought along
 * (a wrapped line, a zero-width space) are dropped; what is left must be
 * printable ASCII, so it is safe in a header.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function readApiKey(value) {
  if (typeof value !== "string") return null;
  const key = value.replace(/[\s​-‍⁠﻿]+/g, "");
  return /^sk-[\x21-\x7e]{16,500}$/.test(key) ? key : null;
}

/**
 * A key as Settings → API shows it, as OpenAI's own dashboard does: its kind
 * and its last four, never enough of it to use.
 *
 * @param {string} key A key readApiKey took.
 */
export function maskApiKey(key) {
  const kind = /^sk-(?:[a-z]{1,12}-)?/.exec(key)?.[0] ?? "sk-";
  return `${kind}…${key.slice(-4)}`;
}

/**
 * The settings the broker would read from its environment, for one call: the
 * window's key as OPENAI_API_KEY, which is never read from the app's own
 * environment, and the rest as the broker has them.
 *
 * @param {string} apiKey
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string | undefined>}
 */
export function appVoiceEnv(apiKey, env) {
  return {
    MICA_LIVE_MODEL: env.MICA_LIVE_MODEL,
    MICA_LIVE_VOICE: env.MICA_LIVE_VOICE,
    MICA_TRAVIS_VOICE: env.MICA_TRAVIS_VOICE,
    MICA_LIVE_DELEGATION: env.MICA_LIVE_DELEGATION,
    MICA_INTERPRETER_MODEL: env.MICA_INTERPRETER_MODEL?.trim() || APP_INTERPRETER_MODEL,
    MICA_INTERPRETER_MAX_OUTPUT_TOKENS: env.MICA_INTERPRETER_MAX_OUTPUT_TOKENS,
    OPENAI_API_KEY: apiKey,
  };
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
const failure = (status, code, message) => ({ status, body: { error: { code, message } } });

/**
 * Each window's key and the requests it is waiting on, by webContents id.
 * `fetchImpl` is injectable so tests reach no API.
 *
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [options]
 */
export function createAppVoice({ env = process.env, fetchImpl = fetch } = {}) {
  /** @type {Map<number, { apiKey: string, provider: string, hint: string, pending: Map<string, AbortController> }>} */
  const windows = new Map();

  /**
   * Forgets a window's key, and abandons what it was waiting on: for a
   * session that also stops a paid session being minted for nobody.
   * @param {number} id
   */
  function forget(id) {
    const entry = windows.get(id);
    if (!entry) return;
    windows.delete(id);
    for (const controller of entry.pending.values()) controller.abort();
  }

  return {
    /**
     * Keeps a key for a window, in place of any it had; false, keeping
     * nothing, when it isn't shaped like one or its provider isn't one Mica
     * calls.
     * @param {number} id
     * @param {unknown} provider
     * @param {unknown} value
     */
    setKey(id, provider, value) {
      const apiKey = readApiKey(value);
      if (!apiKey || typeof provider !== "string" || !APP_VOICE_PROVIDERS.includes(provider)) return false;
      forget(id);
      windows.set(id, { apiKey, provider, hint: maskApiKey(apiKey), pending: new Map() });
      return true;
    },

    /**
     * A window's key as the page may see it: its provider and masked form,
     * or null when it has none.
     * @param {number} id
     * @returns {{ provider: string, hint: string } | null}
     */
    describeKey(id) {
      const entry = windows.get(id);
      return entry ? { provider: entry.provider, hint: entry.hint } : null;
    },

    forget,

    /**
     * Answers one of the broker's routes with the window's key, as the broker
     * would: an HTTP-shaped result. Null when the window has no key, so the
     * page goes to the broker instead.
     *
     * @param {number} id
     * @param {unknown} requestId The page's name for the request, to abort it by.
     * @param {unknown} route
     * @param {unknown} body The request's JSON text; none for health.
     * @returns {Promise<{ status: number, body: Record<string, unknown> } | null>}
     */
    async request(id, requestId, route, body) {
      const entry = windows.get(id);
      if (!entry) return null;
      if (typeof route !== "string" || !APP_VOICE_ROUTES.includes(route)) {
        return failure(404, "not_found", "Unknown route.");
      }
      const callEnv = appVoiceEnv(entry.apiKey, env);
      if (route === "health") {
        // Readiness only, as the broker's: booleans and setting names, never the key.
        return { status: 200, body: { ...describeLiveConfig(callEnv), interpreter: describeInterpreter(callEnv) } };
      }
      if (typeof requestId !== "string" || requestId === "" || requestId.length > 64 || entry.pending.has(requestId)) {
        return failure(400, "invalid_request", "Each request needs its own id.");
      }
      if (typeof body !== "string" || body.length > MAX_BODY_CHARS) {
        return failure(400, "payload_too_large", "Request body is too large.");
      }
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        return failure(400, "invalid_json", "Request body must be JSON.");
      }

      const aborted = new AbortController();
      entry.pending.set(requestId, aborted);
      try {
        return route === "session"
          ? // As the broker: only the offer and the persona come from the page.
            await createLiveSession({
              env: callEnv,
              sdp: value?.sdp,
              persona: value?.persona,
              fetchImpl,
              signal: aborted.signal,
            })
          : await interpretRequest({ env: callEnv, body: value, fetchImpl, signal: aborted.signal });
      } finally {
        entry.pending.delete(requestId);
      }
    },

    /**
     * Abandons one of a window's requests, when the page stops waiting on it.
     * @param {number} id
     * @param {unknown} requestId
     */
    abort(id, requestId) {
      if (typeof requestId === "string") windows.get(id)?.pending.get(requestId)?.abort();
    },
  };
}
