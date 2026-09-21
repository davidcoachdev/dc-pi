# dc-tool-box migration — twenty-first isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§18 "`dc-tool-indent.ts` — Cajas y cards redondeadas para herramientas"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-tool-indent.ts`
- SHA-256: `916b4a7647ec9676c2c2122f7de2f7807b06258b09fa1a8fd435af6406807e83`
- Preserved in: `original/dc-tool-indent.ts`.

Objectives:
- Extract `src/features/dc-tool-box/dc-tool-box-icons.ts`:
  - `TOOL_ICONS` map: tool name to emoji glyph (write, read, bash, edit, grep, find, ls, todo, subagents, memory, etc.).
  - Helper to get icon with fallback.
- Extract `src/features/dc-tool-box/dc-tool-box-patch.ts`:
  - Reload-safe prototype interceptor on `ToolExecutionComponent.prototype`.
  - Rounded border rendering (`╭─ icon tool status ─ [▲/▼] ─╮`, `│`, `╰─ [📋] ─╯`).
  - Integrated click-to-copy handler on bottom border using multiplatform `dcClipboard` (eliminating `spawn("xsel")`).
  - Indent margin and toggleable box state.
- Implement `src/features/dc-tool-box/dc-tool-box.ts`:
  - Extension registering single canonical English command: `/dc-tool-box [on|off|indent <0-8>]`.
- Add automated regression tests in `test/dc-tool-box.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-tool-indent.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement tool icons in `src/features/dc-tool-box/dc-tool-box-icons.ts`.
- [x] Task 3: Implement patch and formatting logic in `src/features/dc-tool-box/dc-tool-box-patch.ts`.
- [x] Task 4: Implement extension entrypoint in `src/features/dc-tool-box/dc-tool-box.ts` with single `/dc-tool-box` command.
- [x] Task 5: Add automated regression tests in `test/dc-tool-box.test.ts`.
- [x] Task 6: Full verification (tests, typecheck), update registry, demo script, and close.
