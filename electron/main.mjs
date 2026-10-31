import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, session } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAppVoice } from './appVoice.mjs';
import { BACKDROP_ARGUMENT, windowBackdrop } from './backdrop.mjs';
import {
  allowPermissionCheck,
  allowPermissionRequest,
  contentSecurityPolicy,
  resolveBrokerOrigin,
} from './permissionPolicy.mjs';
import { TITLE_BAR_HEIGHT, WINDOW_MENUS, menuRequest, titleBarOverlayColors } from './titleBar.mjs';

// The only preload and IPC are the title bar's, the right-click menu's Paste,
// Skye's key from Settings → API (and the backdrop's argument); the UI needs
// no other native privileges.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mica', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.setName('GTAA Mica');
const devArgument = process.argv.find((arg) => arg.startsWith('--mica-dev-url='));
const devUrl = !app.isPackaged && devArgument ? devArgument.slice('--mica-dev-url='.length) : undefined;
if (devUrl) {
  const url = new URL(devUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password) {
    throw new Error('Desktop development requires the launcher-owned loopback Vite URL.');
  }
}
const startUrl = devUrl ?? 'mica://app/index.html';
const origin = new URL(startUrl).origin;
const isAppUrl = (/** @type {string} */ value) => {
  try {
    const url = new URL(value);
    return devUrl ? url.origin === origin : url.protocol === 'mica:' && url.host === 'app';
  } catch { return false; }
};

/*
 * Voice. Mica's renderer never holds an API key: it posts its WebRTC offer to
 * the loopback broker (server/micaLiveServer.mjs), which calls GPT-Live with
 * the server-side key. So the only privileges added here are the microphone
 * and the network reach needed for that exchange.
 *
 * Or, once the user gives a window their own key in Settings → API, this
 * process answers the broker's routes for it instead (appVoice.mjs), keeping
 * the key in memory for that window only and forgetting it when the window
 * reloads or closes. The page hands it over and can't read it back.
 *
 * In development the Vite dev server proxies /api/live to the broker, so
 * requests are same-origin and 'self' already covers them. A packaged build
 * has no proxy and must be built with VITE_MICA_API_BASE_URL, so the matching
 * origin is added to connect-src. The decisions themselves live in
 * permissionPolicy.mjs so they can be tested without Electron.
 */
const brokerOrigin = resolveBrokerOrigin(process.env.MICA_LIVE_BACKEND_ORIGIN);
const renderCsp = contentSecurityPolicy(brokerOrigin);
/** Undefined when packaged, which selects the mica://app policy. */
const devOrigin = devUrl ? new URL(devUrl).origin : undefined;
const appVoice = createAppVoice();

/*
 * Title bar. On Windows and Linux the page draws it, the page's colour: the
 * window menus at its start, the native window controls over its end (the
 * title bar overlay), and no title, which the app shows itself. macOS keeps
 * its own title bar and the system menu bar. The page only opens the menus,
 * through preload.cjs; the controls' colours follow the system theme here,
 * as the page's own theme does.
 */
const customTitleBar = process.platform !== 'darwin';
/*
 * Backdrop. On Windows 11 the window's base layer is Mica (backdrop.mjs), so
 * the window paints nothing of its own and the title bar overlay is clear. The
 * preload tells the page, which then leaves its page colour to Mica too.
 */
const backdrop = windowBackdrop(process.platform, os.release(), process.env.MICA_DESKTOP_BACKDROP);
/*
 * Icon. The site's logo (public/norvara.svg, drawn by scripts/desktop-icons.mjs):
 * white on a dark system theme, black on a light one, so it shows on the
 * taskbar or dock either way. It follows the theme as it changes.
 */
const appIcon = () => nativeImage.createFromPath(
  path.join(app.getAppPath(), 'electron', 'icons', nativeTheme.shouldUseDarkColors ? 'norvara-white.png' : 'norvara-black.png'),
);

async function createWindow() {
  const window = new BrowserWindow({
    title: 'GTAA Mica', width: 1440, height: 960, minWidth: 900, minHeight: 640,
    icon: appIcon(),
    show: false,
    ...(backdrop && { backgroundMaterial: backdrop, backgroundColor: '#00000000' }),
    ...(customTitleBar && {
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...titleBarOverlayColors(nativeTheme.shouldUseDarkColors, backdrop), height: TITLE_BAR_HEIGHT },
    }),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
      ...(backdrop && { additionalArguments: [`${BACKDROP_ARGUMENT}${backdrop}`] }),
    },
  });
  if (customTitleBar) {
    const recolor = () => {
      window.setTitleBarOverlay(titleBarOverlayColors(nativeTheme.shouldUseDarkColors, backdrop));
      window.setIcon(appIcon());
    };
    nativeTheme.on('updated', recolor);
    window.once('closed', () => nativeTheme.off('updated', recolor));
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  // A key from Settings → API lasts as long as the page it was given to.
  const contentsId = window.webContents.id;
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) appVoice.forget(contentsId);
  });
  window.webContents.on('render-process-gone', () => appVoice.forget(contentsId));
  window.webContents.once('destroyed', () => appVoice.forget(contentsId));
  window.once('ready-to-show', () => window.show());
  await window.loadURL(startUrl);
}

app.whenReady().then(async () => {
  /*
   * Everything stays denied except the microphone, and only for this app's own
   * origin. Camera, screen capture, geolocation, notifications, MIDI, HID and
   * the rest are refused exactly as before; sandboxing, context isolation and
   * disabled Node integration are untouched.
   */
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      allowPermissionRequest({
        permission,
        requestingUrl: details?.requestingUrl ?? contents?.getURL(),
        mediaTypes: details?.mediaTypes,
        devOrigin,
      }),
    ),
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    allowPermissionCheck({
      permission,
      requestingOrigin,
      contentsUrl: contents?.getURL(),
      mediaType: details?.mediaType,
      devOrigin,
    }),
  );
  // getDisplayMedia is never part of Mica; deny it explicitly.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  // macOS takes its icon from the dock, not the window.
  if (process.platform === 'darwin') {
    const redock = () => app.dock?.setIcon(appIcon());
    redock();
    nativeTheme.on('updated', redock);
  }
  // Skye's key from Settings → API, and the voice routes answered with it
  // (appVoice.mjs), each for the window that asks. Nothing hands the key back,
  // only its masked form.
  const fromApp = (/** @type {Electron.IpcMainInvokeEvent | Electron.IpcMainEvent} */ event) =>
    isAppUrl(event.senderFrame?.url ?? '');
  ipcMain.handle('mica:voice-set-key', (event, provider, key) =>
    fromApp(event) && appVoice.setKey(event.sender.id, provider, key));
  ipcMain.handle('mica:voice-describe-key', (event) => (fromApp(event) ? appVoice.describeKey(event.sender.id) : null));
  ipcMain.handle('mica:voice-forget-key', (event) => { if (fromApp(event)) appVoice.forget(event.sender.id); });
  ipcMain.handle('mica:voice-request', (event, input) =>
    fromApp(event) ? appVoice.request(event.sender.id, input?.id, input?.route, input?.body) : null);
  ipcMain.on('mica:voice-abort', (event, requestId) => { if (fromApp(event)) appVoice.abort(event.sender.id, requestId); });
  if (customTitleBar) {
    // Also the application menu, unshown, so its shortcuts (Ctrl+R, Ctrl+Shift+I, zoom…) keep working.
    const menu = Menu.buildFromTemplate(WINDOW_MENUS);
    Menu.setApplicationMenu(menu);
    // Opens a menu under its title-bar button, resolving once it closes.
    ipcMain.handle('mica:open-menu', (event, input) => {
      const request = menuRequest(input);
      const submenu = request && menu.getMenuItemById(request.name)?.submenu;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!request || !submenu || !window || !isAppUrl(event.senderFrame?.url ?? '')) return;
      return new Promise((resolve) => submenu.popup({ window, x: request.x, y: request.y, callback: () => resolve(undefined) }));
    });
    // The page's right-click Paste (DefaultContextMenu), as Edit's Paste does;
    // it comes through the preload, so only where the title bar's does.
    ipcMain.handle('mica:paste', (event) => {
      if (isAppUrl(event.senderFrame?.url ?? '')) event.sender.paste();
    });
  }
  if (!devUrl) {
    const root = path.join(app.getAppPath(), 'dist');
    protocol.handle('mica', async (request) => {
      const url = new URL(request.url);
      if (url.host !== 'app' || request.method !== 'GET') return new Response(null, { status: 403 });
      let filename;
      try { filename = path.resolve(root, `.${decodeURIComponent(url.pathname)}`); }
      catch { return new Response(null, { status: 400 }); }
      const relative = path.relative(root, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response(null, { status: 403 });
      try {
        const response = await net.fetch(pathToFileURL(filename).href);
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', renderCsp);
        return new Response(response.body, { status: response.status, headers });
      } catch { return new Response(null, { status: 404 }); }
    });
  }
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error) => {
  dialog.showErrorBox('GTAA Mica could not start', String(error));
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
