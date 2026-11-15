# Security and trust boundaries

The CLI and repository demo are anonymous: participants are owners and can edit/reset their shared room. A room id or invite URL is not an access credential. Private applications must supply real identity and room membership policies.

## Private Node server

```js
import { createCoactServer } from 'coactjs/server';
const app = createCoactServer({
  mode: 'production', host: '127.0.0.1', port: 4174,
  origin: origin => origin === process.env.APP_ORIGIN,
  authenticate: request => sessions.verify(request.headers.cookie),
  authorize: context => membershipPolicy.check(context),
  requestHandler: applicationHandler,
  onError: error => applicationLogger.error(error)
});
await app.start();
```

The named services above belong to your application. Production mode requires both authentication and authorization functions. Invalid modes fail instead of silently becoming a demo. Origin/auth checks occur during upgrade; authorization and role ceilings apply to messages. Hooks should be fast and are time-bounded in the room/Node adapter. Choose explicit allowed public Origins behind a TLS reverse proxy; do not trust arbitrary forwarding headers or put long-lived secrets in room URLs.

## Private Worker

Use `createCoactWorker(policy)` and `createCoactDurableObject(policy)` with the **same policy options** and `mode: 'production'`. The router verifies the identity and join policy before addressing a room coordinator, then overwrites the internal identity header; client-supplied copies do not grant identity. The object runs the message policy again using the verified user. Worker identities must be serializable, at most 2 KiB, with an id string of at most 128 characters. Cookies/Request objects are not retained in WebSocket attachments; message authorization must work from verified identity/session information and your environment bindings.

The shipped Worker demo requires an allowed-room list, limiting anonymous coordinator creation, and configures an edge join limiter. Its namespace id is example configuration: use an appropriate id for your account. The router's join limiter is optional for a custom deployment; if omitted, add equivalent admission protection before private/public room creation. The per-room peer/message/egress budgets still apply. Different Worker instances cannot coordinate state with a global Map; the provided Durable Object binding is required.

| Role | Presence / queries / transport receipts | Custom action | Edit / acquire lock | Reset |
| --- | --- | --- | --- | --- |
| Viewer | Yes | No | No | No |
| Commenter | Yes | Yes | No | No |
| Editor | Yes | Yes | Yes | No |
| Owner | Yes | Yes | Yes | Yes |

A policy can further restrict an operation. It must allow the protocol's `delivery.ack` transport message for admitted readers. Custom actions are notifications: separately authorize business effects or file writes triggered by their receivers. The supplied hooks do not implement an identity provider, session renewal or active membership-revocation push. Your application must close revoked sessions and deliberately choose any policy-cache lifetime; denying writes alone does not retroactively remove already delivered/readable room data.

## Editing correctness

Every state mutation requires a request id and revision. The server serializes authorization, path comparison and commit per room. Independent cells can commit; stale same-field, ancestor, replacement and reset operations conflict. Deletion revisions prevent stale recreation. Optional leases are enforced when held, with private tokens for renew/release, expiry, ancestor protection and disconnect cleanup. Prompt input waits for an owned grant and the latest content before becoming editable. Rejected/unconfirmed changes are exposed as drafts; no automatic replay overwrites new state.

Recent mutation receipts retain fingerprints and small result envelopes. Replays preserve the original outcome/revision but carry the current snapshot; they do not repeat the operation or restore an old snapshot. The cache is bounded and connection-scoped, including through healthy Worker socket hibernation. Reconnect creates a new connection/idempotency window. Use storage-layer version transactions too when changing external files; browser leases cannot protect other filesystem writers.

Node ACKs confirm in-memory state. The Worker adapter writes changed document/revision/journal/lease keys in one SQLite transaction before releasing a success ACK or corresponding broadcast. Persistence failure closes affected connections without success. Worker idle-room expiry intentionally deletes its stored state. This is bounded room persistence, not a permanent file archive, cross-region backup or tamper-evident audit log. The optional Node journal sink is not a transactional save guarantee.

## Resource protection

See [resource profiles](docs/resources.md) for configurable byte/count limits, measured behavior and exact defaults. Payloads, queued edits, documents, history, revisions, peers, leases, input rates, egress and unacknowledged delivery windows are bounded. Worker peers must support delivery receipts; stalled readers close instead of accumulating unlimited output. Attachments have an application budget below the provider cap. Hibernation metadata checkpoints stop after activity; alarms handle expiry and retention without a permanent polling interval.

Limits constrain SDK/adapter behavior, not application-owned histories, image assets, parsers or logs. The full demo gates imports at 2 MiB and selects the demo sheet range. It does not isolate adversarial compressed-file parsing. File bytes never enter this protocol, and SheetJS remains outside the npm library.

## Public files and content

The Node API's default HTTP handler serves 404. The CLI serves only its dedicated public example, browser source and icons. Repository/Worker asset builds explicitly select public directories; server code, environment files and repository metadata are excluded. Treat mounted public directories as public and keep secrets elsewhere. Static routes validate real paths and file types.

Window string content is trusted application HTML; sanitize untrusted content yourself. The demo renders cell values, user labels, prompts and activity text as text. The current tests cover particular behaviors, including restore and slow-reader paths, rather than a full penetration or production load audit.
