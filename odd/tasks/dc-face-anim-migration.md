# dc-face-anim migration — nineteenth isolated slice

Status: completed.

## Authorization and scope

Following `HANDOFF-GEMINI.md` (§7.3 "Migrar extensiones individualmente con snapshot/hash/tests/registro") and `auditoria-individual-extensiones-2026-09-18.md` (§6 "`dc-face.ts` — Carita animada del agente"):
- Original source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-face.ts`
- SHA-256: `b77458e09e6b56821c794808000dc53d0e68eae55aae210ac52345ce8cdfaf31`
- Preserved in: `original/dc-face.ts`.

Objectives:
- Extract `src/features/dc-face-anim/dc-face-anim-frames.ts`:
  - Authentic DC Studio animated kaomoji frames dictionary (`DC_FACE_FRAMES`) for all agent states:
    - `idle`: `["≧(❂‿❂)≦  "]`
    - `thinking`: `[" ( ≖.≖ )   ", " (  ≖.≖)   ", " ( ≖.≖ )   ", " (≖.≖  )   "]`
    - `writing`: `["m( ◔◡◔ )m   ", "m(◔◡◔҂ )m   ", "m( ◔◡◔ )m   ", "m( ͠҂◔◡◔)m   "]`
    - `working`: `["^( '-' )^   ", "<( '-'<)    ", "^( '-' )^   ", " (>'-' )>   "]`
    - `dormant`: `[" ( -_- )    ", " ( -_- ) z  ", " ( -_- ) zZ ", " ( -_- ) zZZ"]`
    - `compacting`: `[" ( ◐.◐ )    ", " ( ◑.◑ )    ", " ( ◐.◐ )    "]`
    - `retying`: `[" ( ◐.̃◐ )    ", " ( ʘ◡ʘ )    ", " ( ◑.◑ )    "]`
    - `talking`: `[" ( ʘ◡ʘ )    ", " ( ʘoʘ )    ", " ( ʘ_ʘ )    ", " ( ʘ.ʘ )    "]`
    - `prompting`: `[" ( ◐‿◐ )!  ", "!( ◐‿◐ )   "]`
- Implement `src/features/dc-face-anim/dc-face-animator.ts`:
  - `DcFaceAnimator` class binding `AgentVisualStateStore` to `ctx.ui.setWorkingIndicator()`.
  - Colorization with blood-accent theme or ANSI colors.
  - Interval configuration (default 250ms for smooth kaomoji animation).
- Implement `src/features/dc-face-anim/dc-face-anim.ts`:
  - Extension registering single canonical English command: `/dc-face`.
  - Automatic activation on `session_start`.
- Add automated regression tests in `test/dc-face-anim.test.ts`.
- Update `migration/registry.md` and `run-demo.sh`.

## Tasks

- [x] Task 1: Snapshot `original/dc-face.ts` and verify SHA-256 in `original/SHA256SUMS`.
- [x] Task 2: Implement frame catalog in `src/features/dc-face-anim/dc-face-anim-frames.ts`.
- [x] Task 3: Implement `DcFaceAnimator` in `src/features/dc-face-anim/dc-face-animator.ts`.
- [x] Task 4: Implement extension in `src/features/dc-face-anim/dc-face-anim.ts` with single `/dc-face` command.
- [x] Task 5: Add automated regression tests in `test/dc-face-anim.test.ts`.
- [x] Task 6: Full verification (tests, typecheck), update registry, demo script, and close.
