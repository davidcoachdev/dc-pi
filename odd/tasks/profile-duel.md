# Profile Duel migration to DcWindow

Status: completed.

## Authorization and scope

The user clarified that the window they were asking about was the Profile Duel ("carita — Alt+c · ¿dcdev o cubis?") from `dc-face.ts`, which was not using `DcWindow` and lacked a solid background, Torii glyph, double frame, and close button.

Objectives:
- Extract `ProfileDuel` from `lab-cofig-pi/dc-face.ts` into `src/features/face/profile-duel.ts`.
- Eliminate `FaceBox`, `FaceTitleBar`, and `FaceRule` single-line box hacks.
- Wrap `ProfileDuel` inside `openDcModal` with double frame `╔═╗`, Torii `⛩ `, `[ X ]` close button, solid opaque `#100a0d` background, and title bar dragging.
- Add regression tests in `test/profile-duel.test.ts`.
- Update `run-demo.sh` to include the profile command for interactive testing.

## Tasks

- [x] Extract `ProfileDuel` without `FaceBox` hacks into `src/features/face/profile-duel.ts`.
- [x] Implement `openProfilePicker` using `openDcModal` in `src/features/face/index.ts`.
- [x] Add regression tests in `test/profile-duel.test.ts` (4/4 PASS).
- [x] Update `run-demo.sh` to load `/perfil`.
- [x] Verify whole test suite (25/25 PASS).
