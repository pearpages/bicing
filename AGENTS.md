# Bicing Pulse

Portfolio project: render millions of Bicing (Barcelona bike-sharing) data points smoothly in the browser. D3
computes, Canvas/WebGL2 draws. Vue 3 + TypeScript 6 + Vite in a pnpm monorepo, shipped as a static site behind nginx.

## Project documents — read before working

These are the contract. Follow them, and amend them before deviating.

| File                               | Holds                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------- |
| [principles.md](principles.md)     | The rules every change follows (P1…), cited by ID                       |
| [architecture.md](architecture.md) | Packages and dependency graph, data model, data flow, rendering, deploy |
| [decisions.md](decisions.md)       | Index of ADRs in `docs/adr/`: why each choice was made                  |
| [tasks.md](tasks.md)               | Open work (phases, Discovered) and the dated log of what was done       |
| [security.md](security.md)         | Surface, secrets, dependency policy, how to report a vulnerability      |
| [LICENSE](LICENSE)                 | MIT                                                                     |

[README.md](README.md) is the user-facing entry point, with the benchmark results.

## Working rules (mandatory)

1. Pick the **first unchecked task** under Open in `tasks.md`. Don't skip ahead or bundle tasks.
2. Re-read the principles the task touches (cite them by ID, e.g. P4, P8).
3. Before committing, lint, typecheck and tests must pass (`pnpm test -- --run`, never watch mode).
4. The commit that completes a task ticks it in `tasks.md` and ends its body with `Task: <ID>`.
5. Need to deviate from `architecture.md` or `principles.md`? First make a separate `docs:` commit amending them (plus an
   ADR in `docs/adr/` and a line in `decisions.md` if there are trade-offs). Code never silently drifts from the docs.
6. Work found mid-task goes under **Discovered** in `tasks.md`. Don't do it on the side.
7. Anything touching input handling, fetched data, headers or dependencies is checked against `security.md`, and
   updates it when the surface changes.
8. End of session: add a dated line at the top of **Done** in `tasks.md`. Outcomes go to those files, never here:
   this file holds only how to work and pointers.
9. Confirm before anything outward-facing: pushes, releases, deploys.

## Development commands

Shells here must run on the mise toolchain (Node 24, pnpm 12): prefix commands with `eval "$(mise env -s bash)"`
if `node -v` doesn't print v24.

- `pnpm install` · `pnpm dev` (apps/web) · `pnpm build`
- `pnpm run lint` · `pnpm run typecheck` (root tsc + `pnpm -r typecheck`, vue-tsc for apps/web) · `pnpm run format`
- `pnpm test -- --run` (never bare `pnpm test`: that's watch mode)
- `docker build -t bicing-pulse .`. The local runtime is colima (`colima start`), with no buildx, so keep the Dockerfile
  free of BuildKit-only syntax.

## Pitfalls that have bitten before

- A package vanished from git → the unanchored ignore `data/` also matched `packages/data` → anchor ignore patterns
  (`/data/`).
- pnpm 12 skipped install scripts → it needs explicit `allowBuilds`; `autoInstallPeers: false` keeps too-new optional
  peers out.
- Benchmarks stalled or read 0 fps → automated Chrome tabs are often hidden, so rAF stops → run them in a foreground
  window.
- Benchmark numbers from dev builds mislead → run them on `vite preview` with `?automation`.
