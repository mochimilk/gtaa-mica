// The page's only bridge to the desktop shell: opening a window menu from the
// title bar it draws (titleBar.mjs). main.mjs checks every request again.
// Sandboxed preloads run as CommonJS, hence .cjs.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("micaDesktop", {
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
});
