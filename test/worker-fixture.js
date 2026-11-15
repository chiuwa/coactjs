// This fixture is not published. It exposes deterministic reload and counters
// solely to verify that connections and state survive losing the engine cache.
import { createCoactWorker, createCoactDurableObject } from '../server/worker.js';
const options = { mode: 'demo', allowedRooms: ['demo'] };
const Base = createCoactDurableObject(options);
export class CoactRoom extends Base {
  reloadForTest() { this.checkpointConnections(); this.engine = null; this.ensure(); return { revision: this.engine.room.revision, peers: this.engine.room.clients.size }; }
  metricsForTest() {
    const engine = this.ensure();
    return { revision: engine.room.revision, peers: engine.room.clients.size, documentBytes: engine.room.documentBytes, journalBytes: engine.room.journalBytes,
      stateRows: [...this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM coact_state')][0].n,
      writes: [...this.ctx.storage.sql.exec('SELECT total_changes() AS n')][0].n,
      maxAttachmentBytes: Math.max(0, ...this.ctx.getWebSockets().map(ws => new TextEncoder().encode(JSON.stringify(ws.deserializeAttachment())).byteLength)) };
  }
}
// Deliberately simple identity stub, only for local authorization tests.
const privateOptions = { mode: 'production', allowedRooms: ['demo'], binding: 'PRIVATE_ROOMS', authenticate: request => { const id = new URL(request.url).searchParams.get('user'); return id ? { id } : null; }, authorize: ({ user }) => ({ allowed: true, role: user?.id === 'viewer' ? 'viewer' : user?.id === 'owner' ? 'owner' : 'editor' }) };
export const PrivateRoom = createCoactDurableObject(privateOptions);
const privateWorker = createCoactWorker(privateOptions);
const worker = createCoactWorker(options);
export default { fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/private/')) { const url = new URL(request.url); url.pathname = path.slice('/private'.length); return privateWorker.fetch(new Request(url, request), env); }
  if (path === '/__test/reload') return env.COACT_ROOMS.getByName('demo').reloadForTest().then(value => Response.json(value));
  if (path === '/__test/metrics') return env.COACT_ROOMS.getByName('demo').metricsForTest().then(value => Response.json(value));
  return worker.fetch(request, env);
} };
