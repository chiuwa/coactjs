import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { setTimeout as pause } from 'node:timers/promises';
import { createCoactServer } from '../server.js';
import { validateMessage } from '../src/protocol.js';

async function fixture(t, options = {}) {
  const app = createCoactServer({ port: 0, host: '127.0.0.1', ...options });
  const { port } = await app.start();
  const origin = `http://127.0.0.1:${port}`;
  const clients = [];
  t.after(async () => { clients.forEach(c => c.ws.terminate()); await app.stop(); });
  async function connect(room = 'test', query = '', name = '') {
    const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/ws?room=${room}${query}`, { origin });
    const inbox = [];
    ws.on('message', raw => inbox.push(JSON.parse(raw)));
    const next = async (predicate, ms = 1800) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const index = inbox.findIndex(predicate);
        if (index >= 0) return inbox.splice(index, 1)[0];
        await pause(5);
      }
      throw new Error(`Message timeout; inbox: ${JSON.stringify(inbox).slice(0, 1000)}`);
    };
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const c = { ws, next, inbox, send: data => ws.send(JSON.stringify(data)) };
    clients.push(c);
    c.send({ type: 'hello', name });
    c.welcome = await next(m => m.type === 'welcome');
    c.write = (data, baseRevision = 0, requestId = crypto.randomUUID()) => {
      c.send({ ...data, requestId, baseRevision });
      return next(m => m.requestId === requestId && ['ack', 'conflict', 'error'].includes(m.type));
    };
    return c;
  }
  return { app, origin, connect };
}

const cell = (address, value) => ({ type: 'sheet', action: 'cell', address, value });
const frame = { type: 'frame', action: 'create', id: 'f1', state: { x: .2, y: .2, w: .3, h: .3 } };

test('same field conflicts, independent fields both succeed, identity stays distinct', async t => {
  const f = await fixture(t);
  const a = await f.connect(); const b = await f.connect();
  assert.equal(a.welcome.canSeed, true); assert.equal(b.welcome.canSeed, false);
  assert.notEqual(a.welcome.self.color, b.welcome.self.color);
  assert.notEqual(a.welcome.self.badge, b.welcome.self.badge);
  const first = await a.write(cell('A1', 'Ada')); assert.equal(first.type, 'ack');
  const independent = await b.write(cell('B1', 'Kai')); assert.equal(independent.type, 'ack');
  const stale = await b.write(cell('A1', 'lost')); assert.equal(stale.reason, 'stale_revision');
  assert.equal(stale.current.sheet.cells.A1, 'Ada');
  assert.equal(stale.current.sheet.cells.B1, 'Kai');
  const next = await b.write(cell('A1', 'intentional'), stale.revision); assert.equal(next.type, 'ack');
});

test('all durable writes require revisions; request ids are idempotent and actor-scoped', async t => {
  const f = await fixture(t); const a = await f.connect(); const b = await f.connect();
  a.send({ ...cell('A1', 'legacy'), requestId: 'missing-revision' });
  assert.equal((await a.next(m => m.type === 'error')).code, 'mutation_envelope_required');
  const data = cell('A1', 'once');
  const first = await a.write(data, 0, 'shared-id');
  const again = await a.write(data, 0, 'shared-id');
  assert.equal(again.replayed, true); assert.equal(again.revision, first.revision);
  assert.equal(again.update.sheet.cells.A1, 'once'); assert.equal(again.update.revision, 1);
  const changed = await a.write(cell('A1', 'tampered'), 0, 'shared-id'); assert.equal(changed.code, 'request_id_reused');
  const other = await b.write(cell('B1', 'separate'), 0, 'shared-id'); assert.equal(other.type, 'ack');
  const stale = await b.write(cell('A1', 'stale'), 0, 'conflict-id');
  await a.write(cell('A1', 'latest'), other.revision);
  const retry = await b.write(cell('A1', 'stale'), 0, 'conflict-id');
  assert.equal(retry.replayed, true); assert.equal(retry.reason, stale.reason);
  assert.equal(retry.revision, stale.revision); assert.equal(retry.current.sheet.cells.A1, 'latest');
});

test('token leases enforce cell, replace, frame and ancestor locks; expiry fences old writes', async t => {
  const f = await fixture(t, { lockTtlMs: 500, maintenanceMs: 20 });
  const a = await f.connect(); const b = await f.connect();
  a.send({ type: 'lock.acquire', path: 'sheet.A1' });
  const grant = await a.next(m => m.type === 'lock.acquired'); const token = grant.lock.token;
  const remote = await b.next(m => m.type === 'lock.acquired'); assert.equal(remote.lock.token, undefined);
  assert.ok(token);
  b.send({ type: 'lock.acquire', path: 'sheet.A1' }); assert.equal((await b.next(m => m.type === 'lock.denied')).reason, 'locked');
  assert.equal((await b.write(cell('A1', 'no'))).reason, 'locked');
  assert.equal((await b.write({ type: 'sheet', action: 'replace', cells: { A1: 'bulk bypass' } })).reason, 'locked');
  a.send({ type: 'lock.release', path: 'sheet.A1', token: 'wrong' }); assert.equal((await a.next(m => m.type === 'error')).code, 'lock_lost');
  a.send({ type: 'lock.renew', path: 'sheet.A1', token });
  assert.equal((await a.next(m => m.type === 'lock.acquired')).lock.token, token);
  await b.next(m => m.type === 'lock.released' && m.reason === 'expired', 1500);
  assert.equal((await a.write({ ...cell('A1', 'late'), lockToken: token })).reason, 'lock_lost');
  assert.equal((await b.write(cell('A1', 'now allowed'))).type, 'ack');
  assert.equal((await a.write(frame)).type, 'ack');
  a.send({ type: 'lock.acquire', path: 'frame.f1.prompt' }); const frameGrant = await a.next(m => m.type === 'lock.acquired' && m.path === 'frame.f1.prompt');
  assert.equal((await b.write({ type: 'frame', action: 'delete', id: 'f1' }, 2)).reason, 'locked');
  a.ws.close();
  await b.next(m => m.type === 'lock.released' && m.paths.includes(frameGrant.path) && m.reason === 'disconnected');
});

test('async policies cannot create concurrent commit races, viewers and revoked users cannot write', async t => {
  let revoked = false;
  const f = await fixture(t, {
    authenticate: async (_req, url) => ({ id: url.searchParams.get('user') || 'a' }),
    authorize: async ({ user, action }) => { await pause(10); return { allowed: !(revoked && action !== 'join'), role: user.id === 'view' ? 'viewer' : user.id === 'owner' ? 'owner' : 'editor' }; }
  });
  const a = await f.connect('test', '&user=a'); const b = await f.connect('test', '&user=b');
  const [one, two] = await Promise.all([a.write(cell('A1', 'a')), b.write(cell('A1', 'b'))]);
  assert.equal([one, two].filter(m => m.type === 'ack').length, 1);
  assert.equal([one, two].filter(m => m.reason === 'stale_revision').length, 1);
  assert.equal((await a.write({ type: 'reset' }, 1)).code, 'forbidden');
  const view = await f.connect('test', '&user=view'); assert.equal(view.welcome.canSeed, false);
  assert.equal((await view.write(cell('B1', 'no'))).code, 'forbidden');
  view.send({ type: 'action', name: 'custom.write', payload: {} }); assert.equal((await view.next(m => m.type === 'error')).code, 'forbidden');
  view.send({ type: 'lock.acquire', path: 'sheet.C1' }); assert.equal((await view.next(m => m.type === 'error')).code, 'forbidden');
  view.send({ type: 'window', action: 'focus', id: 'board' }); assert.equal((await view.next(m => m.type === 'error')).code, 'forbidden');
  revoked = true; assert.equal((await a.write(cell('C1', 'revoked'), 1)).code, 'forbidden');
});

test('bulk replace/reset conflicts with concurrent edits, deletion tombstones reject stale recreation', async t => {
  const f = await fixture(t); const a = await f.connect(); const b = await f.connect();
  assert.equal((await a.write(cell('D2', '10'))).type, 'ack');
  assert.equal((await b.write({ type: 'sheet', action: 'replace', cells: {} })).reason, 'stale_revision');
  assert.equal((await b.write({ type: 'reset' })).reason, 'stale_revision');
  assert.equal((await a.write(frame, 1)).type, 'ack');
  assert.equal((await a.write({ type: 'frame', action: 'delete', id: 'f1' }, 2)).type, 'ack');
  assert.equal((await b.write(frame, 2)).reason, 'stale_revision');
  const reset = await a.write({ type: 'reset' }, 3); assert.equal(reset.type, 'ack');
  assert.equal((await b.write(cell('D2', 'old'), 1)).reason, 'stale_revision');
  const newcomer = await f.connect(); assert.equal(newcomer.welcome.canSeed, false);
});

test('journal revisions match accepted writes, queries resume, ring buffer and sink are isolated', async t => {
  const delivered = [];
  const f = await fixture(t, { journalLimit: 4, journalSink: async event => { delivered.push(event); event.type = 'tampered'; } });
  const a = await f.connect();
  for (let i = 0; i < 5; i++) assert.equal((await a.write(cell('A1', `${i}`), i)).type, 'ack');
  a.send({ type: 'journal.query', since: 0 }); const journal = await a.next(m => m.type === 'journal');
  assert.equal(journal.truncated, true); assert.equal(journal.events.length, 4);
  assert.deepEqual(journal.events.map(e => e.revision), [2, 3, 4, 5]);
  assert.ok(journal.events.every(e => e.type === 'sheet.cell.updated' && e.requestId));
  const last = journal.events.at(-1).seq;
  a.send({ type: 'cursor', x: .3, y: .4 });
  a.send({ type: 'journal.query', since: last }); assert.deepEqual((await a.next(m => m.type === 'journal')).events, []);
  assert.ok(delivered.length >= 6);
});

test('Origin, schema, resource exposure, rate and peer caps are enforced', async t => {
  const f = await fixture(t, { maxPeers: 1, rateLimit: { messagesPerSecond: 1, burst: 3 } });
  await assert.rejects(new Promise((resolve, reject) => {
    const ws = new WebSocket(`${f.origin.replace('http:', 'ws:')}/ws?room=test`, { origin: 'https://evil.example' });
    ws.once('open', () => { ws.terminate(); resolve(); }); ws.once('error', reject);
  }));
  for (const name of ['server.js', '.env', 'package.json', 'node_modules/ws/package.json', 'demo/../server.js']) assert.equal((await fetch(`${f.origin}/${name}`)).status, 404);
  assert.equal((await fetch(`${f.origin}/src/coact.js`)).status, 200);
  const a = await f.connect();
  await assert.rejects(f.connect());
  a.send({ type: 'sheet', action: 'replace', cells: { constructor: 'bad' }, requestId: 'invalid', baseRevision: 0 });
  assert.equal((await a.next(m => m.type === 'error')).code, 'invalid_message');
  a.send(cell('A1', {})); assert.equal((await a.next(m => m.type === 'error')).code, 'invalid_message');
  for (let i = 0; i < 8; i++) a.send({ type: 'cursor', x: 0, y: 0 });
  assert.equal((await a.next(m => m.code === 'rate_limited')).type, 'error');
});

test('room cleanup, fresh initialization and separate server instances do not share state', async t => {
  const f = await fixture(t, { roomTtlMs: 40, maintenanceMs: 10 });
  const a = await f.connect(); await a.write(cell('A1', 'private'));
  const other = await fixture(t); const b = await other.connect(); assert.deepEqual(b.welcome.sheet.cells, {});
  a.ws.close(); await pause(120);
  const fresh = await f.connect(); assert.equal(fresh.welcome.canSeed, true); assert.deepEqual(fresh.welcome.sheet.cells, {});
});

test('production mode requires auth hooks and rejects anonymous handshake', async t => {
  assert.throws(() => createCoactServer({ mode: 'production' }), /requires/);
  const f = await fixture(t, { mode: 'production', authenticate: async () => null, authorize: async () => ({ allowed: true, role: 'editor' }) });
  await assert.rejects(f.connect());
});

test('concurrent asynchronous joins reserve room capacity and release denied slots', async t => {
  const f = await fixture(t, { maxPeers: 1, authorize: async () => { await pause(20); return { allowed: true, role: 'editor' }; } });
  const joins = await Promise.allSettled(Array.from({ length: 5 }, () => f.connect()));
  assert.equal(joins.filter(result => result.status === 'fulfilled').length, 1);
  const joined = joins.find(result => result.status === 'fulfilled').value;
  joined.ws.close(); await pause(30);
  assert.ok((await f.connect()).welcome.self.id);
});

test('tracked history is bounded; reset compacts it without admitting stale writes', async t => {
  const f = await fixture(t, { maxTrackedPaths: 2 }); const a = await f.connect();
  assert.equal((await a.write(cell('A1', 'first'))).type, 'ack');
  assert.equal((await a.write(cell('B1', 'second'), 1)).type, 'ack');
  assert.equal((await a.write(cell('C1', 'full'), 2)).reason, 'history_limit');
  assert.equal((await a.write({ type: 'reset' }, 2)).type, 'ack');
  assert.equal((await a.write(cell('A1', 'stale'), 2)).reason, 'stale_revision');
  assert.equal((await a.write(cell('A1', 'new'), 3)).type, 'ack');
});

test('deleting an owned object releases descendant leases and permits fresh recreation', async t => {
  const f = await fixture(t); const a = await f.connect(); const b = await f.connect();
  assert.equal((await a.write(frame)).type, 'ack');
  a.send({ type: 'lock.acquire', path: 'frame.f1.prompt' });
  await a.next(m => m.type === 'lock.acquired');
  assert.equal((await a.write({ type: 'frame', action: 'delete', id: 'f1' }, 1)).type, 'ack');
  await b.next(m => m.type === 'lock.released' && m.reason === 'deleted' && m.paths.includes('frame.f1.prompt'));
  assert.equal((await b.write(frame, 2)).type, 'ack');
});

test('schema rejects coerced cell addresses; malformed messages spend the rate budget', async t => {
  for (const address of [['A1'], { value: 'A1' }, 1, null]) {
    assert.throws(() => validateMessage(cell(address, 'bad')), /Invalid/);
    assert.throws(() => validateMessage({ type: 'sheet', action: 'selection', address }), /Invalid/);
  }
  assert.throws(() => validateMessage({ ...frame, final: 'false' }), /Invalid/);
  const f = await fixture(t, { rateLimit: { messagesPerSecond: .01, burst: 2 } });
  const a = await f.connect();
  a.ws.send('{'); assert.equal((await a.next(m => m.type === 'error')).code, 'invalid_message');
  a.ws.send('{'); assert.equal((await a.next(m => m.type === 'error')).code, 'rate_limited');
});

test('global Node pending-byte admission rejects pressure before document mutation', async t => {
  const f = await fixture(t, { maxPendingBytes: 256 }); const a = await f.connect();
  a.send({ ...cell('A1', 'x'.repeat(500)), baseRevision: 0, requestId: 'too-much-pending-input' });
  assert.equal((await a.next(m => m.code === 'rate_limited')).type, 'error');
  await pause(30);
  assert.equal(f.app.stats.pendingBytes, 0);
  const b = await f.connect(); assert.equal(b.welcome.sheet.cells.A1, undefined);
});
