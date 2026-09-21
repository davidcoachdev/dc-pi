# dc-preview migration — seventeenth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§22 "`previu.ts` — Port de panel split para tmux/herdr"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/previu.ts`
- SHA-256: `5ee2e15327fe3f2c467aed9ff2cec455a5f0b9f8f2f7b316e0920484da53fd09`
- Preserved in: `original/previu.ts`.

Objectives:
- Extract `src/features/dc-preview/dc-preview-launcher.ts`:
  - Pure, testable multiplexer split functions for Tmux & Herdr:
    - Tool modes: `manager`, `nvim`, `fzf`, `yazi`, `dc-studio`.
    - Orientations: `h` (right / 40%), `v` (down / 40%).
    - Parse helpers: `parseToolArg`, `parseOrientationArg`.
    - Split executors with parameterizable `execFn` and `env`.
- Implement `src/features/dc-preview/dc-preview-panel.ts`:
  - Interactive selection panel (`DcPreviewSelectPanel`) with keyboard navigation (`↑`/`↓`/`Enter`/`Esc`), mouse selection, and selected highlight.
- Implement `src/features/dc-preview/dc-preview.ts`:
  - Menus mounted on `openDcModal` + `DcWindow` with title `⛩  Dc Studio - Preview`.
  - Single canonical English command: `/dc-preview` (no aliases).
  - Shortcut: `Alt+Shift+V`.
- Add automated regression tests in `test/dc-preview.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/previu.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement pure launcher and argument parsing in `src/features/dc-preview/dc-preview-launcher.ts`.
- [x] Task 3: Implement selection panel component in `src/features/dc-preview/dc-preview-panel.ts`.
- [x] Task 4: Implement modal menus and extension in `src/features/dc-preview/dc-preview.ts` with single `/dc-preview` command.
- [x] Task 5: Add automated regression tests in `test/dc-preview.test.ts`.
- [x] Task 6: Full verification (tests, typecheck), update registry, demo script, and close.
