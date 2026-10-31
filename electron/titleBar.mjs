// The desktop title bar's native half, kept pure so it can be tested without
// launching Electron.
//
// On Windows and Linux the page draws the title bar (DesktopTitleBar): the
// window menus at its start, and the native window controls, which Electron
// draws over its end (the title bar overlay). The page opens the menus through
// preload.cjs, and main.mjs checks every request with menuRequest.

/**
 * The bar's height in DIPs: the app bar's (APP_BAR_HEIGHT), so the window
 * controls run its full height. The page reads it back as
 * env(titlebar-area-height).
 */
export const TITLE_BAR_HEIGHT = 56;

/**
 * The window menus, in the bar's order, by the names the page opens them by.
 * Electron's default Help menu is left out: it only links to Electron's docs.
 * @type {import("electron").MenuItemConstructorOptions[]}
 */
export const WINDOW_MENUS = [
  { id: "file", role: "fileMenu" },
  { id: "edit", role: "editMenu" },
  { id: "view", role: "viewMenu" },
  { id: "window", role: "windowMenu" },
];

/**
 * The window controls' colours: the page's, colorNeutralBackground5 behind
 * colorNeutralForeground1, as the boot splash (index.html) and the bar use
 * them; on a system backdrop (backdrop.mjs), clear, as the bar is. The page's
 * theme follows the system's, so these follow nativeTheme.
 * @param {boolean} dark
 * @param {string} [backdrop]
 */
export function titleBarOverlayColors(dark, backdrop) {
  const symbolColor = dark ? "#ffffff" : "#242424";
  // Clear, the page colour at no alpha: Electron shades the hovered and pressed
  // controls toward its colour's contrast, so it must stay the page's.
  if (backdrop) return { color: dark ? "rgba(0, 0, 0, 0)" : "rgba(235, 235, 235, 0)", symbolColor };
  return { color: dark ? "#000000" : "#ebebeb", symbolColor };
}

/**
 * The menu the page asked to open and where, in whole DIPs from the page's top
 * left, or undefined for anything else.
 * @param {unknown} input
 */
export function menuRequest(input) {
  if (typeof input !== "object" || input === null) return undefined;
  const { name, x, y } = /** @type {Record<string, unknown>} */ (input);
  if (typeof name !== "string" || !WINDOW_MENUS.some((menu) => menu.id === name)) return undefined;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return undefined;
  return { name, x: Math.round(x), y: Math.round(y) };
}
