# dc-title migration — fifteenth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§17 "`dc-title.ts` — Renombrado de pestaña"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-title.ts`
- SHA-256: `cd4101d9a0008b01c2e0db275444dc40a5fbf055ba237edf6c1a5581970b39c3`
- Preserved in: `original/dc-title.ts`.

Objectives:
- Extract `src/features/dc-title/dc-title-renamer.ts`:
  - Pure, testable multiplexer and terminal tab renaming functions:
    - `isHerdr(): boolean`
    - `isTmux(): boolean`
    - `renameTab(title: string, options?: RenameTabOptions): RenameTabResult`
    - Parameterizable execution runner and output writer for deterministic testing.
- Implement `src/features/dc-title/dc-title.ts`:
  - `dcTitleExtension(pi: ExtensionAPI)` registering:
    - Single canonical English command `/dc-title`.
    - Automatic rename to "Pi" on `session_start`.
- Add automated regression tests in `test/dc-title.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-title.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement pure tab renamer in `src/features/dc-title/dc-title-renamer.ts`.
- [x] Task 3: Implement extension entrypoint in `src/features/dc-title/dc-title.ts` with single `/dc-title` command.
- [x] Task 4: Add automated regression tests in `test/dc-title.test.ts`.
- [x] Task 5: Full verification (tests, typecheck), update registry, demo script, and close.
