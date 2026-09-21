# openDcModal implementation

Status: completed.

## Authorization and scope

Extract `openDcModal<T>()` in `src/ui/dc-modal.ts` to centralize:
- `ctx.hasUI` and `ctx.mode === "tui"` verification with graceful non-TUI fallback.
- Wrapping `ctx.ui.custom()` with `DcWindow`.
- Idempotent `done(value)` closure (prevents duplicate callbacks on multiple Esc/close events).
- Drag-to-move support using `onMove` on `DcWindow` and dynamic `offsetX`/`offsetY` on the overlay.
- Full TypeScript generics and regression tests.

## Planned surfaces

- `src/ui/dc-window.ts` (add optional `onMove?(dx, dy)` on title bar drag).
- `src/ui/dc-modal.ts` (new modal helper).
- `test/dc-modal.test.ts` (tests for openDcModal, non-TUI fallback, result returning, and dragging).
- `odd/tasks/dc-modal.md`.

## Tasks

- [x] Add `onMove` title bar drag support to `DcWindow` in `src/ui/dc-window.ts`.
- [x] Implement `openDcModal<T>` in `src/ui/dc-modal.ts`.
- [x] Add regression tests in `test/dc-modal.test.ts`.
- [x] Update `test/dc-window.test.ts` for `onMove`.
- [x] Verify whole project typecheck and test suite.
