# v0.5.1 protocol

Transport: JSON text over WebSocket at `/ws?room=<room>`. A browser Origin is required. Rooms and object ids use 1–48 ASCII letters, digits, underscores or hyphens. Prototype keys are rejected for object ids. Send `hello` before other messages; the server replies with `welcome` and `protocol: 5`.

## Joining and snapshots

```json
{"type":"hello","name":"Ada"}
```

`welcome` contains `self`, `peers`, `online`, `windows`, `frames`, `sheet`, `locks`, `revision`, `journal`, and `canSeed`. Authenticated names come from the authentication hook. Anonymous labels/colors are assigned by the server per connection. Each tab is an independent participant. `canSeed` is granted once to the first writable peer in a new room. Existing empty rooms do not acquire a new seed grant just because a tab opens.

`state.query` requests a `snapshot` containing canonical windows, frames, sheet, locks and revision. Reload/reconnect hydrates from the snapshot. A restarted or expired in-memory room begins a new history.

## State mutations

Every durable-in-room mutation requires `requestId` and `baseRevision`:

```json
{"type":"sheet","action":"cell","address":"B2","value":"12","requestId":"edit-42","baseRevision":7}
```

`requestId`: 1–80 ASCII letters, digits, underscores or hyphens. `baseRevision`: non-negative safe integer representing the server revision the edit was based on. `lockToken`, when supplied by the client, must identify a live owned lease touching this mutation.

The server serializes messages including asynchronous authorization per room. It compares the submitted revision to the newest change on a touching path. Touching means equal, ancestor or descendant. Scopes are:

| Mutation | Scope |
| --- | --- |
| Window open/close/move/resize | `window.<id>` |
| Frame create/delete/move/resize/update/generate | `frame.<id>` |
| Sheet cell | `sheet.<address>` |
| Whole sheet replacement | `sheet` |
| Reset | `room` (touches everything) |

A global room revision increments once per accepted state mutation, while the last-change revision is tracked per scope. Different cells with an older room revision can both succeed if neither cell changed since their base. The same cell, an ancestor change or a future base revision conflicts. Deletion tombstones remain to reject stale recreation. There is no `strictRevision` bypass.

Success:

```json
{"type":"ack","accepted":true,"requestId":"edit-42","revision":8,"path":"sheet.B2","update":{"type":"sheet","action":"cell","change":{"address":"B2","value":"12"},"revision":8}}
```

`update` is the canonical change, with actor and optional journal event. Other peers receive the change directly; the author receives it inside the ACK. Conflict:

```json
{"type":"conflict","accepted":false,"requestId":"edit-42","revision":8,"path":"sheet.B2","reason":"stale_revision","current":{"revision":8,"windows":{},"frames":{},"sheet":{"cells":{"B2":"12"},"selections":{}},"locks":{}}}
```

A conflict contains a full snapshot plus applicable lock/change metadata. Failure reasons include `stale_revision`, `locked`, `lock_lost`, `not_found`, `object_limit`, `cell_limit` and `history_limit`. Validation, permission and rate failures use `error` with `code` and correlated `requestId` where available.

Each Node connection retains up to 256 compact request outcomes; the Worker profile retains 16 to fit connection attachments. The fingerprint is SHA-256 and the cache never stores the original message, canonical update or full snapshot. Identical retries return `replayed: true`, the original outcome/revision, and current canonical state (`ack.update` is a `snapshot`, or `conflict.current` is a current snapshot). Thus retries do not repeat edits and do not roll peers back to a cached old snapshot. Reusing an id with different message contents returns `request_id_reused` while the receipt is retained. Once evicted, the original stale base still prevents reapplying an already committed mutation, but the original ACK may no longer be available.

Idempotency is scoped to the connection, including healthy Worker socket hibernation, not reconnects or server restarts that terminate it. Do not automatically replay unconfirmed writes after reconnecting.

## Mutation forms

- `window`: `action` open/close/move/resize, `id`, optional geometry `state`.
- `frame`: create/delete/move/resize, `id`, optional geometry `state`; update uses `prompt`; generate uses the existing prompt and produces deterministic placeholder art.
- `sheet`: cell uses `address` and string `value`; replace uses `cells` (address/string map).
- `reset`: owner only; clears objects, cells and locks. The requesting owner may seed defaults again.

Geometry is normalized `x`, `y`, `w`, `h`, with finite numeric values clamped by the server. One frame/window is a conflict unit. Set `final: true` on the last move/resize to record a meaningful journal event.

Sheet bounds: A–AZ, rows 1–99, at most 400 stored cells, 500 characters per value. Document and message byte budgets also apply, including JSON escaping and UTF-8 size. Blank values remain stored; use replacement to remove unused cells. Prompt length: 500 characters. Binary files are never sent through this protocol.

## Ephemeral messages and actions

- `cursor`: normalized `x`, `y`, optional `down`; other peers receive `peer`.
- `sheet` / selection: `address` or empty string to clear; receives `selection`.
- `window` / focus and `frame` / focus: `id`; updates stacking order. Requires editor/owner; no revision increment.
- `action`: `name` and object `payload`; other peers receive name/payload/actor. Name matches `[a-zA-Z][a-zA-Z0-9._:-]{0,79}`, payload JSON at most 16,000 characters. Actions do not mutate room state; they are not acknowledged document saves.
- `journal.query`: `since` sequence; receives `journal`.

All messages still pass authorization. Presence and queries are available to viewers. Commenters may additionally publish custom actions; editors may write and lock; only owners reset. Applications must authorize any business effects triggered by actions.

## Leases

```json
{"type":"lock.acquire","path":"sheet.B2","ttlMs":15000}
{"type":"lock.renew","path":"sheet.B2","token":"private-owner-token"}
{"type":"lock.release","path":"sheet.B2","token":"private-owner-token"}
```

Supported paths: `sheet`, `sheet.<address>`, `window.<id>`, `frame.<id>`, `frame.<id>.prompt`. Foreign ancestor/descendant leases block acquiring a lease and all touching mutations, including bulk replacement/reset. At most 16 locks per connection. TTL is capped at the configured default and 30 seconds. Renew/release require the live holder's token; renewal cannot resurrect an expired lock.

`lock.acquired` includes `path` and `lock` with actorId/name/badge/color/expiresAt. Only the owning connection gets `token`; snapshots and other clients omit it. `lock.denied` includes path, reason and the current foreign lock when present. `lock.released` includes `paths` and reason `released`, `expired`, `deleted` or `disconnected`. Maintenance broadcasts expiration; disconnect releases owned leases.

The browser client retains tokens privately, renews owned leases, and defers releases until touching queued edits finish. UI code should wait for its lock grant before enabling typing. Locks are optional coordination: writes without a lock still need the revision check and are rejected if a foreign lock exists.

## Activity and recovery

Journal records: `id`, `seq`, `at`, `room`, `revision`, `actor`, `type`, optional `path`, `requestId`, `before`, `after`. Sequences increase per room lifetime, including presence/action events. A committed mutation's event uses its resulting revision. Cursor/focus/intermediate movement are excluded; final movement, cell/prompt changes, object lifecycle, generation, reset, joins/leaves and custom actions are recorded.

Node history defaults to 200 events / 64 KiB; the Worker profile uses 50 / 32 KiB. Both prune when either budget is reached; join sends the latest 20. Query returns events after `since`, `fromSeq` (earliest retained sequence), `nextSeq` (latest sequence) and `truncated`. `truncated` is true if the requested cursor predates retained history or exceeds this room lifetime's latest sequence. Sequence numbers do not identify a durable cross-restart epoch.

Sheet replacement logs before/after cell counts; reset logs object/cell counts. The journal cannot reconstruct a file. `journalSink` receives a cloned event for an application-owned store, outside the in-memory commit. Sink failure calls `onError` and does not roll back an ACK. It is not a transactional write-ahead log.

Client events: `coact:ack`, `coact:conflict`, `coact:error`, `coact:unsaved`, `coact:lock`, `coact:journal`, plus presence/windows/frames/sheet/action/status/ready/drawmode. `coact:unsaved` exposes rejected or unconfirmed operations. Preserve them in the application; never silently overwrite the latest snapshot. The demo offers copying those drafts.

See [Security](../SECURITY.md) for limits, hook configuration and trust boundaries.

## Delivery flow control and runtime behavior

Updated clients include `flowControl: true` in `hello`. The Node adapter accepts legacy peers and uses native buffer/egress limits; the Worker profile requires negotiation and otherwise closes with `flow_control_required`.

For negotiated connections the server appends a monotonic per-connection `deliverySeq` to packets. Clients acknowledge the highest received sequence using `{ "type": "delivery.ack", "sequence": 42 }`. Receipts are batched (up to 64 received packets / about 200ms), with immediate acknowledgment for large packets. These transport receipts do not mutate documents or add journal events. They still pass message authorization/rate checks; admitted readers must be allowed to send them.

The server bounds unacknowledged bytes and sequence distance separately from its egress-rate bucket. Credit bookkeeping uses compact batches instead of retaining packet bodies. Slow peers close with 1013. Worker flow metadata is checkpointed into socket attachments after activity; it restores with the same socket and sequence after hibernation. Client-side initiated pressure closes use application codes (4008 rate / 4009 oversized incoming packet), valid in browsers.

A rate-limit rejection terminates the connection and immediately exposes unconfirmed operations with `rate_limited`, rather than waiting for an 8-second ACK timeout. The client resumes from a snapshot after reconnecting and does not replay those operations.

Node rooms are memory-only. The Worker adapter persists incremental keys in SQLite and delays success delivery until its transaction commits. Cursor, selection, focus and transport-receipt traffic does not write document rows; owned lease changes and meaningful journal/state mutations do. Short-lived connection-metadata timers finish after activity; expiry/empty-room retention uses alarms. Worker defaults and platform-specific restrictions are documented in resources.md.
