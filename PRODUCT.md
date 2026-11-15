> This is the original product/design brief. Verified 0.5.1 technical scope, including Node/Worker adapters and bounded room persistence, is documented in README.md and docs/resources.md; the original non-goals below are historical.

# PRODUCT.md

## Product

**Coact.js** is an embeddable vanilla JavaScript Web Component for real-time multiplayer cursors and shared draggable windows over WebSocket.

It is a small open-source action layer for developers building collaborative canvases, enterprise workspaces, shared dashboards, planning rooms, and interactive prototypes.

## Audience

- Front-end engineers who need multiplayer presence without adopting a full collaboration framework.
- Designers and creative technologists prototyping shared spaces.
- Open-source users who want a readable reference implementation they can fork.

## Demo goal

In under ten seconds, a visitor should understand that:

1. Other people are present in the same room.
2. Cursors are live.
3. Windows are shared.
4. Opening a second tab proves the interaction immediately.

The demo should explain through interaction, not paragraphs.

## Scope

- `<coact-room>` Web Component.
- Cursor presence and room-wide online state.
- Shared open, close, focus, move, and resize state for windows.
- Drawn image frames with shared prompts and deterministic placeholder art.
- A shared spreadsheet grid with live cells, peer selection, formulas, and Excel import/export.
- A reference Node.js WebSocket server.
- A polished demo shell and public API documentation.
- A practical demonstration of image-generation framing and spreadsheet co-editing.

## Non-goals

- Authentication, roles, or permissions.
- Durable room storage.
- CRDT or conflict-free simultaneous editing.
- Production-scale fan-out across multiple server instances.

## Open-source posture

The project should feel legible, hackable, and friendly to fork. Prefer browser-native APIs and zero runtime dependencies in the client component.

## Assumptions

No further product interview was available. The brief and existing working demo are treated as product truth.
