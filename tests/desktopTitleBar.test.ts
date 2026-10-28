// The desktop title bar's native half, tested without launching Electron.
import assert from "node:assert/strict";
import test from "node:test";
import { WINDOW_MENUS, menuRequest, titleBarOverlayColors } from "../electron/titleBar.mjs";

test("the bar opens File, Edit, View and Window, in that order", () => {
  assert.deepEqual(
    WINDOW_MENUS.map((menu) => menu.id),
    ["file", "edit", "view", "window"],
  );
});

test("a menu request names a window menu and a point in the page", () => {
  assert.deepEqual(menuRequest({ name: "edit", x: 52.4, y: 31.6 }), { name: "edit", x: 52, y: 32 });
  assert.deepEqual(menuRequest({ name: "file", x: 0, y: 0 }), { name: "file", x: 0, y: 0 });

  // Any other menu, or none, is refused.
  assert.equal(menuRequest({ name: "help", x: 0, y: 0 }), undefined);
  assert.equal(menuRequest({ name: "toString", x: 0, y: 0 }), undefined);
  assert.equal(menuRequest({ x: 0, y: 0 }), undefined);

  // So is a point that isn't one.
  assert.equal(menuRequest({ name: "view", x: "4", y: 0 }), undefined);
  assert.equal(menuRequest({ name: "view", x: Number.NaN, y: 0 }), undefined);
  assert.equal(menuRequest({ name: "view", x: 0, y: Number.POSITIVE_INFINITY }), undefined);
  assert.equal(menuRequest({ name: "view", x: -1, y: 0 }), undefined);

  // And anything that isn't a request at all.
  assert.equal(menuRequest(undefined), undefined);
  assert.equal(menuRequest(null), undefined);
  assert.equal(menuRequest("file"), undefined);
});

test("the window controls take the page's colours in either theme", () => {
  // colorNeutralBackground5 behind colorNeutralForeground1, as in index.html's boot splash.
  assert.deepEqual(titleBarOverlayColors(false), { color: "#ebebeb", symbolColor: "#242424" });
  assert.deepEqual(titleBarOverlayColors(true), { color: "#000000", symbolColor: "#ffffff" });
});
