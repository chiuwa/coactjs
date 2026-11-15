import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomEngine, bytes } from '../server/room.js';

function fixture(options = {}) {
  const engine = createRoomEngine('resource-test', { rateLimit: { messagesPerSecond: 100000, burst: 100000 }, maxOutboundBytesPerSecond: 1e9, outboundBurstBytes: 1e9, ...options });
  const inbox = [];
  const ws = { readyState: 1, bufferedAmount: 0, send: raw => inbox.push(JSON.parse(raw)), close(code, reason) { this.readyState = 3; this.closed = { code, reason }; } };
  const client = engine.addClient(ws);
  async function request(message) {
    await engine.receive(client, JSON.stringify(message));
    const response = inbox.findLast(value => value.requestId === message.requestId || message.type === 'hello' && value.type === 'welcome');
    inbox.length = 0;
    return response;
  }
  return { engine, ws, client, inbox, request };
}
const cell = (address, value, baseRevision, requestId = crypto.randomUUID()) => ({ type: 'sheet', action: 'cell', address, value, baseRevision, requestId });

test('receipt memory remains bounded by compact outcomes rather than document snapshots', async () => {
  const f = fixture(); await f.request({ type: 'hello' });
  const cells = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`${String.fromCharCode(65 + i % 10)}${1 + Math.floor(i / 10)}`, 'x'.repeat(250)]));
  assert.equal((await f.request({ type: 'sheet', action: 'replace', cells, baseRevision: 0, requestId: 'initial' })).type, 'ack');
  for (let i = 0; i < 256; i++) assert.equal((await f.request(cell('A1', 'stale', 0, `stale-${i}`))).type, 'conflict');
  const state = f.engine.clientState(f.client);
  assert.equal(state.receipts.length, 256); assert.ok(bytes(state.receipts) < 150000);
  assert.ok(state.receipts.every(([, value]) => value.fingerprint.length === 64 && !('current' in value.outcome) && !('update' in value.outcome)));
  const before = f.engine.room.revision;
  const replay = await f.request(cell('A1', 'stale', 0, 'stale-255'));
  assert.equal(replay.replayed, true); assert.equal(replay.current.sheet.cells.A1, 'x'.repeat(250));
  assert.equal(f.engine.room.revision, before);
});

test('document and journal byte budgets reject atomically and prune history', async () => {
  const f = fixture({ maxDocumentBytes: 900, maxJournalBytes: 2000 }); await f.request({ type: 'hello' });
  assert.equal((await f.request(cell('A1', 'x'.repeat(500), 0))).type, 'ack');
  const rejected = await f.request(cell('B1', 'y'.repeat(500), 1));
  assert.equal(rejected.reason, 'document_limit'); assert.equal(rejected.revision, 1);
  assert.equal(rejected.current.sheet.cells.B1, undefined);
  const escaped = await f.request(cell('A1', '\u0000'.repeat(500), 1));
  assert.equal(escaped.reason, 'document_limit'); assert.equal(escaped.current.sheet.cells.A1, 'x'.repeat(500));
  for (let i = 1; i <= 10; i++) assert.equal((await f.request(cell('A1', `${i}`, i))).type, 'ack');
  assert.ok(f.engine.room.documentBytes <= 900); assert.ok(f.engine.room.journalBytes <= 2000);
  assert.ok(f.engine.room.journal.length < 11);
  const lastRevision = f.engine.room.revision;
  const replace = await f.request({ type: 'sheet', action: 'replace', cells: { A1: 'a'.repeat(500), B1: 'b'.repeat(500) }, baseRevision: lastRevision, requestId: 'big-replace' });
  assert.equal(replace.reason, 'document_limit'); assert.equal(replace.current.sheet.cells.A1, '10');
});

test('storage failures do not release ACKs and cursor/selection produce no durable writes', async () => {
  const writes = [], errors = [];
  const f = fixture({ persist: batch => writes.push(structuredClone(batch)) });
  await f.request({ type: 'hello' }); assert.ok(writes.length);
  writes.length = 0;
  await f.request({ type: 'cursor', x: .2, y: .3 });
  await f.request({ type: 'sheet', action: 'selection', address: 'A1' });
  assert.equal(writes.length, 0);
  await f.request(cell('A1', 'durable', 0)); assert.ok(writes[0].some(([key]) => key === 'cell:A1'));
  const failed = fixture({ persist: () => { throw new Error('storage full'); }, onError: error => errors.push(error) });
  const welcome = await failed.request({ type: 'hello' });
  assert.equal(welcome.type, 'error'); assert.equal(welcome.code, 'storage_unavailable'); assert.equal(failed.engine.failed, true);
  assert.equal(failed.ws.closed.code, 1011); assert.equal(errors.length, 1);
});

test('outbound byte budget closes slow consumers and worker-sized attachments stay small', async () => {
  const f = fixture({ maxOutboundBytesPerSecond: 1, outboundBurstBytes: 4096, receiptLimit: 16 });
  await f.request({ type: 'hello' });
  for (let i = 0; i < 16 && f.ws.readyState === 1; i++) await f.request(cell('A1', 'x'.repeat(500), i));
  assert.equal(f.ws.closed.code, 1013);
  assert.ok(bytes(f.engine.clientState(f.client)) < 15000);
});
