# dc-prompt migration — twenty-fifth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§12 "`dc-prompt.ts` — Editor de prompt custom"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-prompt.ts`
- Preserved in: `original/dc-prompt.ts`.

Objectives:
- Decompose `dc-prompt.ts` into clean, testable, decoupled modules under `src/features/dc-prompt/`:
  - `dc-prompt-tokens.ts`: Pure constants, frames (`single`/`double`), KITT animation math, RGB interpolation, gauge rendering, and context/cost formatters.
  - `dc-prompt-status.ts`: Responsive prompt status line builder (model, thinking level, CTX gauge with 4 levels and neon pulse on critical >80%, usage cost, and responsive gap layout) plus Herdr alert notification.
  - `dc-prompt-editor.ts`: `DcPromptEditor` extending `CustomEditor`, rendering the DOS-style double frame (`╔═ ⛩ ════╗`, `║`, `╚═╝`), username in idle mode, hint text, and status bar.
  - `dc-prompt.ts`: Extension entrypoint registering single canonical English command `/dc-prompt [on|off]`, hooking into `session_start` and lifecycle events cleanly.
- Add automated regression tests in `test/dc-prompt.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-prompt.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement tokens module in `src/features/dc-prompt/dc-prompt-tokens.ts`.
- [x] Task 3: Implement status bar module in `src/features/dc-prompt/dc-prompt-status.ts`.
- [x] Task 4: Implement editor component in `src/features/dc-prompt/dc-prompt-editor.ts`.
- [x] Task 5: Implement extension entrypoint in `src/features/dc-prompt/dc-prompt.ts`.
- [x] Task 6: Add automated regression tests in `test/dc-prompt.test.ts`.
- [x] Task 7: Full verification (tests, typecheck), update registry, demo script, and close.
