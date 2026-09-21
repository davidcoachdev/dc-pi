# Caritas migration — second isolated slice

Status: completed.

## Authorization and scope

The user authorized continuing the migration with `caritas.ts`.
Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/caritas.ts`
SHA-256: `907c5fed8f8e0aae8bb0b53e3842a67fc476410ff983f17be7c80786be2ff5c5`
Preserved in: `original/caritas.ts`.

Objectives:
- Extract `CaritasPanel` and `CARITAS` catalog into `src/features/caritas/caritas-panel.ts`.
- Replace the bespoke `DcWindow` + `ctx.ui.custom` boilerplate with `openDcModal`.
- Support `/caritas` command and `Alt+C` shortcut in `src/features/caritas/index.ts`.
- Add comprehensive regression tests in `test/caritas.test.ts`.
- Verify typecheck and full test suite.
- Update `migration/registry.md` and `README.md`.

## Tasks

- [x] Snapshot `original/caritas.ts` and update `original/SHA256SUMS`.
- [x] Implement `src/features/caritas/caritas-panel.ts`.
- [x] Implement `src/features/caritas/index.ts` with `openCaritasPicker` and commands.
- [x] Add unit and regression tests in `test/caritas.test.ts`.
- [x] Verify whole test suite and typecheck (21/21 PASS).
- [x] Update documentation and registry.
