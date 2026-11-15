import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { Miniflare } from 'miniflare';
import fs from 'node:fs/promises';

const options = {
  modules: true, scriptPath: 'work/worker-test-bundle/worker-fixture.js',
  compatibilityDate: '2026-07-01',
  durableObjects: { COACT_ROOMS: { className: 'CoactRoom', useSQLite: true }, PRIVATE_ROOMS: { className: 'PrivateRoom', useSQLite: true } },
  bindings: { COACT_ALLOWED_ROOMS: 'demo' }
};

async function connect(mf, room = 'demo', acknowledge = true, user = null) {
  const response = await mf.dispatchFetch(`http://localhost${user ? '/private' : ''}/ws?room=${room}${user ? `&user=${user}` : ''}`, { headers: { Upgrade: 'websocket', Origin: 'http://localhost' } });
  assert.equal(response.status, 101);
  const ws = response.webSocket, inbox = [];
  let ackTimer = null, sequence = 0, count = 0;
  const ack = () => { clearTimeout(ackTimer); ackTimer = null; if (ws.readyState === 1 && sequence) ws.send(JSON.stringify({ type: 'delivery.ack', sequence })); count = 0; };
  ws.accept(); ws.addEventListener('message', event => {
    const message = JSON.parse(event.data); inbox.push(message);
    if (acknowledge && message.deliverySeq) {
      sequence = message.deliverySeq; count++;
      if (count >= 64 || event.data.length >= 16384) ack();
      else if (!ackTimer) { ackTimer = setTimeout(ack, 200); ackTimer.unref(); }
    }
  });
  const next = async (predicate, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const i = inbox.findIndex(predicate); if (i >= 0) return inbox.splice(i, 1)[0]; await pause(5); }
    throw new Error(`Worker message timeout: ${JSON.stringify(inbox).slice(0, 1500)}`);
  };
  ws.send(JSON.stringify({ type: 'hello', flowControl: true }));
  const welcome = await next(m => m.type === 'welcome');
  return { ws, next, welcome, inbox, send: data => ws.send(JSON.stringify(data)),
    write: async (data, baseRevision, requestId = crypto.randomUUID()) => {
      ws.send(JSON.stringify({ ...data, baseRevision, requestId }));
      return next(m => m.requestId === requestId && ['ack', 'conflict', 'error'].includes(m.type));
    }
  };
}
const cell = (address, value) => ({ type: 'sheet', action: 'cell', address, value });

test('Worker runtime persists accepted edits, preserves live connections across memory reload, and keeps cursors off storage', async t => {
  const mf = new Miniflare(options); t.after(() => mf.dispose());
  const a = await connect(mf), b = await connect(mf);
  assert.notEqual(a.welcome.self.id, b.welcome.self.id);
  const saved = await a.write(cell('A1', 'Persisted'), 0, 'first'); assert.equal(saved.type, 'ack');
  await b.next(m => m.type === 'sheet' && m.change?.value === 'Persisted');
  const stale = await b.write(cell('A1', 'Old'), 0); assert.equal(stale.reason, 'stale_revision');
  const metrics = async () => (await mf.dispatchFetch('http://localhost/__test/metrics')).json();
  const before = await metrics();
  for (let i = 0; i < 10; i++) a.send({ type: 'cursor', x: i / 10, y: .5 });
  a.send({ type: 'journal.query', since: 0 }); await a.next(m => m.type === 'journal');
  const after = await metrics();
  assert.equal(after.writes, before.writes); assert.equal(after.revision, before.revision);
  const reloaded = await (await mf.dispatchFetch('http://localhost/__test/reload')).json();
  assert.equal(reloaded.revision, 1); assert.equal(reloaded.peers, 2);
  const replay = await a.write(cell('A1', 'Persisted'), 0, 'first');
  assert.equal(replay.replayed, true); assert.equal(replay.revision, 1); assert.equal(replay.update.sheet.cells.A1, 'Persisted');
  assert.equal((await b.write(cell('B1', 'After reload'), 0)).type, 'ack');
  await a.next(m => m.type === 'sheet' && m.change?.value === 'After reload');
  assert.ok((await metrics()).maxAttachmentBytes < 15000);
  a.ws.close(); b.ws.close();
});

test('Worker expiry alarms fence stale leases, enforce room capacity and block arbitrary anonymous rooms', async t => {
  const mf = new Miniflare(options); t.after(() => mf.dispose());
  const a = await connect(mf), b = await connect(mf);
  a.send({ type: 'lock.acquire', path: 'sheet.A1', ttlMs: 100 });
  const grant = await a.next(m => m.type === 'lock.acquired');
  await b.next(m => m.type === 'lock.released' && m.reason === 'expired');
  const stale = await a.write({ ...cell('A1', 'expired'), lockToken: grant.lock.token }, 0);
  assert.equal(stale.reason, 'lock_lost');
  const extra = [];
  for (let i = 0; i < 14; i++) extra.push(await connect(mf));
  const full = await mf.dispatchFetch('http://localhost/ws?room=demo', { headers: { Upgrade: 'websocket', Origin: 'http://localhost' } });
  assert.equal(full.status, 429);
  const denied = await mf.dispatchFetch('http://localhost/ws?room=unbounded-new-room', { headers: { Upgrade: 'websocket', Origin: 'http://localhost' } });
  assert.equal(denied.status, 403);
  const origin = await mf.dispatchFetch('http://localhost/ws?room=demo', { headers: { Upgrade: 'websocket', Origin: 'https://other.example' } });
  assert.equal(origin.status, 403);
  a.ws.close(); b.ws.close(); extra.forEach(c => c.ws.close());
});

// Cursor samples are ephemeral even under continuous fan-out. The fixture
// exposes counters only in local tests, never in the published Worker.
test('16 peers sustain cursor fan-out without document writes or attachment growth', async t => {
  const mf = new Miniflare(options); t.after(() => mf.dispose());
  const peers = [];
  for (let i = 0; i < 16; i++) peers.push(await connect(mf));
  const metrics = async () => (await mf.dispatchFetch('http://localhost/__test/metrics')).json();
  const cells = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`${String.fromCharCode(65 + i % 10)}${1 + Math.floor(i / 10)}`, `${i}`.padStart(4, '0') + 'x'.repeat(246)]));
  assert.equal((await peers[0].write({ type: 'sheet', action: 'replace', cells }, 0)).type, 'ack');
  await peers[1].next(m => m.type === 'sheet' && m.action === 'replace');
  let packets = 0, wireBytes = 0;
  // Avoid retaining every incoming sample in the mailbox while measuring RAM.
  for (const peer of peers) {
    peer.ws.addEventListener('message', event => { if (String(event.data).includes('"type":"peer"')) { packets++; wireBytes += new TextEncoder().encode(event.data).byteLength; } });
  }
  const before = await metrics(), started = Date.now();
  for (let step = 0; step < 45; step++) {
    for (const peer of peers) peer.send({ type: 'cursor', x: (step % 20) / 20, y: .5 });
    await pause(67);
    // connect() retains its small functional mailbox; drain the load samples.
    for (const peer of peers) peer.inbox?.splice(0);
  }
  peers[0].send({ type: 'journal.query', since: 0 }); await peers[0].next(m => m.type === 'journal');
  const after = await metrics();
  assert.equal(after.writes, before.writes); assert.equal(after.peers, 16); assert.equal(after.revision, 1);
  assert.ok(packets >= 16 * 45 * 8, { packets }); assert.ok(after.maxAttachmentBytes < 15000);
  const sample = { peers: 16, elapsedMs: Date.now() - started, cursorBroadcastPackets: packets, wireBytes, additionalSqlWrites: after.writes - before.writes, documentBytes: after.documentBytes, maxAttachmentBytes: after.maxAttachmentBytes };
  await fs.writeFile(new URL('../work/worker-load-result.json', import.meta.url), JSON.stringify(sample, null, 2));
  console.log(JSON.stringify({ workerLoad: sample }));
  peers.forEach(peer => peer.ws.close());
});

test('Worker closes readers that do not acknowledge deliveries before buffers grow unbounded', async t => {
  const mf = new Miniflare(options); t.after(() => mf.dispose());
  const sender = await connect(mf);
  const cells = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`${String.fromCharCode(65 + i % 10)}${1 + Math.floor(i / 10)}`, 'x'.repeat(250)]));
  assert.equal((await sender.write({ type: 'sheet', action: 'replace', cells }, 0)).type, 'ack');
  const slow = await connect(mf, 'demo', false);
  let closed;
  slow.ws.addEventListener('close', event => { closed = event.code; });
  for (let i = 0; i < 3; i++) {
    cells.A1 = `changed-${i}`;
    assert.equal((await sender.write({ type: 'sheet', action: 'replace', cells }, i + 1)).type, 'ack');
  }
  for (let i = 0; i < 100 && !closed; i++) await pause(10);
  assert.equal(closed, 1013);
  assert.equal(sender.ws.readyState, 1);
  sender.ws.close();
});


test('Worker production hooks reject forged anonymous joins and enforce viewer/editor ceilings', async t => {
  const mf = new Miniflare(options); t.after(() => mf.dispose());
  const denied = await mf.dispatchFetch('http://localhost/private/ws?room=demo', { headers: { Upgrade: 'websocket', Origin: 'http://localhost', 'X-Coact-User': encodeURIComponent(JSON.stringify({ id: 'owner' })) } });
  assert.equal(denied.status, 401);
  const viewer = await connect(mf, 'demo', true, 'viewer');
  assert.equal(viewer.welcome.self.role, 'viewer');
  assert.equal((await viewer.write(cell('A1', 'forbidden'), 0)).code, 'forbidden');
  const editor = await connect(mf, 'demo', true, 'editor');
  assert.equal((await editor.write(cell('A1', 'allowed'), 0)).type, 'ack');
  await viewer.next(m => m.type === 'sheet' && m.change?.value === 'allowed');
  assert.equal((await editor.write({ type: 'reset' }, 1)).code, 'forbidden');
  viewer.ws.close(); editor.ws.close();
});
