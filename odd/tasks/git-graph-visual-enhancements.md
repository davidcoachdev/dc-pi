# Git graph visual enhancements (Stage 1: Graph illustration)

Status: completed

## Objective

Enhance the Git history graph illustration in `DcGitGraphPanel` matching the reference screenshot:
1. Enriched header displaying branch and working tree status: `<branch> @ <M> mod » ?<U> untracked` (or `✔ clean`).
2. Graph glyph classification: `M` for merge commits, `o` for remote branch tips, `*` for normal/HEAD commits, and ANSI-styled graph connectors (`|`, `|/`, `|\`, `\`).
3. Commit formatting with `#shortHash`, colored reference badges `(HEAD -> branch, origin/branch, tag:v1)`, and clean subject.
4. Bottom summary status line in the graph pane displaying files and diffstat.

## Problem and evidence

The initial Git graph implementation rendered a plain `Branch: <name>` header, standard `*` for all commits without distinguishing merges or remote tips, and raw hash strings without the terminal styling shown in the user's reference image.

## Scope and constraints

- Modified `src/features/dc-git-graph/core/dc-git-graph-parser.ts`, `dc-git-graph-types.ts`, and `src/features/dc-git-graph/views/dc-git-graph-panel.ts`.
- Added `getGitWorkingTreeStatus` in `src/integrations/dc-git/dc-git.ts` to compute modified and untracked counts and diffstat.
- Parsed merge status (commit subject starting with `Merge `) and remote branch tips (`origin/...`).
- Maintained existing two-panel layout, scrolling, mouse, and keyboard navigation.
- Added comprehensive unit and regression tests in `test/dc-git-graph.test.ts`.

## Tasks

- [x] T1 — Add working tree status summary to Git graph header (`<branch> @ <M> mod » ?<U> untracked`).
- [x] T2 — Enhance graph node symbols (`M` for merge, `o` for remote tip, `*` for normal/HEAD) and `#shortHash` formatting.
- [x] T3 — Add bottom summary line with working tree or commit file/line stats.
- [x] T4 — Add comprehensive regression tests in `test/dc-git-graph.test.ts`.
- [x] T5 — Full verification and work-unit commit.

## Acceptance criteria

1. The graph header displays `<branch> @ <M> mod » ?<U> untracked` when working tree has changes, or `<branch> ✔ clean` when clean. **Verified by tests.**
2. Merge commits are rendered with `M` node symbol in the graph. **Verified by tests.**
3. Commits associated with remote branch tips (`origin/...`) without local HEAD render with `o` node symbol. **Verified by tests.**
4. Hashes are prefixed with `#` (e.g. `#958240`). **Verified by tests.**
5. Reference badges are formatted with parentheses and semantic colors. **Verified by tests.**
6. The graph pane includes a footer summary line. **Verified by tests.**
7. All existing and new tests pass without regressions (265 tests passed, 0 failures). **Verified.**

## Verification

- `npm run build && node --test .test-build/test/dc-git-graph.test.js`: passed 14 tests, 0 failures.
- `npm test`: passed 265 tests, 0 failures.
- `npm run typecheck`: clean, 0 errors.
- `git diff --check`: clean, 0 whitespace errors.

## Result and next step

The Git graph modal now faithfully matches the terminal styling from the user's reference image. Next: Proceed to Stage 2 (info layout with commit number + title, and expandable dropdown with Spacebar).
