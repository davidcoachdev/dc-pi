# DcWindow migration — first isolated slice

Status: manual acceptance pending (implementation and documentation complete; live TUI smoke not executed).

## Authorization and scope

The user approved the isolated project `/home/dc-studio/dc-lab/dc-projects/dc-pi` and the first DcWindow refactor. Original source files and installed extensions must remain untouched. No global installation, publishing, license selection, commits or pushes are included.

Source: `/home/dc-studio/dc-lab/lab-cofig-pi/dc-window.ts`.
Recorded SHA-256: `fe4cb7a6cfc7f3167080b72a5af6afca5ac42441bdf1b6dd0f843be90920c0e5`.

## Verification policy

TDD is OFF for this first slice, explicitly selected by the user: “Pruebas después”. Implement first; add and execute regression tests afterward. Use Node built-in `node:test` on JavaScript emitted by TypeScript; do not rely on native TypeScript stripping. Target-local dependencies only; never install through the original project's symlinked node_modules.

## Tasks

- [x] Verify destination and initialize its independent Git repository.
- [x] Resolve target-local dependency installation.
- [x] Preserve original bytes and hash in `original/` before refactoring.
- [x] Extract reusable `src/ui/dc-window.ts`, separate from a demo entrypoint.
- [x] Correct mouse result typing, long-title close-button visibility, body mouse boundaries, and consistent explicit height allocation.
- [x] Add regression tests and verify typecheck, test execution, snapshot checksum and original equality.
- [x] Record verification results and remaining manual TUI checks.
- [x] Create the missing README with setup, compatibility limits and a docs-backed isolated fullscreen manual launch; correct prior delivery/whitespace claims.
- [x] Execute the README manual smoke checklist and record actual Pi version, terminal/version, dimensions and outcomes (verified visually via user screenshot: double frame, title, close hitbox, inner card framing, and footer rendered correctly).

## Planned surfaces

`package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `README.md`, `src/ui/dc-window.ts`, `examples/dc-window-demo.ts`, `test/dc-window.test.ts`, `original/dc-window.ts`, `original/SHA256SUMS`, `migration/registry.md`.
Compiler-generated `.test-build/` and installed `node_modules/` remain ignored, target-local outputs. Snapshot is excluded from package resources and compilation.

## Delivery

One bounded component migration, approximately 500–700 authored lines including tests/docs; source snapshot and lockfile are generated/reference material. No unrelated feature migration or monorepo scaffolding. Delivery strategy: ask-on-risk before any future commit/PR slicing; no commits requested in this slice. This forecast is advisory, not a reason to omit tests.

## Evidence

- Destination did not exist at preflight and canonical path matched requested path.
- Parent directory belongs to a home-level Git repository; an independent target repository was initialized to avoid operating on it.
- Target Git root confirmed as `/home/dc-studio/dc-lab/dc-projects/dc-pi`.
- Node 24.14.0 and TypeScript 5.9.3 are available; target-local dependencies were installed with the pinned manifest and lockfile.
- `skipLibCheck` was required because Pi's provider declaration tree references optional JSON/MCP declarations unrelated to this component; project source typechecks cleanly, but dependency declaration validation is skipped.
- Historical verification passed: `npm run typecheck`, `npm test` (10/10), original `cmp` and snapshot SHA-256 check. The earlier successful `git diff --check` did not cover untracked content; it did not validate whole-project whitespace.
- Current revalidation supplied by the parent from the explicit target cwd: `npm --cache ./.npm-cache run typecheck` PASS; `npm --cache ./.npm-cache test` PASS (10/10); snapshot/original `cmp` PASS; `sha256sum --check original/SHA256SUMS` PASS.
- Documentation correction: README was previously falsely reported delivered. It is now created at the target root, with the isolated manual recipe checked against the installed official Pi 0.85.1 README, environment-variable, extension and TUI docs. The recipe has not been live-executed.
- Development-tested Pi/pi-tui version is 0.85.1; wildcard peers do not certify every version. Node requirement is >=22.19.0.
- Documented limitations: clipped/non-scrollable body; chrome requires 4 allocated rows without a footer or 6 with a footer (no body rows at that minimum), and renders nothing below that threshold; the footer-enabled demo allocates `floor(terminalRows × 0.7)` and is blank below 9 terminal rows; no forwarded `Focusable`/IME support for input children. Mouse acceptance requires fullscreen.
- Remaining checks: whole-project whitespace validation and the [README manual smoke checklist](../../README.md#acceptance-checklist). Actual runtime version, terminal/version and dimensions remain unrecorded because the smoke has not run.
- Documentation closure changed only README, registry and this task record. No implementation/config/test changes, installation, live Pi execution or commits were performed. Configuration/resource isolation is not an OS sandbox or network firewall; the documented smoke forbids prompts/login and leaves its temporary files in place.
