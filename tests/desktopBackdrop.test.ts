// The window's system backdrop, tested without launching Electron.
import assert from "node:assert/strict";
import test from "node:test";
import { windowBackdrop } from "../electron/backdrop.mjs";

test("Windows 11 22H2 and later take Mica", () => {
  assert.equal(windowBackdrop("win32", "10.0.22621"), "mica");
  assert.equal(windowBackdrop("win32", "10.0.26100"), "mica");
});

test("MICA_DESKTOP_BACKDROP=none turns Mica off, so the page paints its own colour", () => {
  assert.equal(windowBackdrop("win32", "10.0.26100", "none"), undefined);
  assert.equal(windowBackdrop("win32", "10.0.26100", " None "), undefined);
  assert.equal(windowBackdrop("win32", "10.0.26100", ""), "mica");
  assert.equal(windowBackdrop("win32", "10.0.26100", "mica"), "mica");
});

test("older Windows and other platforms paint the page colour", () => {
  // Windows 11 21H2 and Windows 10 have no system backdrop to ask for.
  assert.equal(windowBackdrop("win32", "10.0.22000"), undefined);
  assert.equal(windowBackdrop("win32", "10.0.19045"), undefined);
  assert.equal(windowBackdrop("win32", "unexpected"), undefined);
  assert.equal(windowBackdrop("darwin", "24.0.0"), undefined);
  assert.equal(windowBackdrop("linux", "6.8.0-generic"), undefined);
});
