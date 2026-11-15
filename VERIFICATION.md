# Coact.js 0.5.1 verification

Local candidate verified on 2026-11-15. No npm publication, GitHub push or cloud deployment was performed.

| Check | Result |
| --- | --- |
| `npm test` | 18 server/core/resource integration tests passed |
| `npm run test:types` | Browser/Node/Worker declarations passed, including invalid-call expectations |
| `npm run test:worker` | 5 actual local workerd integration tests passed |
| `npm run test:client` | 4 client regression groups passed |
| `npm run test:browser` | 14 demo browser groups passed |
| Worker production dry-run | Passed; no cloud credentials/deployment used |
| Browser-only install | Fresh project added one package; no ws/Wrangler runtime install; browser/Worker declarations compiled without Node types |
| Installed Node CLI | Help and real two-page shared-cell/frame behavior passed |
| Copied installed Cloudflare starter | Built and served in local Wrangler; real two-page WebSocket/cell sync passed |
| Desktop/mobile | Four installed-starter/full-Worker captures inspected; no page overflow; no uncaught browser errors |
| Impeccable mechanical detector | Empty finding list |
| Existing Node demo | Pre-upgrade backup retained; 28 cells and both window geometries restored and compared |

Node.js 24.22.1, Chromium 157.0.8103.78, TypeScript 5.9.3, Wrangler 4.162.0. The configured minimum compatibility date is 2026-07-01. The pinned Wrangler development tooling needs Node 22.12+, separately from the Node 20+ server runtime target. GitHub CI configuration is saved but was not run remotely.

The five follow-up findings are covered by tests: input-time prompt coordination, compact outcome receipts, atomic UI on failed queue admission, per-room hydration, and immediate recoverable rate rejection. Additional checks cover escaped document bytes, immutable queued objects, total Node queued-input pressure, journal byte limits, storage-failure ACK gating, delivery credit windows and slow consumers.

Worker tests exercise SQLite-backed updates, live connection/request-outcome reconstruction after dropping the engine cache, alarm-based lease expiry, room admission/capacity, production authorization hooks and forged-header denial. Reconstruction is deliberately tested, while platform eviction placement/timing and real internet latency remain unmeasured. Test inspection endpoints are excluded from the production entry and npm package.

Resource observations: the repeated-conflict workload retained 0.6 MiB of extra Node heap after GC versus 27.9 MiB in the earlier candidate; this is not total RAM. The local 16-peer cursor sample emitted 10,800 broadcasts / 2,226,505 JSON bytes in 3.528s with 0 additional content SQL writes. Document accounting was 104,710 bytes and the largest attachment in that workload was 616 JSON bytes. The installed-browser sample and exact results are in the separately delivered verification JSON.

Limits: physical touch hardware, Safari/Firefox, real Cloudflare account quotas/costs, long-running production traffic, permanent file recovery and a full security audit were not tested. Node state remains memory-only; Worker state has bounded SQLite persistence and idle retention. SDK budgets do not bound a consumer application's own retained data or total process/isolate footprint.

See docs/resources.md and SECURITY.md for limits, deployment requirements and trust boundaries.

Final npm archive: coactjs-0.5.1.tgz, 140,399 bytes, SHA-256 `c0c080893d3d18e3575adad139d32f9b259a2558c8be987c78c79fd5ddbd95e9`. Archive source/types match the tested files. Server and starter examples are included; tests, full demo, vendored parser and generated files are excluded.
