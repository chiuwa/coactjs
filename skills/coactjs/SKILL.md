---
name: coactjs
description: Build collaborative browser canvases with Coact.js (coactjs), including shared cursors, movable windows, image frames and spreadsheet cells. Use when integrating Coact.js or recreating its multiplayer demo effects.
---

# Coact.js

Integrate the real `coactjs` package into the user's application. Reuse its synchronization and rendering instead of simulating other participants or creating a second WebSocket protocol.

## Choose the starting point

- **Try the installed demo:** `npm install coactjs ws`, then `npx coactjs`. Open the printed URL in two tabs. Node.js 20+; anonymous local editing only.
- **Integrate into an app:** `npm install coactjs`; use the browser component with the application's WebSocket endpoint. Add `ws` only when using `coactjs/server`.
- **Recreate the full workspace:** start with the [repository demo](https://github.com/chiuwa/coactjs/tree/main/demo). Its board, toolbar, grid and Excel importer are application UI, separate from the library. Do not replace an existing app's design unless requested.

Check the installed package version and read `node_modules/coactjs/types/coact.d.ts` before using APIs. This skill targets the 0.5.2 API; prefer installed declarations and examples if they differ. The [integration guide](https://github.com/chiuwa/coactjs/blob/main/docs/guide.md) has extended examples. It describes the repository's current version, which may be newer than the installed package.

## Browser integration

Use a browser ESM bundler, or the installed starter's module-serving arrangement. The root export uses DOM APIs: load it on the client in SSR frameworks. It is not a headless Node client.

```html
<coact-room id="canvas" style="display:block; height:80vh"></coact-room>
```

```js
import { createCoact } from 'coactjs';

const coact = createCoact('#canvas', {
  room: 'design-review',
  endpoint: '/ws'
});

coact.element.registerWindow('brief', {
  title: 'Project brief',
  open: true,
  content: () => {
    const text = document.createElement('p');
    text.textContent = 'Move or resize this shared window.';
    return text;
  }
});

const stopPresence = coact.presence.subscribe(({ peers, online }) => {
  // Render the application's participant list here.
  console.log(online, peers);
});
```

Create/configure the component during initial setup and give it a nonzero height. Every participant must use the same room id and reach the same synchronization server. Use an absolute WebSocket endpoint when frontend and server origins differ; configure the server's origin policy for that frontend.

The component renders remote cursors and coordinates window geometry. Window contents do not synchronize automatically. Register the same window ids on each client; bind editable content to an explicit supported data model.

## Build the requested effects

| Effect | Implementation |
| --- | --- |
| Remote cursors / presence | Automatic inside the connected component; `coact.presence.subscribe()` exposes participants. |
| Shared windows | `coact.element.registerWindow(id, options)`; the component handles drag, resize and focus. |
| Draw an image frame | Bind a button to `coact.element.startFrameDraw()`. Its UI supplies a prompt and placeholder generation. |
| Create a frame directly | `coact.element.addImageFrame({ x: 0.18, y: 0.24, w: 0.32, h: 0.34 })`; geometry is normalized to the canvas, not pixels. |
| Shared cell values | `coact.collection('sheet')`; bind your grid to its snapshot/subscription and cell writes. |
| Confirm a cell write | `await coact.request('sheet', { action: 'cell', address: 'A1', value: 'Approved' })`. |
| Selections | `coact.collection('sheet').select('A1')`; read `coact.element.sheet.selections` to render remote selection UI. |
| Editing leases | Acquire/release paths such as `sheet.A1` or `frame.<id>.prompt`; wait for an owned grant. |
| Activity | Listen to `coact:journal`; `coact.journalSince(sequence)` requests recent events. |

For the grid, prompt workflow and editing controls, read [demo recipes](references/demo-recipes.md). For the smallest working editable-window example, use the installed `examples/basic/public/app.js`.

## Preserve collaboration correctness

- Never reset or replace a room during mount, reconnect or participant join. Let the component hydrate its existing state. `open: true` on registered windows participates in the component's initialization handling.
- Do not infer durable save from a convenience method returning `true`: that means queued locally. `request()` resolves with the server ACK or rejects. Node ACKs confirm in-memory state, not a filesystem write.
- Retain rejected/unconfirmed edits from `coact:unsaved` in a bounded application draft store. Surface `coact:conflict`; do not automatically retry stale values over another person's edit.
- Independent cells can commit concurrently. Touching stale edits conflict. Use optional editing leases for exclusion UX; retain mandatory revision checks. Browser leases do not protect external file writers.
- `registerCollection()` adds a client adapter, not arbitrary server storage. Each room currently has one built-in sheet cell map. Custom actions are notifications, not durable shared documents.
- Keep rendering stable during remote updates; update the affected cell/window instead of rebuilding the whole canvas on cursor movement. Unsubscribe listeners and call `coact.disconnect()` when the owning view unmounts.

## Server and product boundaries

Use `createCoactServer` from `coactjs/server` for a Node host. It owns its HTTP server; provide `requestHandler` to serve the application or put it behind a reverse proxy. A custom server with no handler serves HTTP 404 by default. For runnable static serving, adapt the installed basic example rather than inventing an API. Do not add a cloud provider unless requested.

Production mode requires real `authenticate` and `authorize` hooks. A room name is not an access credential. Preserve origin checks, message/queue/document limits, role checks and backpressure. Keep Node room state and application-owned file persistence distinct. Consult [security](https://github.com/chiuwa/coactjs/blob/main/SECURITY.md) and [resource limits](https://github.com/chiuwa/coactjs/blob/main/docs/resources.md) when building a private service or changing limits.

Image generation is a deterministic placeholder, not an AI service. The library synchronizes cell data; it does not include a complete Excel grid, formulas, XLSX parser, arbitrary file synchronization or permanent audit storage. Integrate these only when requested, using the application's own credentials and persistence.

## Verify the result

Use two real browser contexts connected to the same room. Confirm distinct identities/cursor colors, window drag/resize, cell updates and unchanged state after a new tab joins or reloads. If implementing cell editing, also attempt a same-cell conflict and a different-cell concurrent edit. Confirm disconnected/rejected drafts remain visible and errors are handled. Report which effects were actually exercised and any application-owned services still required. Installing this skill does not authorize publishing, deploying or sending user data to an external service.
