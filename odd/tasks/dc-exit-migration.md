# dc-exit migration — sixteenth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§5 "`dc-exit.ts` — Limpieza de terminal al salir"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-exit.ts`
- SHA-256: `60b9ec44fd061437c2a42ce792dba245cd0d8764b51fab4c682e43b346537aed`
- Preserved in: `original/dc-exit.ts`.

Objectives:
- Implement `src/features/dc-exit/dc-exit.ts`:
  - Hooks into Pi's `session_shutdown` lifecycle event.
  - Detects if shutdown reason is actual quit vs in-flight session switch (`reload`, `new`, `new-session`, `resume`, `fork`).
  - Upon actual quit, arms clean terminal wipe (`\x1b[2J\x1b[3J\x1b[H`) on process `exit`.
  - Parameterizable exit hook and writer for safe test execution.
- Add regression tests in `test/dc-exit.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-exit.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement `src/features/dc-exit/dc-exit.ts`.
- [x] Task 3: Add automated regression tests in `test/dc-exit.test.ts`.
- [x] Task 4: Full verification (tests, typecheck), update registry, demo script, and close.
