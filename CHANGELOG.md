# Changelog

## 0.5.2 (2026-11-16)

- Add chiuwa author, GitHub repository, homepage, issue tracker and public npm registry metadata.
- Adopt Apache-2.0 for this release with a NOTICE file; the published 0.5.1 remains MIT-licensed.
- Add a concise GitHub/npm README with the logo and badges; move detailed examples to docs/guide.md. Remove internal notes and extra screenshots from the public tree. Runtime behavior is unchanged.

## 0.5.1 — published on npm

- Fix prompt concurrency: wait for the owned lease/latest content, queue edits at input time, retain rejected early drafts and disable offline input.
- Make optimistic window/frame lifecycle changes conditional on successful enqueueing. Add configurable client message/pending-byte bounds, immutable queued payloads and `coact.stats`.
- Track initialization by endpoint/room so room switching seeds a fresh room while same-room reconnect remains non-destructive.
- Replace full snapshot/request receipt caching with SHA-256 fingerprints and compact outcomes. Replays return the original result with a fresh snapshot.
- Immediately reject unconfirmed mutations on rate pressure, with browser-valid close codes.
- Extract a runtime-independent room engine and add `coactjs/server`, optional `ws`, the `coactjs` local-example CLI and an installed-package example.
- Add `coactjs/worker`, a Cloudflare Durable Object/SQLite adapter, static-asset demo configuration and a copyable Worker starter. No Node compatibility flag is required by the Worker adapter.
- Add document/history/queue/peer/lease/message/egress limits and negotiated delivery windows. Persist compact connection metadata through hibernation; use incremental document transactions and expiry alarms.
- Limit demo import work and retained draft history. Add focused resource, browser concurrency and actual local workerd integration/load tests.

Published to npm. Cloud deployment remains separate. Node memory and Worker persistence/retention have different guarantees; see SECURITY.md and docs/resources.md.

## 0.5.0 — local release candidate (2026-11-15)

- Require revision/request-id envelopes for every state mutation. Compare touching paths so independent cells can succeed and stale same-field/bulk edits conflict. Keep deletion tombstones.
- Serialize asynchronous authorization and commits per room. Add per-message role checks, same-origin defaults, production hook requirements, schema validation, connection/queue/resource limits, heartbeat/room cleanup and private static-source protection.
- Return canonical ACKs and conflict snapshots. Cache recent mutation results per connection for idempotent retries. Queue client edits and surface rejected/unconfirmed operations through `coact:unsaved` instead of silently overwriting or replaying them.
- Add owned expiring lock tokens, renewal, ancestor protection, disconnect cleanup and lock-aware cell/formula/prompt/drag editing. Consolidate window/frame gesture handling and clean up cancelled/lost-capture/blur gestures.
- Add ordered, bounded Activity history with revision/actor metadata and query-gap metadata. Exclude cursor/focus/intermediate movement noise. Expose a non-transactional journal sink integration.
- Keep existing room data on new tabs/reload, synchronize active navigation after hydration, distinguish per-tab identities, and keep remote drag updates on stable elements.
- Add draft copying and server-confirmed sheet imports to the demo. Keep its powder-white/rose UI and icon placeholders.
- Correct `request()` to return `Promise<Ack>`, make sheet methods return queueing booleans, require explicit object kinds in `objects.set()`, preserve supplied ids, and export `sheetCollection` / `Coact.adapters.sheet`. Keep `Coact.collection.sheet` as a deprecated alias.
- Add real TypeScript declarations and conditional type exports. Keep `ws` and TypeScript in development dependencies; the npm browser package has no runtime dependencies. Clarify the DOM-dependent `core` alias and package/server/demo boundaries.
- Add server, type and real-browser regression suites, architecture/protocol/security documentation and release verification notes.

The protocol is version 5. Older clients without revision/request-id envelopes cannot write to this server. Update client and server together. This session has not published the candidate to npm or GitHub.

Deferred: durable documents/audit transactions, offline replay/merge, true headless transport, separately packaged server, multi-process coordination, rich-text CRDT and real image/file storage.
