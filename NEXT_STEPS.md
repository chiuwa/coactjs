> Current status: 0.5.1 implements the five follow-up corrections, optional Node server/CLI packaging and a Cloudflare Durable Object adapter with bounded SQLite room persistence. True headless browser transport, permanent file archives, rich-text merging and multi-provider orchestration remain deferred. Older proposal stages below are historical.

> Historical proposal. Current verified behavior: [CHANGELOG](CHANGELOG.md), [protocol](docs/protocol.md), [security](SECURITY.md). Durable storage, audit transactions, file merging, true headless transport and a separately published server are not implemented.

# Coact.js — next-step proposal

## Purpose

This document proposes the next product and engineering steps, with special attention to:

1. multi-user file / object editing safety;
2. conflict resolution and whether to lock editing positions;
3. a user journal / audit trail;
4. what a developer actually gets after `npm install coactjs`;
5. realistic applications for the current library.

The guiding principle is still: **no hardcoding demo behavior into core, and no over-designing before real usage**.

---

## 1. Where the project is now

The current v0.4 package is a working browser-side collaboration primitive with a reference server. It is good for prototypes, demos, workshops, and internal tools with trusted users.

It is **not yet** a secure production collaboration backend. It has:

- no authentication;
- no room authorization;
- no durable storage;
- no per-user permissions;
- no rate limiting beyond `maxPayload`;
- no message schema library;
- no revision / conflict control;
- no audit journal;
- no user-owned file concept.

That is acceptable for the demo. The next step should not be "add everything". It should be a staged path from demo to trustworthy product.

---

## 2. What `npm install coactjs` gives the user today

### Files actually shipped

From `npm pack --dry-run`, the package contains:

```text
LICENSE
README.md
demo-screenshot.jpg
package.json
assets/icons/*.svg
src/coact.js
src/coact-room.js
src/styles.js
src/placeholder.js
src/sheet-collection.js
types/coact.d.ts
types/coact-room.d.ts
```

It is about 107 KB packed / 219 KB unpacked, with **zero client runtime dependencies**.

### What is included

- `<coact-room>` and `<coact-canvas>` Web Components.
- A built-in visual room surface: cursors, windows, image frames, drawing layer.
- A WebSocket client for room state and presence.
- `createCoact()` facade.
- `collection('sheet')`, `registerCollection()`, `action()`, `cursor.publish()`, `presence.subscribe()`, `objects` helpers.
- `coact:*` events.
- Reconnect and state hydration.
- CSS custom properties and extracted styles.
- A configurable deterministic image placeholder renderer.
- TypeScript declarations.
- Coact icons.

### What is not included

- No WebSocket server.
- No auth or room permissions.
- No database.
- No Excel grid or formula engine.
- No XLSX import/export.
- No SheetJS.
- No Board / Notes / Palette demo panels.
- No image-generation API.
- No enterprise shell.
- No persistence or audit trail.

This is important: `npm install coactjs` currently gives the **front-end collaboration component**, not a full backend product.

### What the user must provide

A working app currently needs:

1. a WebSocket endpoint implementing the Coact protocol, or the repo's `server.js`;
2. application content for windows;
3. optional image renderer if they want real image generation;
4. optional spreadsheet UI if they use `collection('sheet')`;
5. auth / rate limiting / persistence if deployed publicly.

### Suggested package improvement

Add a separate server package or subpath:

```bash
npm install coactjs
npm install @coactjs/server
```

or:

```js
import { createCoactServer } from 'coactjs/server';
```

But do not bundle Node `ws` into the browser package. Keeping browser and server packages separate avoids shipping server dependencies to front-end users.

---

## 3. What users can build today

Realistic current applications:

### Great fit

- live product demos with two-tab collaboration;
- internal workshops / design sprints;
- teaching WebSocket presence;
- lightweight collaborative moodboards;
- shared planning boards with sticky notes;
- "follow along" product walkthroughs;
- multiplayer cursors on a dashboard;
- prototype image-prompt frames;
- hackathon collaborative canvases;
- internal spreadsheet-like review tables;
- co-browsing UI research sessions.

### Possible but needs user work

- React / Vue app: wrap or mount `<coact-room>`; use events/facade.
- Canvas / WebGL app: use presence/actions but avoid built-in DOM windows, or adapt.
- Real image generation: replace placeholder renderer with API call.
- XLSX import/export: copy/adapt demo code.
- Auth and persistence: replace or extend server.

### Not suitable yet

- public untrusted multi-tenant SaaS;
- regulated audit-log systems;
- critical collaborative documents;
- rich-text co-editing;
- offline-first apps;
- high-concurrency financial or healthcare records.

---

## 4. User journey after installation

Today:

```text
npm install coactjs
  → import Coact
  → add <coact-room>
  → write/provide WebSocket server
  → register window content
  → sync cursors / windows / frames / sheet state
```

The README should make this journey explicit:

```js
import { createCoact } from 'coactjs';

const coact = createCoact('#room', {
  room: 'sprint',
  endpoint: '/ws'
});

coact.collection('sheet').set('A1', 'Owner');
coact.action('review.approve', { id: 'card-1' });
```

Recommended future quick start:

```bash
npm install coactjs @coactjs/server
```

```js
import { createCoactServer } from '@coactjs/server';

createCoactServer({
  port: 8787,
  auth: async (request) => { /* return user */ },
  storage: myStorage
}).start();
```

This turns the repo from "clone the demo" into "install a library".

---

## 5. Server security: minimum production baseline

Current server validates some IDs, cell addresses, prompt length, message size, and action names. That is a good start, but not enough.

### Must-have before public deployment

1. **WSS / TLS** in production.
2. **Origin validation** on WebSocket upgrade to prevent Cross-Site WebSocket Hijacking.
3. **Authentication at handshake**: short-lived ticket or session/JWT; avoid long-lived tokens in query strings.
4. **Room authorization**: may this user join this room? read-only or editor?
5. **Message-level authorization**: do not rely only on handshake auth; every mutation should be checked against the room role.
6. **Rate limiting** per connection and per room: cursor, window, sheet, frame, action, and connection attempts.
7. **Schema validation** for every inbound message, ideally one validator module shared by client and server.
8. **Payload caps** by type: cursor tiny, cell value 500 chars, action payload size cap, no arbitrary HTML.
9. **Idle timeout / heartbeat**: already has ping/pong, add idle disconnect policy.
10. **Room TTL cleanup** after all clients leave.

OWASP and WebSocket security guidance specifically emphasize origin checks, auth at handshake, input validation, rate limiting, message size limits, idle timeouts, and monitoring. Yjs/CRDT production write-ups also recommend JWT verification on both HTTP and WebSocket handshake and append-only update logs for recovery.

### Recommended authorization model

```text
room role:
  owner     - can reset, delete, manage permissions
  editor    - can mutate objects / cells / frames
  commenter - can send cursor, selection, actions, comments; no state mutation
  viewer    - can receive state and presence; no mutation
```

Server should own role enforcement. Client `aria-pressed` / disabled buttons are UX, not security.

### Suggested server config, not hardcoded

```js
createCoactServer({
  origin: (origin) => allowedOrigins.has(origin),
  authenticate: async (request) => userFromSignedTicket(request),
  authorize: async ({ user, room, action }) => policy.can(user, room, action),
  rateLimit: { messagesPerSecond: 30, connectionsPerIp: 10 },
  storage,
  journal
});
```

The core should not know how your company logs in. Inject these as functions.

---

## 6. Conflict resolution: what problem are we solving?

There are at least four different kinds of shared state. They should not all use the same strategy.

| State | Example | Tolerance for conflict | Best strategy |
|---|---|---|---|
| Presence | cursor position | Very high | Last-write-wins, throttled |
| Ephemeral awareness | selection, focus, tool | High | LWW + TTL |
| Coarse objects | window position, frame rectangle | Medium | revision + actor, last writer wins with ack |
| Fine-grained content | text editor chars, formulas, file blocks | Low | OT / CRDT / field lock |
| Business records | approval, status, price, owner | Very low | optimistic concurrency + explicit conflict UX |

Current Coact.js uses LWW for everything. That is correct for cursors, acceptable for window dragging, and unsafe for real files or business data.

### Do not start with CRDT

Yjs is excellent for text, lists, maps, and rich documents because shared types merge automatically. But adding Yjs now would:

- add a runtime dependency to a zero-dependency browser package;
- require a different server/storage model;
- make the current simple state protocol more complex;
- solve rich-text / nested-object conflicts before users have asked for them.

CRDT is right **if** the product later becomes a real document editor with concurrent character-level edits. It is not the right next step for this canvas/action demo.

### Recommended staged strategy

#### Stage A — revision + ack, for all durable state

Every mutation gets:

```json
{
  "type": "sheet.cell.update",
  "room": "sprint",
  "actorId": "u_123",
  "requestId": "req_abc",
  "baseRevision": 42,
  "path": "sheet.A1",
  "value": "Hello"
}
```

Server responds:

```json
{
  "type": "ack",
  "requestId": "req_abc",
  "accepted": true,
  "revision": 43
}
```

or:

```json
{
  "type": "conflict",
  "requestId": "req_abc",
  "reason": "stale_revision",
  "currentRevision": 43,
  "currentValue": "Hi"
}
```

Benefits:

- no silent overwrite;
- client can show "someone changed this cell, reload / overwrite / merge";
- gives idempotency via `requestId`;
- creates a natural place for journal events;
- no locks needed.

This is optimistic concurrency. It is the most valuable next correctness feature.

#### Stage B — soft, short-lived position locks

For spreadsheet cells, text blocks, or frame prompts, add an **ephemeral editing lock**:

```json
{
  "type": "lock.acquire",
  "path": "sheet.A1",
  "ttlMs": 15000,
  "actorId": "u_123"
}
```

Server stores:

```text
path → { actorId, name, color, expiresAt }
```

Rules:

- lock is advisory / soft, not a hard mutex;
- it expires automatically;
- owner can renew while actively editing;
- disconnect releases locks;
- other users see "Ada is editing A1";
- server may still reject writes from non-owner, or allow them to raise a conflict.

Use short TTL, e.g. 10–30 seconds, not 30 minutes. A single Redis instance / Durable Object can own this. Redis docs describe the standard pattern: atomic `SET key token NX PX ttl`, and release only if the token still matches via a Lua/DELEX ownership check. That prevents a stale client from deleting someone else's renewed lock.

For this project's current single-process in-memory server, a `Map` with expiry is enough. Do not introduce Redis until multiple server instances are needed.

#### Stage C — merge policies per data type

Define explicit policy instead of generic "conflict resolution":

```js
{
  "cursor": "lww",
  "window.geometry": "lww_with_revision",
  "sheet.cell": "optimistic_concurrency",
  "frame.prompt": "soft_lock_then_lww",
  "text.block": "crdt_or_ot",
  "file.blob": "versioned_replace"
}
```

This keeps behavior understandable.

#### Stage D — CRDT adapter, only if needed

If future users need rich text, nested documents, or offline editing, add an optional Yjs adapter:

```js
import { createYjsAdapter } from '@coactjs/yjs';
```

Keep it out of core. Yjs shared types (`Y.Text`, `Y.Map`, `Y.Array`) can merge concurrent changes automatically. Coact would provide presence, room transport, and actions; Yjs would own document CRDT state.

---

## 7. Should we lock editing positions?

**Yes, but as soft UX locks, not hard file locks.**

Hard locking an entire file is bad:

- one idle tab can block everyone;
- users forget to release;
- disconnect can leave stale locks;
- it kills the feeling of real-time collaboration.

Do not lock the whole "file". Lock a **path**:

```text
sheet.A1
frame.frame-1.prompt
board.card-42.title
file.block-7
```

Recommended behavior:

1. User focuses a cell / block → `lock.acquire(path)`.
2. Server grants if unclaimed or already owned by same actor.
3. Others see a small colored outline and actor name.
4. Client renews every 5–10 seconds while active.
5. On blur / commit / disconnect → `lock.release(path)`.
6. Server auto-expires lock after TTL.
7. Writes still carry `baseRevision` even with a lock.
8. If lock is held, others are read-only or get a conflict warning.

This gives users confidence without making the room fragile.

### UI examples

- Spreadsheet cell: colored border + "Ada is editing".
- Frame prompt: small badge next to input.
- Board card title: subtle outline with actor color.
- No modal; no blocking error; no "file is locked by someone else" full-screen state.

### Important nuance

Locks are **awareness**, revisions are **correctness**. Never use a lock as the only correctness guarantee. A client can lose network, a lock can expire, and a write can arrive late. The revision check is what prevents silent overwrite.

---

## 8. User journal / audit trail

There are two related but different concepts. Do not mix them.

### User journal

A human-readable activity feed:

```text
Ada changed B2 from 8 to 12 · 10:42
Kai generated an image frame · 10:43
Ada moved Budget.xlsx · 10:44
```

Purpose: collaboration awareness, "what happened while I was away", onboarding, recovery.

### Audit log

A security/immutable record:

```text
actor, action, path, before, after, revision, timestamp, requestId, ip/session
```

Purpose: compliance, debugging, incident review, trust.

For v0.5, implement one **append-only event journal** that powers both, but document the difference.

### Minimal event shape

```json
{
  "id": "evt_01H...",
  "seq": 143,
  "room": "sprint",
  "actor": { "id": "u_123", "name": "Ada", "badge": "AD" },
  "type": "sheet.cell.updated",
  "path": "sheet.A1",
  "before": "Old",
  "after": "New",
  "revision": 43,
  "requestId": "req_abc",
  "at": "2026-11-15T10:42:00.000Z"
}
```

Rules:

- append-only; corrections are new events, never edits to old events;
- strictly increasing `seq` per room;
- immutable in application code;
- compact / snapshot eventually, but keep journal tail;
- cursor / window-drag high-frequency events should be sampled or excluded from the user-visible journal.

### Journal policy by event type

| Event | Journal? | Reason |
|---|---|---|
| cursor move | no | too noisy |
| join / leave | yes, compacted | presence history |
| cell update | yes | important change |
| file import / replace | yes | high-impact |
| frame prompt update | maybe debounce | noisy while typing |
| image generate | yes | meaningful action |
| window open / close | yes | artifact change |
| drag move / resize | no, or final-only | too noisy |
| lock acquire / release | no | ephemeral |
| conflict / rejected write | audit only | debugging/security |

### Storage recommendation

- v0.5: in-memory ring buffer per room, e.g. last 200 events + `seq`.
- v0.6: optional pluggable storage interface:

```js
journal.append(event)
journal.since(room, seq)
journal.snapshot(room)
```

- production adapters: SQLite/Postgres append-only table, Redis stream, Cloudflare Durable Object, or S3/object storage for snapshots.

A real compliance audit log needs stronger guarantees: restricted append-only DB permissions, hash chaining, and external anchoring. That is beyond v0.5 but the event schema should not prevent it.

### UI

Add a small "Activity" panel:

- last 8 meaningful events;
- actor badge and color;
- "since you joined" / "while you were away" section;
- click event → focus affected object;
- no raw JSON.

This turns journal into a user feature, not just backend logging.

---

## 9. File-specific safety

The current project has no real "file" object. The spreadsheet is a cell map; windows are UI surfaces. If the product wants "多人修改 file", add a first-class file abstraction instead of overloading `window`:

```text
FileRecord
  id
  roomId
  name
  kind: sheet | image | text | json | blob
  revision
  updatedBy
  updatedAt
  content or contentRef
```

Then define mutation scopes:

```text
file.replace
file.patch
sheet.cell
text.block
image.replace
```

Rules:

- file-level replace requires `baseRevision`;
- cell/block patch requires path-level revision;
- binary file upload should create a new immutable version rather than overwrite;
- server returns new `revision` and journal event;
- clients keep optimistic local value but reconcile on ack/conflict.

### Hard lock vs soft lock for files

- Do **not** lock the whole file for normal editing.
- Lock only a path or block.
- Offer an explicit owner-controlled "review mode" / "present mode" that makes a whole file read-only if needed.
- For binary assets, use versioned replacement + compare-and-swap, not a long lock.

---

## 10. Proposed roadmap

> Status: v0.5 has been completed and tested as a local candidate. Exact shipped behavior and limitations are in CHANGELOG.md and SECURITY.md; the longer sections below remain historical design proposals. v0.6+ remains proposed.

### v0.5 — Trust and correctness, low ceremony

Goal: make the demo safe enough for small internal pilots.

1. Add `revision` to room state and every durable mutation.
2. Add server `ack` / `conflict` messages with `requestId`.
3. Add idempotency: duplicate `requestId` returns the same ack.
4. Add soft path locks with TTL, renew, release, disconnect cleanup.
5. Add append-only in-memory journal with `seq`.
6. Add a simple Activity panel in the demo.
7. Add origin validation and auth hook in reference server.
8. Add message rate limiting and room TTL.
9. Align docs: peer identity, HSL color, badge, `canSeed`.
10. Fix small review findings:
    - remove or rename `Coact.collection.sheet`;
    - remove ignored `hello.color` or honor it;
    - add badge to `actorOf`;
    - update code drawer to `createCoact` / `coactjs/room`;
    - improve `.d.ts` event maps.

### v0.6 — npm-user ergonomics

Goal: a developer can use Coact without cloning the demo.

1. Split publishable server package `@coactjs/server`.
2. Pluggable `auth`, `authorize`, `storage`, `journal`, `rateLimit`.
3. Add `createCoactClient()` headless transport, no DOM required.
4. Add `coactjs/react` hooks or a tiny vanilla event-store adapter.
5. Add examples:
   - plain HTML;
   - React cursors;
   - spreadsheet with locked cells;
   - image-generation frame using a real API;
   - file revision demo.
6. Add persistence adapter: memory → SQLite / Redis / Durable Object.
7. Add typed protocol package shared by client/server.

### v0.7 — advanced collaboration only if needed

1. Optional `@coactjs/yjs` adapter for text / nested documents.
2. Snapshot + journal replay.
3. Undo / redo.
4. Presence metadata: viewport, focus, tool, follow mode.
5. Conflict UI: field-level merge, accept mine / accept theirs.
6. Read-only / commenter / editor / owner roles.
7. Multi-instance broadcast via Redis pub/sub or Durable Objects.

Do not build all of this now. Validate v0.5 with real users first.

---

## 11. Concrete application ideas after the above

### With current v0.4

- two-tab live demo for a SaaS product;
- teaching tool for WebSocket presence;
- internal sprint canvas;
- shared review table;
- image-prompt moodboard;
- lightweight workshop whiteboard;
- live cursor overlay on an existing dashboard;
- collaborative "what are we looking at" sessions.

### After v0.5 (security + locking + journal)

- internal operations console with multiple reviewers;
- collaborative budget sheet with audit feed;
- design review workspace with image frames and comments;
- incident response room with append-only activity;
- classroom / training rooms with read-only students;
- product feedback triage board;
- AI-agent + human shared canvas with action logs.

### After v0.6 (headless + server package)

- React collaborative dashboard;
- shared JSON config editor;
- multi-user form filling;
- live admin panel with field locks;
- collaborative data labeling;
- multiplayer game/simulation state;
- shared planning timeline;
- remote workshop platform.

### Later, with CRDT adapter

- rich text docs;
- offline-first notes;
- nested outline editors;
- source-code pair editing;
- Figma-like object trees with mergeable properties.

---

## 12. Final recommendation

The next concrete step is **not** CRDT and not a full rewrite. It is:

> Add revisions, acknowledgements, soft path locks, and an append-only journal to the reference server and protocol; then expose them through the public `createCoact()` API.

This gives the biggest jump in user trust:

- "Did my change apply?" → ack.
- "Who changed this?" → journal.
- "Can two people overwrite each other?" → revision conflict.
- "Is someone editing this cell?" → soft lock.
- "Can I deploy this safely?" → origin/auth/rate-limit hooks.
- "What do I get from npm?" → clear browser package + separate server package.

That keeps Coact.js simple, useful, and honest about what it is: a shared-action layer, not yet a full document engine.

---

## Sources considered

- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [OWASP Web Security Testing Guide: WebSockets](https://wstg.owasp.org/latest/4-Web_Security_Testing_Guide/11-Client-side/10-WebSockets/)
- [WebSocket.org: WebSocket Security](https://websocket.org/guides/security/)
- [Yjs documentation: shared types and automatic conflict-free merging](https://github.com/yjs/docs)
- [Redis documentation: distributed locks, SET NX PX and ownership-safe release](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [Event-sourcing / append-only journal design](https://github.com/jimsimon/trouve/blob/main/docs/design/event-log.md)
- [Audit log design: append-only, hash chaining, restricted writer role](https://bastionary.com/blog/audit-log-design)
