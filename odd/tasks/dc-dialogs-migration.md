# dc-dialogs migration — twenty-sixth isolated slice (experimental)

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§3 "`dc-dialogs.ts` — Reemplazo visual de diálogos del host"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-dialogs.ts`
- Preserved in: `original/dc-dialogs.ts`.
- Destination: `src/experimental/dc-dialogs-overlay/`.

Objectives:
- Decompose `dc-dialogs.ts` into clean, testable, decoupled modules under `src/experimental/dc-dialogs-overlay/`:
  - `dc-dialogs-helpers.ts`: `splitPanel`, `titleOf`, `createFallbackTheme`, `getSafeTheme`, symbols (`DC_DIALOG_TITLE`, `REV_SYM`, `ORIG_SYM`, `PATCHED`), and `CleanExtensionSelectPanel`.
  - `dc-dialogs-patch.ts`: `installDialogsPatch`, `uninstallDialogsPatch`, `setDialogsEnabled`, `isDialogsEnabled`. Clean wrapper around `InteractiveMode.prototype` (`showExtensionCustom`, `showSessionSelector`, `showTreeSelector`, `showExtensionSelector`, `showExtensionInput`, `showSelector`) respecting existing `DcWindow` markers (`Symbol.for("dc.window")`).
  - `dc-dialogs.ts`: Extension entrypoint registering single canonical English command `/dc-dialogs [on|off|status]`.
- Add automated regression tests in `test/dc-dialogs.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-dialogs.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement helpers and panel in `src/experimental/dc-dialogs-overlay/dc-dialogs-helpers.ts`.
- [x] Task 3: Implement patch engine in `src/experimental/dc-dialogs-overlay/dc-dialogs-patch.ts`.
- [x] Task 4: Implement extension entrypoint in `src/experimental/dc-dialogs-overlay/dc-dialogs.ts`.
- [x] Task 5: Add automated regression tests in `test/dc-dialogs.test.ts`.
- [x] Task 6: Full verification (tests, typecheck), update registry, demo script, and close.
