// Renders the desktop window's icons from the site's logo (public/norvara.svg):
// white for a dark system theme, black for a light one (electron/main.mjs
// picks between them). Electron draws the SVG, as it can't take one as an
// icon itself. Run again whenever the logo changes: npm run icons:desktop
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const SIZE = 256;
/** The logo's paths take their fill from here, white unless set. */
const LOGO_FILL = 'var(--logo-fill, white)';
const ICONS = { 'norvara-white.png': 'white', 'norvara-black.png': 'black' };

app.whenReady().then(async () => {
  const svg = await readFile(path.join(root, 'public', 'norvara.svg'), 'utf8');
  if (!svg.includes(LOGO_FILL)) throw new Error(`public/norvara.svg no longer sets its fill with ${LOGO_FILL}.`);
  const out = path.join(root, 'electron', 'icons');
  await mkdir(out, { recursive: true });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await window.loadURL('about:blank');
  for (const [name, fill] of Object.entries(ICONS)) {
    const source = svg.replace(LOGO_FILL, fill);
    const png = await window.webContents.executeJavaScript(`(async () => {
      const url = URL.createObjectURL(new Blob([${JSON.stringify(source)}], { type: 'image/svg+xml' }));
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ${SIZE};
      canvas.getContext('2d').drawImage(image, 0, 0, ${SIZE}, ${SIZE});
      URL.revokeObjectURL(url);
      return canvas.toDataURL('image/png');
    })()`);
    await writeFile(path.join(out, name), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
    console.log(`electron/icons/${name}`);
  }
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
