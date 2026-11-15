import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createRoomEngine, bounded } from './room.js';
const fault = code => Object.assign(new Error(code), { code });

export function createCoactServer(options = {}) {
  if (options.mode != null && !['demo', 'production'].includes(options.mode)) throw new Error('mode must be demo or production.');
  const production = options.mode === 'production';
  if (production && (typeof options.authenticate !== 'function' || typeof options.authorize !== 'function')) throw new Error('Production mode requires authenticate and authorize hooks.');
  const config = {
    ...options,
    port: options.port ?? Number(process.env.PORT || 4174), host: options.host ?? '0.0.0.0',
    mode: production ? 'production' : 'demo', origin: options.origin,
    authenticate: options.authenticate ?? (async () => null), authorize: options.authorize,
    maxPayload: options.maxPayload ?? 128 * 1024, roomTtlMs: options.roomTtlMs ?? 600000,
    lockTtlMs: options.lockTtlMs ?? 15000, journalLimit: options.journalLimit ?? 200,
    maintenanceMs: options.maintenanceMs ?? 1000, heartbeatMs: options.heartbeatMs ?? 30000,
    maxTrackedPaths: options.maxTrackedPaths ?? 10000,
    maxRooms: options.maxRooms ?? 100, maxObjects: options.maxObjects ?? 64, maxPeers: options.maxPeers ?? 64,
    rateLimit: { messagesPerSecond: options.messagesPerSecond ?? 100, burst: 150, connectionsPerIp: 24, maxConnections: 256, ...options.rateLimit },
    journalSink: options.journalSink, onError: options.onError ?? (() => {})
  };
  const maxPendingBytes = options.maxPendingBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes <= 0) throw new RangeError('maxPendingBytes must be a positive safe integer.');
  let pendingBytes = 0;
  const reserveInput = size => {
    if (pendingBytes + size > maxPendingBytes) return null;
    pendingBytes += size;
    return () => { pendingBytes -= size; };
  };
  const rooms = new Map();
  const connections = new Map();
  let totalConnections = 0;
  let stopping = false;
  const server = http.createServer(options.requestHandler || ((_req, res) => res.writeHead(404).end()));
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayload, perMessageDeflate: false });

  function getRoom(name) {
    if (!rooms.has(name)) {
      if (rooms.size >= config.maxRooms) throw fault('room_limit');
      rooms.set(name, createRoomEngine(name, { ...config, reserveInput }));
    }
    return rooms.get(name);
  }
  server.on('upgrade', async (request, socket, head) => {
    const quietError = () => socket.destroy();
    socket.on('error', quietError);
    const ip = request.socket.remoteAddress || 'unknown';
    if (stopping || totalConnections >= config.rateLimit.maxConnections || (connections.get(ip) || 0) >= config.rateLimit.connectionsPerIp) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
    totalConnections++; connections.set(ip, (connections.get(ip) || 0) + 1);
    let reserved = true;
    let joiningRoom = null;
    const release = () => { if (!reserved) return; reserved = false; totalConnections--; connections.set(ip, Math.max(0, (connections.get(ip) || 1) - 1)); if (!connections.get(ip)) connections.delete(ip); };
    socket.once('close', release);
    const timeout = setTimeout(() => socket.destroy(), 6000);
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname !== '/ws') throw fault('not_found');
      const origin = request.headers.origin || '';
      const originAllowed = config.origin ? await bounded(Promise.resolve(config.origin(origin, request))) : (() => {
        try { const parsed = new URL(origin); return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.host; } catch { return false; }
      })();
      if (originAllowed !== true) throw fault('forbidden');
      const user = await bounded(Promise.resolve(config.authenticate(request, url)));
      if (production && !user?.id) throw fault('unauthorized');
      const name = url.searchParams.get('room') || 'demo';
      if (!/^[a-zA-Z0-9_-]{1,48}$/.test(name)) throw fault('invalid_room');
      const engine = getRoom(name);
      const room = engine.room;
      if (room.clients.size + room.pendingJoins >= config.maxPeers) throw fault('room_full');
      room.pendingJoins++; joiningRoom = room;
      if (socket.destroyed || stopping) return;
      const client = { user, request };
      client.role = await engine.authorizeJoin(client);
      if (socket.destroyed || stopping) return;
      wss.handleUpgrade(request, socket, head, ws => {
        clearTimeout(timeout); socket.removeListener('error', quietError);
        const c = engine.addClient(ws, client);
        const helloTimeout = setTimeout(() => { if (!c.joined) ws.close(1008, 'Hello required'); }, 5000);
        ws.on('error', config.onError);
        ws.on('pong', () => { c.alive = true; });
        ws.on('message', (raw, binary) => { engine.receive(c, raw.toString(), binary); });
        ws.on('close', () => { clearTimeout(helloTimeout); release(); engine.disconnect(c); });
      });
    } catch (error) {
      if (!socket.destroyed) socket.end(`HTTP/1.1 ${error.code === 'unauthorized' ? 401 : 403} Forbidden\r\nConnection: close\r\n\r\n`);
      config.onError(error);
    } finally { clearTimeout(timeout); if (joiningRoom) joiningRoom.pendingJoins--; }
  });

  const maintenance = setInterval(() => {
    for (const [name, engine] of rooms) {
      const room = engine.room;
      if (!room.clients.size && !room.pending && !room.pendingJoins && Date.now() - room.updatedAt >= config.roomTtlMs) { rooms.delete(name); continue; }
      if (room.locks.size) engine.expire();
    }
  }, config.maintenanceMs);
  const heartbeat = setInterval(() => {
    for (const engine of rooms.values()) for (const c of engine.room.clients.values()) {
      if (c.alive === false) c.ws.terminate(); else { c.alive = false; c.ws.ping(); }
    }
  }, config.heartbeatMs);
  maintenance.unref(); heartbeat.unref();
  return {
    server, wss,
    get stats() { return { rooms: rooms.size, connections: totalConnections, pendingBytes, unacknowledgedBytes: [...rooms.values()].reduce((sum, engine) => sum + [...engine.room.clients.values()].reduce((n, client) => n + (client.unackedBytes || 0), 0), 0) }; },
    start() { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, () => { server.off('error', reject); resolve({ port: server.address().port }); }); }); },
    async stop() {
      stopping = true; clearInterval(maintenance); clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      server.closeIdleConnections();
      await new Promise(resolve => server.close(resolve));
      await new Promise(resolve => wss.close(resolve));
      rooms.clear();
    }
  };
}
