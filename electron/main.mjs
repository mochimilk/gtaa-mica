import { app, BrowserWindow, dialog, net, protocol, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  allowPermissionCheck,
  allowPermissionRequest,
  contentSecurityPolicy,
  resolveBrokerOrigin,
} from './permissionPolicy.mjs';

// No preload or IPC: the current UI needs no native privileges.
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

async function createWindow() {
  const window = new BrowserWindow({
    title: 'GTAA Mica', width: 1440, height: 960, minWidth: 900, minHeight: 640,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
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
