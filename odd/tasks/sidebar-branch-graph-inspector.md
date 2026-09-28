# Status sidebar branch graph inspector

Status: completed

## Objective

Make the Branch row in the Status sidebar open a read-only two-pane Git history inspector. Show a graph of local and remote refs on the left, and the selected commit's metadata and content/diff on the right. Start with `HEAD` selected.

## Problem and evidence

The Branch row had no click handler. The supplied screenshot shows a `git graph` view with branch/status header, commit graph and refs. The repository had a reusable two-pane modal pattern in `DcChangesPanel` but no current Git history graph or commit-detail viewer.

## Scope and constraints

- New feature under `src/features/dc-git-graph/` with pure graph parsing, a two-pane view, entrypoint, and barrel export.
- Added bounded read-only commit graph/detail helpers in `src/integrations/dc-git/dc-git.ts`.
- Wired the Branch row in `src/features/dc-sidebar/components/dc-sidebar-status-card.ts`.
- Regression tests in `test/dc-git-graph.test.ts` and `test/dc-sidebar.test.ts`.
- Graph local and remote refs (`--all`) to match the screenshot; initially select `HEAD`, show metadata plus bounded patch/stat on the right.
- Selecting a commit on the left updates the right pane; support keyboard and mouse. Right-pane scrolling does not change selection.
- The viewer is read-only: no checkout, stage, commit, reset, or worktree mutation.
- No staging or commits were performed.

## Tasks

- [x] T1 — Implement bounded read-only graph/detail data and two-pane inspector, wire Branch click, and add test-first regression coverage. RED: 9 initial failures; GREEN/triangulation: 23 focused tests passed.
- [x] T2 — Independently verify parsing/data bounds, HEAD default, selected-commit detail update, interactions, read-only scope, focused tests, typecheck, and changed-file scope; parent spot-checked typecheck.

## Acceptance criteria

1. Clicking Branch opens a two-pane modal resembling the supplied graph screenshot. **Verified by implementation and tests.**
2. The left pane shows a bounded graph across local and remote refs, with current branch/status header where available. **Verified.**
3. `HEAD` is selected initially; right pane shows that commit's author/date/message and bounded content/diff. **Verified.**
4. Selecting another commit via keyboard or mouse updates the right pane; scrolling the right pane does not alter selection. **Verified by tests.**
5. Empty history, detached HEAD, command failure, and oversized diffs render safe states with bounded subprocess duration/output. **Verified by tests and source review.**
6. No Git mutation is performed, and existing sidebar/Preview/Quota actions remain intact. **Verified by changed-file scope and read-only helpers.**

## Verification

- RED: `npm run build && node --test .test-build/test/dc-git-graph.test.js .test-build/test/dc-sidebar.test.js` produced 9 expected failures before implementation.
- GREEN/triangulation: same command passed **23 tests, 0 failures**.
- `npm run typecheck`: passed in writer, independent verifier, and final parent spot-check.
- Scoped `git diff --check` passed with no output.
- Independent verifier confirmed graph parsing/refs, HEAD default, right-pane detail update, mouse/keyboard interactions, scroll isolation, empty/detached/error/truncated states, no Git mutation, and Branch click wiring.
- Scoped status lists the new graph feature/tests and expected integration/sidebar updates; pre-existing quota/Preview edits were preserved and not touched by this feature.

## Limitations and skipped checks

- Full suite not run.
- Live modal appearance and pane layout were not checked in an actual Pi terminal; user should visually validate.
- Native `gentle_review assess` failed validation because the controller rejects `intendedUntracked` as inspect-only. No review authority or lineage was created; independent verification was used.

## Result and next step

Clicking Branch in the Status sidebar now opens the read-only Git graph modal: refs/commits on the left, selected commit metadata and bounded diff on the right, starting from `HEAD`. Next: click Branch in the live sidebar and check the graph/diff layout visually.
