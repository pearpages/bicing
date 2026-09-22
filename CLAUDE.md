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
