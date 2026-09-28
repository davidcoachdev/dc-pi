# Git graph redesign (2/3 right detail, 1/3 left tree, +25% modal size)

Status: completed

## Objective

Redesign the Git Graph & Commit Inspector modal:
1. Increase modal size by 25% (`width: "96%"`, `maxHeight: "92%"`).
2. Layout split:
   - **Left column (1/3 width, ~35%)**: Git Graph commits tree with branch/status header, continuous unicode connectors (`│╲`, `│╱`), node glyphs (`M`, `o`, `●`), `#shortHash`, and bottom status.
   - **Right column (2/3 width, ~65%)**: User-friendly Commit detail & diff:
     - Header card: commit `#shortHash` with ref badges, author, date, subject.
     - Changed files bar: tabs/badges for modified files with line changes (`+X -Y`) and total summary.
     - Styled code diff: clean indentation, chunk headers `@@`, additions with green shading (`+`), deletions with red shading (`-`) matching git diff.
     - Bottom line: diff line range indicator (`Diff: 1-17/45 (Rueda/PgUp/Dn scroll)`).
3. Keyboard and mouse interactions:
   - Left column (1/3): click/wheel navigates commits (`selectedIndex`).
   - Right column (2/3): wheel/PgUp/PgDown scrolls the diff code.

## Problem and evidence

The previous right pane rendered raw, unparsed `git show` text line by line. The user requested dividing the panels 1/3 (graph tree) and 2/3 (detail), making the modal 25% larger, formatting a clean header card, showing changed files in tabs, and highlighting code with green and red shading as Git does.

## Scope and constraints

- Created pure parser and diff syntax shader in `src/features/dc-git-graph/core/dc-git-diff-formatter.ts` (Directive 1: zero external imports in `core/`).
- Updated `src/features/dc-git-graph/views/dc-git-graph-panel.ts` for 1/3 left graph tree and 2/3 right detail & diff.
- Expanded modal dimensions in `src/features/dc-git-graph/dc-git-graph.ts`.
- Updated test suite in `test/dc-git-graph.test.ts`.

## Verification

- `npm run build && node --test .test-build/test/dc-git-graph.test.js`: 14 tests passed, 0 failures.
- `npm test`: 265 tests passed, 0 failures.
- `npm run typecheck`: clean, 0 errors.
- `git diff --check`: clean, 0 whitespace errors.
