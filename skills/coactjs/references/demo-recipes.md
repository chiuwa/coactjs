# Demo recipes

Use only the effects requested. Inspect installed declarations and `examples/basic/public/app.js` when adapting these patterns.

## Windows and presence

Register application content with `coact.element.registerWindow()`. The component supplies window movement, resize and remote cursor rendering. The board's cards, navigation and participant avatar stack belong to the application; reproduce them only when relevant. Read `peer.name` and `peer.color` instead of assigning one hardcoded identity/color to everyone.

Bind navigation active state to `coact.windows` on `coact:ready` and `coact:windows`, not only the last local click. Do not recreate window DOM on every remote update.

## Shared grid

The built-in collection is a map of spreadsheet addresses to strings. Render a grid with accessible inputs; formula calculation and XLSX import/export are separate application features.

```js
const sheet = coact.collection('sheet');
const stop = sheet.subscribe(cells => {
  // Update the affected grid values, preserving focused drafts.
  console.log(cells);
});

async function commitCell(address, value) {
  try {
    const ack = await coact.request('sheet', {
      action: 'cell', address, value
    });
    return { saved: true, revision: ack.revision };
  } catch (error) {
    return { saved: false, code: error.code, draft: value };
  }
}
```

Route the returned draft/error into the application's recovery UI. Also subscribe to `coact:unsaved` for unconfirmed operations from other edit paths; bound retained drafts by count and bytes. Persist drafts locally if they must survive reload, under the application's privacy policy.

For exclusive cell editing:

1. On focus, request `coact.lock.acquire('sheet.A1')` and keep the input read-only while waiting.
2. On `coact:lock` and state changes, check `coact.locks['sheet.A1']?.actorId === coact.self.id`.
3. After the owned grant, sync the latest cell value before enabling input. Send edits as the user types; keep local drafts if queue admission fails.
4. Release with `coact.lock.release('sheet.A1')` when editing ends. Pending touching mutations settle before release. Revert to read-only when ownership or connectivity is lost.

An acquire call's Boolean return is not a grant. Avoid replacing focused input values on every incoming event. Read-only controls may need an explicit Edit action/focus handler to request a lease. The installed example provides that wiring.

## Image frames

```js
drawButton.addEventListener('click', () => {
  coact.element.startFrameDraw();
});
```

The built-in frame UI supports drawing geometry, prompt editing and generating a shared deterministic placeholder. Use `coact:drawmode` to show whether the draw tool is active, and `coact:frames` to observe frame changes. The component coordinates prompt and drag leases.

An actual generated image requires an application generation API, shared result storage and a supported result-reference data model. The current frame schema does not provide arbitrary per-frame image-URL writes. Do not claim that setting an unknown `imageUrl` field or sending a custom action makes it durable. Implement an explicit authorized server/storage extension when that is the requested scope; keep API secrets on the server.

## Full workspace

For the complete repository demo, clone `https://github.com/chiuwa/coactjs.git`, run `npm ci`, then `npm start`. The npm CLI starter is intentionally smaller. The full demo uses SheetJS locally for Excel import/export, with separate third-party licensing and import-size/range bounds. Do not put entire workbook binaries or large base64 images into cursor/state messages.

For an existing application, bring over only needed UI patterns. Keep the Coact connection lifecycle with the owning view, reuse its server policy and avoid adding a second state engine for the same shared objects.
