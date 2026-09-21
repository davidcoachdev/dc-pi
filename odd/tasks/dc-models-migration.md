# dc-modelos migration — tenth isolated slice

Status: in_progress.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-modelos.ts`
- SHA-256: `a44490be2a911bb16883863bfadf1f772d9cead9bf6da8effabadfd61097b7aa`
- Preserved in: `original/dc-modelos.ts`.

Objectives:
- Modernize and modularize the 3-panel Model & Reasoning selector:
  - Panel 1 (left): Providers and accounts (`All`, `ac01`..`ac10`, `cc1`..`cc3`, etc.) using `CliProxyClient`.
  - Panel 2 (center): Models list with live search, arrow navigation, and selection highlight (`●` / `selectedBg`).
  - Panel 3 (right): Reasoning / Effort selector (`low`, `medium`, `high`, `max`, `off`).
- Replace bespoke `applyModalBg`, duplicate `fetch`, and duplicate `notifyHerdr` with our standardized core helpers:
  - `openDcModal` + `DcWindow` (solid opaque `#100a0d` background, double frame, dragging).
  - `CliProxyClient` (`fetchPrefixEmails()`).
  - `dcNotifier.notify()`.
- Title: `⛩  Dc Studio - Modelos`.
- Unique command: `/dc-modelos`.
- Shortcut: `Alt+M`.
- Add regression tests in `test/dc-models.test.ts`.

## Tasks

- [x] Snapshot `original/dc-modelos.ts` and verify SHA-256.
- [ ] Implement `src/features/dc-models/dc-models-panel.ts`.
- [ ] Implement `src/features/dc-models/dc-models.ts`.
- [ ] Add unit and regression tests in `test/dc-models.test.ts`.
- [ ] Update `run-demo.sh` and README.
- [ ] Verify whole test suite and typecheck.
