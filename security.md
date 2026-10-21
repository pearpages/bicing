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
- **`?lang=`**: picks the UI language. It's matched against the `ca` / `en` allowlist (`apps/web/src/i18n/locales.ts`)
  and anything else is ignored, so the raw value never reaches the DOM.
- **`localStorage`** (`bicing-pulse:lang`): only the remembered language. A read goes through the same allowlist, since
  another script on the origin could have written it, and storage failures are caught, not fatal.
- **Headers** (`nginx.conf`, mirrored in `apps/web/vite.config.ts`): `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless` for cross-origin isolation. There's no Content-Security-Policy yet.
- **Rendering**: text reaches the DOM through Vue templates and d3 `.text()`, never through `innerHTML`, so there's
  no HTML-injection path. Keep it that way when Phase 2 brings real station names.
- **Workers**: messages follow the typed protocol in `packages/data/src/protocol.ts`, same-origin only.

**Phase 2 additions** (planned, not built yet):

- **Parquet from a configurable base URL** (T2.4, ADR 0013). `VITE_DATA_BASE_URL` is set at build time and is not
  user input; in production it's an external host with CORS. Everything fetched from it is untrusted:
  - month names from `manifest.json` must match `YYYY-MM` before they're put in a URL;
  - `stations.json` must have equal-length arrays of the right types;
  - each Parquet file must have the six expected columns, every `stationIdx` below the station count, `t`
    sorted, and `status` a known value.

  A file that fails is rejected with an error, never drawn. Station names reach the DOM only as text (Vue
  templates and d3 `.text()`).

- **Extracting the 7z archives** (T2.2, ADR 0012):
  - **Sandbox:** 7-Zip runs as WASM (`7z-wasm`), with only the archive's folder and a scratch folder under `data/`
    mounted.
  - **Entries:** the archive must list exactly one entry, a plain `*.csv` name (no `/`, no `..`, nothing absolute).
    Anything else is rejected before extraction.
  - **Contents:** the CSV is untrusted too. DuckDB reads it with `TRY_CAST` and range checks, and a month with more
    than 1% invalid rows fails.

**Node CLIs (`tools/*`)**: run locally by the developer. `tools/synthetic` writes only to its `--out` directory.

- **`tools/prepare-data` downloads** (built in T2.1). Archive URLs come from the CKAN `package_show` response, which
  is treated as untrusted (`tools/prepare-data/src/ckan.ts`):
  - **Origin:** only HTTPS URLs on `opendata-ajuntament.barcelona.cat` are kept, and the final URL after redirects
    is checked again.
  - **Names:** a resource must be a monthly `.7z` that needs no token. The file name on disk is built from the
    parsed dataset and month (`<dataset>/<YYYY-MM>.7z`), never from the response, so a name can't escape `--out`.
  - **Size and partial files:** a download is capped at CKAN's declared size, or 500 MB when there's none. It's
    written to `.part` and renamed only once the size matches, so a failed download leaves nothing that looks
    complete.
  - **Manifest:** `data/raw/manifest.json` comes from our own previous run. A malformed one only causes
    re-downloads.

## Secrets

- There are none. The app and CLIs need no keys, and Open Data BCN is public and keyless.
- If one is ever needed, it goes in an env var or a CI secret, never in git. `.env*` files must be gitignored, with
  an example file that lists names only.

## Dependencies

- `pnpm-lock.yaml` is committed. CI installs from the lockfile.
- pnpm 12 runs dependency install scripts only when they're listed in `allowBuilds`.
- `autoInstallPeers: false` keeps optional peers from being pulled in unasked.
- Look up the current stable version before adding a dependency (P25). Prefer individual `d3-*` modules (P3).
- CI actions (`actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact`)
  are pinned to major tags, not commit SHAs.
- The browser tests (ADR 0016) download Chromium from Playwright's CDN in CI, cached per Playwright version. Their
  report is uploaded only when they fail, and holds screenshots of synthetic data only.

## Known risks

- **`?automation` in production**: anyone can script the benchmark in their own tab. This is accepted: it runs only
  client-side code the UI already exposes, and it affects only that tab.
- **No CSP header**: accepted while the page loads only same-origin code and no third-party content. When A9 deploys
  with an external data host, add a CSP with `connect-src` limited to that origin (and `wasm-unsafe-eval` for
  parquet-wasm).
- **CI actions pinned to tags**: accepted for a single-maintainer portfolio repo; pin to SHAs if the repo gains
  secrets or deploy credentials.
