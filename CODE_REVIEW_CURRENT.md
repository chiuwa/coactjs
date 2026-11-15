> Current candidate: **0.5.1** fixes the five follow-up findings and adds the packaged Node/Worker entries and bounded resource profiles. See CHANGELOG.md, docs/resources.md and VERIFICATION.md. The review below is historical context.

> Historical v0.4 review. The verified v0.5 implementation and its limits are documented in [CHANGELOG](CHANGELOG.md), [architecture](docs/architecture.md), [protocol](docs/protocol.md) and [security](SECURITY.md). The package has since been published; consult the changelog for current release status. The sections below describe the earlier review, not the current API contract.

# Coact.js — current project review

Reviewed against the actual code after the v0.4 refactor and identity fixes.

## 1. What this repository is

It is three things in one folder:

```text
Coact.js library      reusable browser component + public API
Demo application      enterprise-style shared workspace
Reference server      WebSocket room server + static file host
```

This is normal for an open-source project, but the boundary must be clear because only the first part is published as `coactjs`.

### Published package

`package.json`:

```json
{
  "name": "coactjs",
  "version": "0.4.0",
  "main": "./src/coact.js",
  "types": "./types/coact.d.ts",
  "exports": {
    ".": "./src/coact.js",
    "./room": "./src/coact-room.js",
    "./core": "./src/coact.js",
    "./styles": "./src/styles.js",
    "./placeholder": "./src/placeholder.js"
  }
}
```

npm package contents are limited to `src`, `types`, `assets/icons`, README, LICENSE, and the demo screenshot. The demo, server, vendored SheetJS, fonts, and screenshots outside that list are repository assets, not library runtime files.

### Repository-only files

- `demo/` — the enterprise workspace UI, Board / Sheet / Palette content, Excel grid, formula bar, XLSX import/export.
- `server.js` — reference WebSocket server and static host.
- `vendor/xlsx.mjs` — SheetJS CE, used by the demo only.
- `assets/fonts/` — Onest font for the demo.
- `assets/icons/` — brand icons, also exported with the package because `placeholder-image` examples reference them.
- `docs/`, `CODE_REVIEW.md`, `PRODUCT.md`, `DESIGN.md` — documentation.

## 2. Current source layout

```text
src/
  coact.js               public entry, small facade
  coact-room.js          Web Component / UI / transport implementation
  styles.js              extracted Shadow DOM CSS
  placeholder.js         deterministic image placeholder renderer
  sheet-collection.js    collection adapter for sheet cells
types/
  coact.d.ts             TypeScript surface
  coact-room.d.ts
```

Current approximate sizes:

| File | Size | Role |
|---|---:|---|
| `coact-room.js` | ~51 KB / 1,377 lines | main implementation |
| `coact.js` | ~3 KB / 89 lines | public facade |
| `styles.js` | ~14 KB / 594 lines | CSS |
| `placeholder.js` | ~1.7 KB | image placeholder |
| `sheet-collection.js` | ~0.4 KB | adapter |

This is much clearer than the previous single 66 KB file. Still, `coact-room.js` remains a large "everything element": transport, DOM, gestures, cursors, windows, frames, sheet state, hydration, and rendering are all in one class. That is acceptable for a v0.4 prototype, but it is the main technical debt.

## 3. What the library actually does today

### Browser element

- Defines `<coact-room>`.
- Defines `<coact-canvas>` as a subclass alias.
- Uses Shadow DOM for cursors, windows, frames, and drawing layer.
- Uses light-DOM slots for application-provided window content.
- Exposes CSS custom properties via `--coact-*`.

### Public facade

`src/coact.js` exports:

```js
Coact                    // frozen object: attach/create
createCoact(target, options)
CoactRoom
CoactCanvas
CoactRoomElement
default Coact
```

`createCoact()` is intentionally not a second runtime. It attaches to an existing `<coact-room>` / `<coact-canvas>` and returns a small API:

```js
coact.cursor.publish(point)
coact.presence.subscribe(handler)
coact.objects.snapshot / set / delete / subscribe
coact.collection(name)
coact.registerCollection(name, adapter)
coact.action(name, payload)
coact.on(eventName, handler)
```

This is useful, but it is still DOM-dependent. It is not yet a fully headless transport library.

### Room / protocol client

`coact-room.js` handles:

- endpoint resolution
- `WebSocket` lifecycle
- `hello`, `welcome`, `join`, `peer`, `leave`
- throttled cursor messages
- window / frame / sheet / action messages
- reconnect with exponential backoff
- state hydration and `coact:ready`

### Presence and identity

The server is now authoritative:

- each room has a monotonically increasing `joinIndex`;
- each client receives a unique generated `name`, `badge`, and muted HSL `color`;
- colors use golden-angle hue spacing;
- badges are shown in avatars instead of initials derived from names;
- cursor labels, avatar borders, and sheet selections use the same color;
- an explicit `name` / `color` from the client can override the generated identity.

This solved the previous "all Coral Finch / CF / similar colors" issue.

### Shared windows

- `registerWindow(id, options)`
- `openWindow`, `closeWindow`, `focusWindow`
- drag / resize / z-order
- content can be a DOM node, function, or trusted HTML string
- emits `coact:windows`

### Shared image frames

- `startFrameDraw()`, `cancelFrameDraw()`, `addImageFrame()`, `deleteFrame()`
- shared prompts and deterministic placeholder generation
- branded placeholder can be configured through `placeholder-*`
- drag / resize / focus
- emits `coact:frames`, `coact:drawmode`

Important: the image generation is a **placeholder**, not real AI generation. It produces a deterministic SVG based on a prompt seed.

### Shared sheet state

The library only synchronizes cell values and selections. It does not render a spreadsheet.

Methods:

- `updateSheetCell(address, value)`
- `replaceSheet(cells)`
- `selectSheetCell(address)`
- `collection('sheet').set/get/replace/snapshot/subscribe`

The actual Excel-like grid, formula bar, `SUM`, import, and export are in `demo/demo.js`. This is a good separation.

### Generic actions

```js
coact.action('image.generate', payload)
```

Server validates the action name and broadcasts it to other room members. Client receives `coact:action`.

This is a small but useful extension point. It is not persisted state.

### Events

All events bubble and are composed:

- `coact:status`
- `coact:presence`
- `coact:windows`
- `coact:frames`
- `coact:sheet`
- `coact:drawmode`
- `coact:ready`
- `coact:action`

## 4. What the demo adds

`demo/demo.js` is a product-shaped adapter. It provides:

- workspace shell and topbar
- tool rail and `aria-pressed` state
- Board, Notes, Sheet, Palette panels
- Excel-like grid and formula bar
- `=SUM(...)` evaluation
- XLSX import / export through SheetJS
- code drawer with HTML / JS / SYNC examples
- empty image frame with Coact icon, capability line, and `npm i coactjs`
- generated placeholder with Coact icon stamp

Demo-only behavior should be understood as examples, not library guarantees.

## 5. Server model

`server.js` keeps rooms in memory:

```js
{
  clients,
  windows,
  frames,
  sheet: { cells, selections },
  zTop,
  frameZTop,
  joinIndex
}
```

It:

- serves demo static files with `no-store`;
- upgrades `/ws?room=...` to WebSocket;
- assigns identity and colors;
- broadcasts presence and state messages;
- validates IDs, cell addresses, prompts, payload size, and action names;
- tracks `canSeed` so only the first client in an empty room seeds defaults;
- runs WebSocket heartbeat ping/pong.

There is no database. Restarting the server clears all room state.

## 6. Strengths

- Clear product identity after adding `src/coact.js`.
- Zero client runtime dependencies.
- Browser-native APIs only.
- Public facade and Web Component adapter can coexist.
- CSS and placeholder renderer are no longer buried inside the class.
- Server-authoritative identity prevents duplicate names / badges / colors.
- Server-authoritative seeding prevents new tabs from resetting shared state.
- High-frequency drag updates do not retrigger animations.
- Normalized geometry works across viewport sizes.
- Headless-ish facade, collection adapter, and generic actions are useful without over-building.
- Demo and library responsibilities are mostly separated.
- Axe / Impeccable detector / browser E2E / server tests currently pass.

## 7. Current code review findings

### P1 — `coact-room.js` is still a God Object

It contains transport, state, rendering, gestures, and all feature logic. This is the main maintainability risk.

Low-risk next split, if needed:

```text
core/transport.js
core/state.js
render/windows.js
render/frames.js
render/cursors.js
```

Avoid splitting further until there is a real plugin or adapter need.

### P1 — `createCoact()` is DOM-bound

`createCoact()` requires an existing `<coact-room>` instance. A developer who wants only presence + actions in React / Canvas / WebGL cannot use it.

This is a product decision, not a bug. If the long-term positioning is "shared action layer for any canvas", a future `createCoactClient()` with no DOM element is the key missing piece.

### P2 — `Coact.collection.sheet` is slightly misleading

`Coact.collection.sheet` exposes the `sheetCollection` adapter object, not a live collection. It is not used by the facade and could confuse users.

Better:

```js
export const Coact = Object.freeze({
  attach: createCoact,
  create: createCoact
});
```

or expose adapters under a clearer name:

```js
Coact.adapters.sheetCollection
```

### P2 — `hello.color` is effectively ignored

The client sends `color` when an attribute is set, but the server always assigns `colorForIndex(index)`. The README still says `color` is "one of the server palette colors", which is stale.

Pick one policy:

- server always assigns identity: remove `color` from `hello` and document that `color` is display-only / unsupported; or
- explicit color wins: server should honor a safe CSS color from `hello`.

Given the recent bug, the current "server always wins" behavior is safer. The docs and client message should be aligned.

### P2 — README / protocol docs still show old hex colors

Docs still show examples like `#b95b73` for peer identity, while the server now sends muted HSL values. The brand accent can remain `#b95b73`, but peer color examples should be updated to something like `hsl(138 25% 44%)` plus `badge`.

Also update `server.test.js` sample hello colors if they imply palette validation.

### P2 — `publicPeer()` includes `badge`, but `actorOf()` does not

Spreadsheet selections include actuator name and color but not badge. It is not critical, but inconsistent. If badges are part of identity, `actorOf()` should include it.

### P2 — Code drawer shows `import 'coactjs'`

The main entry now exports `Coact` / `createCoact`; a bare import still registers the custom element through side effects, but it no longer demonstrates the primary API. A better quick-start is:

```js
import { createCoact } from 'coactjs';

const coact = createCoact('#room', { room: 'demo' });
```

or explicitly:

```js
import 'coactjs/room';
```

depending on whether the user wants the element or facade.

### P2 — `content` still accepts trusted HTML strings

This is convenient but unsafe by default. Keep it for demo compatibility, but v1 should prefer `Node | () => Node` and provide a clearly named `htmlContent()` helper for trusted strings.

### P2 — Room memory is never evicted

Rooms stay in `Map` forever, even after all clients leave. For a demo this is fine. For long-running servers, add TTL / cleanup or a persistence plugin.

### P2 — No revision / conflict model

Concurrent edits are last-write-wins. Fine for cursors and small demos, insufficient for serious collaborative documents. Add `revision`, `updatedAt`, `actorId`, and server acks before using this for critical data.

### P2 — Type declarations are broad

`types/coact.d.ts` is useful but uses `unknown` for most state shapes. That is honest for v0.4, but can be improved with `Peer`, `WindowState`, `FrameState`, `SheetState`, and event map types.

### P3 — Vendored SheetJS is 1 MB

It is demo-only and not published with the library. Good. Just keep it out of `src` and keep the license file.

## 8. What to improve next, without over-designing

Recommended order:

1. Align docs with server-authoritative identity: `badge`, HSL colors, `canSeed`.
2. Remove or clearly rename `Coact.collection.sheet`.
3. Remove `color` from `hello` or let server honor it explicitly.
4. Add `badge` to `actorOf()` and selection metadata.
5. Update code drawer snippets to `createCoact` / `coactjs/room`.
6. Add typed event maps and peer/window/frame interfaces.
7. Add room TTL cleanup.
8. Only then consider a truly headless `createCoactClient()`.

Do **not** add React/Vue adapters, multi-transport backends, CRDT, auth, persistence, or plugin systems yet. Those should follow real usage.

## 9. Verdict

The project is now a coherent, demo-driven v0.4 library:

- product name and public entry match;
- core API exists without a heavy rewrite;
- CSS / placeholder / collection adapter are separated;
- identity, presence, seeding, and reload behavior are stable;
- demo clearly shows why the library is useful;
- tests and accessibility checks are clean.

The main remaining architectural gap is that the public facade still depends on a DOM element. The main code-quality gap is that `coact-room.js` remains a very large single class. Both are manageable and should be addressed only when there is a concrete user need.


---


## v0.5 completion

All state mutations now require revision checks; there is no strictRevision bypass. Conflicts compare touching paths, and same-client pending edits rebase only after the client's own ACK. Leases have private ownership tokens, renewal and ancestor enforcement. Permission checks run per message, including async hooks serialized with commits. The demo keeps rejected drafts and waits for confirmed imports. Activity is bounded and in memory; it is not durable file recovery.

See `test/server.test.js`, `test/browser.py` and `test/types.ts` for reproducible coverage. Headless transport, durable transactions and separate server packaging remain deferred.
