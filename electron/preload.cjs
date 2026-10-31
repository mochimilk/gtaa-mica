// The page's only bridge to the desktop shell: opening a window menu from the
// title bar it draws (titleBar.mjs), pasting from its own right-click menu,
// the window's system backdrop (backdrop.mjs), and Skye's key from Settings →
// API (appVoice.mjs). main.mjs checks every request again.
// Sandboxed preloads run as CommonJS, hence .cjs.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

// backdrop.mjs's BACKDROP_ARGUMENT; a sandboxed preload can't import it.
const BACKDROP_ARGUMENT = "--mica-backdrop=";
const backdrop = process.argv.some((arg) => arg === `${BACKDROP_ARGUMENT}mica`) ? "mica" : undefined;

// Marks <html> with the backdrop as soon as the parser creates it, before the
// page paints, so its styles (the boot splash's included) leave the page
// colour clear. The element doesn't exist yet while this runs.
if (backdrop) {
  new MutationObserver((_records, observer) => {
    if (!document.documentElement) return;
    document.documentElement.dataset.backdrop = backdrop;
    observer.disconnect();
  }).observe(document, { childList: true });
}

// main.mjs's customTitleBar: macOS keeps its own title bar, so there the page
// has no title bar to draw, and the shell's Paste isn't wired.
if (process.platform !== "darwin") contextBridge.exposeInMainWorld("micaDesktop", {
  /** The window's system backdrop, which shows wherever the page is clear. */
  backdrop,
  /**
   * Opens a window menu at a point in the page, in CSS pixels; resolves once
   * it closes.
   * @param {string} name
   * @param {number} x
   * @param {number} y
   * @returns {Promise<void>}
   */
  openMenu: async (name, x, y) => {
    // The menu is placed in DIPs, and the page's CSS pixels scale with its zoom.
    const zoom = webFrame.getZoomFactor();
    await ipcRenderer.invoke("mica:open-menu", { name, x: x * zoom, y: y * zoom });
  },
  /**
   * Pastes the clipboard where the page's focus is, as Ctrl+V does. The page
   * can't read the clipboard itself (permissionPolicy.mjs), so its
   * right-click menu's Paste comes here.
   * @returns {Promise<void>}
   */
  paste: () => ipcRenderer.invoke("mica:paste"),
});

contextBridge.exposeInMainWorld("micaVoice", {
  /**
   * Gives this window the user's key, until it reloads or closes; false when
   * it isn't shaped like one. There is no way to read it back.
   * @param {string} provider
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  setApiKey: (provider, key) => ipcRenderer.invoke("mica:voice-set-key", provider, key),
  /**
   * This window's key as the page may see it: its provider and masked form.
   * @returns {Promise<{ provider: string, hint: string } | null>}
   */
  describeApiKey: () => ipcRenderer.invoke("mica:voice-describe-key"),
  /** @returns {Promise<void>} */
  forgetApiKey: () => ipcRenderer.invoke("mica:voice-forget-key"),
  /**
   * One of the voice broker's routes, answered with this window's key; null
   * when it has none.
   * @param {string} id
   * @param {string} route
   * @param {string | undefined} body
   * @returns {Promise<{ status: number, body: unknown } | null>}
   */
  request: (id, route, body) => ipcRenderer.invoke("mica:voice-request", { id, route, body }),
  /** @param {string} id */
  abort: (id) => ipcRenderer.send("mica:voice-abort", id),
});
