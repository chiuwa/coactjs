# Contributing

Issues and pull requests are welcome.

## Local development

```bash
npm install
npm run dev
```

## Before opening a pull request

- Keep the client component dependency-free.
- Test with at least two browser tabs or two devices.
- Confirm keyboard focus and reduced-motion behavior.
- Update `README.md` and `docs/protocol.md` when the public API or protocol changes.
- Keep authentication and persistence behind application-owned hooks; do not bake a provider or demo policy into the browser library.
- Run `npm test` and `npm run test:types`; run `npm run test:browser` after synchronization or UI changes (see README for Playwright setup).

## Resource and Worker changes

Use Node 22.12+ for the pinned Wrangler tooling. Run `npm run test:worker` after coordinator/Worker changes; it builds a local fixture and uses workerd without cloud credentials. `npm run test:client` covers the five follow-up client paths. Keep tests/profiling endpoints out of production entry points and assets. Never reintroduce full request/snapshot receipt caching or persistent cursor writes. Document budget and protocol changes together.
