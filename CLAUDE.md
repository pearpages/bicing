# Bicing Pulse

Portfolio project: render millions of Bicing data points smoothly in the browser. D3 computes, Canvas/WebGL2 draws.
Vue 3 + TypeScript 6 + Vite, in a pnpm monorepo.

## Governing documents (binding)

These three files are the contract. Read them before working. Follow them, and amend them before deviating.

@docs/ARCHITECTURE.md
@docs/PRINCIPLES.md
@docs/TASKS.md

## Workflow (mandatory)

1. Pick the **first unchecked task** in `docs/TASKS.md`. Don't skip ahead or bundle tasks.
2. Re-read the principles the task touches (cite them by ID, e.g. P4, P8).
3. Before committing, lint, typecheck and tests must pass (`pnpm test -- --run`, never watch mode).
4. The commit that completes a task ticks it in `docs/TASKS.md` and ends its body with `Task: <ID>`.
5. Need to deviate from ARCHITECTURE or PRINCIPLES? First make a separate `docs:` commit amending them (plus an ADR in
   `docs/adr/` if there are trade-offs). Code never silently drifts from the docs.
6. Work found mid-task goes under **Discovered** in `docs/TASKS.md`. Don't do it on the side.
7. End of session: update `docs/TASKS.md` and the session log below.

## Commands

Shells here must run on the mise toolchain (Node 24, pnpm 12): prefix commands with `eval "$(mise env -s bash)"`
if `node -v` doesn't print v24.

- `pnpm install` · `pnpm dev` (apps/web) · `pnpm build`
- `pnpm run lint` · `pnpm run typecheck` (root tsc + `pnpm -r typecheck`, vue-tsc for apps/web) · `pnpm run format`
- `pnpm test -- --run` (never bare `pnpm test`: that's watch mode)
- `docker build -t bicing-pulse .`. The local runtime is colima (`colima start`), with no buildx, so keep the Dockerfile
  free of BuildKit-only syntax.

## Session log

- **2026-09-21**: Planned Phases 0–1 (React → Vue per user request; TS 6.0.3 pinned because typescript-eslint
  doesn't support TS 7 yet). Wrote the governing docs (T0.0).
- **2026-09-22**: Phases 0 and 1 done (T0.0–T1.16). Highlights:
  - Monorepo, strict TS 6, boundary lint, Vitest projects, CI, Docker/nginx with COOP/COEP.
  - core (store, series, min/max + LTTB with property tests), synthetic generator, a typed worker protocol with
    zero-copy transfer, SVG/Canvas/WebGL renderers, a TimeSeriesChart with zoom and hover, Vue bindings, and benchmark mode.
  - Measured: WebGL2 60 fps at 10M, SVG 9 fps at 1M. The first run missed the target until MSAA was found to cost 6×
    (ADR 0009).
  - Lessons: anchor ignore patterns (`data/` once hid `packages/data`); pnpm 12 needs explicit `allowBuilds`, and
    `autoInstallPeers: false` keeps too-new optional peers out; automated Chrome tabs are often hidden, so rAF stops and
    benchmarks need a foreground window; run benchmarks on `vite preview` with `?automation`.
  - Pending: the Discovered list D1–D8 in docs/TASKS.md, then Phase 2 (T2.1–T2.8).
