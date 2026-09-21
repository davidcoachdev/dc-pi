# dc-sidebar architectural rebuild — authentic sidebar restoration

Status: in_progress.

## Authorization and scope

Following user authorization to rebuild the sidebar architecture into reusable components with 100% functional and visual parity with the authentic DC Studio sidebar (Image 2):
- Goal: Restore all interactive collapsible cards (Profile, Quota with live :8325 bridge metrics, MCP servers, Todos) and the animated Big ASCII Kaomoji Face (`railFace`), structured into clean reusable UI primitives and modular feature layers.

## Architecture

1. Reusable UI Primitives (`src/ui/`):
   - `dc-row.ts`: ANSI-safe row justification (`justifyRow(left, right, width)`).
   - `dc-progress-bar.ts`: Pure progress bar renderer supporting blocks (`█`/`░`) and sweeps (`▰`/`▱`).
   - `dc-card.ts`: Reusable card component with frame styling, header action badges, collapse/expand, and mouse hit testing.

2. Sidebar Core (`src/features/dc-sidebar/core/`):
   - `dc-sidebar-types.ts`: Domain models for accounts, quotas, profiles, and click targets.
   - `dc-sidebar-prefs.ts`: Persistent sidebar preferences (`~/.pi/agent/dc-sidebar.json`).
   - `dc-sidebar-state.ts`: Expansion state management (`quotaExpanded`, `profileExpanded`, `mcpExpanded`, `expandedAccounts`).

3. Sidebar Providers (`src/features/dc-sidebar/providers/`):
   - `dc-quota-provider.ts`: Queries live quota from `http://127.0.0.1:8325/quota/${prefix}`.
   - `dc-profile-provider.ts`: Reads `~/.pi/agent/profiles.json` and manages profile switching.
   - `dc-session-metrics.ts`: Extracts token usage in/out, session costs, and active MCP servers.

4. Sidebar Components (`src/features/dc-sidebar/components/`):
   - `dc-sidebar-status-card.ts`: Project path, branch, changes trigger (`[↗]`), and LSP status.
   - `dc-sidebar-quota-card.ts`: Collapsible quota section with per-account progress bars, remaining percentages, and reset countdowns.
   - `dc-sidebar-profile-card.ts`: Collapsible profile section with active profile indicator and switch triggers.
   - `dc-sidebar-mcp-card.ts`: Collapsible MCP section with session tokens progress bar and total costs.
   - `dc-sidebar-face-card.ts`: Authentic Big ASCII Kaomoji Face (`BIG_DEFAULT`, `BIG_SLEEP`, `BIG_THINK`, `BIG_WRITE`, `CUBIS_DEFAULT`) reacting to agent state with `● <mood> · tts [<profile>]`.

5. Sidebar Runtime & Host Integration (`src/features/dc-sidebar/runtime/`):
   - `dc-sidebar-mouse.ts`: Hit testing delegating clicks to expand cards, change profiles, and open modals.
   - `dc-sidebar-host.ts`: `enforceBar(tui)` setting `state.ownsHost = () => true` to suppress the flat bottom bar and activate the right rail cleanly without flex collapse.

6. Orchestrator (`src/features/dc-sidebar/dc-sidebar.ts`):
   - Feature extension entrypoint orchestrating lifecycle hooks and user commands.

## Tasks

- [x] Task 1: Create reusable UI primitives (`dc-row.ts`, `dc-progress-bar.ts`, `dc-card.ts`).
- [x] Task 2: Implement Sidebar Core (`dc-sidebar-types.ts`, `dc-sidebar-prefs.ts`, `dc-sidebar-state.ts`).
- [x] Task 3: Implement Sidebar Providers (`dc-quota-provider.ts`, `dc-profile-provider.ts`, `dc-session-metrics.ts`).
- [x] Task 4: Implement Sidebar Components (status, quota, profile, mcp, big face).
- [x] Task 5: Implement Sidebar Runtime (`dc-sidebar-mouse.ts`, `dc-sidebar-host.ts`).
- [x] Task 6: Integrate orchestrator in `dc-sidebar.ts` and automated regression tests.
- [x] Task 7: Live validation in terminal (186x50).
- [x] Task 8: Implement modular Bottom Bar (Left, Center, Right boxes) when sidebar is hidden (`src/features/dc-sidebar/bottom-bar/`) with responsive degradation, `⟡` distribution, prompt deduplication, and automated regression tests (`test/dc-bottom-bar.test.ts`).
