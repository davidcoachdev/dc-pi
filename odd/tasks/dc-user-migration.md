# dc-user migration — fourteenth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§20 "`dc-user.ts` — Nombre de usuario para el chrome"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-user.ts`
- SHA-256: `da0739c01084ec0be3042befb788787be2d0b2ea3ec21c06940b4e513ac083fb`
- Preserved in: `original/dc-user.ts`.

Objectives:
- Extract `src/features/dc-user/dc-user-store.ts`:
  - Pure, testable user storage functions:
    - `getUserName(filePath?: string): string`
    - `saveUserName(name: string, filePath?: string): void`
    - Parameterizable storage path for deterministic testing (defaults to `~/.pi/agent/dc-user.json`).
- Implement `src/features/dc-user/dc-user-prompt-input.ts`:
  - `PromptInputComponent` implementing `Component` with proper rendering, cursor indicator, Enter/Esc/Backspace handling.
- Implement `src/features/dc-user/dc-user.ts`:
  - `askUserName(ctx: ExtensionContext): Promise<string>` using `openDcModal` + `DcWindow` with title `⛩  Dc Studio - Usuario`.
  - Extension function `dcUserExtension(pi: ExtensionAPI)` registering:
    - Canonical command `/dc-usuario` and alias `/dc-user`.
    - Shortcut `Alt+N`.
    - `session_start` delay hook (4s unref) and `message_start` fallback when name is unset.
    - Lifecycle cleanup on `session_shutdown`.
- Add automated regression tests in `test/dc-user.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-user.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement pure user storage module in `src/features/dc-user/dc-user-store.ts`.
- [x] Task 3: Implement prompt input UI component in `src/features/dc-user/dc-user-prompt-input.ts`.
- [x] Task 4: Implement extension entrypoint and modal in `src/features/dc-user/dc-user.ts`.
- [x] Task 5: Add automated regression tests in `test/dc-user.test.ts`.
- [x] Task 6: Full verification (tests, typecheck), update registry, demo script, and close.
