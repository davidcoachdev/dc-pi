# Models panel list scroll and viewport autoscroll

Status: completed

## Objective

Add windowed viewport scrolling (autoscroll) to the Models column (and Accounts column) in `DcModelsPanel`. When an account/provider like `opencode` has dozens of models, the list must scroll smoothly so the highlighted model always remains visible on screen, from the first item all the way down to the very last one. Pin the search bar and column headers at the top, support keyboard (Up, Down, PageUp, PageDown, Home, End), mouse wheel, and mouse click with scroll offset, and render a retro scrollbar indicator.

## Problem and evidence

Providers with many models (such as `opencode`, local Ollama, or open router models) have 50-100+ items. In `DcModelsPanel`, all rows were generated into lines, but the modal chrome in `DcWindow` sliced off everything exceeding the terminal budget. Moving the cursor down moved `modelCursor` beyond visible rows, causing the cursor and models to disappear from the panel without scrolling.

## Scope and constraints

- Modified `src/features/dc-models/dc-models-panel.ts` to add internal viewport scrolling with `modelScrollOffset` and `tabScrollOffset`.
- Kept search input, search divider, column headers, and sub-separator pinned at lines 0..3.
- Autoscroll on cursor movement (`ensureModelCursorVisible`, `ensureTabCursorVisible`): keep active item inside the visible viewport.
- Supported `Key.pageDown`, `Key.pageUp`, `Key.home`, `Key.end` in `handleInput` for quick navigation across long lists.
- Supported mouse wheel and mouse clicks with `modelScrollOffset`.
- Added a retro scrollbar indicator (`▲`, `█`, `░`, `▼`) in the model column when models exceed visible viewport.
- In `openModelsSelector` (`src/features/dc-models/dc-models.ts`), passed dynamic row budgeting (`maxRows`) and configured `scrollable: false` so `DcWindow` does not scroll off the search header.
- Added comprehensive regression coverage in `test/dc-models.test.ts` for large lists (50-60 models).

## Tasks

- [x] T1 — Implement viewport scrolling, autoscroll cursor-follow, retro scrollbar, and extended key navigation (PageUp/Down, Home/End) in `DcModelsPanel`.
- [x] T2 — Add comprehensive unit and regression tests in `test/dc-models.test.ts` verifying autoscroll, bounds, last-item visibility, and mouse interactions.
- [x] T3 — Verify full test suite (263 tests passed, 0 failures) and TypeScript typecheck with zero regressions.
- [x] T4 — Work-unit commit and documentation close.

## Acceptance criteria

1. In tabs with many models (e.g. 50+ models), moving the cursor down keeps the highlighted model visible at all times. **Verified by tests.**
2. The user can navigate all the way to the last model in the list and see it rendered. **Verified by tests.**
3. The search bar and column headers remain pinned at the top during scrolling. **Verified by tests.**
4. PageDown, PageUp, Home, and End navigate quickly through the model list. **Verified by tests.**
5. Mouse clicks on visible rows accurately select the corresponding model taking `modelScrollOffset` into account. **Verified by tests.**
6. A visual scroll indicator shows current position in long lists. **Verified by tests.**
7. Existing tests in `test/dc-models.test.ts` continue to pass without regression. **11 of 11 tests passed.**

## Verification

- `npm run build && node --test .test-build/test/dc-models.test.js`: passed 11 tests, 0 failures.
- `npm test`: passed 263 tests, 0 failures.
- `npm run typecheck`: clean, 0 errors.
- `git diff --check`: clean, 0 whitespace errors.

## Result and next step

Opening `/dc-models` now smoothly scrolls through all models in large lists like `opencode`, keeping the active item, retro scrollbar, and pinned search bar intact.
