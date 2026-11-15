# Resource limits and measurements

Coact.js uses separate budgets for a room, a connection and a browser component. They bound application-controlled state; they are not a claim about an entire browser process, Node process, or Cloudflare isolate's total RAM.

## Default profiles

| Budget | Node | Worker / Durable Object |
| --- | --- | --- |
| Peers per room | 64 | 16 |
| Windows / frames | 64 of each | 32 of each |
| Document byte accounting | 512 KiB | 256 KiB |
| Mutation-path revisions / tombstones | 10,000 | 2,048 |
| Journal | 200 events and 64 KiB | 50 events and 32 KiB |
| Recent request receipts | 256 compact results | 16 compact results |
| Pending room handlers | 128; all Node rooms also share an 8 MiB input reservation | 64 |
| Input message | 128 KiB | 128 KiB |
| Message token bucket per peer | 100/s, burst 150 | 60/s, burst 90 |
| Outbound byte bucket per peer | 256 KiB/s, burst 1 MiB | 128 KiB/s, burst 512 KiB |
| Unacknowledged delivery window | 1 MiB / 1,024 messages when negotiated | 256 KiB / 512 messages; required |
| Leases per peer / default TTL | 16 / 15 seconds | 8 / 30 seconds |
| Empty-room retention | 10 minutes, in memory | 1 hour, SQLite |

These options are configurable through the server API or Worker factory. Invalid non-finite/negative budgets are rejected. Protocol cell bounds remain A–AZ, rows 1–99, at most 400 stored cells, with 500 characters per value. UTF-8 bytes matter: those count limits do not imply every combination fits a document/message byte budget.

Browser defaults: 128 KiB outbound message, 512 KiB reserved pending payloads including the in-flight edit, at most 128 unsent mutations plus one in-flight mutation, and 1 MiB incoming frame. `maxPayload`, `maxPendingBytes` and `maxIncomingBytes` are attach options. Queue byte accounting reserves revision-number growth, so `coact.stats.pendingBytes` is a conservative payload reservation, not a heap measurement. Input objects are detached before queue retention. Application drafts in the demo keep the latest 32 entries within about 1 MiB; the notice identifies recent drafts when older ones are removed.

## Pressure controls

- Request receipts retain a SHA-256 fingerprint and a small outcome envelope, never the full input or room snapshot. Retrying returns the original outcome with a fresh canonical snapshot. This preserves the result without caching hundreds of document copies.
- Documents, history, revisions and peer counts have independent limits. A failed document-size check leaves canonical state unchanged. Journal pruning exposes query gaps.
- Broadcast JSON is prepared once per event. Fan-out still scales approximately as `N × (N - 1)`; a high connection limit is not a promise that all those people can publish at full frame rate.
- The browser coalesces pointer samples to about 15 Hz and unsent edits to the same field. Intermediate cursor, selection and focus traffic does not write document rows.
- The delivery window tracks unacknowledged bytes/messages independently from a throughput bucket. Worker clients must negotiate delivery receipts. Receipts are batched or sent immediately for large packets; stalled readers close with 1013 instead of indefinitely accumulating buffers.
- Worker connection credit checkpoints batch into WebSocket attachments using a 200ms transient timer. It stops after activity; there is no permanent interval preventing idle hibernation. Attachments stay below an application budget of 15,000 serialized JSON bytes, with compact receipt and transport metadata. This is checked before serialization; the platform attachment cap is 16,384 bytes.
- SQLite stores changed cells/objects, revision markers, bounded events and leases in a transaction before releasing success messages. A cursor/selection update only changes live connection metadata. Storage failure closes affected connections without a success ACK.
- The public Worker demo only admits configured room ids, uses an edge join limiter, and caps each room at 16 peers. This prevents arbitrary anonymous room creation. Production room membership must be checked before addressing a coordinator.
- Node additionally limits simultaneous handshakes/connections and uses native `bufferedAmount` checks. Do not copy its process-local room Map into an ordinary request Worker.

## Local measurements on 2026-11-15

The following are controlled local observations, not production capacity guarantees.

**Receipt regression:** one room, 400 cells of 250 characters, 256 stale requests from one connection, forced GC before/after. The previous candidate retained about **27.9 MiB** of additional Node heap; the compact-result implementation retained about **0.6 MiB**. The benchmark raises traffic/egress budgets to measure cache retention independently. This is additional cache-workload heap, not the whole SDK/server footprint and not a Cloudflare RAM measurement.

**Worker fan-out:** local workerd/Miniflare, 16 active peers, 45 pointer samples per peer at 67ms spacing, with a 400-cell document. Observed **10,800 broadcasts** in about **3.5 seconds**, approximately **2.2 MB** of outgoing JSON, **0 additional content-table SQL writes**, about **105 KB** of document byte accounting, and connection attachments below **1 KiB** in this workload. Transport receipts and checkpoint metadata were enabled. The test also verifies that a reader that never acknowledges gets disconnected before its delivery budget grows without bound.

**Persistence / hibernation path:** tests drop the room engine's in-memory cache while retaining sockets, then restore from SQLite and socket attachments. Peers retain their connection identity, revisions, request outcomes and ability to edit. This explicitly tests reconstruction; it does not certify production placement, eviction timing, regional network latency or a particular monthly cost.

**Browser:** regressions verify count and byte queue rejection, immutable queued inputs, oversized-message rejection, prompt lock acquisition, room switching, and immediate rate rejection. The larger demo suite covers actual cursor/window/frame/sheet interaction. `coact.stats` reports SDK counts/budget reservations; it cannot report total native socket, DOM, font, GPU or application RAM.

## Operating guidance

Cloudflare's Workers memory limit is per isolate, not per request. Official documentation checked for this candidate lists 128 MB including JavaScript/Wasm allocations. Do not equate a small Worker bundle or a small document with that total limit. Observe production CPU, errors, connected peers, bytes, queue pressure and storage use before raising limits. Reduce room size, pointer rate, history or document budgets for constrained applications.

Low document-write volume does not remove WebSocket event handling, fan-out or network load. Avoid a remote membership/database lookup for every pointer sample; use an application-designed short-lived verified policy/session and deliberately choose its revocation behavior. Durable writes still need authoritative permission/version checks. Large binary images/files belong in application-owned object storage, not this protocol.

The Node adapter remains memory-only. The Worker adapter persists bounded room state through restarts/hibernation, then deletes inactive room data after its retention period. Neither adapter is a permanent file archive or tamper-evident audit system. Keep backups/recovery and long-term retention in your own application.

The demo's 2 MiB file gate and row selection limit normal import work. They are not an adversarial compressed-file sandbox. Applications accepting untrusted uploads need an isolated parsing strategy and expanded-size limits. The npm package does not include the Excel parser.

Primary platform references used: Workers platform limits; Durable Objects WebSocket best practices / Hibernation API; SQLite-backed Durable Object storage API; and the installed Wrangler configuration schema. Sources: `https://developers.cloudflare.com/workers/platform/limits/`, `https://developers.cloudflare.com/durable-objects/best-practices/websockets/`, `https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/`.

Node `app.stats` exposes room/connection counts, reserved pending input bytes and unacknowledged delivery bytes. These are operational counters, not process RSS. The global `maxPendingBytes` budget applies across its rooms, in addition to individual handler limits.

## Installed-browser sample

On Chromium 157.0.8103.78, the installed minimal starter with two peers used about 2.18 MiB of measured JS heap after GC. With eight additional empty frames it used about 2.25 MiB; its pending queue was empty. These small controlled samples exclude total browser/native/DOM/GPU memory and application data, and are not a fixed per-package cost.

An editor holding a renewing lease generates traffic even without new text. Quiet-period hibernation does not imply a locked/actively connected editing session has no work. Applications should release edit leases when leaving an editor and deliberately choose any idle-edit policy; the SDK does not silently sacrifice a live edit lock to save runtime activity.

Wrangler/Miniflare local development runs its own Node tooling, workerd process and file watchers. Task Manager RAM for that development stack is not the browser component footprint or a deployed Worker measurement. Build tooling is excluded from browser-only installs; use provider metrics to assess deployed isolate CPU/memory and quotas.
