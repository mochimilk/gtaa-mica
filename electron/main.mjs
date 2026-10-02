import { app, BrowserWindow, dialog, net, protocol, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
        headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'");
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
