# Feature: Sección de Flota de Taxis en el Sidebar de Status

## Context and Goals
- In DC Studio's Status Card (`src/features/dc-sidebar/components/dc-sidebar-status-card.ts`), users want a new interactive section for the Taxi Fleet (`🚕 Taxis:` / `🚕 Flota de Taxis:`), positioned directly after the Quota block.
- Behavioral requirements:
  1. **Collapsed State**: Displays concise counts of occupied and free taxis (e.g., `1 ocupado · 4 libres` or `0 ocupados · 5 libres`). Right header badge has `[↗]` linking directly to `/dc-taxis` (Fleet Manager modal).
  2. **Expanded State**:
     - Displays a list of all taxi units in the fleet (`ac01`, `ac02`, etc.).
     - Each taxi unit is an accordion/collapsible item:
       - Displays taxi account name and current status badge (`libre`, `ocupado`, `recargando`).
       - If `ocupado`: Can be expanded to view detailed telemetry of the passenger:
         - Passenger type and agent name (`orchestrator`, `dc-researcher`, `odd-worker`, etc.).
         - Task label / excerpt.
         - Model being executed.
         - OS Process PID & Session ID.
         - Duration / Elapsed time.
       - If `libre`: Shows clean idle indicator.
     - Footer row inside the section: An interactive link to the Taxi Fleet Manager (`⚙️ Gestor /dc-taxis [Alt+Shift+T ↗]`) invoking `openTaxisViewer(ctx)`.
  3. **Performance & Architecture**: Zero synchronous file hammering in render, modular provider in `src/features/dc-sidebar/providers/dc-taxi-provider.ts`, and full click/mouse interaction support.

## Tasks
- [x] Task 1: Create `src/features/dc-sidebar/providers/dc-taxi-provider.ts` with telemetry formatters and summary helpers.
- [x] Task 2: Integrate `LiveTaxisCollapsible` into `src/features/dc-sidebar/components/dc-sidebar-status-card.ts` immediately after the Quota block.
- [x] Task 3: Add unit tests in `test/dc-sidebar-cards.test.ts` for the taxi fleet collapsible and passenger details.
- [x] Task 4: Run full test suite and verify no regressions.

## Evidence
- `src/features/dc-sidebar/providers/dc-taxi-provider.ts`: Implemented `formatFleetSummaryText`, `formatElapsedDuration`, `formatPassengerRole`, and `getSidebarTaxiFleet`.
- `src/features/dc-sidebar/components/dc-sidebar-status-card.ts`: Added `LiveTaxisCollapsible` and `TaxiUnitList` positioned right after Quota, with nested collapsibles for each taxi unit showing real passenger details when occupied, plus launcher link `⚙️ Gestor /dc-taxis [Alt+Shift+T ↗]`.
- Tests: Added unit tests in `test/dc-sidebar-cards.test.ts` testing formatters, order after Quota, collapsed summary rendering, and expanded passenger details.
- Suite: 332/332 passing cleanly (`npm test`).
