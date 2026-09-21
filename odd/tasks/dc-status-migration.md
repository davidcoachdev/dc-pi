# dc-status migration — twelfth isolated slice

Status: in_progress.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§15 "`dc-status.ts` — Estado del entorno"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-status.ts`
- SHA-256: `881d341e1846f3a6bdc964157617483746b77a13703522a66a6dcad6c9c45d73`
- Preserved in: `original/dc-status.ts`.

Objectives:
- Extract `src/features/dc-status/dc-status-collector.ts`:
  - Pure, testable environment collection functions:
    - `getGitBranchAndStatus(cwd)`
    - `collectEnvStatus(ctx, pi)`
- Implement `src/features/dc-status/dc-status-panel.ts`:
  - Two-tabs layout:
    - Tab 1: `Entorno` (metrics: Git branch, CWD, Model & Reasoning, MCP servers, Packages, Skills, Tools, Pi Version).
    - Tab 2: `Alertas` (detected issues or warnings with copy-to-editor action).
  - Uses `dcClipboard` (multiplatform) instead of Linux-only `xsel`.
- Implement `src/features/dc-status/dc-status.ts`:
  - `openStatusViewer(ctx, pi)` mounted on `openDcModal` + `DcWindow`.
  - Title: `⛩  Dc Studio - Estado`.
  - Unique command: `/dc-status`.
  - Shortcut: `Alt+E`.
  - Configurable width: 55% (-30% scale).
- Regression tests in `test/dc-status.test.ts`.

## Tasks

- [x] Snapshot `original/dc-status.ts` and verify SHA-256.
- [ ] Implement `src/features/dc-status/dc-status-collector.ts`.
- [ ] Implement `src/features/dc-status/dc-status-panel.ts`.
- [ ] Implement `src/features/dc-status/dc-status.ts`.
- [ ] Add regression tests in `test/dc-status.test.ts`.
- [ ] Verify whole test suite and typecheck.
- [ ] Update documentation and `run-demo.sh`.
