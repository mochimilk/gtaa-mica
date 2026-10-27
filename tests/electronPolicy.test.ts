// Desktop permission policy, tested without launching Electron.
import assert from "node:assert/strict";
import test from "node:test";
import {
  allowPermissionCheck,
  allowPermissionRequest,
  contentSecurityPolicy,
  DEFAULT_BROKER_ORIGIN,
  isAppOrigin,
  resolveBrokerOrigin,
} from "../electron/permissionPolicy.mjs";

const PACKAGED_URL = "mica://app/index.html";
const DEV_ORIGIN = "http://127.0.0.1:5173";

test("the packaged app's own URL is recognised despite the custom scheme", () => {
  // `new URL("mica://app/index.html").origin` is the string "null", so an
  // origin comparison would reject the packaged app's own microphone request.
  assert.equal(new URL(PACKAGED_URL).origin, "null");
  assert.equal(isAppOrigin(PACKAGED_URL, undefined), true);
  assert.equal(isAppOrigin("mica://app", undefined), true);

  // Another host on the same scheme is not this app.
  assert.equal(isAppOrigin("mica://evil/index.html", undefined), false);
  assert.equal(isAppOrigin("https://example.com", undefined), false);
  assert.equal(isAppOrigin("", undefined), false);
  assert.equal(isAppOrigin(undefined, undefined), false);
  assert.equal(isAppOrigin("not a url", undefined), false);

  // In development only the launcher's loopback origin counts.
  assert.equal(isAppOrigin(`${DEV_ORIGIN}/index.html`, DEV_ORIGIN), true);
  assert.equal(isAppOrigin("http://127.0.0.1:9999/", DEV_ORIGIN), false);
  // The packaged scheme is not trusted while running from the dev server.
  assert.equal(isAppOrigin(PACKAGED_URL, DEV_ORIGIN), false);
});

test("packaged microphone requests are allowed, video is not", () => {
  const request = (mediaTypes: string[] | undefined, requestingUrl = PACKAGED_URL, permission = "media") =>
    allowPermissionRequest({ permission, requestingUrl, mediaTypes, devOrigin: undefined });

  assert.equal(request(["audio"]), true);

  // Video, or audio plus video, is refused outright rather than downgraded.
  assert.equal(request(["video"]), false);
  assert.equal(request(["audio", "video"]), false);
  // An empty or missing list is not an audio request.
  assert.equal(request([]), false);
  assert.equal(request(undefined), false);

  // A foreign origin never gets the microphone.
  assert.equal(request(["audio"], "https://example.com/page"), false);
  assert.equal(request(["audio"], "mica://evil/index.html"), false);

  // Every other permission stays denied, exactly as before voice existed.
  for (const permission of ["geolocation", "notifications", "midi", "hid", "openExternal", "display-capture"]) {
    assert.equal(request(["audio"], PACKAGED_URL, permission), false, `${permission} must stay denied`);
  }
});

test("development microphone requests follow the launcher origin", () => {
  assert.equal(
    allowPermissionRequest({
      permission: "media",
      requestingUrl: `${DEV_ORIGIN}/`,
      mediaTypes: ["audio"],
      devOrigin: DEV_ORIGIN,
    }),
    true,
  );
  assert.equal(
    allowPermissionRequest({
      permission: "media",
      requestingUrl: "http://localhost:5173/",
      mediaTypes: ["audio"],
      devOrigin: DEV_ORIGIN,
    }),
    false,
  );
});

test("a permission check trusts the supplied origin, not the window URL", () => {
  // When Chromium supplies a requesting origin it is authoritative. Falling
  // back to the window's own URL would let an untrusted origin inherit the
  // app's microphone permission.
  assert.equal(
    allowPermissionCheck({
      permission: "media",
      requestingOrigin: "https://example.com",
      contentsUrl: PACKAGED_URL,
      mediaType: "audio",
      devOrigin: undefined,
    }),
    false,
  );

  assert.equal(
    allowPermissionCheck({
      permission: "media",
      requestingOrigin: "mica://app",
      contentsUrl: PACKAGED_URL,
      mediaType: "audio",
      devOrigin: undefined,
    }),
    true,
  );

  // With no origin supplied, the window URL is the only thing to go on.
  assert.equal(
    allowPermissionCheck({
      permission: "media",
      requestingOrigin: undefined,
      contentsUrl: PACKAGED_URL,
      mediaType: "audio",
      devOrigin: undefined,
    }),
    true,
  );

  // Audio only, and media only.
  assert.equal(
    allowPermissionCheck({
      permission: "media",
      requestingOrigin: "mica://app",
      contentsUrl: PACKAGED_URL,
      mediaType: "video",
      devOrigin: undefined,
    }),
    false,
  );
  assert.equal(
    allowPermissionCheck({
      permission: "geolocation",
      requestingOrigin: "mica://app",
      contentsUrl: PACKAGED_URL,
      mediaType: "audio",
      devOrigin: undefined,
    }),
    false,
  );
});

test("only loopback http origins reach the packaged CSP", () => {
  assert.equal(resolveBrokerOrigin(undefined), DEFAULT_BROKER_ORIGIN);
  assert.equal(resolveBrokerOrigin("  "), DEFAULT_BROKER_ORIGIN);
  assert.equal(resolveBrokerOrigin("http://127.0.0.1:9000"), "http://127.0.0.1:9000");
  assert.equal(resolveBrokerOrigin("http://localhost:8080/"), "http://localhost:8080");

  // A remote or non-http backend is a deployment decision, never a default.
  for (const rejected of [
    "https://api.example.com",
    "http://example.com",
    "http://10.0.0.5:8787",
    "file:///etc/passwd",
    "not a url",
    "http://127.0.0.1:8787/path",
  ]) {
    assert.equal(resolveBrokerOrigin(rejected), DEFAULT_BROKER_ORIGIN, `${rejected} must not be used`);
  }
});

test("the CSP keeps its restrictions and adds only what voice needs", () => {
  const csp = contentSecurityPolicy(DEFAULT_BROKER_ORIGIN);

  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("script-src 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("base-uri 'none'"));
  assert.ok(csp.includes("frame-src 'none'"));

  // The SDP exchange and the agent's audio.
  assert.ok(csp.includes(`connect-src 'self' ${DEFAULT_BROKER_ORIGIN}`));
  assert.ok(csp.includes("media-src 'self' blob: mediastream:"));

  // No wildcards or inline script crept in.
  assert.equal(csp.includes("*"), false);
  assert.equal(csp.includes("'unsafe-eval'"), false);
  assert.equal(csp.includes("script-src 'self' 'unsafe-inline'"), false);
});
