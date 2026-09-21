# dc-keys migration — eighth isolated slice

Status: in_progress.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-keys.ts`
- SHA-256: `a2ea2c92f7f9fd4f97fa3d0d22dc063bfd23387d6c3f49e8989e713e3cb0329f`
- Preserved in: `original/dc-keys.ts`.

Objectives:
- Extract `src/features/dc-keys/dc-keys-panel.ts`:
  - Categories: General, TUI Input, Other, Extensions.
  - Horizontal tabs navigation (`←`/`→`, Tab, mouse click on tab).
  - Search filter (`/` or direct typing, Escape clears).
  - Two-column shortcut card rendering with solid background.
  - Live shortcut reload support (`r` key or refresh button).
- Implement `src/features/dc-keys/dc-keys.ts`:
  - `openKeysViewer(ctx)` using `openDcModal`.
  - Double frame, Torii `⛩ `, close button `[ X ]`, drag-to-move.
  - Commands `/dc-keys` and `/dc-teclas`.
  - Shortcut `Alt+?` or `Alt+/`.
- Unit tests in `test/dc-keys.test.ts`.

## Tasks

- [x] Snapshot `original/dc-keys.ts` and verify SHA-256.
- [ ] Implement `src/features/dc-keys/dc-keys-panel.ts`.
- [ ] Implement `src/features/dc-keys/dc-keys.ts`.
- [ ] Add unit tests in `test/dc-keys.test.ts`.
- [ ] Verify whole test suite (100% PASS).
- [ ] Update documentation and `run-demo.sh`.
