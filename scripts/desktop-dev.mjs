import { createServer } from 'vite';
import electron from 'electron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Start our own Vite instance and use its actual bound address, never probe an
// arbitrary occupied port. Existing browser development servers stay running.
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5180, strictPort: false, open: false } });
await server.listen();
const address = server.httpServer?.address();
if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port.');
const url = `http://127.0.0.1:${address.port}/`;
const response = await fetch(url);
if (!response.ok) { await server.close(); throw new Error('Vite readiness check failed.'); }
console.log(`GTAA Mica desktop renderer (also available in a browser): ${url}`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// In Node, Electron's package exports its executable path (its declarations describe the runtime API).
const executable = /** @type {string} */ (/** @type {unknown} */ (electron));
const child = spawn(executable, [root, `--mica-dev-url=${url}`], { cwd: root, env, stdio: 'inherit' });
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', (code) => void stop(code ?? 0));
child.on('error', (error) => { console.error(error); void stop(1); });
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
