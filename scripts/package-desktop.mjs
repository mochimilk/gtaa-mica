import { packager } from '@electron/packager';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const platform = process.platform;
const arch = process.arch;
if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') throw new Error('Unsupported desktop platform.');
if (arch !== 'arm64' && arch !== 'x64') throw new Error('This prototype supports arm64 and x64 hosts.');
const staging = await mkdtemp(path.join(os.tmpdir(), 'gtaa-mica-package-'));
try {
  await cp(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
  await cp(path.join(root, 'electron'), path.join(staging, 'electron'), { recursive: true });
  // The broker's session and interpreter code, which the app runs on a key from Settings → API (electron/appVoice.mjs).
  for (const file of ['live-session.mjs', 'interpret.mjs']) {
    await cp(path.join(root, 'server', file), path.join(staging, 'server', file));
  }
  await writeFile(path.join(staging, 'package.json'), JSON.stringify({
    name: manifest.name, productName: 'GTAA Mica', version: manifest.version,
    type: 'module', main: 'electron/main.mjs',
  }));
  const outputs = await packager({
    dir: staging, name: 'GTAA Mica', appBundleId: 'local.gtaa.mica',
    electronVersion: manifest.devDependencies.electron,
    platform, arch,
    out: path.join(root, 'desktop-out'), asar: true, overwrite: true,
  });
  console.log('Unsigned local prototype:', outputs.join('\n'));
} finally { await rm(staging, { recursive: true, force: true }); }
