import { ROOM_STYLE, CURSOR_SVG } from './styles.js';
import { createPlaceholderSvg } from './placeholder.js';
import { sheetCollection } from './sheet-collection.js';
import { mutationScope, touches, validateMessage, ID_PATTERN, CELL_PATTERN, MAX_CELLS } from './protocol.js';

const VALID_ID = ID_PATTERN;
const ACTION_NAME = /^[a-zA-Z][a-zA-Z0-9._:-]{0,79}$/;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10);
}

function initials(name) {
  return String(name || 'G').split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase();
}

export class CoactRoom extends HTMLElement {
  static get observedAttributes() {
    return ['name', 'placeholder-image', 'placeholder-title', 'placeholder-code', 'placeholder-note'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._defs = new Map();
    this._windows = new Map();
    this._windowEls = new Map();
    this._peers = new Map();
    this._cursorEls = new Map();
    this._slotted = new Map();
    this._socket = null;
    this._connected = false;
    this._online = 1;
    this._destroyed = false;
    this._manualClose = false;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._cursorTimer = null;
    this._windowTimer = null;
    this._pendingWindow = null;
    this._frameTimer = null;
    this._pendingFrame = null;
    this._frames = new Map();
    this._frameEls = new Map();
    this._frameZTop = 10;
    this._sheet = { cells: {}, selections: {} };
    this._collections = new Map();
    this._revision = 0;
    this._journal = [];
    this._locks = {};
    this._mutationQueue = [];
    this._queuedBytes = 0;
    this._roomKey = null;
    this._receivedDelivery = 0;
    this._deliveryCount = 0;
    this._deliveryTimer = null;
    this._inflight = null;
    this._ownLocks = new Map();
    this._releasingLocks = new Set();
    this._lockRequests = new Set();
    this._drawingMode = false;
    this._drawSession = null;
    this._localZ = 10;
    this._self = {
      id: '',
      name: this.getAttribute('name') || 'Guest',
      color: '#8b6b75',
      x: 0.5,
      y: 0.5,
      down: false
    };

    this.shadowRoot.innerHTML = `
      <style>${ROOM_STYLE}</style>
      <div class="cw-canvas" part="canvas">
        <div class="cw-frame-layer" part="frames"></div>
        <div class="cw-window-layer" part="windows"></div>
        <div class="cw-draw-layer" part="draw-layer">
          <div class="cw-draw-preview"></div>
        </div>
        <div class="cw-cursor-layer" part="cursors"></div>
      </div>`;
    this._frameLayer = this.shadowRoot.querySelector('.cw-frame-layer');
    this._windowLayer = this.shadowRoot.querySelector('.cw-window-layer');
    this._drawLayer = this.shadowRoot.querySelector('.cw-draw-layer');
    this._drawPreview = this.shadowRoot.querySelector('.cw-draw-preview');
    this._cursorLayer = this.shadowRoot.querySelector('.cw-cursor-layer');

    this._onPointerMove = (event) => this._updateSelfCursor(event);
    this._onPointerDown = (event) => this._updateSelfCursor(event, true);
    this._onPointerUp = (event) => {
      const rect = this._canvasRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        this._onPointerMove(event);
      }
      this._self.down = false;
      this._sendCursor(true);
    };
    this._onWindowBlur = () => {
      this._self.down = false;
      this._sendCursor(true);
    };
    this.registerCollection('sheet', sheetCollection);
    this._onResize = () => this._renderAllGeometry();
    this._onKeyDown = (event) => {
      if (event.key === 'Escape' && this._drawingMode) this.cancelFrameDraw();
    };
    this._onDrawPointerDown = (event) => this._startDraw(event);
    this._onDrawPointerMove = (event) => this._moveDraw(event);
    this._onDrawPointerUp = (event) => this._endDraw(event);
    this._drawLayer.addEventListener('pointerdown', this._onDrawPointerDown);
    this._drawLayer.addEventListener('pointermove', this._onDrawPointerMove);
    this._drawLayer.addEventListener('pointerup', this._onDrawPointerUp);
    this._drawLayer.addEventListener('pointercancel', this._onDrawPointerUp);
  }

  connectedCallback() {
    this._destroyed = false;
    this._manualClose = false;
    this.addEventListener('pointermove', this._onPointerMove, { passive: true });
    this.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    window.addEventListener('pointerup', this._onPointerUp, { passive: true });
    window.addEventListener('pointercancel', this._onPointerUp, { passive: true });
    window.addEventListener('blur', this._onWindowBlur);
    window.addEventListener('keydown', this._onKeyDown);
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(this);
    queueMicrotask(() => {
      if (this.isConnected) this.connect();
    });
  }

  disconnectedCallback() {
    this._destroyed = true;
    this.removeEventListener('pointermove', this._onPointerMove);
    this.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('blur', this._onWindowBlur);
    window.removeEventListener('keydown', this._onKeyDown);
    this._resizeObserver?.disconnect();
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._cursorTimer);
    clearTimeout(this._windowTimer);
    clearTimeout(this._frameTimer);
    this.disconnect();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === 'name' && newValue && !this._connected) this._self.name = newValue.slice(0, 24);
    if (name.startsWith('placeholder-')) {
      for (const [id, el] of this._frameEls.entries()) {
        const state = this._frames.get(id);
        if (state) this._applyFrameDetails(el, state);
      }
    }
  }

  get room() { return this.getAttribute('room') || 'demo'; }
  get online() { return this._online; }
  get self() { return { ...this._self }; }
  get peers() { return [...this._peers.values()].map((peer) => ({ ...peer })); }
  get windows() { return structuredClone(Object.fromEntries(this._windows)); }
  get frames() { return structuredClone(Object.fromEntries(this._frames)); }
  get sheet() { return { cells: { ...this._sheet.cells }, selections: Object.fromEntries(Object.entries(this._sheet.selections).map(([id, value]) => [id, { ...value }])) }; }
  get revision() { return this._revision; }
  get stats() { return { pendingMutations: this._mutationQueue.length + Number(Boolean(this._inflight)), pendingBytes: this._queuedBytes + (this._inflight?.bytes || 0), peers: this._peers.size, windows: this._windows.size, frames: this._frames.size, cells: Object.keys(this._sheet.cells).length, journalEntries: this._journal.length }; }
  get journal() { return structuredClone(this._journal); }
  get locks() { return structuredClone(this._locks); }

  registerWindow(id, options = {}) {
    if (!VALID_ID.test(id)) throw new Error(`Invalid window id: ${id}`);
    this._defs.set(id, {
      id,
      title: options.title || id,
      accent: options.accent || '#b95b73',
      content: options.content ?? '',
      start: options.start || null,
      size: options.size || { w: 0.36, h: 0.42 },
      open: Boolean(options.open),
      order: this._defs.size
    });
    if (this._windows.has(id) && !this._windowEls.has(id)) this._createWindowEl(this._windows.get(id));
    if (this._connected && this._windows.size === 0 && options.open && this.dataset.canSeed === 'true') this.openWindow(id);
    return this;
  }

  defineWindow(id, options) {
    return this.registerWindow(id, options);
  }

  openWindow(id, overrides = {}) {
    if (!this._canEdit(`window.${id}`)) return false;
    const def = this._defs.get(id);
    if (!def) throw new Error(`Window is not registered: ${id}`);
    if (this._windows.has(id)) {
      this.focusWindow(id);
      return this._windowEls.get(id) || null;
    }

    const compact = this.clientWidth < 720;
    const index = this._windows.size % 4;
    const state = {
      id,
      x: overrides.x ?? def.start?.x ?? (compact ? 0.08 + index * 0.025 : 0.27 + index * 0.025),
      y: overrides.y ?? def.start?.y ?? (compact ? 0.1 + index * 0.04 : 0.22 + index * 0.035),
      w: overrides.w ?? def.size?.w ?? (compact ? 0.72 : 0.36),
      h: overrides.h ?? def.size?.h ?? (compact ? 0.5 : 0.42),
      z: this._nextZ(),
      actor: { id: this._self.id, name: this._self.name, color: this._self.color }
    };
    if (!this._mutate({ type: 'window', action: 'open', id, state })) return false;
    this._applyWindow(state);
    this._emitWindows('open', state);
    return this._windowEls.get(id) || null;
  }

  closeWindow(id) {
    if (!this._canEdit(`window.${id}`)) return false;
    if (!this._windows.has(id)) return;
    if (!this._mutate({ type: 'window', action: 'close', id })) return false;
    this._removeWindow(id);
    this._emitWindows('close', { id });
  }

  focusWindow(id) {
    if (!this._canEdit(`window.${id}`)) return false;
    const state = this._windows.get(id);
    const el = this._windowEls.get(id);
    if (!state || !el) return;
    state.z = this._nextZ();
    state.actor = { id: this._self.id, name: this._self.name, color: this._self.color };
    el.style.zIndex = String(10 + state.z);
    this._applyActor(el, state.actor);
    this._mutate({ type: 'window', action: 'focus', id, state });
  }

  resetRoom() {
    if (this._connected && this._self.role === 'owner') return this._mutate({ type: 'reset' });
    return false;
  }

  registerCollection(name, adapter) {
    const key = String(name || '');
    if (!VALID_ID.test(key)) throw new Error(`Invalid collection name: ${key}`);
    if (!adapter || typeof adapter.snapshot !== 'function' || typeof adapter.set !== 'function' || typeof adapter.replace !== 'function') {
      throw new Error(`Collection adapter is incomplete: ${key}`);
    }
    this._collections.set(key, adapter);
    return this.collection(key);
  }

  collection(name) {
    const adapter = this._collections.get(String(name || ''));
    if (!adapter) throw new Error(`Collection is not registered: ${name}`);
    const room = this;
    return Object.freeze({
      name,
      get snapshot() { return adapter.snapshot(room); },
      get(key) { return adapter.get ? adapter.get(room, key) : adapter.snapshot(room)[key]; },
      set(key, value) { return adapter.set(room, key, value); },
      replace(values) { return adapter.replace(room, values); },
      select(key) { return adapter.select ? adapter.select(room, key) : undefined; },
      subscribe(handler) {
        const listener = (event) => handler(adapter.snapshot(room), event.detail);
        room.addEventListener(adapter.event, listener);
        return () => room.removeEventListener(adapter.event, listener);
      }
    });
  }

  action(name, payload = {}) {
    const type = String(name || '');
    if (!ACTION_NAME.test(type)) throw new Error(`Invalid action name: ${type}`);
    return this._send({ type: 'action', name: type, payload });
  }

  publishCursor(point = {}) {
    this._self.x = clamp(Number(point.x) || 0, 0, 1);
    this._self.y = clamp(Number(point.y) || 0, 0, 1);
    if (typeof point.down === 'boolean') this._self.down = point.down;
    return this._sendCursor(true);
  }

  journalSince(seq = 0) {
    return this._send({ type: 'journal.query', since: Number(seq) || 0 });
  }

  acquireLock(path, ttlMs) {
    this._releasingLocks.delete(path);
    const sent = this._send({ type: 'lock.acquire', path, ttlMs });
    if (sent) this._lockRequests.add(path);
    return sent;
  }

  renewLock(path) {
    const lock = this._ownLocks.get(path);
    return !!lock && this._send({ type: 'lock.renew', path, token: lock.token });
  }

  releaseLock(path) {
    this._releasingLocks.add(path);
    this._flushLockReleases();
    return true;
  }

  request(type, payload = {}) {
    if (!mutationScope({ ...payload, type })) return Promise.reject(Object.assign(new Error('request() requires a state mutation'), { code: 'invalid_request' }));
    return new Promise((resolve, reject) => {
      if (!this._queueMutation({ ...payload, type }, { resolve, reject })) {
        reject(Object.assign(new Error('Not connected'), { code: 'not_connected' }));
      }
    });
  }

  startFrameDraw() {
    if (!this._canEdit('frame.new')) return false;
    this._drawingMode = true;
    this._drawSession = null;
    this._drawLayer.classList.add('is-active');
    this._drawPreview.style.display = 'none';
    this._emitDrawMode(true);
  }

  cancelFrameDraw() {
    this._drawingMode = false;
    this._drawSession = null;
    this._drawLayer.classList.remove('is-active', 'is-drawing');
    this._drawPreview.style.display = 'none';
    this._emitDrawMode(false);
  }

  addImageFrame(rect = null) {
    if (!this._canEdit('frame.new')) return false;
    const selection = rect || { x: 0.18, y: 0.24, w: 0.32, h: 0.34 };
    return this._createImageFrame({
      x: clamp(selection.x, 0.01, 0.94),
      y: clamp(selection.y, 0.01, 0.92),
      w: clamp(selection.w, 0.16, 0.72),
      h: clamp(selection.h, 0.18, 0.68)
    });
  }

  deleteFrame(id) {
    if (!this._canEdit(`frame.${id}`)) return false;
    if (!this._frames.has(id)) return;
    if (!this._mutate({ type: 'frame', action: 'delete', id })) return false;
    this._removeFrame(id);
    this._emitFrames('delete', { id });
  }

  updateSheetCell(address, value) {
    const cell = String(address || '').toUpperCase();
    if (!CELL_PATTERN.test(cell) || !this._canEdit(`sheet.${cell}`)) return false;
    const text = String(value ?? '').slice(0, 500);
    if (!this._mutate({ type: 'sheet', action: 'cell', address: cell, value: text })) return false;
    this._sheet.cells[cell] = text;
    this._emitSheet('cell', { change: { address: cell, value: text }, actor: this._self });
    return true;
  }

  replaceSheet(cells) {
    if (!this._canEdit('sheet') || Object.keys(cells || {}).length > MAX_CELLS) return false;
    const next = {};
    for (const [address, value] of Object.entries(cells || {})) {
      const key = String(address).toUpperCase();
      if (!CELL_PATTERN.test(key)) return false;
      next[key] = String(value ?? '').slice(0, 500);
    }
    if (!this._mutate({ type: 'sheet', action: 'replace', cells: next })) return false;
    this._sheet.cells = next;
    this._emitSheet('replace', { cells: { ...next }, actor: this._self });
    return true;
  }

  selectSheetCell(address) {
    const cell = String(address || '').toUpperCase();
    if (cell && !CELL_PATTERN.test(cell)) return;
    if (cell) {
      this._sheet.selections[this._self.id || 'self'] = {
        clientId: this._self.id,
        name: this._self.name,
        badge: this._self.badge,
        color: this._self.color,
        address: cell
      };
    } else {
      delete this._sheet.selections[this._self.id || 'self'];
    }
    this._emitSheet('selection', { selection: { clientId: this._self.id, address: cell || null }, actor: this._self });
    this._send({ type: 'sheet', action: 'selection', address: cell });
  }

  connect() {
    if (this._socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this._socket.readyState)) return;
    this._manualClose = false;
    clearTimeout(this._reconnectTimer);
    this._setStatus('connecting');
    try {
      const endpoint = this._resolveEndpoint();
      if (this._roomKey !== endpoint) {
        this._roomKey = endpoint;
        this.removeAttribute('data-state-loaded');
        this._revision = 0; this._journal = [];
        this._syncWindows({}); this._syncFrames({}); this._setSheetState({});
      }
      clearTimeout(this._deliveryTimer); this._deliveryTimer = null;
      this._receivedDelivery = 0; this._deliveryCount = 0;
      this._socket = new WebSocket(endpoint);
    } catch (error) {
      this._setStatus('offline', { error: String(error) });
      this._scheduleReconnect();
      return;
    }

    const socket = this._socket;
    socket.addEventListener('open', () => {
      if (this._socket !== socket) return;
      this._connected = false;
      this._send({
        type: 'hello',
        flowControl: true,
        name: this.hasAttribute('name') ? this._self.name : '',
        x: this._self.x,
        y: this._self.y
      });
    });

    socket.addEventListener('message', (event) => {
      if (this._socket !== socket) return;
      if (typeof event.data !== 'string') { socket.close(4009, 'Text messages required'); return; }
      const incomingBytes = new TextEncoder().encode(event.data).byteLength;
      if (incomingBytes > (Number(this.getAttribute('max-incoming-bytes')) || 1024 * 1024)) { socket.close(4009, 'Message too large'); return; }
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (!data || typeof data !== 'object') return;
      if (Number.isSafeInteger(data.deliverySeq) && data.deliverySeq > this._receivedDelivery) {
        this._receivedDelivery = data.deliverySeq; this._deliveryCount++;
        if (this._deliveryCount >= 64 || incomingBytes >= 16384) this._ackDelivery();
        else if (!this._deliveryTimer) this._deliveryTimer = setTimeout(() => this._ackDelivery(), 200);
      }
      this._handleMessage(data);
    });

    socket.addEventListener('close', () => {
      if (this._socket !== socket) return;
      this._connected = false;
      this._failMutations('disconnected');
      this._clearLocks();
      clearInterval(this._lockMaintenance);
      this._online = 1;
      this._clearPeers();
      this._emitPresence();
      this._setStatus('offline');
      if (!this._destroyed && !this._manualClose) this._scheduleReconnect();
    });

    socket.addEventListener('error', () => socket.close());
  }

  disconnect() {
    this._manualClose = true;
    clearTimeout(this._deliveryTimer); this._deliveryTimer = null;
    this._connected = false;
    this._setStatus('offline');
    this._failMutations('disconnected');
    this._clearLocks();
    clearInterval(this._lockMaintenance);
    clearTimeout(this._reconnectTimer);
    if (this._socket) this._socket.close(1000, 'Client disconnected');
  }

  _resolveEndpoint() {
    const configured = this.getAttribute('endpoint') || '';
    let endpoint = configured;
    if (!endpoint) {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      endpoint = `${protocol}//${location.host}/ws`;
    } else if (endpoint.startsWith('/')) {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      endpoint = `${protocol}//${location.host}${endpoint}`;
    }
    endpoint = endpoint.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const url = new URL(endpoint);
    url.searchParams.set('room', this.room);
    return url.toString();
  }

  _scheduleReconnect() {
    const delay = Math.min(5000, 600 * 2 ** this._reconnectAttempt++);
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _mutate(payload) {
    return this._queueMutation(payload);
  }

  _canEdit(scope) {
    if (!this._connected || !['owner', 'editor'].includes(this._self.role)) return false;
    return !Object.values(this._locks).some(lock => lock.expiresAt > Date.now() && lock.actorId !== this._self.id && touches(scope, lock.path));
  }

  _queueMutation(payload, completion = null) {
    const reject = code => {
      completion?.reject(Object.assign(new Error(code), { code }));
      this._emit('coact:error', { code });
      if (!completion) this._emit('coact:unsaved', { code, operations: [payload] });
      return false;
    };
    if (!this._connected) return reject('not_connected');
    const scope = mutationScope(payload);
    if (!scope) return this._send(payload);
    const explicitBase = payload.baseRevision !== undefined;
    let message = { ...payload, requestId: crypto.randomUUID(), baseRevision: payload.baseRevision ?? this._revision };
    try { validateMessage(message); } catch { return reject('invalid_message'); }
    const own = [...this._ownLocks.values()].find(lock => lock.expiresAt > Date.now() && touches(scope, lock.path));
    if (own) message.lockToken = own.token;
    const last = this._mutationQueue.at(-1);
    const collapse = !completion && !explicitBase && last && !last.completion && last.scope === scope && last.message.type === message.type && last.message.action === message.action && ['cell', 'update', 'move', 'resize'].includes(message.action);
    if (collapse) message = { ...message, baseRevision: last.message.baseRevision, requestId: last.message.requestId };
    let text;
    try { text = JSON.stringify(message); } catch { return reject('invalid_message'); }
    const payloadBytes = new TextEncoder().encode(text).byteLength;
    const bytes = payloadBytes + 16 - String(message.baseRevision).length;
    const maxPayload = Number(this.getAttribute('max-payload')) || 128 * 1024;
    const maxPendingBytes = Number(this.getAttribute('max-pending-bytes')) || 512 * 1024;
    if (payloadBytes > maxPayload) return reject('payload_too_large');
    const total = this._queuedBytes + (this._inflight?.bytes || 0) + bytes - (collapse ? last.bytes : 0);
    if ((!collapse && this._mutationQueue.length >= 128) || total > maxPendingBytes) return reject('queue_full');
    message = JSON.parse(text); // Detach caller-owned objects before retaining them in the queue.
    if (collapse) {
      this._queuedBytes += bytes - last.bytes;
      last.message = message; last.bytes = bytes;
    } else {
      this._mutationQueue.push({ message, scope, explicitBase, completion, bytes });
      this._queuedBytes += bytes;
    }
    this._flushMutations();
    return true;
  }

  _flushMutations() {
    if (!this._connected || this._inflight || this._processingAck || !this._mutationQueue.length) { this._flushLockReleases(); return; }
    const next = this._mutationQueue.shift();
    this._queuedBytes -= next.bytes;
    this._inflight = next;
    if (!this._send(next.message)) { this._failMutations('not_sent'); return; }
    next.timer = setTimeout(() => {
      this._failMutations('ack_timeout');
      this._socket?.close(4000, 'Acknowledgement timeout');
    }, 8000);
  }

  _failMutations(code) {
    const pending = [this._inflight, ...this._mutationQueue].filter(Boolean);
    const buffered = [this._pendingWindow && { type: 'window', ...this._pendingWindow }, this._pendingFrame && { type: 'frame', ...this._pendingFrame }].filter(Boolean);
    this._pendingWindow = null; this._pendingFrame = null;
    for (const key of ['_windowTimer', '_frameTimer']) { clearTimeout(this[key]); this[key] = null; }
    this._mutationQueue = []; this._queuedBytes = 0; this._inflight = null;
    for (const item of pending) { clearTimeout(item.timer); item.completion?.reject(Object.assign(new Error(code), { code })); }
    if (pending.length || buffered.length) this._emit('coact:unsaved', { code, operations: [...pending.map(item => item.message), ...buffered] });
  }

  _finishMutation(data) {
    const item = this._inflight;
    if (!item || item.message.requestId !== data.requestId) return;
    clearTimeout(item.timer); this._inflight = null; this._processingAck = true;
    if (data.type === 'ack') {
      for (const next of this._mutationQueue) if (!next.explicitBase && touches(next.scope, item.scope)) next.message.baseRevision = Math.max(next.message.baseRevision, data.revision);
      if (data.update) this._handleMessage(data.update);
      this._overlayPendingState();
      item.completion?.resolve(data);
    } else {
      const discarded = this._mutationQueue.filter(next => touches(next.scope, item.scope));
      this._mutationQueue = this._mutationQueue.filter(next => !touches(next.scope, item.scope));
      this._queuedBytes = this._mutationQueue.reduce((sum, next) => sum + next.bytes, 0);
      for (const next of [item, ...discarded]) next.completion?.reject(Object.assign(new Error(data.reason || data.code), { code: data.reason || data.code, detail: data }));
      if (data.current?.sheet) this._restoreSnapshot(data.current);
      else this._send({ type: 'state.query' });
      this._emit('coact:unsaved', { code: data.reason || data.code, operations: [item, ...discarded].map(next => next.message) });
    }
    this._processingAck = false;
    this._flushMutations();
  }

  _overlayPendingState() {
    for (const { message: m } of this._mutationQueue) {
      if (m.type === 'sheet') {
        if (m.action === 'cell') this._sheet.cells[m.address] = m.value;
        if (m.action === 'replace') this._sheet.cells = { ...m.cells };
      }
      if (m.type === 'window' && this._windows.has(m.id) && m.state) {
        const state = { ...this._windows.get(m.id), ...m.state };
        this._windows.set(m.id, state);
        const el = this._windowEls.get(m.id); if (el) this._applyGeometry(el, state);
      }
      if (m.type === 'frame' && this._frames.has(m.id)) {
        const state = { ...this._frames.get(m.id), ...m.state };
        if (m.action === 'update') Object.assign(state, { prompt: m.prompt, status: 'empty', seed: 0 });
        this._frames.set(m.id, state);
        const el = this._frameEls.get(m.id); if (el) { this._applyFrameGeometry(el, state); this._applyFrameDetails(el, state); }
      }
    }
    if (this._mutationQueue.some(item => item.message.type === 'sheet')) this._emitSheet('pending', {});
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  _ackDelivery() {
    clearTimeout(this._deliveryTimer); this._deliveryTimer = null;
    if (this._receivedDelivery) this._send({ type: 'delivery.ack', sequence: this._receivedDelivery });
    this._deliveryCount = 0;
  }

  _send(payload) {
    if (!this._socket || this._socket.readyState !== WebSocket.OPEN || this._socket.bufferedAmount > 1024 * 1024) return false;
    this._socket.send(JSON.stringify(payload));
    return true;
  }

  _flushLockReleases() {
    for (const path of this._releasingLocks) {
      if ([this._inflight, ...this._mutationQueue].some(item => item && touches(item.scope, path))) continue;
      const own = this._ownLocks.get(path);
      if (!own && this._lockRequests.has(path)) continue;
      if (own) this._send({ type: 'lock.release', path, token: own.token });
      this._releasingLocks.delete(path); this._ownLocks.delete(path);
    }
  }

  _clearLocks() {
    this._locks = {}; this._ownLocks.clear(); this._releasingLocks.clear(); this._lockRequests.clear();
    for (const [id, el] of this._frameEls) this._applyFrameDetails(el, this._frames.get(id));
    this._emit('coact:lock', { type: 'lock.cleared' });
  }

  _maintainLocks() {
    for (const [path, lock] of this._ownLocks) {
      if (lock.expiresAt <= Date.now()) {
        this._ownLocks.delete(path); delete this._locks[path];
        for (const [id, el] of this._frameEls) this._applyFrameDetails(el, this._frames.get(id));
        this._emit('coact:lock', { type: 'lock.lost', path });
      } else if (lock.renewAt <= Date.now()) {
        lock.renewAt = Date.now() + 2000;
        this.renewLock(path);
      }
    }
  }

  _restoreSnapshot(data) {
    this._revision = Math.max(this._revision, Number(data.revision) || 0);
    for (const el of [...this._windowEls.values(), ...this._frameEls.values()]) el.classList.remove('is-dragging');
    this._syncWindows(data.windows || {}); this._syncFrames(data.frames || {});
    this._setSheetState(data.sheet || {});
    this._locks = structuredClone(data.locks || {});
    this._emitWindows('snapshot', {}); this._emitFrames('snapshot', {}); this._emitSheet('snapshot', {});
    this._emit('coact:lock', { type: 'lock.snapshot' });
  }

  _setStatus(state, extra = {}) {
    this.dispatchEvent(new CustomEvent('coact:status', {
      detail: { state, online: this._online, ...extra },
      bubbles: true,
      composed: true
    }));
  }

  _emitPresence() {
    this.dispatchEvent(new CustomEvent('coact:presence', {
      detail: {
        self: { ...this._self },
        peers: this.peers,
        online: this._online
      },
      bubbles: true,
      composed: true
    }));
  }

  _emitWindows(action, changed) {
    this.dispatchEvent(new CustomEvent('coact:windows', {
      detail: { action, changed, windows: this.windows },
      bubbles: true,
      composed: true
    }));
  }

  reconcileState() {
    for (const [id, state] of this._windows.entries()) {
      if (this._defs.has(id) && !this._windowEls.has(id)) this._createWindowEl(state);
    }
    for (const [id, state] of this._frames.entries()) {
      if (!this._frameEls.has(id)) this._createFrameEl(state);
    }
    this._renderAllGeometry();
  }

  _setHydrationReady() {
    this._canSeed = false;
    this.dataset.canSeed = 'false';
    if (this.hasAttribute('data-state-loaded')) return;
    this.setAttribute('data-state-loaded', '');
    this.dispatchEvent(new CustomEvent('coact:ready', {
      detail: { windows: this.windows, frames: this.frames, sheet: this.sheet },
      bubbles: true,
      composed: true
    }));
  }

  _emitFrames(action, changed) {
    this.dispatchEvent(new CustomEvent('coact:frames', {
      detail: { action, changed, frames: this.frames },
      bubbles: true,
      composed: true
    }));
  }

  _emitSheet(action, changed) {
    this.dispatchEvent(new CustomEvent('coact:sheet', {
      detail: { action, changed, sheet: this.sheet },
      bubbles: true,
      composed: true
    }));
  }

  _emitJournal(action, events, metadata = {}) {
    this.dispatchEvent(new CustomEvent('coact:journal', {
      detail: { action, events, journal: this.journal, revision: this._revision, ...metadata },
      bubbles: true,
      composed: true
    }));
  }

  _emitDrawMode(active) {
    this.dispatchEvent(new CustomEvent('coact:drawmode', {
      detail: { active, type: 'image-frame' },
      bubbles: true,
      composed: true
    }));
  }

  _handleMessage(data) {
    if (!data || typeof data.type !== 'string') return;
    if (data.revision != null && Number.isFinite(Number(data.revision))) this._revision = Math.max(this._revision, Number(data.revision));
    if (data.journalEvent) {
      const event = data.journalEvent;
      if (!this._journal.some((existing) => existing.seq === event.seq)) {
        this._journal.push({ ...event });
        this._journal.sort((a, b) => a.seq - b.seq);
        if (this._journal.length > 200) this._journal.splice(0, this._journal.length - 200);
        this._emitJournal(event.type, [event]);
      }
    }

    if (data.type === 'ack' || data.type === 'conflict') {
      this._finishMutation(data);
      this._emit(data.type === 'ack' ? 'coact:ack' : 'coact:conflict', data);
      return;
    }

    if (data.type === 'snapshot') { this._restoreSnapshot(data); return; }

    if (data.type === 'journal') {
      const seen = new Set(this._journal.map((event) => event.seq));
      for (const event of data.events || []) if (!seen.has(event.seq)) this._journal.push({ ...event });
      this._journal.sort((a, b) => a.seq - b.seq);
      if (this._journal.length > 200) this._journal.splice(0, this._journal.length - 200);
      this._emitJournal('query', data.events || [], { truncated: data.truncated, fromSeq: data.fromSeq, nextSeq: data.nextSeq });
      return;
    }

    if (data.type === 'lock.acquired' || data.type === 'lock.released' || data.type === 'lock.denied') {
      this._lockRequests.delete(data.path);
      if (data.type === 'lock.acquired' && data.path && data.lock) {
        const { token, ...lock } = data.lock;
        this._locks[data.path] = lock;
        if (token && lock.actorId === this._self.id) this._ownLocks.set(data.path, { ...lock, token, renewAt: Date.now() + Math.max(30, (lock.expiresAt - Date.now()) * .6) });
        this._flushLockReleases();
      }
      if (data.type === 'lock.released') for (const path of data.paths || []) { delete this._locks[path]; this._ownLocks.delete(path); }
      if (data.type === 'lock.denied') {
        this._ownLocks.delete(data.path);
        if (data.lock) this._locks[data.lock.path] = data.lock; else delete this._locks[data.path];
      }
      this._flushLockReleases();
      this._emit('coact:lock', { ...data, lock: data.lock ? { ...data.lock, token: undefined } : undefined });
      for (const [id, el] of this._frameEls) this._applyFrameDetails(el, this._frames.get(id));
      return;
    }

    if (data.type === 'error') {
      if (data.code === 'rate_limited' && !data.requestId) {
        this._connected = false;
        this._setStatus('offline', { code: 'rate_limited' });
        this._failMutations('rate_limited');
        this._socket?.close(4008, 'Rate limit exceeded');
      } else this._finishMutation(data);
      this.dispatchEvent(new CustomEvent('coact:error', { detail: { ...data }, bubbles: true, composed: true }));
      return;
    }

    if (data.type === 'welcome') {
      this._connected = true;
      this._reconnectAttempt = 0;
      clearInterval(this._lockMaintenance);
      this._lockMaintenance = setInterval(() => this._maintainLocks(), 1000);
      this._self.id = data.self?.id || '';
      this._self.name = data.self?.name || this._self.name;
      this._self.color = data.self?.color || this._self.color;
      this._self.badge = data.self?.badge || initials(this._self.name);
      this._self.role = data.self?.role || 'editor';
      this._revision = Number(data.revision) || 0;
      this._journal = Array.isArray(data.journal) ? data.journal.map((event) => ({ ...event })) : [];
      this._locks = data.locks && typeof data.locks === 'object' ? { ...data.locks } : {};
      this._canSeed = Boolean(data.canSeed) && !this.hasAttribute('data-state-loaded');
      this.dataset.canSeed = String(this._canSeed);
      this._online = Math.max(1, Number(data.online) || 1);
      this._localZ = Math.max(10, Number(data.zTop) || 10);
      this._frameZTop = Math.max(10, Number(data.frameZTop) || 10);
      this._clearPeers();
      for (const peer of data.peers || []) {
        this._peers.set(peer.id, peer);
        this._renderPeer(peer);
      }
      this._syncWindows(data.windows || {});
      this._syncFrames(data.frames || {});
      this._setSheetState(data.sheet || {});
      this._setStatus('online');
      this._emitPresence();
      this._emitWindows('welcome', { restored: true });
      this._emitFrames('welcome', {});
      this._emitSheet('welcome', {});
      this._emitJournal('welcome', []);
      this._emit('coact:lock', { type: 'lock.snapshot' });
      this._sendCursor(true);
      // State hydration must be observable before any default-window seeding.
      if (this._windows.size === 0 && this._canSeed) this._seedInitialWindows();
      else this._setHydrationReady();
      return;
    }

    if (data.type === 'join' && data.peer) {
      this._peers.set(data.peer.id, data.peer);
      this._renderPeer(data.peer);
      this._online = Math.max(1, Number(data.online) || 1);
      this._emitPresence();
      return;
    }

    if (data.type === 'peer' && data.peer) {
      this._peers.set(data.peer.id, data.peer);
      this._renderPeer(data.peer);
      return;
    }

    if (data.type === 'leave') {
      this._peers.delete(data.id);
      this._removeCursor(data.id);
      this._online = Math.max(1, Number(data.online) || 1);
      this._emitPresence();
      return;
    }

    if (data.type === 'window' && data.window) {
      if (data.action === 'close') {
        this._removeWindow(data.window.id);
        this._emitWindows('close', data.window);
        return;
      }
      const currentEl = this._windowEls.get(data.window.id);
      if (currentEl?.classList.contains('is-dragging') && this._ownLocks.get(`window.${data.window.id}`)?.expiresAt > Date.now()) {
        const current = this._windows.get(data.window.id);
        if (current) this._windows.set(data.window.id, { ...current, actor: data.window.actor });
      } else {
        // High-frequency move/resize messages must never retrigger decorative animation.
        this._applyWindow(data.window);
      }
      this._emitWindows(data.action, data.window);
      return;
    }

    if (data.type === 'frame' && data.frame) {
      if (data.action === 'delete') {
        this._removeFrame(data.frame.id);
      } else {
        const el = this._frameEls.get(data.frame.id);
        if (el?.classList.contains('is-dragging') && this._ownLocks.get(`frame.${data.frame.id}`)?.expiresAt > Date.now()) {
          const current = this._frames.get(data.frame.id);
          if (current) this._frames.set(data.frame.id, { ...current, actor: data.frame.actor });
        } else {
          // Keep remote frame updates animation-free for the same reason.
          this._applyFrame(data.frame);
        }
      }
      this._emitFrames(data.action, data.frame);
      return;
    }

    if (data.type === 'sheet') {
      if (data.action === 'cell' && data.change) {
        this._sheet.cells[data.change.address] = String(data.change.value ?? '');
      } else if (data.action === 'replace') {
        this._sheet.cells = { ...(data.cells || {}) };
      } else if (data.action === 'selection' && data.selection) {
        if (data.selection.address) {
          this._sheet.selections[data.selection.clientId] = { ...data.selection };
        } else {
          delete this._sheet.selections[data.selection.clientId];
        }
      }
      this._emitSheet(data.action, data);
      return;
    }

    if (data.type === 'action') {
      this.dispatchEvent(new CustomEvent('coact:action', {
        detail: { name: data.name, payload: data.payload, actor: data.actor },
        bubbles: true,
        composed: true
      }));
      return;
    }

    if (data.type === 'room-state') {
      this._clearLocks();
      this._locks = data.locks || {};
      this._syncWindows(data.windows || {});
      this._syncFrames(data.frames || {});
      this._setSheetState(data.sheet || {});
      this._localZ = Math.max(10, Number(data.zTop) || 10);
      this._frameZTop = Math.max(10, Number(data.frameZTop) || 10);
      this._emitWindows('reset', { actor: data.actor });
      this._emitFrames('reset', { actor: data.actor });
      this._emitSheet('reset', { actor: data.actor });
      if (data.canSeed && data.actor?.id === this._self.id) {
        this.dataset.canSeed = 'true'; this._emitSheet('welcome', {}); this._seedInitialWindows();
      }
      else this._setHydrationReady();
    }
  }

  _seedInitialWindows() {
    for (const [id, def] of this._defs.entries()) {
      if (!def.open || this._windows.has(id)) continue;
      this.openWindow(id);
    }
    this._setHydrationReady();
  }

  _clearPeers() {
    this._peers.clear();
    for (const id of [...this._cursorEls.keys()]) this._removeCursor(id);
  }

  _cursorEl(peer) {
    if (this._cursorEls.has(peer.id)) return this._cursorEls.get(peer.id);
    const el = document.createElement('div');
    el.className = 'cw-cursor';
    el.style.setProperty('--peer-color', peer.color || '#b95b73');
    el.innerHTML = `${CURSOR_SVG}<span class="cw-cursor-label"></span>`;
    this._cursorLayer.appendChild(el);
    this._cursorEls.set(peer.id, el);
    return el;
  }

  _renderPeer(peer) {
    if (!peer || peer.id === this._self.id) return;
    const el = this._cursorEl(peer);
    el.style.setProperty('--peer-color', peer.color || '#b95b73');
    el.querySelector('.cw-cursor-label').textContent = peer.name || 'Guest';
    el.classList.toggle('is-down', Boolean(peer.down));
    const x = clamp(peer.x, 0, 1) * this.clientWidth;
    const y = clamp(peer.y, 0, 1) * this.clientHeight;
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    el.classList.add('is-visible');
  }

  _removeCursor(id) {
    this._cursorEls.get(id)?.remove();
    this._cursorEls.delete(id);
  }

  _syncWindows(states) {
    const incoming = new Set(Object.keys(states || {}));
    for (const id of [...this._windows.keys()]) {
      if (!incoming.has(id) && !this._windowEls.get(id)?.classList.contains('is-dragging')) this._removeWindow(id, { emit: false });
    }
    for (const [id, state] of Object.entries(states || {})) {
      this._applyWindow({ ...state, id });
    }
  }

  _applyWindow(state) {
    if (!state?.id) return;
    const normalized = {
      ...state,
      x: Number(state.x) || 0.15,
      y: Number(state.y) || 0.15,
      w: Number(state.w) || 0.36,
      h: Number(state.h) || 0.42,
      z: Number(state.z) || 1
    };
    this._windows.set(normalized.id, normalized);
    this._localZ = Math.max(this._localZ, normalized.z);

    let el = this._windowEls.get(normalized.id);
    if (!el && this._defs.has(normalized.id)) el = this._createWindowEl(normalized);
    if (!el) return;

    this._applyGeometry(el, normalized);
    this._applyActor(el, normalized.actor);

  }

  _createWindowEl(state) {
    const def = this._defs.get(state.id);
    if (!def) return null;
    if (this._windowEls.has(state.id)) return this._windowEls.get(state.id);

    const el = document.createElement('section');
    el.className = 'cw-window';
    el.setAttribute('part', 'window');
    el.setAttribute('aria-label', `${def.title} shared window`);
    el.style.setProperty('--coact-window-accent', def.accent);
    el.innerHTML = `
      <header class="cw-window-head" part="window-header">
        <span class="cw-window-mark" aria-hidden="true"></span>
        <span class="cw-window-title"></span>
        <span class="cw-actor"></span>
        <button class="cw-close" type="button" aria-label="Close ${this._escapeAttr(def.title)}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
        </button>
      </header>
      <div class="cw-window-body" part="window-body" tabindex="0" aria-label="${this._escapeAttr(def.title)} content"></div>
      <span class="cw-resize" part="resize-handle" aria-hidden="true"></span>`;
    el.querySelector('.cw-window-title').textContent = def.title;

    const body = el.querySelector('.cw-window-body');
    if (def.content instanceof Node || typeof def.content === 'function') {
      let wrapper = this._slotted.get(state.id);
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'cw-slotted';
        wrapper.dataset.cwWindow = state.id;
        const slotName = `cw-${state.id}`;
        wrapper.slot = slotName;
        this.appendChild(wrapper);
        this._slotted.set(state.id, wrapper);
        const value = typeof def.content === 'function' ? def.content(el) : def.content;
        if (value instanceof Node) wrapper.appendChild(value);
        else wrapper.innerHTML = String(value ?? '');
      }
      const slot = document.createElement('slot');
      slot.name = `cw-${state.id}`;
      body.appendChild(slot);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'cw-fallback-content';
      fallback.innerHTML = String(def.content ?? '');
      body.appendChild(fallback);
    }

    this._windowLayer.appendChild(el);
    this._windowEls.set(state.id, el);
    this._wireWindow(el, state.id);
    return el;
  }

  _wireWindow(el, id) {
    const head = el.querySelector('.cw-window-head');
    const resize = el.querySelector('.cw-resize');
    const close = el.querySelector('.cw-close');

    el.addEventListener('pointerdown', () => this.focusWindow(id), { passive: true });
    head.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.cw-close')) return;
      this._startDrag(event, id);
    });
    resize.addEventListener('pointerdown', (event) => this._startResize(event, id));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closeWindow(id);
    });
  }

  _startDrag(event, id) { this._startGesture(event, id, 'window', false); }
  _startResize(event, id) { this._startGesture(event, id, 'window', true); }

  _startGesture(event, id, kind, resizing) {
    const scope = `${kind}.${id}`;
    if (event.button !== 0 || !this._canEdit(scope)) return;
    const frame = kind === 'frame';
    const state = (frame ? this._frames : this._windows).get(id);
    const el = (frame ? this._frameEls : this._windowEls).get(id);
    if (!state || !el || el.classList.contains('is-dragging')) return;
    event.preventDefault(); event.stopPropagation();
    this.acquireLock(scope);
    if (frame) this._focusFrame(id); else this.focusWindow(id);
    el.classList.add('is-dragging');
    el.setPointerCapture(event.pointerId);
    const rect = this._canvasRect();
    const start = { ...state };
    const startX = event.clientX, startY = event.clientY;
    const queue = force => frame ? this._queueFrame(resizing ? 'resize' : 'move', id, state, force) : this._queueWindow(resizing ? 'resize' : 'move', id, state, force);
    let ended = false, moved = false, granted = false;
    const move = next => {
      if (next.pointerId !== event.pointerId || !(this._ownLocks.get(scope)?.expiresAt > Date.now()) || !el.classList.contains('is-dragging')) return;
      if (!granted) { Object.assign(state, (frame ? this._frames : this._windows).get(id)); Object.assign(start, state); granted = true; }
      const dx = (next.clientX - startX) / rect.width, dy = (next.clientY - startY) / rect.height;
      if (resizing) {
        const minW = frame ? Math.max(.15, 220 / rect.width) : Math.max(.2, (this.clientWidth < 720 ? 210 : 250) / rect.width);
        const minH = frame ? Math.max(.15, 190 / rect.height) : Math.max(.16, (this.clientHeight < 520 ? 170 : 190) / rect.height);
        state.w = clamp(start.w + dx, minW, Math.min(frame ? .72 : .84, .99 - state.x));
        state.h = clamp(start.h + dy, minH, Math.min(frame ? .68 : .8, .97 - state.y));
      } else {
        state.x = clamp(start.x + dx, .01, .99 - state.w);
        state.y = clamp(start.y + dy, .01, .97 - state.h);
      }
      moved = true;
      if (frame) this._applyFrameGeometry(el, state); else this._applyGeometry(el, state);
      queue(false);
    };
    const end = next => {
      if (ended || next.type !== 'blur' && next.pointerId !== event.pointerId) return;
      ended = true;
      el.classList.remove('is-dragging');
      el.removeEventListener('pointermove', move);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) el.removeEventListener(name, end);
      window.removeEventListener('blur', end);
      if (moved && this._ownLocks.has(scope)) queue(true);
      this.releaseLock(scope);
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    };
    el.addEventListener('pointermove', move);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(name, end);
    window.addEventListener('blur', end);
  }

  _applyGeometry(el, state) {
    const width = Math.max(1, this.clientWidth);
    const height = Math.max(1, this.clientHeight);
    const compact = width < 720;
    const safeBottom = Number(this.getAttribute('safe-bottom')) || 16;
    const minWidth = compact ? 210 : 250;
    const minHeight = compact ? 170 : 190;
    let w = clamp(state.w, 0.18, 0.86) * width;
    let h = clamp(state.h, 0.16, 0.82) * height;
    w = Math.max(minWidth, Math.min(w, width - 16));
    h = Math.max(minHeight, Math.min(h, height - safeBottom - 16));
    const x = Math.min(clamp(state.x, 0.01, 0.94) * width, Math.max(8, width - w - 8));
    const y = Math.min(clamp(state.y, 0.01, 0.92) * height, Math.max(8, height - h - safeBottom));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.width = `${Math.round(w)}px`;
    el.style.height = `${Math.round(h)}px`;
    el.style.zIndex = String(10 + Number(state.z || 0));
  }

  _renderAllGeometry() {
    for (const [id, state] of this._windows.entries()) {
      const el = this._windowEls.get(id);
      if (el) this._applyGeometry(el, state);
    }
    for (const [id, state] of this._frames.entries()) {
      const el = this._frameEls.get(id);
      if (el) this._applyFrameGeometry(el, state);
    }
    for (const [id, peer] of this._peers.entries()) this._renderPeer({ ...peer, id });
  }

  _applyActor(el, actor) {
    const node = el.querySelector('.cw-actor');
    if (!actor) {
      node.textContent = '—';
      el.style.setProperty('--coact-actor', 'var(--coact-line-strong)');
      return;
    }
    node.textContent = actor.id === this._self.id ? 'You' : actor.name;
    node.title = actor.name;
    el.style.setProperty('--coact-actor', actor.color || 'var(--coact-line-strong)');
  }

  _removeWindow(id, { emit = true } = {}) {
    const el = this._windowEls.get(id);
    if (el) {
      el.style.pointerEvents = 'none';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px) scale(.985)';
      setTimeout(() => el.remove(), 160);
    }
    this._windowEls.delete(id);
    this._windows.delete(id);
    if (emit) this._emitWindows('close', { id });
  }

  _setSheetState(sheet) {
    this._sheet = {
      cells: { ...(sheet?.cells || {}) },
      selections: Object.fromEntries(Object.entries(sheet?.selections || {}).map(([id, value]) => [id, { ...value }]))
    };
  }

  _syncFrames(states) {
    const incoming = new Set(Object.keys(states || {}));
    for (const id of [...this._frames.keys()]) {
      if (!incoming.has(id) && !this._frameEls.get(id)?.classList.contains('is-dragging')) this._removeFrame(id, { emit: false });
    }
    for (const [id, state] of Object.entries(states || {})) this._applyFrame({ ...state, id });
  }

  _applyFrame(state) {
    if (!state?.id) return;
    const normalized = {
      ...state,
      x: Number(state.x) || 0.15,
      y: Number(state.y) || 0.15,
      w: Number(state.w) || 0.28,
      h: Number(state.h) || 0.34,
      z: Number(state.z) || 1,
      prompt: String(state.prompt || ''),
      status: state.status || 'empty',
      seed: Number(state.seed) || 0
    };
    this._frames.set(normalized.id, normalized);
    this._frameZTop = Math.max(this._frameZTop, normalized.z);

    let el = this._frameEls.get(normalized.id);
    if (!el) el = this._createFrameEl(normalized);
    if (!el) return;
    this._applyFrameGeometry(el, normalized);
    this._applyFrameDetails(el, normalized);

  }

  _createFrameEl(state) {
    if (this._frameEls.has(state.id)) return this._frameEls.get(state.id);
    const el = document.createElement('article');
    el.className = 'cw-image-frame';
    el.setAttribute('part', 'image-frame');
    el.setAttribute('aria-label', 'Shared image frame');
    el.innerHTML = `
      <header class="cw-frame-head">
        <span class="cw-frame-grip" aria-hidden="true"></span>
        <span class="cw-frame-label">Coact frame</span>
        <span class="cw-frame-actor"></span>
        <button class="cw-frame-delete" type="button" aria-label="Delete image frame">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M6 4V2.5h4V4M5 6.5v6M8 6.5v6M11 6.5v6M4.2 4l.6 10h6.4l.6-10"/></svg>
        </button>
      </header>
      <div class="cw-frame-art"></div>
      <div class="cw-frame-composer">
        <input class="cw-frame-prompt" type="text" maxlength="500" placeholder="Describe an image" aria-label="Image prompt">
        <button class="cw-frame-generate" type="button" aria-label="Generate placeholder image" title="Generate placeholder">
          <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1.5l1.2 4.3L14.5 7l-4.3 1.2L9 12.5 7.8 8.2 3.5 7l4.3-1.2L9 1.5Z"/><path d="M14.5 11.5l.6 2.2 2.2.6-2.2.6-.6 2.2-.6-2.2-2.2-.6 2.2-.6.6-2.2Z"/></svg>
        </button>
      </div>
      <span class="cw-frame-resize" aria-hidden="true"></span>`;

    const prompt = el.querySelector('.cw-frame-prompt');
    const generate = el.querySelector('.cw-frame-generate');
    prompt.addEventListener('focus', () => {
      this.acquireLock(`frame.${state.id}.prompt`);
      this._applyFrameDetails(el, this._frames.get(state.id));
    });
    prompt.addEventListener('blur', () => this.releaseLock(`frame.${state.id}.prompt`));
    prompt.addEventListener('input', () => {
      const current = this._frames.get(state.id);
      if (!current) return;
      const value = prompt.value;
      const path = `frame.${state.id}.prompt`;
      const leased = [...this._ownLocks.values()].some(lock => lock.expiresAt > Date.now() && touches(path, lock.path));
      if (prompt.readOnly || !leased || !this._canEdit(path)) {
        this._emit('coact:unsaved', { code: 'edit_access_pending', operations: [{ type: 'frame', action: 'update', id: state.id, prompt: value }] });
        prompt.value = current.prompt;
        return;
      }
      if (!this._mutate({ type: 'frame', action: 'update', id: state.id, prompt: value })) { prompt.value = current.prompt; return; }
      Object.assign(current, { prompt: value, status: 'empty', seed: 0, actor: this._self });
      this._applyFrameDetails(el, current);
    });
    prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this._generateFrame(state.id);
      }
    });
    generate.addEventListener('click', () => this._generateFrame(state.id));

    this._frameLayer.appendChild(el);
    this._frameEls.set(state.id, el);
    this._wireFrame(el, state.id);
    return el;
  }

  _wireFrame(el, id) {
    const head = el.querySelector('.cw-frame-head');
    const resize = el.querySelector('.cw-frame-resize');
    const remove = el.querySelector('.cw-frame-delete');

    el.addEventListener('pointerdown', () => this._focusFrame(id), { passive: true });
    head.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.cw-frame-delete')) return;
      this._startFrameDrag(event, id);
    });
    resize.addEventListener('pointerdown', (event) => this._startFrameResize(event, id));
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      this.deleteFrame(id);
    });
  }

  _applyFrameDetails(el, state) {
    const art = el.querySelector('.cw-frame-art');
    const prompt = el.querySelector('.cw-frame-prompt');
    const generate = el.querySelector('.cw-frame-generate');
    const actor = el.querySelector('.cw-frame-actor');

    if (this.shadowRoot.activeElement !== prompt || prompt.readOnly) prompt.value = state.prompt || '';
    generate.disabled = !state.prompt.trim() || state.status === 'generating';
    if (state.actor) {
      actor.textContent = state.actor.id === this._self.id ? 'You' : state.actor.name;
      actor.title = state.actor.name;
      el.style.setProperty('--coact-frame-actor', state.actor.color || 'var(--coact-line-strong)');
    } else {
      actor.textContent = '—';
      el.style.setProperty('--coact-frame-actor', 'var(--coact-line-strong)');
    }

    const path = `frame.${state.id}.prompt`;
    const leased = [...this._ownLocks.values()].some(lock => lock.expiresAt > Date.now() && touches(path, lock.path));
    prompt.readOnly = !this._canEdit(path) || !leased;
    prompt.setAttribute('aria-readonly', String(prompt.readOnly));
    prompt.setAttribute('aria-busy', String(this._lockRequests.has(path)));
    generate.disabled = generate.disabled || !this._canEdit(`frame.${state.id}`) || this._lockRequests.has(path);
    const placeholderImage = this.getAttribute('placeholder-image') || '';
    const placeholderTitle = this.getAttribute('placeholder-title') || '';
    const placeholderCode = this.getAttribute('placeholder-code') || '';
    const placeholderNote = this.getAttribute('placeholder-note') || 'PLACEHOLDER';

    const renderKey = JSON.stringify([state.status, state.seed, placeholderImage, placeholderTitle, placeholderCode, placeholderNote]);
    if (art.dataset.renderKey === renderKey) return;
    art.dataset.renderKey = renderKey;
    if (state.status === 'generated' && state.seed) {
      art.innerHTML = createPlaceholderSvg(state.seed);
      if (placeholderImage) {
        const brand = document.createElement('div');
        brand.className = 'cw-frame-brand';
        const image = document.createElement('img');
        image.src = placeholderImage;
        image.alt = '';
        brand.appendChild(image);
        art.appendChild(brand);
      }
      const note = document.createElement('span');
      note.className = 'cw-frame-placeholder-note';
      note.textContent = placeholderNote;
      art.appendChild(note);
    } else {
      const empty = document.createElement('div');
      empty.className = 'cw-frame-empty';
      empty.setAttribute('aria-hidden', 'true');
      if (placeholderImage) {
        const image = document.createElement('img');
        image.className = 'cw-frame-empty-logo';
        image.src = placeholderImage;
        image.alt = '';
        empty.appendChild(image);
      } else {
        const fallback = document.createElement('div');
        fallback.innerHTML = '<svg class="cw-frame-empty-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.2" cy="9" r="1.4"/><path d="M3.8 17l5.2-5 4.2 4 2.4-2.3 4.6 4.2"/></svg>';
        empty.appendChild(fallback.firstElementChild);
      }
      if (placeholderTitle) {
        const title = document.createElement('span');
        title.className = 'cw-frame-empty-title';
        title.textContent = placeholderTitle;
        empty.appendChild(title);
      }
      if (placeholderCode) {
        const code = document.createElement('code');
        code.className = 'cw-frame-empty-code';
        code.textContent = placeholderCode;
        empty.appendChild(code);
      }
      art.replaceChildren(empty);
    }
  }

  _focusFrame(id) {
    if (!this._canEdit(`frame.${id}`)) return false;
    const state = this._frames.get(id);
    const el = this._frameEls.get(id);
    if (!state || !el) return;
    state.z = this._nextFrameZ();
    state.actor = { id: this._self.id, name: this._self.name, color: this._self.color };
    el.style.zIndex = String(10 + state.z);
    this._applyFrameDetails(el, state);
    this._mutate({ type: 'frame', action: 'focus', id });
  }

  _startFrameDrag(event, id) { this._startGesture(event, id, 'frame', false); }
  _startFrameResize(event, id) { this._startGesture(event, id, 'frame', true); }

  _applyFrameGeometry(el, state) {
    const width = Math.max(1, this.clientWidth);
    const height = Math.max(1, this.clientHeight);
    const safeBottom = Number(this.getAttribute('safe-bottom')) || 16;
    let w = clamp(state.w, 0.1, 0.72) * width;
    let h = clamp(state.h, 0.1, 0.68) * height;
    w = Math.max(220, Math.min(w, width - 16));
    h = Math.max(190, Math.min(h, height - safeBottom - 16));
    const x = Math.min(clamp(state.x, 0.01, 0.94) * width, Math.max(8, width - w - 8));
    const y = Math.min(clamp(state.y, 0.01, 0.92) * height, Math.max(8, height - h - safeBottom));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.width = `${Math.round(w)}px`;
    el.style.height = `${Math.round(h)}px`;
    el.style.zIndex = String(10 + Number(state.z || 0));
  }

  _removeFrame(id, { emit = true } = {}) {
    const el = this._frameEls.get(id);
    if (el) {
      el.style.pointerEvents = 'none';
      el.style.opacity = '0';
      el.style.transform = 'translateY(5px) scale(.985)';
      setTimeout(() => el.remove(), 150);
    }
    this._frameEls.delete(id);
    this._frames.delete(id);
    if (emit) this._emitFrames('delete', { id });
  }

  _nextFrameZ() {
    this._frameZTop = Math.max(this._frameZTop, ...[...this._frames.values()].map((state) => Number(state.z) || 0)) + 1;
    return this._frameZTop;
  }

  _queueFrame(action, id, state, force = false) {
    this._pendingFrame = { action, id, state: { x: state.x, y: state.y, w: state.w, h: state.h }, final: force };
    if (force) {
      clearTimeout(this._frameTimer);
      this._frameTimer = null;
      this._flushFrame();
      return;
    }
    if (this._frameTimer) return;
    this._frameTimer = setTimeout(() => {
      this._frameTimer = null;
      this._flushFrame();
    }, 34);
  }

  _flushFrame() {
    if (!this._pendingFrame) return;
    const next = this._pendingFrame;
    this._pendingFrame = null;
    this._mutate({ type: 'frame', action: next.action, id: next.id, state: next.state, final: next.final });
  }

  _generateFrame(id) {
    if (!this._canEdit(`frame.${id}`)) return false;
    const state = this._frames.get(id);
    if (!state || !state.prompt.trim()) return;
    if (!this._mutate({ type: 'frame', action: 'generate', id })) return false;
    state.status = 'generating';
    state.actor = { id: this._self.id, name: this._self.name, color: this._self.color };
    this._applyFrameDetails(this._frameEls.get(id), state);
  }

  _startDraw(event) {
    if (!this._drawingMode || this._drawSession || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this._updateSelfCursor(event, true);
    this._drawLayer.setPointerCapture(event.pointerId);
    const rect = this._canvasRect();
    this._drawSession = {
      pointerId: event.pointerId,
      startX: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      startY: clamp((event.clientY - rect.top) / rect.height, 0, 1),
      endX: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      endY: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
    this._drawLayer.classList.add('is-drawing');
  }

  _moveDraw(event) {
    if (!this._drawSession || event.pointerId !== this._drawSession.pointerId) return;
    const rect = this._canvasRect();
    this._drawSession.endX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    this._drawSession.endY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const x = Math.min(this._drawSession.startX, this._drawSession.endX);
    const y = Math.min(this._drawSession.startY, this._drawSession.endY);
    const w = Math.abs(this._drawSession.endX - this._drawSession.startX);
    const h = Math.abs(this._drawSession.endY - this._drawSession.startY);
    Object.assign(this._drawPreview.style, {
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      width: `${w * 100}%`,
      height: `${h * 100}%`,
      display: w > 0 && h > 0 ? 'block' : 'none'
    });
  }

  _endDraw(event) {
    if (!this._drawSession || event.pointerId !== this._drawSession.pointerId) return;
    const rect = {
      x: Math.min(this._drawSession.startX, this._drawSession.endX),
      y: Math.min(this._drawSession.startY, this._drawSession.endY),
      w: Math.abs(this._drawSession.endX - this._drawSession.startX),
      h: Math.abs(this._drawSession.endY - this._drawSession.startY)
    };
    this.cancelFrameDraw();
    if (event.type === 'pointercancel') return;
    if (rect.w >= 0.08 && rect.h >= 0.08) this._createImageFrame(rect);
  }

  _createImageFrame(rect) {
    const id = `frame-${uid()}`;
    const state = {
      id,
      x: rect.x,
      y: rect.y,
      w: Math.max(0.16, rect.w),
      h: Math.max(0.18, rect.h),
      z: this._nextFrameZ(),
      prompt: '',
      status: 'empty',
      seed: 0,
      actor: { id: this._self.id, name: this._self.name, color: this._self.color }
    };
    if (!this._mutate({ type: 'frame', action: 'create', id, state: { x: state.x, y: state.y, w: state.w, h: state.h } })) return false;
    this._applyFrame(state);
    this._emitFrames('create', state);
    setTimeout(() => this._frameEls.get(id)?.querySelector('.cw-frame-prompt')?.focus({ preventScroll: true }), 60);
    return id;
  }

  _nextZ() {
    this._localZ = Math.max(this._localZ, ...[...this._windows.values()].map((state) => Number(state.z) || 0)) + 1;
    return this._localZ;
  }

  _queueWindow(action, id, state, force = false) {
    this._pendingWindow = { action, id, state: { x: state.x, y: state.y, w: state.w, h: state.h }, final: force };
    if (force) {
      clearTimeout(this._windowTimer);
      this._windowTimer = null;
      this._flushWindow();
      return;
    }
    if (this._windowTimer) return;
    this._windowTimer = setTimeout(() => {
      this._windowTimer = null;
      this._flushWindow();
    }, 34);
  }

  _flushWindow() {
    if (!this._pendingWindow) return;
    const next = this._pendingWindow;
    this._pendingWindow = null;
    this._mutate({ type: 'window', action: next.action, id: next.id, state: next.state, final: next.final });
    this._emitWindows(next.action, { id: next.id, ...next.state });
  }

  _updateSelfCursor(event, down) {
    const rect = this._canvasRect();
    if (!rect.width || !rect.height) return;
    this._self.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    this._self.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    if (typeof down === 'boolean') this._self.down = down;
    this._sendCursor(typeof down === 'boolean');
  }

  _sendCursor(force = false) {
    if (force) {
      clearTimeout(this._cursorTimer);
      this._cursorTimer = null;
      return this._send({ type: 'cursor', x: this._self.x, y: this._self.y, down: this._self.down, urgent: true });
    }
    if (this._cursorTimer) return false;
    this._cursorTimer = setTimeout(() => {
      this._cursorTimer = null;
      this._send({ type: 'cursor', x: this._self.x, y: this._self.y, down: this._self.down, urgent: false });
    }, 67);
    return true;
  }

  _canvasRect() {
    return this.shadowRoot.querySelector('.cw-canvas').getBoundingClientRect();
  }

  _escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export class CoactCanvas extends CoactRoom {}

if (!customElements.get('coact-room')) {
  customElements.define('coact-room', CoactRoom);
}
if (!customElements.get('coact-canvas')) {
  customElements.define('coact-canvas', CoactCanvas);
}


