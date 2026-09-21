# DcWindow scroll support

Status: completed.

## Authorization and scope

The user explicitly requested adding scroll functionality to `DcWindow` after testing the visual demo and seeing that longer content was clipped.
Scope:
- Add vertical scrolling (`scrollY`) to `DcWindow` in `src/ui/dc-window.ts`.
- Mouse wheel support via `handleMouse` (`type === "wheel"` and `wheelDelta`).
- Keyboard scrolling via `handleInput` (`Up`, `Down`, `PageUp`, `PageDown`, `Home`, `End`) when child content does not consume them.
- Visual retro scrollbar on the right border (`▲`, `░`, `█`, `▼`) when content exceeds the allocated body budget.
- Automatic clamping on resize / invalidation.
- Regression tests covering wheel, keyboard, clipping, and scrollbar in `test/dc-window.test.ts`.
- Keep the original file in `lab-cofig-pi/dc-window.ts` untouched.

## Tasks

- [x] Plan architecture for scroll in `DcWindow`.
- [x] Implement `scrollY`, wheel support, keyboard navigation, and scrollbar in `src/ui/dc-window.ts`.
- [x] Add regression tests in `test/dc-window.test.ts` (13/13 pass).
- [x] Verify `examples/dc-window-demo.ts` with longer content.
- [x] Update documentation (`README.md`, `migration/registry.md`).
