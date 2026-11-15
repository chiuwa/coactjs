/** Protocol helpers shared by the browser and the reference server. */
export const MAX_CELLS = 400;
export const ID_PATTERN = /^(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9_-]{1,48}$/;
export const CELL_PATTERN = /^(?:[A-Z]|A[A-Z])[1-9][0-9]?$/;
export const ACTION_PATTERN = /^[a-zA-Z][a-zA-Z0-9._:-]{0,79}$/;
export const REQUEST_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export function touches(a, b) {
  return a === 'room' || b === 'room' || a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

export function mutationScope(message) {
  if (message.type === 'reset') return 'room';
  if (message.type === 'window' && message.action !== 'focus') return `window.${message.id}`;
  if (message.type === 'frame' && message.action !== 'focus') return `frame.${message.id}`;
  if (message.type === 'sheet' && message.action === 'cell') return `sheet.${message.address}`;
  if (message.type === 'sheet' && message.action === 'replace') return 'sheet';
  return null;
}

export function validLockPath(value) {
  if (typeof value !== 'string') return false;
  if (value === 'sheet') return true;
  if (value.startsWith('sheet.')) return CELL_PATTERN.test(value.slice(6));
  const [kind, id, field, ...rest] = value.split('.');
  return ['window', 'frame'].includes(kind) && ID_PATTERN.test(id || '') && !rest.length &&
    (!field || (kind === 'frame' && field === 'prompt'));
}

export function validateMessage(message) {
  const fail = () => { throw Object.assign(new Error('Invalid message'), { code: 'invalid_message' }); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const string = (value, length) => typeof value === 'string' && value.length <= length;
  if (!object(message) || !string(message.type, 40)) fail();
  if (message.requestId !== undefined && (typeof message.requestId !== 'string' || !REQUEST_PATTERN.test(message.requestId))) fail();
  if (message.baseRevision !== undefined && (!Number.isSafeInteger(message.baseRevision) || message.baseRevision < 0)) fail();
  if (message.lockToken !== undefined && !string(message.lockToken, 80)) fail();
  if (message.final !== undefined && typeof message.final !== 'boolean') fail();
  switch (message.type) {
    case 'hello':
      if (message.flowControl !== undefined && typeof message.flowControl !== 'boolean') fail();
      if (message.name !== undefined && !string(message.name, 100)) fail();
      break;
    case 'cursor':
      if (message.urgent !== undefined && typeof message.urgent !== 'boolean') fail();
      if (![message.x, message.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) fail();
      if (message.down !== undefined && typeof message.down !== 'boolean') fail();
      break;
    case 'window':
    case 'frame': {
      const actions = message.type === 'window' ? ['open', 'close', 'move', 'resize', 'focus'] : ['create', 'delete', 'move', 'resize', 'focus', 'update', 'generate'];
      if (typeof message.id !== 'string' || !ID_PATTERN.test(message.id) || !actions.includes(message.action)) fail();
      if (message.action === 'update' && !string(message.prompt, 500)) fail();
      if (message.state !== undefined && (!object(message.state) || !['x', 'y', 'w', 'h'].every(key => message.state[key] === undefined || (typeof message.state[key] === 'number' && Number.isFinite(message.state[key]))))) fail();
      break;
    }
    case 'sheet':
      if (!['cell', 'replace', 'selection'].includes(message.action)) fail();
      if (message.action === 'replace') {
        if (!object(message.cells) || Object.keys(message.cells).length > MAX_CELLS) fail();
        if (!Object.entries(message.cells).every(([key, value]) => CELL_PATTERN.test(key) && string(value, 500))) fail();
      } else if (message.action === 'cell') {
        if (typeof message.address !== 'string' || !CELL_PATTERN.test(message.address) || !string(message.value, 500)) fail();
      } else if (typeof message.address !== 'string' || message.address !== '' && !CELL_PATTERN.test(message.address)) fail();
      break;
    case 'action':
      if (typeof message.name !== 'string' || !ACTION_PATTERN.test(message.name) || !object(message.payload) || JSON.stringify(message.payload).length > 16000) fail();
      break;
    case 'lock.acquire':
    case 'lock.renew':
    case 'lock.release':
      if (!validLockPath(message.path)) fail();
      if (message.ttlMs !== undefined && (!Number.isFinite(message.ttlMs) || message.ttlMs <= 0)) fail();
      if (message.token !== undefined && !string(message.token, 80)) fail();
      break;
    case 'journal.query':
      if (message.since !== undefined && (!Number.isSafeInteger(message.since) || message.since < 0)) fail();
      break;
    case 'delivery.ack':
      if (!Number.isSafeInteger(message.sequence) || message.sequence < 0) fail();
      break;
    case 'state.query':
    case 'reset':
      break;
    default: fail();
  }
  return message;
}
