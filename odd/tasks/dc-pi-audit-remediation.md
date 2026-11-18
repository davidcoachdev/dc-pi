# dc-pi Deep Audit Remediation

Branch: `feat/taxi-vip-uc-accounts-and-models`
Scope: Remediate verified findings from the full read-only audit of `dc-pi` across 4 batches (Lote 1–4).

## Specs
S1. Lote 1 — Test suite & runner stabilization: fix `dc-super-agent-daemon.test.ts` 15s hang, `dc-quota-provider.test.ts` host config leak, `dc-git-graph.test.ts` non-hermetic git failure, and print `TIMEOUT` output + pin `cwd` in `scripts/dc-test-runner.mjs`.
S2. Lote 1 — VIP/UC/NAN account & dispatcher fixes: unify `cc*`/`uc*`/`nan*` detection across `dc-taxi-accounts.ts`, `dc-effort-policy.ts`, and `dc-agents.ts` (`turn_end`), and remove 100% CPU synchronous spin-wait in `dc-taxi-dispatcher.ts` (`sleepSync`).
S3. Lote 2 — Critical security hardening: remove `execSync` shell interpolation and global `pkill` in `dc-control-daemon-manager.ts`, guard/confine `dc_ptc_run` (`dc-scan-guard.ts`, `dc-ptc-runner.ts`), enforce SSRF/redirect/IP checks in `dc-fetch.ts`/`dc-api-client.ts`/`dc-browser-cdp.ts`/`dc-lazyweb-client.ts`, parameterize `dc-engram-db.ts` SQLite queries, and close `dc-scan-guard.ts`/`dc-anti-loop-guard.ts` bypasses + path traversal in `dc-browser-cdp.ts`/`dc-pdf-extractor.ts`.
S4. Lote 3 — TUI & lifecycle stability: restore extension error visibility in `dc-core-patches.ts`, fix `opts.signal` abort overlay lock leak in `dc-dialogs-patch.ts`, coordinate `LAYOUT_NODE` between `dc-sidebar-host.ts` and `dc-body.ts`, fix `CaritasPanel` scroll rendering, and clean up timers/daemons/listeners in `DcWindow`, `dc-prompt`, `dc-ephemeral-tools`, `dc-services`, `dc-tts`, `dc-agents`, and `dc-mobile`.
S5. Lote 4 — Tooling, config isolation & coverage: make `scripts/dc-quality-ratchet.mjs` enforce the directives it claims, fix ESM worker execution in `src/testing/adversarial/fuzzer.ts`, honor `PI_CODING_AGENT_DIR`/atomic writes for config files, add tests/fixes for `dc-handoff` and `dc-checkpoint`, and clean stale skill references.

## Tasks
T1 | S1 | worker | done | Lote 1A: Stabilize `scripts/dc-test-runner.mjs` and fix the 3 failing/timing-out tests (`dc-super-agent-daemon`, `dc-quota-provider`, `dc-git-graph`).
T2 | S2 | worker | done | Lote 1B: Fix VIP/UC/NAN account consistency (`dc-taxi-accounts.ts`, `dc-effort-policy.ts`, `dc-agents.ts`) and eliminate `sleepSync` CPU spin in `dc-taxi-dispatcher.ts`.
T3 | S3 | worker | done | Lote 2A: Fix critical command injection & PTC/scan-guard bypasses (`dc-control-daemon-manager.ts`, `dc-ptc-runner.ts`, `dc-scan-guard.ts`, `dc-anti-loop-guard.ts`).
T4 | S3 | worker | done | Lote 2B: Harden SSRF, unbounded HTTP reads, path traversal, and Engram SQL parameterization (`dc-fetch.ts`, `dc-api-client.ts`, `dc-browser-cdp.ts`, `dc-pdf-extractor.ts`, `dc-engram-db.ts`, `dc-lazyweb-client.ts`).
T5 | S4 | worker | done | Lote 3A: Fix critical TUI & patch bugs (`dc-core-patches.ts`, `dc-dialogs-patch.ts`, `dc-sidebar-host.ts`, `dc-body.ts`, `dc-caritas-panel.ts`, `dc-status-panel.ts`).
T6 | S4 | worker | done | Lote 3B: Fix UI/daemon/timer lifecycle leaks (`dc-window.ts`, `dc-prompt.ts`, `dc-ephemeral-tools.ts`, `dc-services-manager.ts`, `dc-tts.ts`, `dc-mobile-viewer.ts`, `dc-agents.ts`).
T7 | S5 | worker | done | Lote 4A: Upgrade `scripts/dc-quality-ratchet.mjs`, fix ESM `fuzzer.ts`, and honor `PI_CODING_AGENT_DIR` / atomic config writes.
T8 | S5 | inline | done | Lote 4B: Fix `dc-checkpoint` untracked/escaping, complete & test `dc-handoff`, fix `dc-codegraph` binary lookup, and clean stale `skills/` refs. (Recovered and verified PASS across all 6 test suites.)

## Log
L1. User requested: "antes de realiza algun cambio realiza una audiotoria completa a todo dc-pi profuncda", followed by "comencemos" after reviewing the 4-batch remediation plan.
