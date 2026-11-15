import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoactServer as createServer } from './server/index.js';
import { staticFiles } from './server/static.js';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const requestHandler = staticFiles({ '/': path.join(ROOT, 'demo'), '/demo/': path.join(ROOT, 'demo'), '/src/': path.join(ROOT, 'src'), '/assets/': path.join(ROOT, 'assets'), '/vendor/': path.join(ROOT, 'vendor') });
export function createCoactServer(options = {}) { return createServer({ requestHandler, ...options }); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createCoactServer();
  const { port } = await app.start();
  console.log(`Coact.js demo: http://localhost:${port}`);
  for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) console.log(`Network: http://${entry.address}:${port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.stop(); process.exit(0); });
}
