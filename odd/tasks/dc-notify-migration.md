# Notifier implementation — third isolated slice

Status: completed.

## Authorization and scope

Following the roadmap in `HANDOFF-GEMINI.md` (§7 "Helpers repetidos: notificaciones con fallback Herdr") and `auditoria-individual-extensiones-2026-09-18.md` (§B "Notificaciones Herdr con fallback"):
- Isolate the notification helper in `src/integrations/dc-notify/dc-notifier.ts`.
- Pure public interface `Notifier`:
  - Detects Herdr availability via `HERDR_SOCKET_PATH` or `HERDR_ENV`.
  - Configurable binary via `HERDR_BIN_PATH ?? "herdr"` (no hardcoded absolute paths).
  - Asynchronous non-blocking dispatch with fallback to `ctx.ui.notify`.
  - Does NOT include internal monkey-patches to Pi's `AssistantMessageComponent` or `InteractiveMode`.
- Provide extension command `/dc-notify-test` to verify.
- Add regression tests in `test/dc-notifier.test.ts`.
- Keep original `lab-cofig-pi/dc-notify.ts` untouched.

## Tasks

- [x] Snapshot `lab-cofig-pi/dc-notify.ts` to `original/dc-notify.ts` and verify SHA-256.
- [x] Implement `src/integrations/dc-notify/dc-notifier.ts`.
- [x] Add regression tests in `test/dc-notifier.test.ts` (3/3 PASS).
- [x] Verify test suite and typecheck (29/29 PASS).
- [x] Update documentation (`migration/registry.md`, `README.md`).
