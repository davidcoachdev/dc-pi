# dc-markdown migration — twenty-third isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§10 "`dc-markdown.ts` — Renderer de Markdown"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-markdown.ts`
- SHA-256: `7aa7701f27a42d57e0129eaf0759163b82192f80025f47e7ef61890eda516447`
- Preserved in: `original/dc-markdown.ts`.

Objectives:
- Extract `src/features/dc-markdown/dc-markdown-tokens.ts`:
  - `LANG_ICONS` map (TypeScript ``, Rust ``, Python ``, Go ``, Bash `📟`, etc.).
  - `blendWithBackground()` ANSI RGB blender with DC Studio panel color (`#0d0d0d`).
  - `renderCodeBoxToken()` generating rounded cards (`╭─ lang ─╮`, `│`, `╰─╯`) and error boxes (`╭─ ☠️ Error ─╮`).
  - Replacement of raw Markdown headings ("### " → "◆ ", "#### " → "▸ ").
- Extract `src/features/dc-markdown/dc-markdown-patch.ts`:
  - Intercepts `Markdown.prototype.renderToken` and `AssistantMessageComponent.prototype`.
  - Integrates multiplatform clipboard copy using `dcClipboard` (eliminating `spawn("xsel")`).
- Implement `src/features/dc-markdown/dc-markdown.ts`:
  - Extension registering single canonical English command: `/dc-markdown [on|off]`.
- Add automated regression tests in `test/dc-markdown.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-markdown.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement token renderer and color blender in `src/features/dc-markdown/dc-markdown-tokens.ts`.
- [x] Task 3: Implement patch and assistant message handlers in `src/features/dc-markdown/dc-markdown-patch.ts`.
- [x] Task 4: Implement extension in `src/features/dc-markdown/dc-markdown.ts` with single `/dc-markdown` command.
- [x] Task 5: Add automated regression tests in `test/dc-markdown.test.ts`.
- [x] Task 6: Full verification (tests, typecheck), update registry, demo script, and close.
