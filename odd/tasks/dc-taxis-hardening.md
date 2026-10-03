# Feature: Hardening de Flota de Taxis, Atomicidad y Subagentes Efímeros

## Context and Goals
Following the technical audit by `odd-scout`, harden the Taxi Fleet and Ephemeral Agents subsystem:
1. **Atomic Persistence & Lockfile**: Add atomic file locking (`dc-taxis.json.lock` with retries) and atomic `.tmp + renameSync` write for `dc-taxis-history.json` to prevent lost updates or corruption during concurrent leases.
2. **Sidebar Throttling Cache**: Introduce a 5-second in-memory cache in `src/features/dc-sidebar/providers/dc-taxi-provider.ts` so `getSidebarTaxiFleet()` does not hammer `/proc` and `.jsonl` files on every TUI render frame.
3. **Automatic Recharging & Quota Integration**: Ensure `releaseTaxi` and `leaseTaxi` check known quota levels to transition drained accounts (<5%) to `'recargando'` automatically without requiring the TUI modal to be opened.
4. **Background Subagent Lifecycle & Token Telemetry**: Fix premature `.md` and taxi release in `mode: "background"`, and extract real token usage (`tokens`, `costEstimated`) when recording completed trips in `dc_ephemeral_agent_run`.
5. **Delegated Subagent Execution**: Delegate worker tasks to ephemeral subagents (`dc_ephemeral_agent_run`) in accordance with the user's instructions.
6. **Testing & Invariants**: Add comprehensive unit tests covering lockfile concurrency, atomic history persistence, sidebar cache, and quota cooldown transitions.

## Tasks
- [x] Task 1: Implement file locking for `dc-taxis.json` and atomic persistence for `dc-taxis-history.json`.
- [x] Task 2: Implement 5-second TTL cache in `dc-taxi-provider.ts` to eradicate `/proc` I/O during sidebar renders.
- [x] Task 3: Wire automatic `'recargando'` cooling transition in `releaseTaxi()` and `leaseTaxi()`.
- [x] Task 4: Fix background subagent cleanup and extract real token usage in `dc-ephemeral-tools.ts`.
- [x] Task 5: Add unit tests for concurrency, atomic history, caching, and cooling, and run complete test suite.

## Evidence
- `withFleetLock`: Atomic lockfile with backoff, stale lock recovery, and reentrancy support in `dc-taxi-dispatcher.ts`.
- `dc-taxi-history.ts`: Atomic write via `.tmp` and `renameSync`, corrupt backup preservation (`.corrupt.bak`).
- `dc-taxi-provider.ts`: 5s TTL memory cache for `getSidebarTaxiFleet()`.
- Quota cooling: Synchronous automatic cooldown in `releaseTaxi()` (<5% -> 'recargando') and recovery in `leaseTaxi()` (>=60% -> 'libre').
- Background & Tokens: Isolated background lifecycle without premature file deletion in `dc-ephemeral-tools.ts`, plus normalized `extractSubagentMetrics`.
- Tests: 344/344 tests passing (`npm test`).
