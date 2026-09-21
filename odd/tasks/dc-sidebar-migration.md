# dc-sidebar migration — twenty-fourth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§14 "`dc-sidebar.ts` — Sidebar de gentle-pi con marco DC"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-sidebar.ts`
- SHA-256: `1146aec0e3a161bf0045a6569255f0bf222a023b549d6a15121c17ebe3048e2a`
- Preserved in: `original/dc-sidebar.ts`.

Objectives:
- Decompose the massive 3400-line monolithic `dc-sidebar.ts` into clean, testable, decoupled modules under `src/features/dc-sidebar/`:
  - `dc-sidebar-prefs.ts`: Persistent sidebar preferences (`~/.pi/agent/dc-sidebar.json`: `hidden`, `frame`, `bodyFrame`, `headerBar`).
  - `dc-sidebar-context.ts`: Context usage monitoring, thresholds (optimal/medium/high/critical), and modal viewer.
  - `dc-sidebar-frame.ts`: Double frame wrapper (`╔═╗`, `║`, `╚═╝`, Torii `⛩ `) around rail and layout nodes.
  - `dc-sidebar-rail.ts`: Rail section hooking, card styling, brand badge substitution ("gentle-pi" → "⛩  Dc Studio"), and show/hide logic.
  - `dc-sidebar.ts`: Extension entrypoint registering single canonical English command `/dc-sidebar [toggle|show|hide|frame|context]` and shortcut `Alt+B`.
- Add automated regression tests in `test/dc-sidebar.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-sidebar.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement preferences module in `src/features/dc-sidebar/dc-sidebar-prefs.ts`.
- [x] Task 3: Implement context monitoring in `src/features/dc-sidebar/dc-sidebar-context.ts`.
- [x] Task 4: Implement frame & layout decoration in `src/features/dc-sidebar/dc-sidebar-frame.ts`.
- [x] Task 5: Implement rail management and card styling in `src/features/dc-sidebar/dc-sidebar-rail.ts`.
- [x] Task 6: Implement extension and commands in `src/features/dc-sidebar/dc-sidebar.ts`.
- [x] Task 7: Add automated regression tests in `test/dc-sidebar.test.ts`.
- [x] Task 8: Full verification (tests, typecheck), update registry, demo script, and close.
