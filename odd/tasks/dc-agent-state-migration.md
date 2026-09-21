# Agent Visual State Store — seventh isolated slice

Status: in_progress.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.2 "Helpers repetidos: estado visual") and `auditoria-individual-extensiones-2026-09-18.md` (§F "Estado de agente y animación"):
- Problem solved: Multiple extensions (`dc-face`, `dc-prompt`, `dc-studio-banner`) independently listened to Pi lifecycle events (`agent_start`, `turn_start`, `tool_execution_start/end`, `agent_settled`) and collided when setting `ctx.ui.setWorkingIndicator`.
- Implement `AgentVisualStateStore` in `src/core/dc-agent-state/dc-agent-state.ts`:
  - Central event-driven state machine.
  - States: `idle`, `thinking`, `writing`, `working`, `error`, `compacting`, `dormant`.
  - Observer pattern: components subscribe to state changes (`subscribe((state) => ...)`).
  - Single owner pattern for `setWorkingIndicator` to prevent flickering.
- Unit tests in `test/dc-agent-state.test.ts`.

## Tasks

- [ ] Implement `src/core/dc-agent-state/dc-agent-state.ts`.
- [ ] Add unit tests in `test/dc-agent-state.test.ts`.
- [ ] Verify test suite and typecheck.
- [ ] Update documentation (`migration/registry.md`, `README.md`).
