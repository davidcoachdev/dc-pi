# Feature: Conectar DC-Face a Estados del Agente y Erradicar Polling Ciego (Directiva 6)

## Context and Goals
- In `dc-pi`, `dc-face` was previously disconnected from live agent activity because `agentVisualStateStore.bind(pi)` was never invoked inside `dcStudioExtension` (`src/index.ts`).
- At the same time, `dc-face` had an unconditional `setInterval` running every 900ms calling `tui.requestRender()`, and `dc-face-bridge.ts` had a blind polling timer running every 1500ms making HTTP requests to TTS.
- This caused a silent memory leak and terminal thrashing when the user was inactive, culminating in a V8 out-of-memory crash (`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`).
- Objective:
  1. Bind `agentVisualStateStore` properly in `src/index.ts` via `dcStateMonitorExtension` so that the agent's real lifecycle events (`agent_start`, `turn_start`, `message_update`, `tool_execution_start`, `tool_execution_end`, `session_compact`, `agent_settled`) drive the visual state and face mode dynamically.
  2. Implement reactive lifecycle in `src/features/dc-face/dc-face.ts`:
     - Animate continuously during active states (`pensando`, `escribiendo`, `trabajando`, `compactando`, `reintentando`, `hablando`) AND during `dormido` (cycling sleep frames `z`, `z Z`, `z Z Z` smoothly until state changes).
     - Only stop animation loop in static single-frame states (`feliz`).
  3. Eradicate blind continuous polling in `dc-face-bridge.ts` (TTS bridge), deferring TTS polling until explicit user integration later as requested.
  4. Cache `readFacePrefs` in memory to eliminate sync `fs.readFileSync` on every render frame.
  5. Optimize `paintBigLine` in `painter.ts` with ANSI run-length chunking for 75% lighter TUI payloads.
  6. Unify `mapAgentStateToFaceMode` in `dc-face-types.ts` and remove orphaned constants.

## Tasks
- [x] Task 1: Wire `dcStateMonitorExtension` into `src/index.ts` to connect Pi lifecycle to `agentVisualStateStore`.
- [x] Task 2: Initial refactor of `src/features/dc-face/dc-face.ts` lifecycle.
- [x] Task 3: Disable blind HTTP polling in `src/features/dc-face/core/dc-face-bridge.ts` for zero network/timer churn at idle.
- [x] Task 4: Animate `dormido` continuously until state changes, pausing loop only in static single-frame `feliz`.
- [x] Task 5: In-memory cache for `readFacePrefs()` in `src/features/dc-face/core/dc-face-prefs.ts`.
- [x] Task 6: ANSI run-length chunking in `src/features/dc-face/art/painter.ts`.
- [x] Task 7: Unify `mapAgentStateToFaceMode` in `dc-face-types.ts`, clean dead constants, and update sidebar footer.
- [x] Task 8: Update unit tests and run complete test suite.

## Evidence
- `src/features/dc-face/dc-face.ts`: `hasAnimatedFrames(mode)` ensures `dormido` cycles sleep frames continuously until agent state changes, while static `feliz` avoids redundant render loops.
- `src/features/dc-face/core/dc-face-prefs.ts`: Added in-memory cache `cachedPrefs` removing synchronous `fs.readFileSync` on every render tick.
- `src/features/dc-face/art/painter.ts`: Replaced per-char ANSI escaping with contiguous run-length chunking.
- `src/features/dc-face/core/dc-face-types.ts` & `dc-sidebar-footer.ts`: Single unified `mapAgentStateToFaceMode` implementation; purged orphaned constants.
- Unit Tests: 330/330 tests passing (`npm test`).
