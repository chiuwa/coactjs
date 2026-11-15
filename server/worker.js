import { DurableObject } from 'cloudflare:workers';
import { createRoomEngine, bytes, bounded } from './room.js';

// Each room is a separate coordinator. These defaults fit a small public demo;
// applications can select another profile after measuring their own workload.
export const WORKER_LIMITS = Object.freeze({
  maxPeers: 16, maxObjects: 32, maxTrackedPaths: 2048, maxLocksPerClient: 8,
  maxPayload: 128 * 1024, maxDocumentBytes: 256 * 1024,
  journalLimit: 50, maxJournalBytes: 32 * 1024, receiptLimit: 16,
  requireDeliveryAck: true, maxInFlightBytes: 256 * 1024, maxInFlightMessages: 512,
  maxPending: 64, cursorIntervalMs: 50, lockTtlMs: 30000, roomTtlMs: 3600000,
  maxOutboundBytesPerSecond: 128 * 1024, outboundBurstBytes: 512 * 1024,
  rateLimit: { messagesPerSecond: 60, burst: 90 }
});

function allowedOrigin(request, options, env) {
  if (options.origin) return options.origin(request.headers.get('Origin') || '', request, env);
  try { const origin = new URL(request.headers.get('Origin')); return ['http:', 'https:'].includes(origin.protocol) && origin.host === new URL(request.url).host; }
  catch { return false; }
}

export function createCoactWorker(options = {}) {
  if (options.mode != null && !['demo', 'production'].includes(options.mode)) throw new Error('mode must be demo or production.');
  if (options.mode === 'production' && (typeof options.authenticate !== 'function' || typeof options.authorize !== 'function')) throw new Error('Production mode requires authenticate and authorize hooks.');
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname !== '/ws') return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
      if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
      const room = url.searchParams.get('room') || 'demo';
      if (!/^[a-zA-Z0-9_-]{1,48}$/.test(room)) return new Response('Invalid room', { status: 400 });
      const allowed = options.allowedRooms || (env.COACT_ALLOWED_ROOMS ? env.COACT_ALLOWED_ROOMS.split(',').map(value => value.trim()) : null);
      if (options.mode !== 'production' && !allowed) return new Response('Configure allowed demo rooms', { status: 503 });
      if (allowed && !allowed.includes(room)) return new Response('Room not allowed', { status: 403 });
      try {
        if (await bounded(Promise.resolve(allowedOrigin(request, options, env))) !== true) return new Response('Forbidden', { status: 403 });
        const limiter = env.COACT_JOIN_LIMITER;
        if (limiter && !(await limiter.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) return new Response('Too many joins', { status: 429 });
        const user = options.authenticate ? await bounded(Promise.resolve(options.authenticate(request, env))) : null;
        if (options.mode === 'production' && !user?.id) return new Response('Unauthorized', { status: 401 });
        if (user && (typeof user.id !== 'string' || !user.id || user.id.length > 128)) return new Response('Invalid identity', { status: 400 });
        if (bytes(user) > 2048) return new Response('Identity too large', { status: 400 });
        if (options.authorize) {
          const decision = await bounded(Promise.resolve(options.authorize({ user, room, action: 'join', message: { type: 'hello' }, request }, env)));
          if (decision !== true && decision?.allowed !== true) return new Response('Forbidden', { status: 403 });
        }
        // Public headers never supply an identity: overwrite it after verification.
        const headers = new Headers(request.headers);
        headers.set('X-Coact-User', encodeURIComponent(JSON.stringify(user)));
        return env[options.binding || 'COACT_ROOMS'].getByName(room).fetch(new Request(request, { headers }));
      } catch (error) { options.onError?.(error); return new Response('Join unavailable', { status: 503 }); }
    }
  };
}

export function createCoactDurableObject(options = {}) {
  if (options.mode != null && !['demo', 'production'].includes(options.mode)) throw new Error('mode must be demo or production.');
  if (options.mode === 'production' && typeof options.authorize !== 'function') throw new Error('Production Durable Objects require authorize.');
  const limits = { ...WORKER_LIMITS, ...options, rateLimit: { ...WORKER_LIMITS.rateLimit, ...options.rateLimit } };
  return class CoactDurableRoom extends DurableObject {
    constructor(ctx, env) {
      super(ctx, env);
      this.engine = null; this.alarmAt = null; this.dirtyClients = new Set(); this.checkpointTimer = null;
      ctx.blockConcurrencyWhile(async () => { this.alarmAt = await ctx.storage.getAlarm(); this.load(); });
    }
    load() {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS coact_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      const entries = new Map(); let size = 0;
      const maxKeys = limits.maxTrackedPaths + 400 + 2 * limits.maxObjects + limits.maxPeers * limits.maxLocksPerClient + limits.journalLimit + 2;
      for (const row of this.ctx.storage.sql.exec('SELECT key, value FROM coact_state LIMIT ?', maxKeys + 1)) {
        size += bytes(row.key) + bytes(row.value);
        if (entries.size >= maxKeys || size > 1024 * 1024) throw new Error('Stored room exceeds the configured profile.');
        entries.set(row.key, JSON.parse(row.value));
      }
      const name = entries.get('meta')?.name || this.ctx.getWebSockets().map(ws => ws.deserializeAttachment()?.room).find(Boolean) || '';
      this.engine = createRoomEngine(name, {
        ...limits,
        authorize: options.authorize ? context => options.authorize(context, this.env) : undefined,
        onError: options.onError || (error => console.error(error)),
        persist: changes => this.ctx.storage.transactionSync(() => {
          for (const [key, value] of changes) {
            if (value === null) this.ctx.storage.sql.exec('DELETE FROM coact_state WHERE key = ?', key);
            else this.ctx.storage.sql.exec('INSERT INTO coact_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
          }
        }),
        onOutboundChange: client => {
          this.dirtyClients.add(client);
          if (!this.checkpointTimer) this.checkpointTimer = setTimeout(() => this.checkpointConnections(), 200);
        },
        onClientChange: (client, state) => {
          if (bytes(state) > 15000) throw new Error('Connection attachment exceeds its budget.');
          client.ws.serializeAttachment(state);
          this.dirtyClients.delete(client);
        }
      });
      this.engine.restore(entries);
      for (const ws of this.ctx.getWebSockets()) {
        if (ws.readyState !== 1) continue;
        const state = ws.deserializeAttachment();
        if (state && !state.detached) this.engine.addClient(ws, state);
      }
    }
    checkpointConnections() {
      clearTimeout(this.checkpointTimer); this.checkpointTimer = null;
      for (const client of this.dirtyClients) if (client.ws.readyState === 1) {
        const state = this.engine.clientState(client);
        if (bytes(state) > 15000) client.ws.close(1013, 'Attachment budget exceeded');
        else client.ws.serializeAttachment(state);
      }
      this.dirtyClients.clear();
    }
    ensure() { if (!this.engine || this.engine.failed) this.load(); return this.engine; }
    async fetch(request) {
      const engine = this.ensure();
      if (engine.room.clients.size >= limits.maxPeers) return new Response('Room full', { status: 429 });
      const name = new URL(request.url).searchParams.get('room') || 'demo';
      if (engine.room.name && engine.room.name !== name) return new Response('Invalid room', { status: 400 });
      engine.room.name = name;
      let user;
      try { user = JSON.parse(decodeURIComponent(request.headers.get('X-Coact-User') || 'null')); }
      catch { return new Response('Invalid identity', { status: 400 }); }
      const pair = new WebSocketPair(); const [clientSocket, serverSocket] = Object.values(pair);
      this.ctx.acceptWebSocket(serverSocket);
      const client = engine.addClient(serverSocket, { user, role: 'viewer' });
      serverSocket.serializeAttachment(engine.clientState(client));
      await this.scheduleAlarm();
      return new Response(null, { status: 101, webSocket: clientSocket });
    }
    async webSocketMessage(ws, message) {
      const engine = this.ensure();
      const client = [...engine.room.clients.values()].find(value => value.ws === ws);
      if (!client) { ws.close(1008, 'Unknown connection'); return; }
      await engine.receive(client, message, typeof message !== 'string');
      await this.scheduleAlarm();
    }
    async webSocketClose(ws) {
      const engine = this.ensure();
      const client = [...engine.room.clients.values()].find(value => value.ws === ws);
      if (client) await engine.disconnect(client);
      else {
        const state = ws.deserializeAttachment();
        if (state?.joined && !engine.room.journal.some(event => event.type === 'presence.left' && event.actor.id === state.id)) await engine.disconnect(engine.addClient(ws, state));
      }
      await this.scheduleAlarm();
    }
    webSocketError(ws) { ws.close(1011, 'WebSocket error'); return this.webSocketClose(ws); }
    async scheduleAlarm() {
      const engine = this.ensure(), clients = [...engine.room.clients.values()];
      const times = [...engine.room.locks.values()].map(lock => lock.expiresAt);
      for (const client of clients) if (!client.joined) times.push(client.helloDeadline);
      if (!clients.length) times.push(engine.room.updatedAt + limits.roomTtlMs);
      const next = times.length ? Math.max(Date.now() + 10, Math.min(...times)) : null;
      if (next === null) { if (this.alarmAt !== null) await this.ctx.storage.deleteAlarm(); this.alarmAt = null; }
      else if (this.alarmAt === null || next < this.alarmAt) { await this.ctx.storage.setAlarm(next); this.alarmAt = next; }
    }
    async alarm() {
      this.alarmAt = null;
      const engine = this.ensure();
      for (const client of [...engine.room.clients.values()]) if (!client.joined && client.helloDeadline <= Date.now()) { client.ws.close(1008, 'Hello required'); await engine.disconnect(client); }
      await engine.expire();
      if (!engine.room.clients.size && Date.now() - engine.room.updatedAt >= limits.roomTtlMs) {
        await this.ctx.storage.deleteAll(); await this.ctx.storage.deleteAlarm(); this.engine = null; return;
      }
      await this.scheduleAlarm();
    }
  };
}
