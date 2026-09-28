# Status sidebar quota display

Status: completed

## Objective

Keep the Status sidebar Quota block live and concise. Expanded provider rows show a progress bar and remaining percentage only. A collapsed provider's `Restante` row shows every available quota-entry percentage in provider order, joined by `/`; examples: `98%/74%/64%` for three windows and `1%/2%/3%/4%` for four account quotas. Do not change the `/quota` modal.

## Problem and evidence

The collapsed summary selected only one 5h and one weekly value, so providers with four quota entries (for example Gemini and Claude 5h/weekly pairs) lost two values. The user requested all four percentages in the collapsed sidebar, in order.

## Scope and constraints

- Changed only `src/features/dc-sidebar/components/dc-sidebar-status-card.ts` and `test/dc-sidebar-cards.test.ts` for these display refinements.
- Kept `/quota` modal behavior and code out of scope.
- Preserved live cache updates, progress bars, window labels, expansion state, provider ordering, summary bar, and modal click action.
- Expanded rows show only remaining percentage; collapsed `Restante` shows every available entry's remaining percentage in provider order, separated by `/` with no window-name words.
- With no entry values, preserve the `100%` fallback.
- No staging or commits were performed.

## Tasks

- [x] T1 — Make Status sidebar Quota rows reactive and add a deterministic regression test. The regression showed the same card rendering fallback after cache updated to 42%; after the change it verified refreshed values, collapsed summary, ordering, expansion, and `[↗]` action.
- [x] T2 — Independently verify live refresh, package typecheck, and scope. Focused test passed; parent spot-checked typecheck.
- [x] T3 — Simplify expanded Status sidebar quota rows to progress bar plus numeric remaining percentage only; update assertions. Test-first RED then GREEN.
- [x] T4 — Independently verify percentage-only rows, focused test, typecheck, and scope; parent spot-checked typecheck.
- [x] T5 — Include monthly remaining percentage in collapsed provider summary and test 3-window slash format. Test-first RED then GREEN.
- [x] T6 — Independently verify collapsed 3-window summary, focused test, typecheck, and scope; parent spot-checked typecheck.
- [x] T7 — Include all provider entry percentages in source order, including four-entry Gemini/Claude summaries; add deterministic regression. Test-first RED then GREEN.
- [x] T8 — Independently verify 0/2/3/4-entry summaries, focused test, typecheck, and scope; parent spot-checked typecheck.

## Acceptance criteria

1. Pending quota values may render a visibly distinct fallback until fetched data arrives. **Verified by T1.**
2. The same sidebar instance displays refreshed cached values after async fetch. **Verified by T1.**
3. Expanded provider rows show a progress bar and numeric remaining percentage only; no `left`, `% used`, or reset text. **Verified by regression and independent source review.**
4. Collapsed `Restante` includes every available entry percentage in provider order: 0 entries `100%`, 2 entries `98%/74%`, 3 entries `98%/74%/64%`, and 4 entries `1%/2%/3%/4%`. **All cases verified.**
5. Provider order, expanded window labels, expansion state, live refresh, summary bar, and `[↗]` action remain intact. **Verified by regression and source review.**
6. No `/quota` modal code is changed. **Worker scope excluded modal files; their modifications predated this work.**

## Verification

- T1 RED: cache held 42%, but the same card rendered 100% fallback. GREEN: same-instance regression passed.
- T3 RED: expanded rows displayed `100% left`. GREEN: percentage-only assertions passed.
- T5 RED: three-value assertion failed against old `98% sem 74%`. GREEN: summary became `98%/74%/64%`; missing Monthly was omitted.
- T7 RED: four-entry assertion failed because old category-based summary retained only `3%/4%`. GREEN: summary maps all numeric `pctLeft` entries and joins in source order; empty entries retain the `100%` fallback.
- `npm run build && node --test .test-build/test/dc-sidebar-cards.test.js`: passed; 4 tests, 0 failures.
- `npm run typecheck`: passed in writer, independent verifier, and final parent spot-check.
- `git diff --check -- src/features/dc-sidebar/components/dc-sidebar-status-card.ts test/dc-sidebar-cards.test.ts`: passed, no output.
- Independent verification confirmed 0/2/3/4-entry formatting, expanded percentage-only output, same-instance live refresh, and sidebar interactions.
- Scoped status shows sidebar component and test modified; `/quota` source/panel modifications were pre-existing and untouched by this work.

## Limitations and skipped checks

- Full suite not run; interactive live TUI confirmation remains for the user.
- Focused test runner takes about 61 seconds despite assertions finishing quickly; lingering handle not investigated.
- Native risk assessment facade rejected its `intendedUntracked` schema field as inspect-only; no review authority or lineage was created. Independent verification was used instead.

## Result and next step

The Status sidebar Quota display now retains live updates. Expanded rows show progress bars and remaining percentages only. Collapsed `Restante` shows every available quota-entry percentage in source order joined by `/`; Gemini's four values now render as `1%/2%/3%/4%`. The `/quota` modal remains unchanged. Next: reload Pi and visually confirm the collapsed display in the live sidebar.
