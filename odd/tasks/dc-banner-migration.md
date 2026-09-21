# dc-banner migration — thirteenth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§16 "`dc-studio-banner.ts` — Banner de inicio"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-studio-banner.ts`
- SHA-256: `b79095b7a5d19a9ff6a8b45905bc29e832c7c6b4c2e4481de64373544465ab1c`
- Preserved in: `original/dc-studio-banner.ts`.

Objectives:
- Extract pure banner logo art & gradient functions into `src/features/dc-banner/dc-banner-art.ts`.
- Implement clean, patch-free banner header component in `src/features/dc-banner/dc-banner.ts`:
  - Renders the authentic centered DC Studio ASCII shield logo with the Blood gradient (`#ff3333` → `#990000`).
  - Fallback to compact `✦ Dc Studio ✦` if terminal width < 72 columns.
  - Automatically hides cleanly upon first user prompt (`input` / `agent_start`) via `ctx.ui.setHeader(undefined)`.
  - Zero monkey-patches to Pi internal classes or prototypes.
  - Connects to `agentVisualStateStore` for visual presence synchronization.
- Add regression tests in `test/dc-banner.test.ts`.

## Tasks

- [x] Snapshot `original/dc-studio-banner.ts` and verify SHA-256.
- [x] Implement `src/features/dc-banner/dc-banner-art.ts`.
- [x] Implement `src/features/dc-banner/dc-banner.ts`.
- [x] Add regression tests in `test/dc-banner.test.ts`.
- [x] Verify whole test suite and typecheck.
- [x] Update documentation and `run-demo.sh`.
