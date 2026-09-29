# Git graph header wordwrap and +25% height increase

Status: completed

## Objective

1. Add intelligent wordwrap with clean 4-space indentation to the commit subject and description in the Right Panel's Header Card so long messages are never truncated.
2. Increase the modal window height by 25% (expanding `maxHeight` to 96% and dynamic `maxRows` budgeting to 48 rows to give plenty of room for graph and diff).

## Problem and evidence

Long commit messages like `feat(git-graph): redesign modal with 1/3 tree, 2/3 friendly detail card, and green/red shaded diff` were truncated at `rightW - 6` with `...`. The user requested wordwrap for commit descriptions so the full text is readable, and increasing window height by 25%.

## Scope and constraints

- Added `wrapMessageText` pure function in `src/features/dc-git-graph/core/dc-git-diff-formatter.ts`.
- Updated `DcGitGraphPanel.render` to wordwrap `parsedDetail.subject` and `parsedDetail.body` with 4-space indentation for continuation lines.
- Added `maxRows?: number | (() => number)` to `DcGitGraphPanelOptions` and expanded dynamic height calculation to `Math.max(18, Math.min(48, Math.floor(termRows * 0.94) - 6))`.
- Updated `src/features/dc-git-graph/dc-git-graph.ts` modal options with +25% height (`maxHeight: "96%"` and `width: "98%"`).
- Added comprehensive unit tests in `test/dc-git-graph.test.ts`.

## Tasks

- [x] T1 — Add `wrapMessageText` and update `renderDcCodeBox` / `dc-git-diff-formatter.ts`.
- [x] T2 — Implement subject/description wordwrap in `DcGitGraphPanel` and expand `maxRows` height by 25%.
- [x] T3 — Update `openGitGraphViewer` in `dc-git-graph.ts`.
- [x] T4 — Add regression tests in `test/dc-git-graph.test.ts`.
- [x] T5 — Full test suite verification and work-unit commit.

## Acceptance criteria

1. Long commit subjects wrap across lines without truncation. **Verified by tests.**
2. Commit body paragraphs wrap cleanly and indent with 4 spaces. **Verified by tests.**
3. Window height is expanded by ~25% in terminal (`maxHeight: "96%"`). **Verified.**
4. All existing and new tests pass without regressions (268 total tests). **Verified.**

## Verification

- `npm run build && node --test .test-build/test/dc-git-graph.test.js`: 17 tests passed, 0 failures.
- `npm test`: 268 tests passed, 0 failures.
- `npm run typecheck`: clean, 0 errors.
- `git diff --check`: clean, 0 whitespace errors.
