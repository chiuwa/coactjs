# Coact.js library code review

## Short answer

Yes: if the product is **Coact.js**, the library should expose `coact.js` as the public entry and `Coact` as the main class/API. `coact-room.js` is an implementation detail that grew from the demo's "room" metaphor and the `<coact-room>` custom element.

The current code works, but the published library is too broad for a core package. It mixes:

1. a good real-time shared state / presence core;
2. a full opinionated window manager;
3. a built-in image-frame UI;
4. spreadsheet action helpers;
5. a large branded CSS theme;
6. demo-specific placeholder and install copy.

That is fine for a demo, but not yet the most elegant shape for an open-source JavaScript library.

---

## Current package shape

```text
package.json
  name: coactjs
  main/exports: ./src/coact-room.js

src/coact-room.js
  - const STYLE                 (about 14KB / 588 lines)
  - export class CoactRoom
  - customElements.define('coact-room', CoactRoom)
```

Stats:

- Source size: roughly 66 KB / 1,950 lines.
- Embedded CSS: roughly 14 KB / 588 lines, about 21% of the file.
- One exported class: `CoactRoom`.
- 66 class-level methods/properties; 47 private/helper methods.
- All DOM rendering, protocol handling, throttling, drag/resize, frame UI, sheet protocol, cursor UI, and CSS live in one class.

---

## What the current JS actually provides

### 1. WebSocket room client

- Resolves `/ws` or a custom full endpoint.
- Sends `hello`.
- Receives `welcome`, `join`, `peer`, `leave`, `window`, `frame`, `sheet`, `room-state`.
- Reconnects with exponential backoff.
- Sends cursor messages throttled to about 50 ms.
- Sends window / frame drag updates throttled to about 34 ms.
- Exposes `connect()` and `disconnect()`.

### 2. Presence

- Tracks local identity and colors.
- Renders remote cursors inside Shadow DOM.
- Tracks `self`, `peers`, `online`.
- Emits `coact:status`, `coact:presence`, `coact:ready`.

### 3. Shared windows

- `registerWindow(id, options)`
- `openWindow(id, overrides?)`
- `closeWindow(id)`
- `focusWindow(id)`
- Drag, resize, minimize? (No full minimize UI in current build; mostly open/close/focus/move/resize.)
- Window content can be a DOM node, function, or trusted HTML string.
- Slotted content stays in light DOM.
- Emits `coact:windows`.

### 4. Shared image frames

- `startFrameDraw()`
- `cancelFrameDraw()`
- `addImageFrame(rect?)`
- `deleteFrame(id)`
- Shared prompt updates and generate status.
- Deterministic seeded SVG placeholder.
- Branded `placeholder-image`, `placeholder-title`, `placeholder-code`.
- Drag / resize / focus.
- Emits `coact:frames`, `coact:drawmode`.

### 5. Shared spreadsheet state

- `updateSheetCell(address, value)`
- `replaceSheet(cells)`
- `selectSheetCell(address)`
- Receives `cell`, `replace`, `selection`.
- Exposes `room.sheet`.
- Emits `coact:sheet`.

Important: the library does **not** render the Excel grid, formula bar, import/export UI, or formulas. Those are in the demo. That separation is correct.

### 6. Theme / Web Component

- Shadow DOM.
- CSS custom properties: `--coact-*`.
- Built-in cursor/window/frame styling.
- `part` attributes for some outer styling.
- Keyboard focus handling and reduced-motion support.

---

## Why `coact-room` exists

It came from the first demo name: `co-work-room` → `<co-work-room>` → `<coact-room>`. At that stage the product concept was a "room" widget.

After renaming the brand to Coact.js, the word "room" is still useful as a **transport concept** but too narrow as the **library identity**:

- The library is not just a room.
- It is not just a whiteboard.
- It should be a shared-action layer for any canvas.

Recommended naming:

| Layer | Name |
|---|---|
| Brand | **Coact.js** |
| npm package | `coactjs` |
| Public file | `src/coact.js` |
| Main class / imperative API | `Coact` |
| Optional Web Component | `<coact-room>` or `<coact-canvas>` |
| Protocol grouping | `room` |

---

## Code review findings

### P0 — Public entry does not match the product name

`package.json` exports `coact-room.js`, but users install `coactjs` and the brand is Coact.js. This creates a mental mismatch.

**Recommendation:** add `src/coact.js` as the only public entry. Keep `coact-room.js` private or split it into modules.

```js
// src/coact.js
import { CoactRoomElement } from './elements/coact-room-element.js';
import { CoactClient } from './core/coact-client.js';

export class Coact {
  constructor(target, options = {}) { /* ... */ }
  static attach(target, options = {}) { return new Coact(target, options); }
  static define(options = {}) { /* define custom element */ }
}

export { CoactClient, CoactRoomElement };
export default Coact;
```

```json
"exports": {
  ".": "./src/coact.js",
  "./room": "./src/elements/coact-room-element.js"
}
```

### P1 — One 1,950-line class is doing too much

`CoactRoom` currently owns:

- WebSocket transport
- state hydration
- cursor layer
- window rendering
- frame rendering
- seat/color assignment
- pointer drag math
- CSS
- placeholder art
- sheet protocol
- demo-specific behavior

This makes it hard to tree-shake, unit test, or adopt partially.

**Recommendation:** split into focused modules:

```text
src/
  coact.js              public factory + default export
  core/
    client.js           WebSocket, reconnect, room state
    protocol.js         message builders / parsers / validation
    presence.js         peers, cursors, color assignment
    actions.js          generic action API
    geometry.js         normalized rect helpers
    throttle.js         throttled emitters
  elements/
    coact-room.js       <coact-room>
    window-manager.js   draggable windows
    image-frame.js      frame UI
    cursor-layer.js     remote cursors
  styles/
    tokens.css
    room.css
```

A much smaller `Coact` headless core would be framework-agnostic and testable in Node/browser without DOM.

### P1 — Core and UI are coupled

The most valuable reusable layer is not the window UI. It is:

- presence
- actions
- room state
- normalized geometry
- throttled broadcasts
- event subscription

A developer may want those features in React, Vue, Canvas, SVG, WebGL, Three.js, or tldraw, without Coact's built-in DOM windows.

**Recommendation:** introduce a headless core:

```js
import { createCoact } from 'coactjs';

const coact = createCoact({
  endpoint: '/ws',
  room: 'sprint',
  initial: { objects: {} }
});

coact.presence.on((people) => {});
coact.cursor.publish({ x: 0.2, y: 0.4 });
coact.objects.set('card-1', { x: 0.1, y: 0.2, w: 0.3, h: 0.2 });
coact.objects.onChange((objects, change) => {});
coact.action('image.generate', { frameId: 'card-1', prompt: '...' });
```

Then `<coact-room>` becomes one adapter built on top of the core.

### P1 — Built-in CSS is large and opinionated

About 14 KB of CSS is embedded in the JS string. The theme is beautiful for the demo, but it makes the library feel like a UI kit, not an action layer.

**Recommendation:**

- Keep CSS tokens and minimal structural styles in core.
- Ship theme presets as separate CSS files.
- Allow `theme="none"` or `unstyled` for headless rendering.
- Offer `part` and CSS custom properties consistently.
- Consider constructable CSSStyleSheet when available.

```js
import 'coactjs/theme/enterprise.css';
```

### P1 — Image-frame placeholder generation is demo-specific

`placeholder-title`, `placeholder-code`, `COACT PLACEHOLDER`, and the branded icon are great for the demo, but they are Coact-product marketing inside a general library.

**Recommendation:** move to a renderer hook:

```js
room.registerFrameRenderer({
  empty({ frame, setContent }) { /* host-owned empty state */ },
  generated({ frame, seed, setContent }) { /* host-owned placeholder or real image */ }
});
```

Then the built-in renderer can be optional:

```js
import { brandedFrameRenderer } from 'coactjs/demo';
```

### P1 — Sheet helpers are useful but too Excel-shaped

`updateSheetCell('A1', value)` is natural for the demo, but the core should be more generic.

**Recommendation:** keep the high-level helper, but base it on a generic key-value collection API:

```js
coact.collection('sheet').set('A1', 'Hello');
coact.collection('objects').set('card-1', { x, y });
coact.collection('sheet').replace(cells);
```

Then demo can provide an A1 / spreadsheet adapter. This opens Coact to forms, tables, diagrams, and canvas objects.

### P2 — API has aliases and mixed responsibilities

- `defineWindow()` simply aliases `registerWindow()`.
- `resetRoom()` clears windows, frames, and sheet cells; it is really `resetState()`.
- `updateSheetCell`, `replaceSheet`, `selectSheetCell` mix domain-specific naming into the room class.
- `safe-bottom` and `placeholder-*` are demo/theme concerns, not transport.

**Recommendation:** keep aliases for compatibility in v0.3, but make v1 API smaller:

```js
coact.objects.open(...)
coact.objects.close(...)
coact.collection('sheet').set(...)
coact.presence.select(...)
coact.reset(...)
```

### P2 — `content` accepts raw HTML strings

`innerHTML = String(def.content ?? '')` is convenient but risky if users pass untrusted content. README says "trusted", but libraries should make the safe path the default.

**Recommendation:** accept only `Node | () => Node` in the core. Put HTML-string support in a clearly named helper:

```js
import { htmlContent } from 'coactjs/utils';
content: htmlContent(`<b>Only for trusted strings</b>`)
```

### P2 — Transport safety can be improved

The server validates cell addresses, IDs, message size, and prompt length. Client can still send high-frequency messages. Good, but production users will need:

- message revision numbers
- actor identity tokens
- rate limiting
- authentication / room permissions
- reconnect resume token
- server ack for canonical state

This is documented; it belongs in v1.

### P2 — Event names are good but could be typed

`coact:status`, `coact:presence`, `coact:windows`, `coact:frames`, `coact:sheet`, `coact:ready`, `coact:drawmode` are clear. Ship a `.d.ts` file with event maps, even if source stays JS:

```ts
interface CoactEventMap {
  'coact:ready': CustomEvent<{ windows: ..., frames: ..., sheet: ... }>;
  'coact:presence': CustomEvent<PresenceEvent>;
}
```

---

## What is already good

- Zero client runtime dependencies.
- Browser-native Web Component.
- Shadow DOM isolation with light-DOM slots.
- Normalized coordinates, good for different viewport sizes.
- Throttled cursor and drag messages.
- Reconnect with backoff.
- Server-authoritative color assignment and one-shot seeding.
- High-frequency remote updates intentionally avoid animation re-trigger.
- Branded placeholders can be configured through attributes.
- Spreadsheet rendering correctly lives in the demo, not in the library.
- Axe / responsive / keyboard focus are in decent shape.
- Events bubble and are composed.

---

## Recommended public API shape

### Level 1 — Headless core, best long-term foundation

```js
import { createCoact } from 'coactjs';

const coact = createCoact({
  room: 'sprint',
  endpoint: '/ws',
  profile: { name: 'Ada' }
});

coact.cursor.publish({ x, y });
coact.presence.subscribe(console.log);
coact.objects.set('card-1', { x, y, w, h, data: {} });
coact.action('frame.generate', { id: 'card-1', prompt: '...' });
coact.collection('sheet').set('A1', 'Hello');
```

### Level 2 — Web Component adapter

```html
<script type="module">
  import 'coactjs/room';
</script>

<coact-room
  room="sprint"
  endpoint="/ws"
  theme="enterprise"
></coact-room>
```

### Level 3 — Add-on adapters

```js
import { attachLiveCursors } from 'coactjs/adapters/cursors';
import { createSpreadsheetAdapter } from 'coactjs/adapters/sheet';
import { createFrameAdapter } from 'coactjs/adapters/frame';
```

---

## Features that would make users actually adopt it

### 1. Headless `createCoact()` API

Most important. Users should be able to add Coact to an existing app without adopting Coact's DOM/window styling.

### 2. Generic shared objects

```js
coact.objects.upsert('node-1', { x, y, w, h, type: 'sticky', text: 'Idea' });
coact.objects.patch('node-1', { x: 0.4 });
coact.objects.delete('node-1');
coact.objects.subscribe((objects) => render(objects));
```

This is the natural bridge from "window demo" to "any canvas".

### 3. Typed actions and commands

```js
coact.action('cursor.focus', { target: 'card-1' });
coact.action('image.generate', { frameId, prompt });
coact.action('sheet.import', { cells });
```

Actions should support local optimistic state + server ack + remote broadcast.

### 4. Presence metadata and awareness

```js
coact.presence.set({
  name: 'Ada',
  color: '#...',
  focus: 'card-1',
  tool: 'select',
  viewport: { x, y, zoom }
});
```

Useful for "Ada is editing B2", "following Ada", selection rings, and focus mode.

### 5. Adapter ecosystem

- `coactjs/react` hooks
- `coactjs/vue` composable
- `coactjs/yjs` bridge
- `coactjs/liveblocks` or generic transport adapter
- `coactjs/excanvas` / tldraw / Fabric / Konva examples

### 6. Transport abstraction

Do not force WebSocket. Let users provide:

```js
createCoact({ transport: myTransport });
```

Built-in transports:

- WebSocket
- BroadcastChannel for same-browser tabs
- WebRTC data channel
- Supabase / Ably / Pusher adapter
- in-memory transport for tests

### 7. Permissions and room lifecycle

Even a lightweight version needs:

- room auth callback
- read-only mode
- action allowlist
- ownership / actor identity
- "who can delete?" policy

### 8. Conflict policy and revision numbers

Current last-write-wins is fine for demo. Add:

- `revision`
- `updatedAt`
- `actorId`
- optimistic UI
- server ack
- stale update rejection

### 9. Persistence plug-ins

```js
createCoact({
  storage: {
    load(room) {},
    save(room, snapshot) {}
  }
});
```

Starter adapters: memory, localStorage, Redis, Cloudflare Durable Object.

### 10. DevTools and observability

- `coact:debug` event stream
- latency / dropped messages / reconnect count
- room snapshot inspector
- simple examples folder

---

## Suggested v0.4 refactor, low-risk

Without a full rewrite:

1. Add `src/coact.js` public entry.
2. Rename export from `CoactRoom` to `Coact`, keep `CoactRoom` as deprecated alias.
3. Keep `<coact-room>` for compatibility; optionally alias `<coact-canvas>`.
4. Move `STYLE` to `src/styles/coact-room.css` imported as text at build time, or keep a separate `theme.js`.
5. Move `_placeholderSvg` and branded frame rendering to `src/renderers/placeholder.js`.
6. Extract WebSocket / message handling to `src/core/client.js`.
7. Add `coact.collection(name).set/get/replace` generic API; keep current sheet methods as wrappers.
8. Add `.d.ts` type declarations.
9. Change `package.json` exports:

```json
"exports": {
  ".": "./src/coact.js",
  "./room": "./src/elements/coact-room.js",
  "./core": "./src/core/client.js"
}
```

This keeps the demo working while making the library feel like a real product.

---

## Final verdict

`coact-room.js` is a solid prototype of a full-stack collaborative surface, but it is not yet a clean reusable library. The best move is not to delete it; it is to demote it to an adapter.

Make **Coact.js** the headless shared-action layer:

> Presence + actions + shared objects + transport.

Keep `<coact-room>` as an optional UI adapter:

> Windows, image frames, styled cursors, branded placeholders.

That gives users a reason to adopt the JS, not just clone the demo.


---

## v0.4 follow-up: low-risk improvements applied

The first refactor pass did not rewrite the runtime. It made the product boundary clearer while keeping the existing browser element and protocol intact.

Applied:

- `src/coact.js` is now the package main entry.
- `Coact`, `createCoact`, `CoactRoom`, `CoactCanvas`, and `CoactRoomElement` are exported.
- `<coact-canvas>` is registered as a subclass alias of `<coact-room>`.
- `package.json` exposes `.`, `./room`, `./core`, `./styles`, `./placeholder`.
- TypeScript declarations were added under `types/`.
- Inline `STYLE` and `CURSOR_SVG` moved to `src/styles.js`.
- The generated-image placeholder renderer moved to `src/placeholder.js`.
- The `COACT PLACEHOLDER` label became configurable via `placeholder-note`.
- A small `createCoact(element)` facade provides `cursor`, `presence`, `objects`, `collection`, `registerCollection`, `action`, and `on`.
- `collection('sheet')` is backed by a small adapter in `src/sheet-collection.js`.
- Generic application actions now travel as `{ type: 'action', name, payload }` and surface as `coact:action`.
- The demo imports the public Coact.js entry and exposes `window.__coact` for integration tests.

Still intentionally deferred:

- Full headless transport core without a DOM element.
- Framework adapters for React / Vue.
- Multiple transport backends.
- Revision / conflict policy.
- Authentication and persistence plugins.

Those are larger product decisions and should follow real user feedback rather than being added speculatively.
