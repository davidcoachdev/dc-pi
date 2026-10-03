# Feature: Conectar DC-Face a Estados del Agente y Erradicar Polling Ciego (Directiva 6)

## Context and Goals
- In `dc-pi`, `dc-face` was previously disconnected from live agent activity because `agentVisualStateStore.bind(pi)` was never invoked inside `dcStudioExtension` (`src/index.ts`).
- At the same time, `dc-face` had an unconditional `setInterval` running every 900ms calling `tui.requestRender()`, and `dc-face-bridge.ts` had a blind polling timer running every 1500ms making HTTP requests to TTS.
- This caused a silent memory leak and terminal thrashing when the user was inactive, culminating in a V8 out-of-memory crash (`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`).
- Objective:
  1. Bind `agentVisualStateStore` properly in `src/index.ts` via `dcStateMonitorExtension` so that the agent's real lifecycle events (`agent_start`, `turn_start`, `message_update`, `tool_execution_start`, `tool_execution_end`, `session_compact`, `agent_settled`) drive the visual state and face mode dynamically.
  2. Implement zero-idle lifecycle in `src/features/dc-face/dc-face.ts`: when the agent settles into `idle` (`feliz`) or `dormant` (`dormido`), stop the animation timer immediately. Only animate when the agent is actively working/thinking/writing/retrying or in demo mode.
  3. Eradicate blind continuous polling in `dc-face-bridge.ts` (TTS bridge), deferring TTS polling until explicit user integration later as requested.
  4. Ensure zero memory leaks, zero redundant TUI renders at idle, and add unit test coverage.

## Tasks
- [x] Task 1: Wire `dcStateMonitorExtension` into `src/index.ts` to connect Pi lifecycle to `agentVisualStateStore`.
- [x] Task 2: Refactor `src/features/dc-face/dc-face.ts` to stop animation timers at `idle` / `dormant` and only tick when active.
- [x] Task 3: Disable blind HTTP polling in `src/features/dc-face/core/dc-face-bridge.ts` for zero network/timer churn at idle.
- [x] Task 4: Add unit tests for `dc-face` reactivity and zero-idle timer invariants, and run complete test suite.

## Evidence
- `src/index.ts`: Imported and wired `dcStateMonitorExtension` inside `dcStudioExtension`, binding `agentVisualStateStore` to Pi lifecycle hooks.
- `src/features/dc-face/dc-face.ts`: Added `syncFaceMode` which checks `isIdleOrDormant(mode)` and immediately clears `animTimer` when settling into `feliz` or `dormido`. Animate loop only runs during active work (`thinking`, `writing`, `working`, `retying`, `compacting`, `talking`).
- `src/features/dc-face/core/dc-face-bridge.ts`: Removed continuous `setInterval` polling to `127.0.0.1:9877` adhering to Directive 6.
- Unit Tests: Added dedicated lifecycle test in `test/dc-face.test.ts` and registered command checks in `test/index.test.ts`. Full test suite: 328/328 tests passing (`npm test`).
