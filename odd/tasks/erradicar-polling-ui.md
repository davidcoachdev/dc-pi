# Feature: Erradicar Polling Ciego en TUI (Directiva 6)

## Context and Goals
Eliminate all blind polling timers (`setInterval`) from DC Studio's TUI components, strictly enforcing Directive 6 of DC Studio Architecture:
- Remove 300ms `setInterval` from `src/features/dc-body/dc-body.ts`.
- Remove 1,000ms `setInterval` from `src/features/dc-sidebar/runtime/dc-sidebar-host.ts`.
- Ensure `dc-prompt` animation and neon pulses pause cleanly when agent enters idle/dormant state.
- Wire all layout wrapping to reactive event hooks: `session_start`, `process.stdout.on("resize")`, and direct user command toggles (`/body-frame`, `/dc-sidebar`).
- Maintain zero CPU usage at idle while preserving 100% visual fidelity and frame wrapping.

## Tasks
- [x] Task 1: Erradicar polling en `dc-body.ts` (`src/features/dc-body/dc-body.ts`)
- [x] Task 2: Erradicar polling en `dc-sidebar-host.ts` (`src/features/dc-sidebar/runtime/dc-sidebar-host.ts`)
- [x] Task 3: Optimizar ciclo de vida de pulso en `dc-prompt`
- [x] Task 4: Verificación focalizada con pruebas unitarias (`dc-body.test.ts`, `dc-sidebar.test.ts`, `dc-prompt.test.ts`)

## Evidence
- `dc-body.ts`: Removed 300ms `setInterval`; replaced with `process.stdout.on("resize")` listener and command triggers.
- `dc-sidebar-host.ts`: Removed 1,000ms `setInterval`; `startPolling` now performs one-shot `tryWrap(tui)`.
- `dc-prompt`: Verified `stopPulseTimer` stops neon pulse when below 81% CTX and editor `stopPulse` runs on idle.
- Typecheck: PASS (`tsc --noEmit`).
- Tests: 24/24 PASS across `test/dc-body.test.ts`, `test/dc-sidebar.test.ts`, and `test/dc-prompt.test.ts`.
