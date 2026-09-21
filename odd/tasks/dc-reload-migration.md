# dc-reload migration — twentieth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§7 "`dc-herdr-reload.ts` — Atajo F5 y recarga"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-herdr-reload.ts`
- SHA-256: `4c455e5aba20230cde149d1c7cbab146d921ae27146c3d0d696ff09d930c636d`
- Preserved in: `original/dc-herdr-reload.ts`.

Objectives:
- Implement `src/features/dc-reload/dc-reload.ts`:
  - Eliminate prototype monkey patching of `InteractiveMode`.
  - Use official `ctx.reload()` provided by Pi ExtensionContext.
  - Register shortcut strictly with `F5` (`pi.registerShortcut("f5")`).
  - Register single canonical English command: `/dc-reload`.
  - Capture `session_start` with reason `"reload"` to dispatch Herdr notification via `dcNotifier`.
- Add automated regression tests in `test/dc-reload.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-herdr-reload.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement extension in `src/features/dc-reload/dc-reload.ts` with `ctx.reload()`, shortcut F5, and `/dc-reload`.
- [x] Task 3: Add automated regression tests in `test/dc-reload.test.ts`.
- [x] Task 4: Full verification (tests, typecheck), update registry, demo script, and close.
