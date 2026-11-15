import { CoactRoom, CoactCanvas } from './coact-room.js';
import { sheetCollection } from './sheet-collection.js';

/**
 * Attach Coact to an existing <coact-room> / <coact-canvas> element.
 * This facade stays intentionally small: it reuses the browser element and protocol.
 */
export function createCoact(target, options = {}) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (!(element instanceof CoactRoom)) {
    throw new Error('Coact target must be a <coact-room> or <coact-canvas> element.');
  }

  for (const key of ['maxPayload', 'maxPendingBytes', 'maxIncomingBytes']) if (options[key] != null && (!Number.isSafeInteger(options[key]) || options[key] <= 0)) throw new RangeError(`${key} must be a positive safe integer.`);

  const attributes = {
    room: options.room,
    endpoint: options.endpoint,
    name: options.name,
    'safe-bottom': options.safeBottom,
    'max-payload': options.maxPayload,
    'max-pending-bytes': options.maxPendingBytes,
    'max-incoming-bytes': options.maxIncomingBytes,
    'placeholder-image': options['placeholder-image'],
    'placeholder-title': options['placeholder-title'],
    'placeholder-code': options['placeholder-code'],
    'placeholder-note': options['placeholder-note']
  };
  for (const [key, value] of Object.entries(attributes)) {
    if (value != null) element.setAttribute(key, String(value));
  }

  const api = {
    element,
    get self() { return element.self; },
    get peers() { return element.peers; },
    get online() { return element.online; },
    get windows() { return element.windows; },
    get frames() { return element.frames; },
    get revision() { return element.revision; },
    get stats() { return element.stats; },
    get journal() { return element.journal; },
    get locks() { return element.locks; },
    cursor: { publish: (point = {}) => element.publishCursor(point) },
    presence: {
      subscribe(handler) {
        const listener = (event) => handler(event.detail);
        element.addEventListener('coact:presence', listener);
        return () => element.removeEventListener('coact:presence', listener);
      }
    },
    objects: {
      get snapshot() { return { ...element.frames, ...element.windows }; },
      set(id, value) {
        const { kind, ...state } = value || {};
        if (!['window', 'frame'].includes(kind)) throw new TypeError('Specify kind: window or frame.');
        if (kind === 'window' && !element._defs.has(id)) throw new Error(`Window is not registered: ${id}`);
        const exists = kind === 'window' ? element.windows[id] : element.frames[id];
        return element.request(kind, { action: exists ? 'move' : kind === 'window' ? 'open' : 'create', id, state });
      },
      delete(id) {
        if (element.frames[id]) return element.deleteFrame(id);
        if (element.windows[id]) return element.closeWindow(id);
        return undefined;
      },
      subscribe(handler) {
        const listener = (event) => handler(api.objects.snapshot, event.detail);
        element.addEventListener('coact:windows', listener);
        element.addEventListener('coact:frames', listener);
        return () => {
          element.removeEventListener('coact:windows', listener);
          element.removeEventListener('coact:frames', listener);
        };
      }
    },
    collection(name) { return element.collection(name); },
    registerCollection(name, adapter) { return element.registerCollection(name, adapter); },
    action(name, payload) { return element.action(name, payload); },
    request(type, payload) { return element.request(type, payload); },
    journalSince(seq) { return element.journalSince(seq); },
    lock: {
      acquire(path, ttlMs) { return element.acquireLock(path, ttlMs); },
      renew(path) { return element.renewLock(path); },
      release(path) { return element.releaseLock(path); }
    },
    on(type, handler) {
      element.addEventListener(type, handler);
      return () => element.removeEventListener(type, handler);
    },
    connect() { return element.connect(); },
    disconnect() { return element.disconnect(); },
    reset() { return element.resetRoom(); }
  };

  return api;
}

export const Coact = Object.freeze({
  attach: createCoact,
  create: createCoact,
  adapters: Object.freeze({ sheet: sheetCollection }),
  collection: Object.freeze({ sheet: sheetCollection })
});

export { CoactRoom, CoactCanvas, sheetCollection };
export const CoactRoomElement = CoactRoom;
export default Coact;
