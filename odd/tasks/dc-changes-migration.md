# dc-changes migration — ninth isolated slice

Status: in_progress.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§2 "`dc-changes.ts` — Visor de Git y diff"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-changes.ts`
- SHA-256: `3a02ad656909deacfeba1afcf578b898e4414e4fd84c965eeb1466b70efe7d34`
- Preserved in: `original/dc-changes.ts`.

Objectives:
- Extract `src/integrations/dc-git/dc-git.ts`:
  - Pure, testable Git functions:
    - `parseGitStatus(rawStatus)`
    - `getGitChanges(cwd)`
    - `getFileDiff(cwd, file)`
- Implement `src/features/dc-changes/dc-changes-panel.ts`:
  - Two-panel layout: Left (file list with badges M, A, ?, D), Right (syntax-highlighted diff with line-by-line scrolling).
  - Keyboard navigation (`↑`/`↓` for files, `PgUp`/`PgDn` for diff, `r` refresh, `Enter` / `o` edit).
  - Mouse navigation (wheel on diff, click on file, click on footer buttons).
- Implement `src/features/dc-changes/dc-changes.ts`:
  - `openChangesViewer(ctx)` using `openDcModal`.
  - Canonical command `/dc-changes` (with `/dc-diff` alias).
  - Shortcut `Alt+F`.
  - Title: `⛩  Dc Studio - Cambios`.
- Add unit and regression tests in `test/dc-changes.test.ts`.

## Tasks

- [x] Snapshot `original/dc-changes.ts` and verify SHA-256.
- [ ] Implement `src/integrations/dc-git/dc-git.ts`.
- [ ] Implement `src/features/dc-changes/dc-changes-panel.ts`.
- [ ] Implement `src/features/dc-changes/dc-changes.ts`.
- [ ] Add unit tests in `test/dc-changes.test.ts`.
- [ ] Verify whole test suite and typecheck.
- [ ] Update documentation and `run-demo.sh`.
