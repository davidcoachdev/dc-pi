# dc-user-box migration — twenty-second isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§19 "`dc-user-prompt.ts` — Enmarcado de mensajes del usuario"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-user-prompt.ts`
- SHA-256: `3171cc53fb67d955fb75f32c9ab5cf393b707078d594d15d95f7ed073cc42c0e`
- Preserved in: `original/dc-user-prompt.ts`.

Objectives:
- Implement `src/features/dc-user-box/dc-user-box-patch.ts`:
  - Intercepts `UserMessageComponent.prototype.render` and `handleMouse`.
  - Encloses user prompts in rounded cards (`╭─ ⛩  User ─╮`, `│`, `╰─ [📋] ─╯`).
  - Integrates with `getUserName()` from `dc-user-store.ts`.
  - Click-to-copy handler on bottom border using multiplatform `dcClipboard` (eliminating `spawn("xsel")`).
  - Configurable box enablement and vertical padding.
- Implement `src/features/dc-user-box/dc-user-box.ts`:
  - Extension registering single canonical English command: `/dc-user-box [on|off|pad]`.
- Add automated regression tests in `test/dc-user-box.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-user-prompt.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement patch and formatting in `src/features/dc-user-box/dc-user-box-patch.ts`.
- [x] Task 3: Implement extension in `src/features/dc-user-box/dc-user-box.ts` with single `/dc-user-box` command.
- [x] Task 4: Add automated regression tests in `test/dc-user-box.test.ts`.
- [x] Task 5: Full verification (tests, typecheck), update registry, demo script, and close.
