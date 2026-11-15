import { validateMessage, mutationScope, touches, MAX_CELLS, REQUEST_PATTERN } from '../src/protocol.js';

const encoder = new TextEncoder();
export const bytes = value => encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
const NAMES = [['Rose Fox', 'RF'], ['Pink Otter', 'PO'], ['Coral Finch', 'CF'], ['Mauve Hare', 'MH'], ['Peach Moth', 'PM'], ['Berry Kite', 'BK'], ['Sage Wren', 'SW'], ['Clay Finch', 'CL'], ['Paper Crane', 'PC']];
const clone = value => structuredClone(value);
const fault = (code, current = {}) => Object.assign(new Error(code), { code, current });
const cleanName = value => String(value || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
const publicPeer = c => ({ id: c.id, userId: c.user?.id || null, name: c.name, badge: c.badge, color: c.color, role: c.role, x: c.x, y: c.y, down: c.down });
const actorOf = c => ({ id: c.id, userId: c.user?.id || null, name: c.name, badge: c.badge, color: c.color, role: c.role });

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function colorFor(index) {
  return `hsl(${Math.round(index * 137.508) % 360} ${22 + index % 3 * 3}% ${40 + index % 2 * 4}%)`;
}

function geometry(input = {}, fallback = {}, frame = false) {
  const bounds = frame ? { x: [0.01, 0.94, 0.2], y: [0.01, 0.92, 0.1], w: [0.1, 0.72, 0.28], h: [0.1, 0.68, 0.3] } : { x: [0.01, 0.94, 0.2], y: [0.01, 0.92, 0.1], w: [0.18, 0.86, 0.36], h: [0.16, 0.82, 0.42] };
  return Object.fromEntries(Object.entries(bounds).map(([key, [min, max, initial]]) => [key, Math.min(max, Math.max(min, input[key] ?? fallback[key] ?? initial))]));
}

function imageSeed(prompt) {
  let value = 2166136261;
  for (let i = 0; i < prompt.length; i++) value = Math.imul(value ^ prompt.charCodeAt(i), 16777619);
  return value >>> 0;
}

function snapshot(room) {
  return clone({ windows: Object.fromEntries(room.windows), frames: Object.fromEntries(room.frames), sheet: room.sheet, locks: publicLocks(room), revision: room.revision });
}

function publicLocks(room) {
  return Object.fromEntries([...room.locks].map(([key, { token, ...lock }]) => [key, { ...lock }]));
}

export async function bounded(promise, ms = 5000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(fault('authorization_timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}


export function createRoomEngine(name, options = {}) {
  const config = {
    maxPayload: 128 * 1024, maxDocumentBytes: 512 * 1024, maxJournalBytes: 64 * 1024,
    maxObjects: 64, maxTrackedPaths: 10000, maxLocksPerClient: 16, maxPeers: 64,
    journalLimit: 200, receiptLimit: 256, maxPending: 128,
    lockTtlMs: 15000, roomTtlMs: 600000, cursorIntervalMs: 50,
    requireDeliveryAck: false, maxInFlightBytes: 1024 * 1024, maxInFlightMessages: 1024,
    maxOutboundBytesPerSecond: 256 * 1024, outboundBurstBytes: 1024 * 1024,
    rateLimit: { messagesPerSecond: 100, burst: 150 },
    onError: () => {}, ...options
  };
  for (const key of ['maxPayload','maxDocumentBytes','maxPending','maxPeers','maxInFlightBytes','maxInFlightMessages','lockTtlMs','roomTtlMs','maxOutboundBytesPerSecond','outboundBurstBytes']) if (!Number.isSafeInteger(config[key]) || config[key] <= 0) throw new RangeError(`${key} must be a positive safe integer.`);
  for (const key of ['maxObjects','maxTrackedPaths','maxLocksPerClient','maxJournalBytes','journalLimit','receiptLimit','cursorIntervalMs']) if (!Number.isSafeInteger(config[key]) || config[key] < 0) throw new RangeError(`${key} must be a non-negative safe integer.`);
  if (!Number.isFinite(config.rateLimit.messagesPerSecond) || config.rateLimit.messagesPerSecond <= 0 || !Number.isSafeInteger(config.rateLimit.burst) || config.rateLimit.burst < 1) throw new RangeError('Invalid message rate limit.');
  const room = { name, clients: new Map(), windows: new Map(), frames: new Map(), sheet: { cells: {}, selections: {} }, locks: new Map(), revisions: new Map(), revision: 0, journal: [], journalBytes: 0, documentBytes: 0, seq: 0, zTop: 10, joinIndex: 0, initialized: false, pendingJoins: 0, updatedAt: Date.now(), tasks: Promise.resolve(), pending: 0 };
  const documentSizes = new Map();
  const connections = new WeakMap();
  let changes = new Map(), outbox = null, failed = false;
  const record = (key, value) => { if (config.persist) changes.set(key, value); };
  function saveMeta() {
    record('meta', Object.fromEntries(['name', 'revision', 'seq', 'zTop', 'joinIndex', 'initialized', 'updatedAt'].map(key => [key, room[key]])));
  }
  function storeDocument(key, value) {
    const size = value === null ? 0 : bytes(key) + bytes(JSON.stringify(value)) + 2;
    const total = room.documentBytes - (documentSizes.get(key) || 0) + size;
    if (total > config.maxDocumentBytes) throw fault('document_limit');
    room.documentBytes = total;
    if (value === null) documentSizes.delete(key); else documentSizes.set(key, size);
    record(key, value);
  }
  function replaceCellDocuments(cells) {
    let total = room.documentBytes;
    for (const [key, size] of documentSizes) if (key.startsWith('cell:')) total -= size;
    for (const [key, value] of Object.entries(cells)) total += bytes(`cell:${key}`) + bytes(JSON.stringify(value)) + 2;
    if (total > config.maxDocumentBytes) throw fault('document_limit');
    for (const key of [...documentSizes.keys()]) if (key.startsWith('cell:')) storeDocument(key, null);
    for (const [key, value] of Object.entries(cells)) storeDocument(`cell:${key}`, value);
  }
  function transmit(ws, text) {
    const c = connections.get(ws);
    if (!c || ws.readyState !== 1) return;
    const sequence = (c.deliverySeq || 0) + 1;
    if (c.flowControl) text = `${text.slice(0, -1)},"deliverySeq":${sequence}}`;
    const now = Date.now(), size = bytes(text);
    c.outboundTokens = Math.min(config.outboundBurstBytes, (c.outboundTokens ?? config.outboundBurstBytes) + (now - (c.outboundAt || now)) * config.maxOutboundBytesPerSecond / 1000);
    c.outboundAt = now;
    if (size > c.outboundTokens || Number(ws.bufferedAmount || 0) > config.outboundBurstBytes || c.flowControl && ((c.unackedBytes || 0) + size > config.maxInFlightBytes || sequence - (c.ackedSeq || 0) > config.maxInFlightMessages)) { ws.close(1013, 'Slow consumer'); return; }
    c.outboundTokens -= size;
    if (c.flowControl) {
      c.deliverySeq = sequence; c.unackedBytes = (c.unackedBytes || 0) + size;
      const batch = c.deliveryBatches.at(-1);
      if (batch && batch[2] < 32) { batch[0] = sequence; batch[1] += size; batch[2]++; }
      else c.deliveryBatches.push([sequence, size, 1]);
    }
    try { ws.send(text); } catch { ws.close(1013, 'Send unavailable'); }
    if (c.flowControl) config.onOutboundChange?.(c);
  }

  function send(ws, payload) {
    const text = JSON.stringify(payload);
    if (outbox) outbox.push([ws, text]); else transmit(ws, text);
  }
  function broadcast(room, payload, except = null) {
    const text = JSON.stringify(payload);
    for (const c of room.clients.values()) if (c.joined && c.id !== except) {
      if (outbox) outbox.push([c.ws, text]); else transmit(c.ws, text);
    }
  }
  function append(room, client, type, detail = {}) {
    const event = deepFreeze(clone({ id: crypto.randomUUID(), seq: ++room.seq, at: new Date().toISOString(), room: room.name, revision: room.revision, actor: actorOf(client), type, ...detail }));
    room.journal.push(event);
    room.journalBytes += bytes(event);
    record(`event:${event.seq}`, event);
    while (room.journal.length > config.journalLimit || room.journalBytes > config.maxJournalBytes) { const removed = room.journal.shift(); room.journalBytes -= bytes(removed); record(`event:${removed.seq}`, null); }
    saveMeta();
    if (config.journalSink) {
      try { Promise.resolve(config.journalSink(clone(event))).catch(config.onError); } catch (error) { config.onError(error); }
    }
    return event;
  }
  function expiredLocks(room) {
    const paths = [...room.locks].filter(([, lock]) => lock.expiresAt <= Date.now()).map(([key]) => key);
    for (const key of paths) { room.locks.delete(key); record(`lock:${key}`, null); }
    if (paths.length) broadcast(room, { type: 'lock.released', paths, reason: 'expired' });
  }
  async function authorize(client, room, message) {
    const operation = message.type === 'hello' ? 'join' : `${message.type}${message.action ? `.${message.action}` : ''}`;
    if (!config.authorize) return { allowed: true, role: 'owner' }; // Explicitly anonymous local demo.
    const decision = await bounded(Promise.resolve(config.authorize({ user: client.user, room: room.name, action: operation, message: clone(message), role: client.role, request: client.request })));
    if (decision === true) return { allowed: true, role: client.role || 'viewer' };
    if (!decision || decision.allowed !== true) throw fault('forbidden');
    return decision;
  }
  function roleAllowed(c, message) {
    const scope = mutationScope(message);
    if (message.type === 'reset') return c.role === 'owner';
    if (scope || message.action === 'focus' || message.type === 'lock.acquire' || message.type === 'lock.renew') return ['owner', 'editor'].includes(c.role);
    if (message.type === 'action') return ['owner', 'editor', 'commenter'].includes(c.role);
    return true;
  }
  function lockCheck(room, client, scope, data) {
    expiredLocks(room);
    const applicable = [...room.locks.values()].filter(lock => touches(scope, lock.path));
    const foreign = applicable.find(lock => lock.actorId !== client.id);
    if (foreign) throw fault('locked', { path: foreign.path, lock: publicLocks(room)[foreign.path] });
    if (data.lockToken && !applicable.some(lock => lock.actorId === client.id && lock.token === data.lockToken)) throw fault('lock_lost', { path: scope });
  }
  function commit(room, client, data, scope, update, eventType, detail) {
    room.revision++;
    room.revisions.set(scope, room.revision);
    record(`rev:${scope}`, room.revision);
    saveMeta();
    room.updatedAt = Date.now();
    const journalEvent = eventType ? append(room, client, eventType, { path: scope, requestId: data.requestId, ...detail }) : null;
    const change = { ...update, revision: room.revision, requestId: data.requestId, actor: actorOf(client), ...(journalEvent ? { journalEvent } : {}) };
    broadcast(room, change, client.id);
    return { type: 'ack', accepted: true, requestId: data.requestId, revision: room.revision, path: scope, update: change };
  }

  function mutate(room, c, data, scope) {
    const actor = actorOf(c);
    if (data.type === 'window' || data.type === 'frame') {
      const frame = data.type === 'frame';
      const map = frame ? room.frames : room.windows;
      const current = map.get(data.id);
      const create = frame ? 'create' : 'open';
      const remove = frame ? 'delete' : 'close';
      let state;
      let event = null;
      if (data.action === create) {
        if (!current && map.size >= config.maxObjects) throw fault('object_limit');
        state = current ? { ...current, z: ++room.zTop, actor } : { id: data.id, ...geometry(data.state, {}, frame), z: ++room.zTop, actor, ...(frame ? { prompt: '', status: 'empty', seed: 0 } : {}) };
        if (!current) event = frame ? 'frame.created' : 'window.opened';
      } else {
        if (!current) throw fault('not_found');
        if (data.action === remove) {
          storeDocument(`${frame ? 'frame' : 'window'}:${data.id}`, null);
          map.delete(data.id);
          const paths = [...room.locks.keys()].filter(key => touches(scope, key));
          for (const key of paths) { room.locks.delete(key); record(`lock:${key}`, null); }
          if (paths.length) broadcast(room, { type: 'lock.released', paths, reason: 'deleted' });
          return commit(room, c, data, scope, { type: data.type, action: data.action, [frame ? 'frame' : 'window']: { id: data.id, actor } }, frame ? 'frame.deleted' : 'window.closed', { before: current });
        }
        state = { ...current, actor };
        if (['move', 'resize'].includes(data.action)) Object.assign(state, geometry(data.state, current, frame));
        if (data.action === 'update') { Object.assign(state, { prompt: data.prompt, status: 'empty', seed: 0 }); if (current.prompt !== data.prompt) event = 'frame.updated'; }
        if (data.action === 'generate') {
          if (!current.prompt.trim()) throw fault('empty_prompt');
          Object.assign(state, { status: 'generated', seed: imageSeed(current.prompt) });
          event = 'frame.generated';
        }
      }
      storeDocument(`${frame ? 'frame' : 'window'}:${data.id}`, state);
      map.set(data.id, state);
      if (data.final && ['move', 'resize'].includes(data.action)) event = `${data.type}.${data.action === 'move' ? 'moved' : 'resized'}`;
      return commit(room, c, data, scope, { type: data.type, action: data.action, [frame ? 'frame' : 'window']: state }, event, { after: state });
    }
    if (data.type === 'sheet') {
      if (data.action === 'cell') {
        if (!(data.address in room.sheet.cells) && Object.keys(room.sheet.cells).length >= MAX_CELLS) throw fault('cell_limit');
        const before = room.sheet.cells[data.address] ?? '';
        storeDocument(`cell:${data.address}`, data.value);
        room.sheet.cells[data.address] = data.value;
        return commit(room, c, data, scope, { type: 'sheet', action: 'cell', change: { address: data.address, value: data.value } }, 'sheet.cell.updated', { before, after: data.value });
      }
      const before = { ...room.sheet.cells };
      replaceCellDocuments(data.cells);
      room.sheet.cells = { ...data.cells };
      return commit(room, c, data, scope, { type: 'sheet', action: 'replace', cells: { ...data.cells } }, 'sheet.replaced', { before: { cellCount: Object.keys(before).length }, after: { cellCount: Object.keys(data.cells).length } });
    }
    const before = { windows: room.windows.size, frames: room.frames.size, cells: Object.keys(room.sheet.cells).length };
    for (const key of documentSizes.keys()) record(key, null);
    for (const key of room.revisions.keys()) record(`rev:${key}`, null);
    for (const key of room.locks.keys()) record(`lock:${key}`, null);
    documentSizes.clear(); room.documentBytes = 0;
    room.windows.clear(); room.frames.clear(); room.revisions.clear(); room.sheet = { cells: {}, selections: {} }; room.locks.clear();
    return commit(room, c, data, scope, { type: 'room-state', ...snapshot(room), zTop: room.zTop, frameZTop: room.zTop, canSeed: true }, 'room.reset', { before });
  }

  function handleLock(room, c, data) {
    expiredLocks(room);
    const current = room.locks.get(data.path);
    if (data.type === 'lock.release') {
      if (!current || current.actorId !== c.id || current.token !== data.token) throw fault('lock_lost');
      room.locks.delete(data.path);
      record(`lock:${data.path}`, null);
      broadcast(room, { type: 'lock.released', paths: [data.path], actorId: c.id, reason: 'released' });
      return;
    }
    const foreign = [...room.locks.values()].find(lock => touches(lock.path, data.path) && lock.actorId !== c.id);
    if (foreign || (data.type === 'lock.renew' && (!current || current.token !== data.token || current.actorId !== c.id))) {
      send(c.ws, { type: 'lock.denied', path: data.path, lock: foreign ? publicLocks(room)[foreign.path] : null, reason: foreign ? 'locked' : 'lock_lost' });
      return;
    }
    if (!current && [...room.locks.values()].filter(lock => lock.actorId === c.id).length >= config.maxLocksPerClient) throw fault('lock_limit');
    const ttl = Math.max(50, Math.min(data.ttlMs ?? config.lockTtlMs, config.lockTtlMs, 30000));
    const lock = { path: data.path, actorId: c.id, name: c.name, badge: c.badge, color: c.color, expiresAt: Date.now() + ttl, token: current?.token ?? crypto.randomUUID() };
    room.locks.set(data.path, lock);
    record(`lock:${data.path}`, lock);
    send(c.ws, { type: 'lock.acquired', path: data.path, lock: { ...lock } });
    broadcast(room, { type: 'lock.acquired', path: data.path, lock: publicLocks(room)[data.path] }, c.id);
  }

  async function handle(room, c, data) {
    if (c.ws.readyState !== 1) return;
    const decision = await authorize(c, room, data);
    if (c.ws.readyState !== 1) return;
    if (decision.role) {
      if (!['owner', 'editor', 'commenter', 'viewer'].includes(decision.role)) throw fault('forbidden');
      c.role = decision.role;
    }
    if (!roleAllowed(c, data)) throw fault('forbidden');
    if (data.type === 'hello') {
      if (c.joined) throw fault('already_joined');
      if (config.requireDeliveryAck && !data.flowControl) { send(c.ws, { type: 'error', code: 'flow_control_required' }); c.ws.close(1008, 'Flow control required'); return; }
      c.flowControl = data.flowControl === true;
      const index = room.joinIndex++;
      const [base, badge] = NAMES[index % NAMES.length];
      const cycle = Math.floor(index / NAMES.length) + 1;
      Object.assign(c, { joined: true, name: cleanName(c.user?.name || data.name) || `${base} ${cycle}`, badge: cycle > 1 ? `${badge}${cycle}` : badge, color: colorFor(index) });
      const canSeed = !room.initialized && ['owner', 'editor'].includes(c.role);
      if (canSeed) room.initialized = true;
      saveMeta();
      const journalEvent = append(room, c, 'presence.joined');
      send(c.ws, { type: 'welcome', self: publicPeer(c), online: [...room.clients.values()].filter(p => p.joined).length, peers: [...room.clients.values()].filter(p => p.joined && p.id !== c.id).map(publicPeer), ...snapshot(room), zTop: room.zTop, frameZTop: room.zTop, journal: clone(room.journal.slice(-20)), canSeed, protocol: 5 });
      broadcast(room, { type: 'join', peer: publicPeer(c), online: [...room.clients.values()].filter(p => p.joined).length, journalEvent }, c.id);
      return;
    }
    if (!c.joined) throw fault('hello_required');
    if (data.type === 'delivery.ack') {
      if (!c.flowControl || data.sequence <= c.ackedSeq) return;
      if (data.sequence > c.deliverySeq) throw fault('invalid_message');
      c.ackedSeq = data.sequence;
      while (c.deliveryBatches.length && c.deliveryBatches[0][0] <= data.sequence) c.unackedBytes -= c.deliveryBatches.shift()[1];
      return;
    }
    if (data.type === 'cursor') {
      if (!data.urgent && c.lastCursorAt && Date.now() - c.lastCursorAt < config.cursorIntervalMs && c.down === !!data.down) return;
      c.lastCursorAt = Date.now();
      Object.assign(c, { x: data.x, y: data.y, down: !!data.down });
      broadcast(room, { type: 'peer', peer: publicPeer(c) }, c.id); return;
    }
    if (data.type.startsWith('lock.')) { handleLock(room, c, data); return; }
    if (data.type === 'state.query') { send(c.ws, { type: 'snapshot', ...snapshot(room) }); return; }
    if (data.type === 'journal.query') {
      const first = room.journal[0]?.seq ?? room.seq + 1;
      send(c.ws, { type: 'journal', events: clone(room.journal.filter(e => e.seq > (data.since || 0))), fromSeq: first, nextSeq: room.seq, truncated: (data.since || 0) < first - 1 || (data.since || 0) > room.seq }); return;
    }
    if (data.type === 'action') {
      const journalEvent = append(room, c, 'action', { path: `action.${data.name}` });
      broadcast(room, { type: 'action', name: data.name, payload: data.payload, actor: actorOf(c), journalEvent }, c.id);
      send(c.ws, { type: 'journal', events: [journalEvent] }); return;
    }
    if (data.type === 'sheet' && data.action === 'selection') {
      const selection = { clientId: c.id, name: c.name, badge: c.badge, color: c.color, address: data.address || null };
      c.selection = data.address || '';
      if (data.address) room.sheet.selections[c.id] = selection; else delete room.sheet.selections[c.id];
      broadcast(room, { type: 'sheet', action: 'selection', selection }, c.id); return;
    }
    if (data.action === 'focus') {
      const map = data.type === 'frame' ? room.frames : room.windows;
      const state = map.get(data.id);
      if (state) { const next = { ...state, z: ++room.zTop, actor: actorOf(c) }; map.set(data.id, next); broadcast(room, { type: data.type, action: 'focus', [data.type]: next }, c.id); }
      return;
    }
    const scope = mutationScope(data);
    if (!data.requestId || !Number.isSafeInteger(data.baseRevision)) throw fault('mutation_envelope_required');
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(data)));
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const previous = c.receipts.get(data.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw fault('request_id_reused');
      const replay = { ...previous.outcome, replayed: true };
      if (replay.type === 'ack') replay.update = { type: 'snapshot', ...snapshot(room) };
      else replay.current = snapshot(room);
      send(c.ws, replay); return;
    }
    let response;
    try {
      if (scope !== 'room' && !room.revisions.has(scope) && room.revisions.size >= config.maxTrackedPaths) throw fault('history_limit');
      lockCheck(room, c, scope, data);
      const changedAt = Math.max(0, ...[...room.revisions].filter(([key]) => touches(key, scope)).map(([, rev]) => rev));
      if (data.baseRevision > room.revision || changedAt > data.baseRevision) throw fault('stale_revision', { path: scope, changedAt });
      response = mutate(room, c, data, scope);
    } catch (error) {
      response = { type: 'conflict', accepted: false, requestId: data.requestId, revision: room.revision, reason: error.code || 'invalid_mutation', path: scope, current: { ...snapshot(room), ...error.current } };
    }
    const { current, update, ...outcome } = response;
    c.receipts.set(data.requestId, { fingerprint, outcome });
    if (c.receipts.size > config.receiptLimit) c.receipts.delete(c.receipts.keys().next().value);
    send(c.ws, response);
  }


  function clientState(c) {
    const value = Object.fromEntries(['id','user','role','joined','x','y','down','color','badge','name','tokens','refillAt','selection','helloDeadline','flowControl','deliverySeq','ackedSeq','unackedBytes','deliveryBatches'].map(key => [key, c[key]]));
    value.room = room.name;
    value.receipts = [...c.receipts];
    return value;
  }
  function addClient(ws, state = {}) {
    const c = { id: crypto.randomUUID(), user: null, role: 'viewer', request: undefined, joined: false, x: .5, y: .5, down: false, color: '#756c72', badge: 'G', name: 'Guest', tokens: config.rateLimit.burst, refillAt: Date.now(), selection: '', flowControl: false, deliverySeq: 0, ackedSeq: 0, unackedBytes: 0, deliveryBatches: [], helloDeadline: Date.now() + 5000, ...state, ws, receipts: new Map(state.receipts || []) };
    room.clients.set(c.id, c); connections.set(ws, c); room.updatedAt = Date.now();
    if (c.selection && c.joined) room.sheet.selections[c.id] = { clientId: c.id, name: c.name, badge: c.badge, color: c.color, address: c.selection };
    return c;
  }
  function transaction(callback) {
    room.pending++;
    const task = room.tasks.then(async () => {
      if (failed) return;
      outbox = config.persist ? [] : null;
      try {
        await callback();
        if (config.persist && changes.size) { const batch = [...changes]; await config.persist(batch); changes.clear(); }
        const delivery = outbox; outbox = null;
        for (const [ws, text] of delivery || []) transmit(ws, text);
      } catch (error) {
        if (config.persist && changes.size) {
          failed = true;
          for (const c of room.clients.values()) { transmit(c.ws, JSON.stringify({ type: 'error', code: 'storage_unavailable' })); c.ws.close(1011, 'Storage unavailable'); }
        }
        config.onError(error);
      } finally { outbox = null; room.pending--; }
    });
    room.tasks = task.catch(config.onError);
    return task;
  }
  function receive(c, text, binary = false) {
    if (c.ws.readyState !== 1) return Promise.resolve();
    const now = Date.now();
    c.tokens = Math.min(config.rateLimit.burst, c.tokens + (now - c.refillAt) * config.rateLimit.messagesPerSecond / 1000); c.refillAt = now;
    if (c.tokens < 1 || room.pending >= config.maxPending) {
      transmit(c.ws, JSON.stringify({ type: 'error', code: 'rate_limited' })); c.ws.close(1013, 'Rate limit exceeded'); return Promise.resolve();
    }
    c.tokens--;
    let data;
    try {
      if (binary || typeof text !== 'string' || bytes(text) > config.maxPayload) throw fault('invalid_message');
      data = JSON.parse(text); validateMessage(data);
    } catch (error) { transmit(c.ws, JSON.stringify({ type: 'error', code: error.code || 'invalid_message', requestId: typeof data?.requestId === 'string' && REQUEST_PATTERN.test(data.requestId) ? data.requestId : undefined })); return Promise.resolve(); }
    const release = config.reserveInput?.(bytes(text));
    if (config.reserveInput && !release) { transmit(c.ws, JSON.stringify({ type: 'error', code: 'rate_limited' })); c.ws.close(1013, 'Server queue full'); return Promise.resolve(); }
    return transaction(async () => {
      try { await handle(room, c, data); }
      catch (error) { send(c.ws, { type: 'error', code: error.code || 'internal_error', requestId: data.requestId }); if (!error.code) config.onError(error); }
      config.onClientChange?.(c, clientState(c));
    }).finally(() => release?.());
  }
  function disconnect(c) {
    if (c.detached) return room.tasks;
    c.detached = true; room.clients.delete(c.id);
    return transaction(() => {
      const paths = [...room.locks].filter(([, lock]) => lock.actorId === c.id).map(([key]) => key);
      for (const key of paths) { room.locks.delete(key); record(`lock:${key}`, null); }
      if (paths.length) broadcast(room, { type: 'lock.released', paths, actorId: c.id, reason: 'disconnected' });
      delete room.sheet.selections[c.id];
      broadcast(room, { type: 'sheet', action: 'selection', selection: { clientId: c.id, address: null } });
      if (c.joined) broadcast(room, { type: 'leave', id: c.id, online: [...room.clients.values()].filter(p => p.joined).length, journalEvent: append(room, c, 'presence.left') });
      room.updatedAt = Date.now(); saveMeta();
    });
  }
  function restore(entries) {
    const meta = entries.get('meta');
    if (meta) for (const key of ['revision','seq','zTop','joinIndex','initialized','updatedAt']) if (meta[key] !== undefined) room[key] = meta[key];
    for (const [key, value] of entries) {
      const index = key.indexOf(':'); if (index < 0) continue;
      const kind = key.slice(0, index), id = key.slice(index + 1);
      if (kind === 'window') room.windows.set(id, value);
      if (kind === 'frame') room.frames.set(id, value);
      if (kind === 'cell') room.sheet.cells[id] = value;
      if (kind === 'rev') room.revisions.set(id, value);
      if (kind === 'lock') room.locks.set(id, value);
      if (kind === 'event') room.journal.push(value);
      if (['window','frame','cell'].includes(kind)) { const size = bytes(key) + bytes(JSON.stringify(value)) + 2; documentSizes.set(key, size); room.documentBytes += size; }
    }
    room.journal.sort((a, b) => a.seq - b.seq); room.journalBytes = room.journal.reduce((n, event) => n + bytes(event), 0);
  }
  return { room, config, addClient, clientState, receive, disconnect, restore, snapshot: () => snapshot(room),
    authorizeJoin: async c => { const decision = await authorize(c, room, { type: 'hello' }); return decision.role || 'viewer'; },
    expire: () => transaction(() => expiredLocks(room)),
    get failed() { return failed; }
  };
}
