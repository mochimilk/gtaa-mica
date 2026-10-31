// The page's bridge to the Windows app, as electron/preload.cjs is Electron's.
// MainWindow injects it before any of the page's own scripts, filling in the
// backdrop and the menus. Every call is a message on WebView2's channel, and
// the app checks each one again (Bridge/PageBridge.cs). Positions go in CSS
// pixels with devicePixelRatio, which counts the page's zoom, so the app can
// place them on screen however the page is zoomed.
//
//   window.micaDesktop: the window's backdrop, its menus (opened as native
//     menus under the page's title bar buttons), and where the page's title
//     bar is, so the rest of it drags the window (DesktopTitleBar).
//   window.micaGitHub: signing in to GitHub for updates
//     (src/components/settings/gitHubAccount.ts). Only the login comes back.
(() => {
  const webview = window.chrome && window.chrome.webview;
  if (!webview) return;

  const backdrop = __MICA_BACKDROP__;
  const menus = Object.freeze(__MICA_MENUS__);

  // Marks <html> with the backdrop as soon as the parser creates it, before
  // the page paints, as preload.cjs does.
  if (backdrop) {
    new MutationObserver((_records, observer) => {
      if (!document.documentElement) return;
      document.documentElement.dataset.backdrop = backdrop;
      observer.disconnect();
    }).observe(document, { childList: true });
  }

  let sequence = 0;
  const waiting = new Map();
  webview.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "reply") {
      const call = waiting.get(message.id);
      if (!call) return;
      waiting.delete(message.id);
      if (message.error) call.reject(new Error(message.error));
      else call.resolve(message.result ?? null);
    } else if (message.type === "open-settings" && typeof message.page === "string") {
      // The app asks for a Settings page (Help → Check for updates, signed out).
      window.dispatchEvent(new CustomEvent("mica:open-settings", { detail: message.page }));
    }
  });

  /** A call the app answers. */
  const call = (method, args) =>
    new Promise((resolve, reject) => {
      sequence += 1;
      waiting.set(sequence, { resolve, reject });
      webview.postMessage({ id: sequence, method, args: args ?? null });
    });
  /** A message the app acts on without answering. */
  const tell = (method, args) => webview.postMessage({ id: 0, method, args: args ?? null });

  Object.defineProperty(window, "micaDesktop", {
    value: Object.freeze({
      backdrop: backdrop ?? undefined,
      menus,
      /** Opens a window menu at a point in the page, in CSS pixels; resolves once it closes. */
      openMenu: (name, x, y) => call("window.openMenu", { name, x, y, scale: devicePixelRatio }).then(() => undefined),
      /**
       * Where the page's title bar is, in CSS pixels: its height, and the
       * buttons in it, which stay clickable; the rest drags the window.
       */
      setTitleBar: (height, buttons) => tell("window.setTitleBar", { height, buttons, scale: devicePixelRatio }),
    }),
  });

  Object.defineProperty(window, "micaGitHub", {
    value: Object.freeze({
      account: () => call("github.account"),
      startSignIn: () => call("github.startSignIn"),
      finishSignIn: () => call("github.finishSignIn"),
      cancelSignIn: () => tell("github.cancelSignIn"),
      openVerification: () => tell("github.openVerification"),
      signOut: () => call("github.signOut").then(() => undefined),
    }),
  });
})();
