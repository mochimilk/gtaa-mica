// The renderer's only contact with Mica's backend.
//
// The browser never holds an API key, a client secret or an ephemeral token:
// it posts its SDP offer to Mica's own broker, which calls GPT-Live with the
// server-side project key and returns the answer. There is nothing here to
// persist, and nothing to put in a VITE_* variable except the broker's own
// public URL.

export type LiveSessionGrant = {
  sessionId: string;
  /** The server's SDP answer. */
  sdp: string;
};

export type LiveHealth = {
  ready: boolean;
  apiKeyConfigured: boolean;
  model: string;
  voice: string;
  delegation: string;
  code?: string;
  message?: string;
};

/** A failure with a code the UI can branch on. */
export class LiveCallError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LiveCallError";
    this.code = code;
  }
}

/**
 * Where the broker lives.
 *
 * Empty by default, which makes the calls relative: in browser development and
 * in Electron development the Vite dev server proxies `/api` to the broker, so
 * requests stay same-origin and the CSP needs no extra origin. A packaged
 * Electron build has no proxy, so it must be built with
 * `VITE_MICA_API_BASE_URL` pointing at the broker.
 */
export function liveApiBase(): string {
  const configured = (import.meta.env as Record<string, string | undefined> | undefined)
    ?.VITE_MICA_API_BASE_URL;
  return typeof configured === "string" ? configured.replace(/\/$/, "") : "";
}

type RequestOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

/** Reads `{ error: { code, message } }` without trusting its shape. */
async function readError(response: Response, fallbackCode: string): Promise<LiveCallError> {
  let code = fallbackCode;
  let message = "Voice is unavailable.";
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body?.error?.code === "string") code = body.error.code;
    if (typeof body?.error?.message === "string") message = body.error.message;
  } catch {
    // Keep the fallback: an unparseable error body is still an error.
  }
  return new LiveCallError(code, message);
}

/**
 * Exchanges an SDP offer for a GPT-Live session.
 *
 * @throws LiveCallError with `missing_api_key` when the broker has no key
 *   configured, which is the expected state in a fresh checkout.
 */
export async function requestLiveSession(
  sdp: string,
  { baseUrl = liveApiBase(), fetchImpl = fetch, signal }: RequestOptions = {},
): Promise<LiveSessionGrant> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/live/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new LiveCallError("cancelled", "The call was cancelled.");
    throw new LiveCallError(
      "backend_unreachable",
      "Mica's voice backend is not running. Start it with `npm run dev:voice`.",
    );
  }

  if (!response.ok) throw await readError(response, `http_${response.status}`);

  let payload: { sessionId?: unknown; sdp?: unknown };
  try {
    payload = (await response.json()) as { sessionId?: unknown; sdp?: unknown };
  } catch {
    throw new LiveCallError("invalid_response", "Mica's voice backend returned an unreadable response.");
  }
  if (typeof payload.sessionId !== "string" || typeof payload.sdp !== "string") {
    throw new LiveCallError("invalid_response", "Mica's voice backend did not return a session.");
  }
  return { sessionId: payload.sessionId, sdp: payload.sdp };
}

/**
 * Configuration readiness, used to explain why voice is unavailable before
 * asking for the microphone. Returns null when the broker cannot be reached.
 */
export async function fetchLiveHealth({
  baseUrl = liveApiBase(),
  fetchImpl = fetch,
  signal,
}: RequestOptions = {}): Promise<LiveHealth | null> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/live/health`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as LiveHealth;
  } catch {
    return null;
  }
}
