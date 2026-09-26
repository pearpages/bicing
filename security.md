# Security

The security surface of Bicing Pulse and the rules that protect it. General rules are in
[principles.md](principles.md); how the pieces fit is in [architecture.md](architecture.md). Update this file
whenever the surface changes (new input, endpoint, secret, dependency, header).

## Reporting a vulnerability

TODO: there's no public remote yet (tasks.md D1, S3). Until then, email the owner (pearpages) directly. Once the
GitHub repo exists, report through its private vulnerability reporting. Never open a public issue for an unfixed
vulnerability.

## Surface

**Web app (`apps/web`)**: a static site served by nginx. No backend, no accounts, no auth, no cookies, no user
uploads. All data is generated in a Web Worker from a seed.

- **URL input**: only `?automation`, which exposes `window.bicingBenchmark` (run a benchmark, read its Markdown). It
  only reaches what the page's own UI already does, so it's accepted (see Known risks).
- **Headers** (`nginx.conf`, mirrored in `apps/web/vite.config.ts`): `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless` for cross-origin isolation. There's no Content-Security-Policy yet.
- **Rendering**: text reaches the DOM through Vue templates and d3 `.text()`, never through `innerHTML`, so there's
  no HTML-injection path. Keep it that way when Phase 2 brings real station names.
- **Workers**: messages follow the typed protocol in `packages/data/src/protocol.ts`, same-origin only.

**Phase 2 additions** (planned, not built yet):

- Parquet fetched from a configurable external base URL (CORS + range requests). Treat those files as untrusted:
  validate the schema and bounds (station indices < station count, sorted `t`) before handing columns to renderers.
- `tools/prepare-data` downloads from the Open Data BCN CKAN API and extracts 7z archives. Extract only to
  `data/`, and reject entries with absolute paths or `..` (path traversal). Use HTTPS only.

**Node CLIs (`tools/*`)**: run locally by the developer. `tools/synthetic` writes only to its `--out` directory.

## Secrets

- There are none. The app and CLIs need no keys, and Open Data BCN is public and keyless.
- If one is ever needed, it goes in an env var or a CI secret, never in git. `.env*` files must be gitignored, with
  an example file that lists names only.

## Dependencies

- `pnpm-lock.yaml` is committed. CI installs from the lockfile.
- pnpm 12 runs dependency install scripts only when they're listed in `allowBuilds`.
- `autoInstallPeers: false` keeps optional peers from being pulled in unasked.
- Look up the current stable version before adding a dependency (P25). Prefer individual `d3-*` modules (P3).
- CI actions (`actions/checkout`, `pnpm/action-setup`, `actions/setup-node`) are pinned to major tags, not commit SHAs.

## Known risks

- **`?automation` in production**: anyone can script the benchmark in their own tab. This is accepted: it runs only
  client-side code the UI already exposes, and it affects only that tab.
- **No CSP header**: accepted while the page loads only same-origin code and no third-party content. Revisit when
  Phase 2 adds the external data URL (a `connect-src` limited to that origin).
- **CI actions pinned to tags**: accepted for a single-maintainer portfolio repo; pin to SHAs if the repo gains
  secrets or deploy credentials.
