# Open the project folder in Yazi from Status sidebar

Status: completed

## Objective

When the user clicks the Project row in the Status sidebar, open Yazi directly in the project's root directory using the existing Preview panel-placement flow. Ask whether to place it beside the current pane or below it. Do not show the Preview tool picker because Yazi is fixed for this shortcut.

## Problem and evidence

The Status sidebar Project row displayed the project path but had no click handler. The Preview feature already supports Yazi and has a side/bottom placement choice plus tmux/Herdr launch paths. Reusing it avoids duplicating pane-launch logic.

## Scope and constraints

- Changed only `src/features/dc-preview/dc-preview.ts`, `src/features/dc-preview/index.ts`, `src/features/dc-sidebar/components/dc-sidebar-status-card.ts`, `test/dc-preview.test.ts`, and `test/dc-sidebar.test.ts` for this feature.
- Use the absolute project root supplied by `proj.cwd`.
- Existing `/dc-preview` command/tool-picker behavior remains unchanged.
- Reuse existing side/bottom menu, cancellation behavior, tmux/Herdr launcher, and graceful plain-terminal notification.
- Do not launch Yazi inside Pi's Node/TUI process.
- No staging or commits were performed.

## Tasks

- [x] T1 — Expose/reuse Preview's direction-selection flow for fixed Yazi, wire the Project row click to it with project root, and add test-first regression coverage. RED: 5 new tests failed for missing export/Project click callback. GREEN: 19 focused Preview/sidebar tests passed.
- [x] T2 — Independently verify click-to-direction-to-launch/cancel paths, project CWD binding, Preview behavior preservation, focused tests, typecheck, and changed-file scope; parent spot-checked typecheck.

## Acceptance criteria

1. Clicking the Project row opens the placement choice directly; it does not ask which Preview tool to use. **Verified.**
2. Choosing side or bottom launches Yazi in the exact project root through the existing tmux/Herdr pane launcher. **Choice and launcher calls verified with mocks; live pane rendering not run.**
3. Canceling the choice does not launch a pane/process. **Verified.**
4. Unsupported plain-terminal environments retain the existing graceful notification; Yazi is not run inside Pi's active TUI process. **Verified by no-multiplexer test and mocked execution.**
5. Existing `/dc-preview` tool selection and placement flows continue to work. **Focused regression tests passed.**
6. Automated tests cover placement, CWD, cancellation, and sidebar click wiring without launching Yazi or mutating the user's terminal. **Verified.**

## Verification

- RED: `npm run build && node --test .test-build/test/dc-preview.test.js .test-build/test/dc-sidebar.test.js` failed as expected with 5 failures for missing helper export and inert Project row.
- GREEN: the same command passed **19 tests, 0 failures**.
- `npm run typecheck`: passed in writer, independent verifier, and final parent spot-check.
- Scoped `git diff --check` over all five allowed files: passed with no output.
- Independent verification confirmed direct side/bottom choice, absolute `proj.cwd` routing, cancellation no-op, existing `/dc-preview` command path, graceful plain terminal behavior, and changed-file scope.
- Scoped status also lists the quota implementation/panel files modified; they were pre-existing and not touched by this feature.

## Limitations and skipped checks

- Full test suite not run.
- Live interactive pane appearance was not checked in an actual tmux/Herdr session; user should validate the resulting split and Yazi working directory.
- Native `gentle_review assess` failed validation because the controller rejects `intendedUntracked` as inspect-only. No review authority or lineage was created; independent verification was used.

## Result and next step

Clicking Project in the Status sidebar now opens the existing Preview direction chooser directly with Yazi fixed, then launches it in the project root for the selected right/bottom split. Next: test it once in the running Pi session inside tmux or Herdr.
