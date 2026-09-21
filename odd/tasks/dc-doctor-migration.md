# dc-doctor migration — eighteenth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§4 "`dc-doctor.ts` — Diagnóstico de compatibilidad"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-doctor.ts`
- SHA-256: `a7e41538549a8109f4c87d001e5cd0a8eb5098bb85489219ee060ed3cf93af93`
- Preserved in: `original/dc-doctor.ts`.

Objectives:
- Extract `src/features/dc-doctor/dc-doctor-inspector.ts`:
  - Pure probing & shape description functions:
    - `describeNode(node: unknown, depth?: number): Record<string, unknown>`
    - `describeComp(comp: unknown, depth?: number): Record<string, unknown>`
    - `probeLayout(tui: unknown, ctx: ExtensionContext): DcDoctorProbeResult`
    - `summarizeProbe(result: DcDoctorProbeResult): string`
    - `runDoctorDiagnostic(tui: unknown, ctx: ExtensionContext, options?: DcDoctorOptions): DcDoctorReport`
    - Parameterizable storage path for deterministic tests.
- Implement `src/features/dc-doctor/dc-doctor.ts`:
  - `dcDoctorExtension(pi: ExtensionAPI)` registering:
    - TUI anchor widget capture on `session_start`.
    - Delayed layout drift check (4.5s unref) with Herdr notification if changed.
    - Single canonical English command: `/dc-doctor` (no aliases).
- Add automated regression tests in `test/dc-doctor.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-doctor.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement pure inspector in `src/features/dc-doctor/dc-doctor-inspector.ts`.
- [x] Task 3: Implement extension in `src/features/dc-doctor/dc-doctor.ts` with single `/dc-doctor` command.
- [x] Task 4: Add automated regression tests in `test/dc-doctor.test.ts`.
- [x] Task 5: Full verification (tests, typecheck), update registry, demo script, and close.
