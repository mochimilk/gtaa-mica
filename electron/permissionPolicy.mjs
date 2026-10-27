// Permission policy for the desktop shell, kept pure so it can be tested
// without launching Electron.
//
// Mica grants exactly one capability it did not before: the microphone, and
// only to its own window. Everything else stays denied.

/**
 * Whether a URL or origin belongs to this app.
 *
 * `mica:` is a custom scheme, and `new URL("mica://app/index.html").origin` is
 * the string `"null"` — comparing origins would therefore reject the packaged
 * app's own microphone request. So the packaged case is matched on protocol
 * and host explicitly, the same way navigation is checked.
 *
 * @param {string | undefined | null} value A full URL or a serialized origin.
 * @param {string | undefined} devOrigin Dev-server origin, when running from Vite.
 */
export function isAppOrigin(value, devOrigin) {
  if (typeof value !== "string" || value === "") return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (devOrigin) return url.origin === devOrigin;
  return url.protocol === "mica:" && url.host === "app";
}

/**
 * Decides a `media` permission request.
 *
 * Audio only: a request that also asks for video is refused outright rather
 * than silently downgraded to audio.
 *
 * @param {object} input
 * @param {string} input.permission
 * @param {string | undefined} input.requestingUrl
 * @param {string[] | undefined} input.mediaTypes
 * @param {string | undefined} input.devOrigin
 */
export function allowPermissionRequest({ permission, requestingUrl, mediaTypes, devOrigin }) {
  if (permission !== "media") return false;
  if (!isAppOrigin(requestingUrl, devOrigin)) return false;
  const types = mediaTypes ?? [];
  if (types.length === 0) return false;
  return types.every((type) => type === "audio");
}

/**
 * Decides a `media` permission check.
 *
 * When Chromium supplies a requesting origin it is authoritative: falling back
 * to the window's own URL would let an untrusted origin inherit the app's
 * permission. The window URL is only consulted when no origin was supplied.
 *
 * @param {object} input
 * @param {string} input.permission
 * @param {string | undefined} input.requestingOrigin
 * @param {string | undefined} input.contentsUrl
 * @param {string | undefined} input.mediaType
 * @param {string | undefined} input.devOrigin
 */
export function allowPermissionCheck({ permission, requestingOrigin, contentsUrl, mediaType, devOrigin }) {
  if (permission !== "media") return false;
  if (mediaType !== "audio") return false;
  const subject = requestingOrigin !== undefined && requestingOrigin !== "" ? requestingOrigin : contentsUrl;
  return isAppOrigin(subject, devOrigin);
}

/** Loopback http origins only; a remote backend is a deployment decision. */
export const DEFAULT_BROKER_ORIGIN = "http://127.0.0.1:8787";

/**
 * Validates the broker origin that goes into the packaged app's connect-src.
 * @param {string | undefined} configured
 */
export function resolveBrokerOrigin(configured) {
  const value = configured?.trim();
  if (!value) return DEFAULT_BROKER_ORIGIN;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    if (url.protocol !== "http:" || !loopback || url.pathname !== "/") return DEFAULT_BROKER_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_BROKER_ORIGIN;
  }
}

/**
 * The renderer's Content-Security-Policy.
 *
 * WebRTC media is not covered by `connect-src`; that directive is for the SDP
 * exchange with the broker. In development the dev-server proxy keeps those
 * requests same-origin, so `'self'` already covers them.
 *
 * @param {string} brokerOrigin
 */
export function contentSecurityPolicy(brokerOrigin) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    // The agent's audio arrives as a MediaStream on the peer connection.
    "media-src 'self' blob: mediastream:",
    `connect-src 'self' ${brokerOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join("; ");
}
