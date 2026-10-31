// The renderer's only contact with Mica's backend.
//
// The browser never holds an API key, a client secret or an ephemeral token:
// it posts its SDP offer to Mica's own broker, which calls GPT-Live with the
// server-side project key and returns the answer. There is nothing here to
// persist, and nothing to put in a VITE_* variable except the broker's own
// public URL. In the desktop app, a key from Settings → API goes to the main
// process instead, which answers the same routes with it (liveFetch).
import { desktopVoice, type DesktopVoiceRoute } from "./desktopVoice.ts";

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

/** The broker's routes, by path, as the desktop app answers them. */
const DESKTOP_ROUTES: Record<string, DesktopVoiceRoute> = {
  "/api/live/session": "session",
  "/api/live/interpret": "interpret",
  "/api/live/health": "health",
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Whether there is a broker to go to: the dev server's proxy, or the one a
 * packaged build was built with.
 */
function hasBroker(): boolean {
  return liveApiBase() !== "" || (import.meta.env as { DEV?: boolean } | undefined)?.DEV === true;
}

/**
 * `fetch` for Mica's voice routes. In the desktop app, a window given a key in
 * Settings → API has the main process answer them with it
 * (electron/appVoice.mjs), so the key never rides on a request from here;
 * without one they go to the broker, as in a browser. A packaged build with no
 * broker answers that it needs a key.
 */
export const liveFetch: typeof fetch = async (input, init) => {
  const voice = desktopVoice();
  const route = voice && typeof input === "string" ? DESKTOP_ROUTES[new URL(input, "mica://app/").pathname] : undefined;
  if (!voice || !route) return fetch(input, init);

  const signal = init?.signal ?? undefined;
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const abort = () => voice.abort(id);
  signal?.addEventListener("abort", abort, { once: true });
  let answer: Awaited<ReturnType<typeof voice.request>>;
  try {
    answer = await voice.request(id, route, typeof init?.body === "string" ? init.body : undefined);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  signal?.throwIfAborted();

  if (answer) return jsonResponse(answer.status, answer.body);
  if (hasBroker()) return fetch(input, init);
  return jsonResponse(503, {
    error: { code: "missing_api_key", message: "Skye needs an OpenAI API key: add yours in Settings → API." },
  });
};

type RequestOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

/** Whose session: Skye's, or Travis's, answering her on an approval call (./teammateVoice). */
export type LivePersona = "skye" | "travis";

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
 * Exchanges an SDP offer for a GPT-Live session: Skye's, unless `persona`
 * says whose; the broker holds each one's instructions and voice.
 *
 * @throws LiveCallError with `missing_api_key` when the broker has no key
 *   configured, which is the expected state in a fresh checkout.
 */
export async function requestLiveSession(
  sdp: string,
  { baseUrl = liveApiBase(), fetchImpl = liveFetch, signal, persona }: RequestOptions & { persona?: LivePersona } = {},
): Promise<LiveSessionGrant> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/live/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(persona ? { sdp, persona } : { sdp }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new LiveCallError("cancelled", "The call was cancelled.");
    throw new LiveCallError(
      "backend_unreachable",
      desktopVoice()
        ? "Skye needs an OpenAI API key: add yours in Settings → API, or start Mica's voice backend with `npm run dev:voice`."
        : "Mica's voice backend is not running. Start it with `npm run dev:voice`.",
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
  fetchImpl = liveFetch,
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
