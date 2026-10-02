# Feature: DC Sentinel Autonomous Guardian

## Context and Goals
Implement `dc-sentinel` as an autonomous, ambient background guardian for DC Studio with interactive TUI modal viewer.
- Pre-flight semantic recall: search Engram in `<15ms` and inject relevant past memories into `systemPromptOptions.appendSystemPrompt` to save thinking tokens.
- In-flight passive recorder: track user prompt, tool runs (including `subagent_run` invocations), errors, and outcomes without blocking or altering executions.
- Post-flight settlement: at `agent_settled`, automatically format and write the chronicle entry to `docs/chronicle/` and synchronize observations to Engram.
- Interactive TUI Viewer (`SentinelPanel` & `openSentinelViewer`): two-pane modal (turns on left, details/markdown on right), tab switching between active session and chronicle disk files, search filtering, mouse support, and shortcut `Alt+Shift+S`.
- Child session isolation: completely bypass child sessions (`GENTLE_PI_AGENTS_CHILD === "1"`).
- Zero conflict with gentle-ai: strictly mutate `event.systemPromptOptions.appendSystemPrompt` with idempotency checks.

## Tasks
- [x] Task 1: Core Recall Engine (`src/features/dc-sentinel/core/dc-sentinel-recall.ts`)
- [x] Task 2: Core Flight Recorder Engine (`src/features/dc-sentinel/core/dc-sentinel-recorder.ts`)
- [x] Task 3: Extension Lifecycle Entrypoint (`src/features/dc-sentinel/dc-sentinel.ts` & `index.ts`)
- [x] Task 4: Comprehensive Unit Tests (`test/dc-sentinel.test.ts`)
- [x] Task 5: Canonical Documentation & Ecosystem Integration (`docs/08-dc-sentinel-autonomous-guardian.md` & `src/index.ts`)
- [x] Task 6: TUI Sentinel View Panel & Modal (`src/features/dc-sentinel/views/dc-sentinel-panel.ts` & `dc-sentinel-modal.ts`)
- [x] Task 7: Unit Tests for Sentinel Panel & Shortcuts (`test/dc-sentinel-panel.test.ts`)

## Evidence
- Typecheck: PASS (`tsc --noEmit`)
- Tests: 12/12 PASS across `test/dc-sentinel.test.ts` (6) and `test/dc-sentinel-panel.test.ts` (6)
- Package integration: PASS in `test/index.test.ts`
- Documentation: `docs/08-dc-sentinel-autonomous-guardian.md` and `docs/dc-subagents-and-performance-architecture.md`
- Subagent definition: `agents/dc-sentinel.md` synced to `~/.pi/agent/agents/dc-sentinel.md`
- Shortcuts: `Alt+Shift+S` and command `/dc-sentinel [status|recall <q>|disco]`
