import { createCoact } from '../src/coact.js';

const params = new URLSearchParams(location.search);
const roomName = (params.get('room') || 'demo').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'demo';

const roomElement = document.querySelector('#room');
const room = roomElement;
const coact = createCoact(roomElement);
window.__coact = coact;
const avatarStack = document.querySelector('#avatar-stack');
const onlineCount = document.querySelector('#online-count');
const connectionDot = document.querySelector('#connection-dot');
const connectionLabel = document.querySelector('#connection-label');
const firstPeer = document.querySelector('#first-peer');
const roomChip = document.querySelector('#room-chip');
const roomLabel = document.querySelector('#room-name');
const codeButton = document.querySelector('#code-button');
const activityButton = document.querySelector('#activity-button');
const activitySheet = document.querySelector('#activity-sheet');
const activityClose = document.querySelector('#activity-close');
const activityList = document.querySelector('#activity-list');
const activityRevision = document.querySelector('#activity-revision');
const codeSheet = document.querySelector('#code-sheet');
const sheetClose = document.querySelector('#sheet-close');
const sheetScrim = document.querySelector('#sheet-scrim');
const codeContent = document.querySelector('#code-content');
const copyCode = document.querySelector('#copy-code');
const toast = document.querySelector('#toast');
const frameButton = document.querySelector('#frame-button');
const drawStatus = document.querySelector('#draw-status');
const cancelDraw = document.querySelector('#cancel-draw');

room.setAttribute('room', roomName);
roomLabel.textContent = roomName;

let toastTimer = null;
let activeCodeTab = 'html';
let triggerBeforeSheet = null;

const CODE = {
  html: `<script type="module">\n  import { createCoact } from 'coactjs';\n  const coact = createCoact('#room', { room: 'demo', endpoint: '/ws' });\n<\/script>\n\n<coact-room id="room"></coact-room>`,
  js: `import { createCoact } from 'coactjs';\n\nconst coact = createCoact('#room');\ncoact.element.registerWindow('notes', {\n  title: 'Notes',\n  open: true,\n  content: () => document.createElement('textarea')\n});\n\ncoact.presence.subscribe(({ peers }) => console.log(peers));\ncoact.on('coact:ready', () => console.log('Room ready'));`,
  sync: `const sheet = coact.collection('sheet');\n\n// State edits are queued and acknowledged.\nsheet.set('A1', 'Hello');\nsheet.subscribe(cells => console.log(cells));\n\n// Await a server decision when saving matters.\ntry {\n  await coact.request('sheet', {\n    action: 'cell', address: 'B1', value: 'Ready'\n  });\n} catch (error) {\n  console.log('Not saved:', error.code);\n}\n\ncoact.on('coact:unsaved', event => keepDraft(event.detail));`
};

function icon(name) {
  const icons = {
    plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
    check: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.2l2.5 2.5L10 3.2"/></svg>',
    dots: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="16" cy="10" r="1.3"/></svg>'
  };
  return icons[name] || '';
}

function boardContent() {
  const node = document.createElement('div');
  node.className = 'board-panel';
  node.innerHTML = `
    <div class="board-toolbar">
      <span class="board-live"><i></i>Live</span>
      <span class="spacer"></span>
      <div class="mini-presence" aria-hidden="true">
        <span class="mini-avatar" style="background:#f2dde3">A</span>
        <span class="mini-avatar" style="background:#f1ece2">J</span>
        <span class="mini-avatar" style="background:#e8ede5">M</span>
      </div>
    </div>
    <div class="board-columns" tabindex="0" role="region" aria-label="Board columns">
      <section class="board-column">
        <p class="column-title"><span>Now</span><b>02</b></p>
        <article class="sticky rose">
          <h2>Set the room</h2>
          <p>Drop the invite link into the shared thread.</p>
          <div class="sticky-meta"><span class="sticky-tag">Share</span><span class="sticky-avatar">A</span></div>
        </article>
        <article class="sticky butter">
          <h2>Cursor pass</h2>
          <p>Move across the canvas and watch the second tab.</p>
          <div class="sticky-meta"><span class="sticky-tag">Test</span><span class="sticky-avatar">J</span></div>
        </article>
      </section>
      <section class="board-column">
        <p class="column-title"><span>Next</span><b>02</b></p>
        <article class="sticky sage">
          <h2>Window snap</h2>
          <p>Resize the corner, then trade places.</p>
          <div class="sticky-meta"><span class="sticky-tag">Flow</span><span class="sticky-avatar">M</span></div>
        </article>
        <article class="sticky cream">
          <h2>Room palette</h2>
          <p>Pull the rose and cream tokens apart.</p>
          <div class="sticky-meta"><span class="sticky-tag">Style</span><span class="sticky-avatar">A</span></div>
        </article>
      </section>
      <section class="board-column">
        <p class="column-title"><span>Done</span><b>02</b></p>
        <article class="sticky coral">
          <h2>Shared surface</h2>
          <p>Two windows, one quiet stage.</p>
          <div class="sticky-meta"><span class="sticky-tag">Live</span><span class="sticky-avatar">J</span></div>
        </article>
        <article class="sticky cream">
          <h2>Joined</h2>
          <p>Presence is on.</p>
          <div class="sticky-meta"><span class="sticky-tag">Ready</span><span class="sticky-avatar">M</span></div>
        </article>
      </section>
    </div>`;
  return node;
}

function notesContent() {
  const node = document.createElement('div');
  node.className = 'notes-panel';
  node.innerHTML = `
    <div class="note-top">
      <span class="note-date">NOV 15 / WORKSHOP</span>
      <span class="note-menu" aria-hidden="true">${icon('dots')}</span>
    </div>
    <h2>A quieter shared room.</h2>
    <div class="note-rule"></div>
    <ul class="note-list">
      <li><span class="note-check done">${icon('check')}</span><span>Move a window between two tabs.</span></li>
      <li><span class="note-check done">${icon('check')}</span><span>Resize the board from the corner.</span></li>
      <li><span class="note-check"></span><span>Open the palette and leave it somewhere.</span></li>
      <li><span class="note-check"></span><span>Pass the cursor to another person.</span></li>
    </ul>
    <div class="note-signoff"><span class="mini-avatar" style="background:var(--rose-weak)">RF</span><span>Rose Fox</span></div>`;
  return node;
}

function paletteContent() {
  const node = document.createElement('div');
  node.className = 'palette-panel';
  node.innerHTML = `
    <div class="swatch-grid">
      <div class="swatch" style="--swatch:#f2dde3"><strong>Rose</strong><span>#F2DDE3</span></div>
      <div class="swatch" style="--swatch:#fffdfd"><strong>Paper</strong><span>#FFFDFD</span></div>
      <div class="swatch" style="--swatch:#b98577"><strong>Clay</strong><span>#B98577</span></div>
      <div class="swatch" style="--swatch:#d8c7a4"><strong>Sand</strong><span>#D8C7A4</span></div>
      <div class="swatch" style="--swatch:#c7d1c4"><strong>Sage</strong><span>#C7D1C4</span></div>
      <div class="swatch" style="--swatch:#756c72;color:#fffdfd"><strong>Mauve</strong><span style="color:rgba(255,253,253,.7)">#756C72</span></div>
      <div class="swatch-note"><span>Component tokens</span><code>--coact-*</code></div>
    </div>`;
  return node;
}


const SHEET_COLUMNS = 6;
const SHEET_ROWS = 10;
const SHEET_COLUMN_NAMES = Array.from({ length: SHEET_COLUMNS }, (_, i) => String.fromCharCode(65 + i));
const DEFAULT_SHEET_CELLS = {
  A1: 'Workstream', B1: 'Owner', C1: 'Status', D1: 'Hours',
  A2: 'Image frames', B2: 'CF', C2: 'Live', D2: '8',
  A3: 'Shared sheet', B3: 'MH', C3: 'Live', D3: '6',
  A4: 'Board review', B4: 'RF', C4: 'Done', D4: '4',
  A5: 'Prompt pass', B5: 'PM', C5: 'Next', D5: '3',
  A6: 'Total', B6: '', C6: '', D6: '=SUM(D2:D5)',
  A8: 'Invite', B8: 'Copy room link', C8: 'Ready', D8: ''
};

let sheetElement = null;
let sheetGrid = null;
let formulaInput = null;
let cellAddress = null;
let sheetLive = null;
let sheetFileInput = null;
let selectedSheetCell = 'A1';
let sheetState = { cells: {}, selections: {} };
let xlsxModule = null;
const sheetInputs = new Map();
let editingSheetCell = null;
let requestedSheetCell = null;
let unsavedDrafts = [];
let draftHistoryTrimmed = false;

function cellAddressFrom(row, column) {
  return `${String.fromCharCode(65 + column)}${row + 1}`;
}

function parseCellAddress(address) {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(String(address || '').toUpperCase());
  if (!match) return null;
  let column = 0;
  for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function rawSheetValue(address) {
  return String(sheetState.cells?.[address] ?? '');
}

function evaluateSheetCell(address, visiting = new Set()) {
  if (visiting.has(address)) return '#REF!';
  const raw = rawSheetValue(address);
  if (!raw.startsWith('=')) return raw;
  const sumMatch = /^=SUM\(([A-Z]+[1-9][0-9]*):([A-Z]+[1-9][0-9]*)\)$/i.exec(raw);
  if (!sumMatch) return '#VALUE!';
  const start = parseCellAddress(sumMatch[1]);
  const end = parseCellAddress(sumMatch[2]);
  if (!start || !end) return '#VALUE!';
  visiting.add(address);
  let total = 0;
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
      const value = evaluateSheetCell(cellAddressFrom(row, column), visiting);
      const number = Number(value);
      if (Number.isFinite(number)) total += number;
    }
  }
  visiting.delete(address);
  return total;
}

function displaySheetValue(address) {
  const value = evaluateSheetCell(address);
  return typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value ?? '');
}

function editSheetCell(address, value) {
  if (!room.updateSheetCell(address, value)) {
    retainDrafts([{ type: 'sheet', action: 'cell', address, value }]);
    return;
  }
  sheetState.cells[address] = value;
  renderSheet();
}

function beginSheetEdit(address) {
  if (editingSheetCell && editingSheetCell !== address) coact.lock.release(`sheet.${editingSheetCell}`);
  editingSheetCell = address;
  selectedSheetCell = address;
  selectSheetCell(address);
  renderLocks();
}

function retainDrafts(operations) {
  if (unsavedDrafts.length + operations.length > 32) draftHistoryTrimmed = true;
  unsavedDrafts = [...unsavedDrafts, ...operations].slice(-32);
  let draftBytes = new TextEncoder().encode(JSON.stringify(unsavedDrafts)).byteLength;
  while (draftBytes > 1024 * 1024 && unsavedDrafts.length > 1) { draftHistoryTrimmed = true; unsavedDrafts.shift(); draftBytes = new TextEncoder().encode(JSON.stringify(unsavedDrafts)).byteLength; }
  const recovery = document.querySelector('#draft-recovery');
  recovery.hidden = false;
  document.querySelector('#draft-count').textContent = `${draftHistoryTrimmed ? 'Latest ' : ''}${unsavedDrafts.length} unsaved ${unsavedDrafts.length === 1 ? 'change' : 'changes'}`;
}

function draftText(operation) {
  if (operation.type === 'sheet' && operation.action === 'cell') return `${operation.address}\t${operation.value}`;
  if (operation.type === 'sheet' && operation.action === 'replace') return Object.entries(operation.cells).map(([key, value]) => `${key}\t${value}`).join('\n');
  if (operation.prompt != null) return operation.prompt;
  return JSON.stringify(operation);
}

function applySheetState(sheet) {
  sheetState = {
    cells: { ...(sheet?.cells || {}) },
    selections: Object.fromEntries(Object.entries(sheet?.selections || {}).map(([id, value]) => [id, { ...value }]))
  };
  if (sheetElement) renderSheet();
}

function maybeSeedSheet(allowed = false) {
  if (!allowed || Object.keys(sheetState.cells || {}).length > 0) return;
  room.replaceSheet(DEFAULT_SHEET_CELLS);
}

function renderSheet() {
  if (!sheetElement) return;
  for (const [address, input] of sheetInputs.entries()) {
    if (document.activeElement !== input) input.value = displaySheetValue(address);
  }
  if (document.activeElement !== formulaInput) formulaInput.value = rawSheetValue(selectedSheetCell);
  cellAddress.textContent = selectedSheetCell;

  const selections = Object.values(sheetState.selections || {}).filter((selection) => selection.clientId !== room.self.id && selection.address);
  for (const input of sheetInputs.values()) {
    const cell = input.closest('.sheet-cell');
    cell.classList.remove('has-peer-selection');
    cell.style.removeProperty('--peer-color');
    cell.removeAttribute('title');
  }
  for (const selection of selections) {
    const input = sheetInputs.get(selection.address);
    if (!input) continue;
    const cell = input.closest('.sheet-cell');
    cell.classList.add('has-peer-selection');
    cell.style.setProperty('--peer-color', selection.color || '#b95b73');
    cell.title = `${selection.name || 'Someone'} is here`;
  }
  renderLocks();
}

function selectSheetCell(address, focus = false) {
  const parsed = parseCellAddress(address);
  if (!parsed || parsed.row >= SHEET_ROWS || parsed.column >= SHEET_COLUMNS) return;
  selectedSheetCell = address;
  cellAddress.textContent = address;
  formulaInput.value = rawSheetValue(address);
  room.selectSheetCell(address);
  if (focus) sheetInputs.get(address)?.focus();
}

function moveSheetSelection(address, key, shiftKey) {
  const parsed = parseCellAddress(address);
  if (!parsed) return;
  let { row, column } = parsed;
  if (key === 'ArrowUp') row -= 1;
  else if (key === 'ArrowDown' || key === 'Enter') row += 1;
  else if (key === 'ArrowLeft') column -= 1;
  else if (key === 'ArrowRight') column += 1;
  else if (key === 'Tab') column += shiftKey ? -1 : 1;
  else return false;
  row = Math.max(0, Math.min(SHEET_ROWS - 1, row));
  column = Math.max(0, Math.min(SHEET_COLUMNS - 1, column));
  const next = cellAddressFrom(row, column);
  selectSheetCell(next, true);
  return true;
}

async function getXLSX() {
  if (!xlsxModule) xlsxModule = await import('../vendor/xlsx.mjs');
  return xlsxModule;
}

async function importWorkbook(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Choose a spreadsheet under 2 MiB'); return; }
  try {
    const XLSX = await getXLSX();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', sheets: 0, sheetRows: SHEET_ROWS + 1, cellHTML: false });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });
    const cells = {};
    let hitLimit = Boolean(worksheet['!fullref']);
    rows.forEach((row, rowIndex) => {
      row.forEach((value, columnIndex) => {
        if (rowIndex >= SHEET_ROWS || columnIndex >= SHEET_COLUMNS) {
          if (value !== '' && value != null) hitLimit = true;
          return;
        }
        if (value === '' || value == null) return;
        cells[cellAddressFrom(rowIndex, columnIndex)] = String(value);
      });
    });
    if (Object.values(cells).some(value => value.length > 500)) { showToast('A cell exceeds the 500-character demo limit'); return; }
    await coact.request('sheet', { action: 'replace', cells });
    showToast(hitLimit ? `Imported first ${SHEET_COLUMNS} columns × ${SHEET_ROWS} rows` : 'Spreadsheet imported', 3000);
  } catch (error) {
    console.error(error);
    showToast(error.code ? 'Import not saved. Copy the draft and try again.' : 'Could not read that spreadsheet');
  }
}

async function exportWorkbook() {
  try {
    const XLSX = await getXLSX();
    const aoa = Array.from({ length: SHEET_ROWS }, (_, row) =>
      Array.from({ length: SHEET_COLUMNS }, (_, column) => displaySheetValue(cellAddressFrom(row, column)))
    );
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    for (let row = 0; row < SHEET_ROWS; row += 1) {
      for (let column = 0; column < SHEET_COLUMNS; column += 1) {
        const address = cellAddressFrom(row, column);
        const raw = rawSheetValue(address);
        if (!raw.startsWith('=')) continue;
        const computed = evaluateSheetCell(address);
        if (typeof computed === 'number') worksheet[address] = { t: 'n', v: computed, f: raw.slice(1) };
      }
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Coact');
    XLSX.writeFile(workbook, 'coact.xlsx');
    showToast('Spreadsheet exported');
  } catch (error) {
    console.error(error);
    showToast('Could not export the spreadsheet');
  }
}

function createSheetContent() {
  if (sheetElement) return sheetElement;
  const node = document.createElement('div');
  node.className = 'sheet-panel';
  const header = SHEET_COLUMN_NAMES.map((name) => `<th scope="col">${name}</th>`).join('');
  const body = Array.from({ length: SHEET_ROWS }, (_, row) => {
    const cells = Array.from({ length: SHEET_COLUMNS }, (_, column) => {
      const address = cellAddressFrom(row, column);
      return `<td class="sheet-cell" data-cell="${address}"><input data-cell="${address}" data-row="${row}" data-col="${column}" aria-label="Cell ${address}" maxlength="500" autocomplete="off" spellcheck="false"></td>`;
    }).join('');
    return `<tr><th class="sheet-row-head" scope="row">${row + 1}</th>${cells}</tr>`;
  }).join('');
  node.innerHTML = `
    <div class="sheet-toolbar">
      <button class="sheet-tool" type="button" data-sheet-action="import" aria-label="Import spreadsheet">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg><span>Import</span>
      </button>
      <button class="sheet-tool" type="button" data-sheet-action="export" aria-label="Export spreadsheet">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg><span>Export</span>
      </button>
      <span class="spacer"></span>
      <span class="sheet-live"><i></i><span>Live</span></span>
    </div>
    <div class="formula-bar">
      <span class="cell-address">A1</span>
      <input class="formula-input" aria-label="Formula bar" maxlength="500" autocomplete="off" spellcheck="false">
    </div>
    <div class="sheet-grid-wrap" tabindex="0" role="region" aria-label="Shared spreadsheet">
      <table class="shared-sheet">
        <colgroup><col>${'<col>'.repeat(SHEET_COLUMNS)}</colgroup>
        <thead><tr><th aria-hidden="true"></th>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="sheet-status"><span><strong>Budget.xlsx</strong></span><span>${SHEET_ROWS} × ${SHEET_COLUMNS}</span></div>
    <input class="sheet-import" type="file" accept=".xlsx,.xls,.csv" aria-label="Import spreadsheet file">
  `;

  sheetElement = node;
  sheetGrid = node.querySelector('.sheet-grid-wrap');
  formulaInput = node.querySelector('.formula-input');
  cellAddress = node.querySelector('.cell-address');
  sheetFileInput = node.querySelector('.sheet-import');
  const liveLabel = node.querySelector('.sheet-live span');
  sheetLive = {
    set textContent(value) { liveLabel.textContent = value; },
    get textContent() { return liveLabel.textContent; }
  };
  node.querySelectorAll('.sheet-cell input').forEach((input) => sheetInputs.set(input.dataset.cell, input));

  node.addEventListener('click', (event) => {
    const action = event.target.closest('[data-sheet-action]')?.dataset.sheetAction;
    if (action === 'import') sheetFileInput.click();
    if (action === 'export') exportWorkbook();
  });
  sheetFileInput.addEventListener('change', () => {
    importWorkbook(sheetFileInput.files?.[0]);
    sheetFileInput.value = '';
  });
  node.addEventListener('focusin', (event) => {
    const input = event.target.closest('.sheet-cell input');
    if (input) {
      input.value = rawSheetValue(input.dataset.cell);
      beginSheetEdit(input.dataset.cell);
    } else if (event.target === formulaInput) {
      formulaInput.value = rawSheetValue(selectedSheetCell);
      beginSheetEdit(selectedSheetCell);
    }
  });
  node.addEventListener('input', (event) => {
    const input = event.target.closest('.sheet-cell input');
    if (input && !input.readOnly) editSheetCell(input.dataset.cell, input.value);
    else if (event.target === formulaInput && !formulaInput.readOnly) editSheetCell(selectedSheetCell, formulaInput.value);
  });
  node.addEventListener('keydown', (event) => {
    const input = event.target.closest('.sheet-cell input');
    if (input && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'].includes(event.key)) {
      if (moveSheetSelection(input.dataset.cell, event.key, event.shiftKey)) event.preventDefault();
    } else if (event.target === formulaInput && event.key === 'Enter') {
      event.preventDefault(); moveSheetSelection(selectedSheetCell, 'Enter', false);
    }
  });
  node.addEventListener('focusout', () => queueMicrotask(() => {
    const active = document.activeElement;
    if (active === formulaInput || active?.matches('.sheet-cell input') && node.contains(active)) return;
    if (editingSheetCell) coact.lock.release(`sheet.${editingSheetCell}`);
    editingSheetCell = null;
    requestedSheetCell = null;
    room.selectSheetCell('');
    renderSheet();
  }));

  applySheetState(room.sheet);
  if (Object.keys(sheetState.cells).length === 0 && room.dataset.canSeed === 'true') maybeSeedSheet(true);
  renderSheet();
  return node;
}

room.registerWindow('board', {
  title: 'Launch board',
  accent: '#b95b73',
  open: true,
  start: { x: 0.045, y: 0.12 },
  size: { w: 0.43, h: 0.49 },
  content: boardContent
});

room.registerWindow('notes', {
  title: 'Workshop note',
  accent: '#a88270',
  open: false,
  start: { x: 0.57, y: 0.22 },
  size: { w: 0.34, h: 0.49 },
  content: notesContent
});

room.registerWindow('sheet', {
  title: 'Budget.xlsx',
  accent: '#8f9f77',
  open: true,
  start: { x: 0.52, y: 0.19 },
  size: { w: 0.43, h: 0.53 },
  content: createSheetContent
});

room.registerWindow('palette', {
  title: 'Signal palette',
  accent: '#9d7c86',
  start: { x: 0.34, y: 0.2 },
  size: { w: 0.31, h: 0.48 },
  content: paletteContent
});

function showToast(message, duration = 2200) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), duration);
}

function initials(name) {
  return String(name || 'G').split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase();
}


const JOURNAL_LABELS = {
  'presence.joined': 'joined the room',
  'presence.left': 'left the room',
  'sheet.cell.updated': 'updated a cell',
  'sheet.replaced': 'replaced the sheet',
  'window.opened': 'opened a window',
  'window.closed': 'closed a window',
  'window.moved': 'moved a window',
  'window.resized': 'resized a window',
  'frame.created': 'created a frame',
  'frame.deleted': 'deleted a frame',
  'frame.moved': 'moved a frame',
  'frame.resized': 'resized a frame',
  'frame.updated': 'edited a prompt',
  'frame.generated': 'generated a placeholder',
  'room.reset': 'reset the room',
  action: 'sent an action'
};

function journalSummary(event) {
  const label = JOURNAL_LABELS[event.type] || event.type;
  const path = event.path || '';
  const after = event.after;
  let detail = path;
  if (event.type === 'sheet.cell.updated' && typeof after === 'string') detail = `${path} → ${after || 'empty'}`;
  else if (event.type === 'action' && event.path) detail = event.path.replace(/^action\./, '');
  else if (event.type === 'frame.generated' && after?.prompt) detail = after.prompt;
  return { label, detail };
}

function renderJournal() {
  if (!activityList) return;
  const events = window.__coact?.journal || [];
  activityRevision.textContent = `rev ${window.__coact?.revision ?? 0}`;
  activityList.replaceChildren();
  if (!events.length) {
    const empty = document.createElement('p');
    empty.className = 'activity-empty';
    empty.textContent = 'Room activity will appear here.';
    activityList.appendChild(empty);
    return;
  }
  events.slice(-30).reverse().forEach((event) => {
    const item = document.createElement('article');
    item.className = 'activity-item';
    const badge = document.createElement('span');
    badge.className = 'activity-badge';
    badge.textContent = event.actor?.badge || '··';
    badge.style.borderColor = event.actor?.color || 'var(--line-strong)';
    const copy = document.createElement('div');
    copy.className = 'activity-copy';
    const strong = document.createElement('strong');
    const summary = journalSummary(event);
    strong.textContent = `${event.actor?.name || 'Someone'} ${summary.label}`;
    const detail = document.createElement('span');
    detail.textContent = summary.detail || '';
    const time = document.createElement('span');
    time.className = 'activity-time';
    time.textContent = new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    copy.append(strong, detail, time);
    item.append(badge, copy);
    activityList.appendChild(item);
  });
}

function openActivity() {
  if (codeSheet.classList.contains('is-open')) closeCodeSheet(false);
  triggerBeforeSheet = document.activeElement;
  activitySheet.inert = false;
  activitySheet.classList.add('is-open');
  activitySheet.setAttribute('aria-hidden', 'false');
  activityButton.setAttribute('aria-expanded', 'true');
  sheetScrim.classList.add('is-active');
  renderJournal();
  activityClose.focus({ preventScroll: true });
}

function closeActivity(restoreFocus = true) {
  activitySheet.classList.remove('is-open');
  activitySheet.setAttribute('aria-hidden', 'true');
  activitySheet.inert = true;
  activityButton.setAttribute('aria-expanded', 'false');
  if (!codeSheet.classList.contains('is-open')) sheetScrim.classList.remove('is-active');
  if (restoreFocus && triggerBeforeSheet instanceof HTMLElement) triggerBeforeSheet.focus({ preventScroll: true });
}

function renderLocks() {
  const locks = coact.locks;
  const online = connectionDot.dataset.state === 'online';
  const canEdit = online && ['owner', 'editor'].includes(coact.self.role);
  document.querySelectorAll('[data-window]').forEach(button => { button.disabled = !canEdit; });
  frameButton.disabled = !canEdit;
  document.querySelector('#reset-button').disabled = !online || coact.self.role !== 'owner';
  const lockAt = address => locks[`sheet.${address}`] || locks.sheet;
  for (const [address, input] of sheetInputs) {
    const cell = input.closest('.sheet-cell');
    const lock = lockAt(address);
    const foreign = lock && lock.actorId !== coact.self.id;
    cell.classList.toggle('is-locked', Boolean(foreign));
    if (lock) cell.style.setProperty('--lock-color', lock.color);
    else cell.style.removeProperty('--lock-color');
    cell.title = foreign ? `${lock.name} is editing ${address}` : '';
    input.readOnly = !canEdit || !lock || Boolean(foreign);
    input.setAttribute('aria-readonly', String(input.readOnly));
  }
  if (!formulaInput) return;
  const current = lockAt(selectedSheetCell);
  formulaInput.readOnly = !canEdit || !current || current.actorId !== coact.self.id;
  formulaInput.setAttribute('aria-readonly', String(formulaInput.readOnly));
  const foreign = current && current.actorId !== coact.self.id;
  sheetLive.textContent = !online ? 'Offline' : !canEdit ? 'Read only' : foreign ? `${current.name} editing` : editingSheetCell && !current ? 'Waiting for edit access' : 'Live';
  sheetElement.querySelector('[data-sheet-action="import"]').disabled = !canEdit;
  if (editingSheetCell && canEdit && !lockAt(editingSheetCell) && requestedSheetCell !== editingSheetCell) {
    requestedSheetCell = editingSheetCell;
    if (!coact.lock.acquire(`sheet.${editingSheetCell}`)) requestedSheetCell = null;
  }
}

function renderPresence(detail) {
  const people = [
    { ...detail.self, isSelf: true },
    ...detail.peers.map((peer) => ({ ...peer, isSelf: false }))
  ];
  avatarStack.replaceChildren();
  people.slice(0, 5).forEach((person) => {
    const avatar = document.createElement('span');
    avatar.className = 'avatar' + (person.isSelf ? ' is-self' : '');
    avatar.style.background = `color-mix(in srgb, ${person.color} 30%, var(--surface))`;
    avatar.style.color = 'var(--ink)';
    avatar.style.setProperty('--person', person.color);
    avatar.textContent = person.badge || initials(person.name);
    avatar.title = person.isSelf ? `${person.name} · you` : person.name;
    avatarStack.appendChild(avatar);
  });

  onlineCount.textContent = String(detail.online);
  onlineCount.title = `${detail.online} online`;
  const alone = detail.online <= 1;
  firstPeer.classList.toggle('is-hidden', !alone);
  document.body.classList.toggle('needs-peer', alone);
}

function updateDock() {
  const states = room.windows;
  const rail = document.querySelector('.rail');
  const ready = room.hasAttribute('data-state-loaded') || Object.keys(states).length > 0;
  if (rail) rail.classList.toggle('is-ready', ready);
  document.querySelectorAll('[data-window]').forEach((button) => {
    button.setAttribute('aria-pressed', String(ready && Boolean(states[button.dataset.window])));
  });
}

function currentUrl() {
  const url = new URL(location.href);
  url.searchParams.set('room', roomName);
  return url.toString();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function openCodeSheet() {
  if (activitySheet.classList.contains('is-open')) closeActivity(false);
  triggerBeforeSheet = document.activeElement;
  codeSheet.inert = false;
  codeSheet.classList.add('is-open');
  codeSheet.setAttribute('aria-hidden', 'false');
  codeButton.setAttribute('aria-expanded', 'true');
  document.body.classList.add('sheet-open');
  sheetScrim.classList.add('is-active');
  document.querySelector('[data-code-tab="html"]').focus({ preventScroll: true });
  document.querySelector('.workspace').scrollLeft = 0;
}

function closeCodeSheet(restoreFocus = true) {
  codeSheet.classList.remove('is-open');
  codeSheet.setAttribute('aria-hidden', 'true');
  codeSheet.inert = true;
  codeButton.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('sheet-open');
  sheetScrim.classList.remove('is-active');
  if (restoreFocus && triggerBeforeSheet instanceof HTMLElement) triggerBeforeSheet.focus({ preventScroll: true });
}

function setCodeTab(name) {
  activeCodeTab = name;
  codeContent.textContent = CODE[name];
  document.querySelectorAll('[data-code-tab]').forEach((tab) => {
    const active = tab.dataset.codeTab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
}

room.addEventListener('coact:status', (event) => {
  const state = event.detail.state;
  connectionDot.dataset.state = state;
  connectionLabel.textContent = state === 'online' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline';
  connectionDot.setAttribute('aria-label', connectionLabel.textContent);
  requestedSheetCell = null;
  renderLocks();
  if (state === 'offline') showToast('Disconnected. Changes will resume after reconnecting.');
});

room.addEventListener('coact:presence', (event) => {
  renderPresence(event.detail);
});

room.addEventListener('coact:windows', (event) => {
  if (['welcome', 'open', 'close', 'reset', 'move', 'resize', 'focus', 'snapshot', 'pending'].includes(event.detail.action)) updateDock();
});

room.addEventListener('coact:ready', updateDock);

room.addEventListener('coact:sheet', (event) => {
  applySheetState(event.detail.sheet);
  const empty = Object.keys(event.detail.sheet?.cells || {}).length === 0;
  if (!empty) return;
  if (event.detail.action === 'welcome' && room.dataset.canSeed === 'true') maybeSeedSheet(true);
});

room.addEventListener('coact:drawmode', (event) => {
  const active = Boolean(event.detail.active);
  frameButton.setAttribute('aria-pressed', String(active));
  drawStatus.hidden = !active;
});

room.addEventListener('coact:frames', (event) => {
  if (event.detail.action === 'create' && event.detail.changed?.actor?.id !== room.self.id) {
    showToast(`${event.detail.changed.actor?.name || 'Someone'} placed an image frame`);
  }
});

document.querySelectorAll('[data-window]').forEach((button) => {
  button.addEventListener('click', () => {
    const id = button.dataset.window;
    if (room.windows[id]) room.closeWindow(id);
    else room.openWindow(id);
    window.setTimeout(updateDock, 30);
  });
});

document.querySelector('#reset-button').addEventListener('click', () => {
  if (!room.resetRoom()) showToast('You cannot reset this room right now.');
});

frameButton.addEventListener('click', (event) => {
  if (event.detail === 0) {
    room.addImageFrame();
    return;
  }
  if (frameButton.getAttribute('aria-pressed') === 'true') room.cancelFrameDraw();
  else room.startFrameDraw();
});

cancelDraw.addEventListener('click', () => room.cancelFrameDraw());

document.querySelector('#copy-button').addEventListener('click', async () => {
  await copyText(currentUrl());
  showToast('Invite link copied');
});

roomChip.addEventListener('click', async () => {
  await copyText(currentUrl());
  showToast('Room link copied');
});

document.querySelector('#peer-button').addEventListener('click', () => {
  window.open(currentUrl(), '_blank', 'noopener');
});

codeButton.addEventListener('click', () => {
  if (codeSheet.classList.contains('is-open')) closeCodeSheet();
  else openCodeSheet();
});

sheetClose.addEventListener('click', () => closeCodeSheet());
activityButton.addEventListener('click', () => {
  if (activitySheet.classList.contains('is-open')) closeActivity();
  else openActivity();
});
activityClose.addEventListener('click', () => closeActivity());
window.__coact.on('coact:journal', renderJournal);
coact.on('coact:lock', event => {
  if (event.detail.path === `sheet.${requestedSheetCell}` || event.detail.type === 'lock.cleared') requestedSheetCell = null;
  renderLocks();
});
coact.on('coact:unsaved', event => retainDrafts(event.detail.operations));
window.__coact.on('coact:ack', (event) => { activityRevision.textContent = `rev ${event.detail.revision}`; });
coact.on('coact:conflict', event => {
  showToast(event.detail.reason === 'locked' ? 'Someone else is editing here. Your draft is kept.' : 'Change not saved. Your draft is kept.');
  updateDock(); renderLocks();
});
window.__coact.on('coact:error', (event) => {
  if (event.detail.code === 'rate_limited') showToast('Slow down: too many updates');
});
sheetScrim.addEventListener('click', () => {
  if (codeSheet.classList.contains('is-open')) closeCodeSheet();
  if (activitySheet.classList.contains('is-open')) closeActivity();
});
document.querySelector('#copy-drafts').addEventListener('click', async () => {
  await copyText(unsavedDrafts.map(draftText).join('\n'));
  showToast('Draft copied');
});
document.querySelector('#dismiss-drafts').addEventListener('click', () => {
  unsavedDrafts = []; draftHistoryTrimmed = false; document.querySelector('#draft-recovery').hidden = true;
});

document.querySelectorAll('[data-code-tab]').forEach((tab) => {
  tab.addEventListener('click', () => setCodeTab(tab.dataset.codeTab));
});

copyCode.addEventListener('click', async () => {
  await copyText(CODE[activeCodeTab]);
  showToast('Code copied');
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (codeSheet.classList.contains('is-open')) closeCodeSheet();
  if (activitySheet.classList.contains('is-open')) closeActivity();
});

setCodeTab('html');
updateDock();
window.__coactDemo = Object.freeze({ room, coact: window.__coact, updateDock, renderJournal, renderLocks });
roomElement.reconcileState();
updateDock();
applySheetState(roomElement.sheet);
renderJournal();
renderLocks();

