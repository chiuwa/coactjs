import { createCoact, Coact, sheetCollection, type Ack, type Peer } from 'coactjs';
import { CoactRoom } from 'coactjs/room';
import { ROOM_STYLE } from 'coactjs/styles';
import { createPlaceholderSvg } from 'coactjs/placeholder';
const api = createCoact('#room', { room: 'test', endpoint: '/ws' });
const element: CoactRoom = api.element;
api.on('coact:presence', event => { const peers: Peer[] = event.detail.peers; console.log(peers); });
api.on('coact:unsaved', event => { console.log(event.detail.operations, event.detail.code); });
api.on('coact:journal', event => { console.log(event.detail.truncated, event.detail.nextSeq); });
const ack: Promise<Ack> = api.request('sheet', { action: 'cell', address: 'A1', value: 'Ready' });
api.request('frame', { action: 'update', id: 'image-1', prompt: 'A shared room' });
api.request('reset');
element.defineWindow('check', { title: 'Type checked' });
// @ts-expect-error non-reset requests need their mutation payload
api.request('sheet');
// @ts-expect-error sheet cell values are strings
api.request('sheet', { action: 'cell', address: 'A1', value: 42 });
// @ts-expect-error prompt is required for frame update
api.request('frame', { action: 'update', id: 'image-1' });
api.objects.set('notes', { kind: 'window', x: .2 });
// @ts-expect-error explicit object kind is required
api.objects.set('notes', { x: .2 });
api.registerCollection('copy', Coact.adapters.sheet);
api.registerCollection('copy2', sheetCollection);
console.log(ack, element.sheet.cells, ROOM_STYLE, createPlaceholderSvg(42));

import { createCoactServer } from 'coactjs/server';
import { createCoactWorker, createCoactDurableObject } from 'coactjs/worker';
createCoactServer({ maxDocumentBytes: 256000, requireDeliveryAck: true });
createCoactWorker({ mode: 'demo', allowedRooms: ['demo'] });
createCoactDurableObject({ maxPeers: 16 });
console.log(api.stats.pendingBytes);
