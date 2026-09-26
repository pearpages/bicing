# 0010 — Project knowledge lives in principles, architecture, decisions, tasks and security

- **Status:** Accepted
- **Date:** 2026-09-26
- **Principles:** P21, P23, P26

## Context

The governing docs lived in `docs/` as `ARCHITECTURE.md`, `PRINCIPLES.md` and `TASKS.md`, and `CLAUDE.md` held the
workflow, the commands and a growing session log. That works for Claude Code only. Other agents look for `AGENTS.md`,
and the session log mixed outcomes, lessons and decisions in a file nobody prunes. There was no security file and no
license, although the project is meant to be published as a portfolio piece.

## Decision

Adopt the owner's cross-project knowledge standard:

- `AGENTS.md` holds how to work here and pointers, nothing else. `CLAUDE.md` only imports `AGENTS.md` and
  `principles.md`.
- At the repo root: `principles.md` (rules), `architecture.md` (how it's built), `decisions.md` (ADR index; the ADRs
  stay in `docs/adr/`), `tasks.md` (`## Open` / `## Done`), `security.md`, `LICENSE` (MIT).
- `tasks.md` keeps the phase and Discovered structure under Open, so "do the first unchecked task" still works.
  Session outcomes become dated lines at the top of Done instead of a session log.

## Consequences

- (+) Every kind of knowledge has one home, and any agent finds it from `AGENTS.md`.
- (+) The principles are always in Claude's context without being duplicated.
- (+) The layout matches the owner's other projects, so the same tooling checks it.
- (−) Architecture and tasks are no longer auto-imported into Claude's context; the working rules say to read them.
- (−) Old paths linger in a few code comments until they're updated (tasks.md S1).

## Alternatives considered

- **Keep `docs/` uppercase and only add the missing files.** Less churn, but the standard's checks would keep
  flagging the files as missing, and the project would be the odd one out.
- **Keep the session log in `CLAUDE.md`.** Rejected: that's the pile-up this standard exists to prevent.
