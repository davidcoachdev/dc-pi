# Clipboard Integration — sixth isolated slice

Status: in_progress.

## Authorization and scope

Following the roadmap in `HANDOFF-GEMINI.md` (§7.2 "Helpers repetidos: clipboard") and `auditoria-individual-extensiones-2026-09-18.md` (§E "Clipboard Linux y multiplataforma"):
- Eliminate hardcoded `xsel` calls spread across `dc-markdown`, `dc-tool-indent`, `dc-user-prompt`, `dc-status`.
- Implement `src/integrations/dc-clipboard/dc-clipboard.ts`:
  - Multiplatform auto-detection:
    - Wayland: `wl-copy`
    - X11: `xsel`, `xclip`
    - macOS: `pbcopy`
    - Windows: `clip.exe` / `powershell`
    - Terminal fallback: OSC 52 escape sequences
  - Safe, non-blocking asynchronous copy (`copyToClipboard(text)`).
  - Graceful fallback: never crash or throw uncaught exceptions if no tool is present.
- Unit tests in `test/dc-clipboard.test.ts`.

## Tasks

- [ ] Implement `src/integrations/dc-clipboard/dc-clipboard.ts`.
- [ ] Add unit tests in `test/dc-clipboard.test.ts`.
- [ ] Verify test suite and typecheck.
- [ ] Update documentation (`migration/registry.md`, `README.md`).
