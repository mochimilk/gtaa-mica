// Mica's local GPT-Live session broker.
//
// SCOPE: local development only, and deliberately so. This repository has no
// user authentication, so there is nothing to authorize a session request
// against. A session-minting route is a paid, abusable endpoint, so this server
// binds to loopback, refuses non-loopback hosts, and checks the browser Origin
// against an allowlist. Do not deploy it as-is; a hosted Mica needs the route
// behind real app authentication first (see docs/gpt-live-voice.md).
//
// The OpenAI project key stays in this process. It is never sent to the
// renderer, never written to a response, and never put in a VITE_* variable.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createLiveSession, describeLiveConfig } from "./live-session.mjs";
import { describeInterpreter, interpretRequest } from "./interpret.mjs";

export const DEFAULT_PORT = 8787;
export const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "mica://app"];
/** Request bodies are a single SDP offer; anything larger is rejected unread. */
const MAX_BODY_BYTES = 96 * 1024;

const SESSION_ROUTE = "/api/live/session";
const INTERPRET_ROUTE = "/api/live/interpret";
const HEALTH_ROUTE = "/api/live/health";
const POST_ROUTES = new Set([SESSION_ROUTE, INTERPRET_ROUTE]);

/**
 * Origins allowed to call the broker.
 * @param {Record<string, string | undefined>} env
 */
export function allowedOrigins(env) {
  const configured = env.MICA_LIVE_ALLOWED_ORIGINS?.trim();
  if (!configured) return [...DEFAULT_ORIGINS];
  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Browser requests must come from an allowlisted origin. A missing Origin
 * header (curl, a test, packaged Electron on a custom scheme) is allowed
 * because the listener is loopback-only; `null` is not, since that is what a
 * sandboxed or cross-origin document sends.
 *
 * @param {string | undefined} origin
 * @param {string[]} allowed
 */
export function isAllowedOrigin(origin, allowed) {
  if (origin === undefined) return true;
  if (origin === "null") return false;
  return allowed.includes(origin);
}

/** Loopback names the broker will answer on. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * The listener binds to loopback, but binding is not a Host check: a request
 * can still arrive with a foreign Host header (DNS rebinding, a proxy). The
 * local-only guarantee is only as strong as both checks together.
 *
 * @param {string | undefined} host Raw `Host` header, may include a port.
 */
export function isLoopbackHost(host) {
  if (!host) return false;
  // Strip the port, keeping bracketed IPv6 literals intact.
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return LOOPBACK_HOSTS.has(name.toLowerCase());
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {Record<string, unknown>} body
 * @param {string | undefined} origin Echoed only after passing the allowlist.
 */
function sendJson(response, status, body, origin) {
  const headers = /** @type {Record<string, string>} */ ({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS";
    headers["Access-Control-Max-Age"] = "600";
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

/**
 * Reads a size-capped JSON body.
 * @param {import("node:http").IncomingMessage} request
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, code: string, message: string }>}
 */
function readJsonBody(request) {
  return new Promise((resolve) => {
    const declared = Number(request.headers["content-length"] ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      resolve({ ok: false, code: "payload_too_large", message: "Request body is too large." });
      return;
    }
    const chunks = /** @type {Buffer[]} */ ([]);
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        resolve({ ok: false, code: "payload_too_large", message: "Request body is too large." });
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") });
      } catch {
        resolve({ ok: false, code: "invalid_json", message: "Request body must be JSON." });
      }
    });
    request.on("error", () => resolve({ ok: false, code: "request_failed", message: "Request stream failed." }));
  });
}

/**
 * Builds the broker. `fetchImpl` is injectable so tests exercise every route
 * without a key and without any outbound request.
 *
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [options]
 */
export function createMicaLiveServer({ env = process.env, fetchImpl = fetch } = {}) {
  const allowed = allowedOrigins(env);

  return createServer(async (request, response) => {
    const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (!isLoopbackHost(request.headers.host)) {
      sendJson(
        response,
        421,
        { error: { code: "host_not_allowed", message: "This broker only answers loopback requests." } },
        undefined,
      );
      return;
    }
    if (!isAllowedOrigin(origin, allowed)) {
      sendJson(response, 403, { error: { code: "origin_not_allowed", message: "Origin is not allowed." } }, undefined);
      return;
    }
    // Only echo an origin that passed the allowlist.
    const corsOrigin = origin;

    if (request.method === "OPTIONS") {
      sendJson(response, 204, {}, corsOrigin);
      return;
    }

    if (url.pathname === HEALTH_ROUTE && request.method === "GET") {
      // Readiness only: booleans and setting names, never the key itself.
      sendJson(response, 200, { ...describeLiveConfig(env), interpreter: describeInterpreter(env) }, corsOrigin);
      return;
    }

    if (!POST_ROUTES.has(url.pathname)) {
      sendJson(response, 404, { error: { code: "not_found", message: "Unknown route." } }, corsOrigin);
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use POST." } }, corsOrigin);
      return;
    }

    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      sendJson(
        response,
        415,
        { error: { code: "unsupported_media_type", message: "Use Content-Type: application/json." } },
        corsOrigin,
      );
      return;
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      sendJson(response, 400, { error: { code: body.code, message: body.message } }, corsOrigin);
      return;
    }

    // If the renderer hangs up mid-request the socket closes; abort the
    // upstream call rather than finish work nobody will use. For the session
    // route that also avoids minting a paid session that is then discarded.
    const aborted = new AbortController();
    const onClientGone = () => aborted.abort();
    request.once("aborted", onClientGone);
    response.once("close", () => {
      if (!response.writableEnded) onClientGone();
    });

    try {
      const result =
        url.pathname === SESSION_ROUTE
          ? // Only the SDP offer, and which of the app's personas it is for,
            // are accepted from the renderer. Session instructions are
            // app-authored on this side, so caller text can never become
            // model instructions.
            await createLiveSession({
              env,
              sdp: /** @type {any} */ (body.value)?.sdp,
              persona: /** @type {any} */ (body.value)?.persona,
              fetchImpl,
              signal: aborted.signal,
            })
          : // Interpretation: transcript and board state are carried as data,
            // and the interpreter's own rules stay server-owned.
            await interpretRequest({ env, body: body.value, fetchImpl, signal: aborted.signal });
      if (response.writableEnded || aborted.signal.aborted) return;
      sendJson(response, result.status, result.body, corsOrigin);
    } finally {
      request.off("aborted", onClientGone);
    }
  });
}

/**
 * Starts the broker on loopback.
 * @param {{ env?: Record<string, string | undefined>, port?: number, host?: string }} [options]
 */
export function startMicaLiveServer({ env = process.env, port, host = "127.0.0.1" } = {}) {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(
      "The Mica live broker is unauthenticated and refuses non-loopback hosts. Put it behind app authentication before exposing it.",
    );
  }
  const resolvedPort = port ?? Number(env.MICA_LIVE_PORT ?? DEFAULT_PORT);
  const server = createMicaLiveServer({ env });
  server.listen(resolvedPort, host, () => {
    const config = describeLiveConfig(env);
    console.log(`[mica-live] listening on http://${host}:${resolvedPort} (local development only)`);
    console.log(`[mica-live] model=${config.model} voice=${config.voice} delegation=${config.delegation}`);
    console.log(
      config.apiKeyConfigured
        ? "[mica-live] OPENAI_API_KEY is set; calls will reach GPT-Live and bill the project."
        : "[mica-live] OPENAI_API_KEY is not set; /api/live/session will answer 503 missing_api_key.",
    );
    const interpreter = describeInterpreter(env);
    console.log(
      interpreter.ready
        ? `[mica-live] interpreter model=${interpreter.model}`
        : "[mica-live] MICA_INTERPRETER_MODEL is not set; /api/live/interpret will answer 503 interpreter_not_configured and voice actions stay unavailable.",
    );
  });
  return server;
}

// `node --env-file=.env server/micaLiveServer.mjs` loads the private file
// without this module ever reading it itself.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMicaLiveServer();
}
