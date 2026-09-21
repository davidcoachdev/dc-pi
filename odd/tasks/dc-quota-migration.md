# dc-quota migration — eleventh isolated slice

Status: in_progress.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-quota.ts`
- SHA-256: `ac404334b843b011f889d36694309859751c61c6e912fa8f8a25ba18d3ab83cd`
- Preserved in: `original/dc-quota.ts`.

Objectives:
- Extract `src/features/dc-quota/dc-quota-types.ts`:
  - Pure helper functions:
    - `quotaLevelColor(pctLeft)`: maps percentage to "success", "warning", "error".
    - `humanizeReset(ms)`: formats reset times (e.g. "2h", "1d 4h", "now").
    - `normalizeCliProxyName(name, prefix)`: cleans account names.
    - Data interfaces: `QuotaRow`, `QuotaSection`.
- Implement `src/features/dc-quota/dc-quota-panel.ts`:
  - Two-panel layout:
    - Left column: Providers / accounts with counts `● [AC01 - email]` or `[OpenCode Go]`.
    - Right column: Progress bars (`█` filled, `░` track) with `% left` and `reset` time.
  - Full keyboard (`←`/`→`, `Tab`, `↑`/`↓`, `r` refresh) and mouse navigation.
- Implement `src/features/dc-quota/dc-quota.ts`:
  - `openQuotaViewer(ctx)` mounted on `openDcModal` + `DcWindow`.
  - Title: `⛩  Dc Studio - Cuotas`.
  - Unique command: `/dc-quota`.
  - Shortcut: `Alt+Shift+Q`.
- Add unit and regression tests in `test/dc-quota.test.ts`.

## Tasks

- [x] Snapshot `original/dc-quota.ts` and verify SHA-256.
- [ ] Implement `src/features/dc-quota/dc-quota-types.ts`.
- [ ] Implement `src/features/dc-quota/dc-quota-panel.ts`.
- [ ] Implement `src/features/dc-quota/dc-quota.ts`.
- [ ] Add regression tests in `test/dc-quota.test.ts`.
- [ ] Verify whole test suite and typecheck.
- [ ] Update documentation and `run-demo.sh`.
