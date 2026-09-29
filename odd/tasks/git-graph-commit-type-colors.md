# Git graph commit type semantic color coding

Status: completed

## Objective

Add semantic color coding for Conventional Commit types across the Git Graph tree and the Commit Header card:
- `feat`: emerald green (`\x1b[38;2;120;230;140m`)
- `fix`: coral red (`\x1b[38;2;255;120;120m`)
- `merge`: warm amber (`\x1b[38;2;250;150;90m`)
- `style`: plum pink (`\x1b[38;2;215;160;195m`)
- `refactor`: lavender purple (`\x1b[38;2;175;120;245m`)
- `test`: golden yellow (`\x1b[38;2;245;210;90m`)
- `docs`: sky blue (`\x1b[38;2;120;190;255m`)
- `chore`: slate gray (`\x1b[38;2;160;160;170m`)
- `perf`: cyan turquoise (`\x1b[38;2;80;230;220m`)

## Problem and evidence

All commit subjects and graph nodes were previously styled in uniform monochrome text colors, making it harder to visually distinguish bug fixes from features, refactors, docs, and merges at a glance.

## Scope and constraints

- Added `getCommitTypeInfo` and `formatStyledCommitSubject` pure functions in `src/features/dc-git-graph/core/dc-git-diff-formatter.ts`.
- Updated `GitGraphCommit` in `core/dc-git-graph-types.ts` to include `typeTag` and `typeColorAnsi`.
- Parsed commit types in `core/dc-git-graph-parser.ts`.
- Styled both graph nodes and subject lines with type colors in `views/dc-git-graph-panel.ts`.
- Added comprehensive regression tests in `test/dc-git-graph.test.ts`.

## Tasks

- [x] T1 — Implement commit type detection and ANSI color mapping in `core/dc-git-diff-formatter.ts`.
- [x] T2 — Update `GitGraphCommit` model and parser in `core/dc-git-graph-parser.ts`.
- [x] T3 — Render semantic colors in graph nodes and commit subjects in `views/dc-git-graph-panel.ts`.
- [x] T4 — Add regression tests in `test/dc-git-graph.test.ts`.
- [x] T5 — Full verification, PR creation, and work-unit merge.

## Verification

- `npm run build && node --test .test-build/test/dc-git-graph.test.js`: 19 tests passed, 0 failures.
- `npm test`: 270 tests passed, 0 failures.
- `npm run typecheck`: clean, 0 errors.
- `git diff --check`: clean, 0 whitespace errors.
