# VIP Taxi Explicit Selection and Startup Isolation Bugfix

## Specs
S1. User verbatim bug report: "bueno hay un but si yo abro otro pi solo debe usar los taxi normales ,os vip solo se utilizan si yo cambio a las cuentas de cc se deben usar esos taxi sino no estan disponible para asignacuion solo cuando se escojan esa cuentas pilas revisa eso para arrglar eso"
S2. User verbatim recurrence: "abri otro pi y volvio a cojer el taxi vip"
S3. User verbatim dynamic scope clarification: "es asta la ultima ac44 o la que esten disponibles de la ac no usar la cc estas es solo paRA CUANDO YO ASIGNO LOS TAXI CC"
S4. Startup, failover, and default acquisition behavior:
   - When opening another Pi or starting a new session, startup acquisition must strictly allocate from standard dynamically available `ac` units (e.g. up to ac44 or discovered accounts from models.json/fleet state).
   - Inherited `cc*` / VIP models from persisted session/settings must never cause acquisition of a VIP unit at startup.
   - When falling back from an inherited CC/VIP model to a standard taxi, dispatcher/agents must construct a valid standard Gemini model identifier (`${provider}/${account}/${fallbackBaseModel}`, e.g. `cpam/ac01/gemini-3.8-flash-high`) and never an invalid combination such as `acXX/gpt...`.
S5. Explicit VIP selection:
   - VIP taxis (`cc1`..`cc4`) are only eligible for assignment when the human user explicitly chooses a CC account via manual model selection (TUI `/model`, Ctrl+P cycling, or `dc-models` modal).
   - Explicit manual `cc*` selection must acquire ONLY that exact requested CC unit (no automatic substitution with other VIPs or standard accounts if that CC unit is busy).
   - If the requested `cc*` unit is busy or unavailable, the acquisition must fail/reject cleanly (return `null`), leaving fleet state untouched and preserving any existing legitimate reservation held by this terminal.
S6. Routine bookkeeping and existing VIP preservation:
   - Existing authorized VIP reservations held by an active session/PID must be preserved during routine bookkeeping/heartbeats.
   - Startup of a new Pi session must NEVER acquire VIP.
   - Internal `pi.setModel` switches (startup alignment, quota handover, workshop failover) must be guarded so they are not misclassified as human manual selections in `model_select`.
S7. Dynamic discovery:
   - Preserve dynamic account discovery (models.json / state.fleet); do not hardcode a restrictive list such as ac01..ac04. Standard fleet includes all discovered `ac*` accounts (e.g., through ac44).

## Tasks
T1 | S1-S7 | subagent | completed | Authored isolated TDD reproductions in test/dc-taxi-vip-selection.test.ts; observed RED exit code 1 (failures: startup inherited cc4 acquired VIP, and busy cc4 mutated fleet / released existing reservation). Commit: not authorized.
T2 | S1-S7 | subagent | completed | Implemented explicit VIP selection parameter in acquireOrchestratorTaxi/syncOrchestratorTaxi, release-only-after-confirmation, busy CC exact rejection with unchanged fleet, standard Gemini fallback construction, and guarded internal setModel switches in dc-agents.ts. Verified GREEN exit code 0 on both dc-taxi-vip-selection.test.ts (5/5) and dc-taxi-vip.test.ts (3/3). Commit: not authorized.
T3 | S1-S7 | subagent | completed | Updated docs/03-agents-taxis-and-lego-system.md with authorized explicit-only VIP allocation rules, dynamic AC allocation (ac01..ac44), failover guarantees, and busy rejection invariants. Commit: not authorized.
T4 | S1-S7 | subagent + verifier | completed | Concurrency risk item 4 assessed (atomic fleet locking, no locks held across async setModel, release-only-on-confirmed-lease); verified GREEN exit code 0 across all 34 taxi tests (8 VIP + 26 lifecycle/ownership). Commit: pending user authorization.

## Log
L1. Initialized task document with user verbatim quotes: "bueno hay un but si yo abro otro pi solo debe usar los taxi normales ,os vip solo se utilizan si yo cambio a las cuentas de cc se deben usar esos taxi sino no estan disponible para asignacuion solo cuando se escojan esa cuentas pilas revisa eso para arrglar eso", "abri otro pi y volvio a cojer el taxi vip", and clarification "es asta la ultima ac44 o la que esten disponibles de la ac no usar la cc estas es solo paRA CUANDO YO ASIGNO LOS TAXI CC".
L2. Scout verified that startup in dc-agents.ts passes inherited modelId to acquireOrchestratorTaxi without distinguishing startup from explicit user action, and acquireOrchestratorTaxi treats isVipAccount(currentAccount) as authorization to allocate VIP or pool other VIPs on fallback, while also mutating fleet state by wiping existing reservations before checking candidate availability.
L3. Authored test/dc-taxi-vip-selection.test.ts with isolated HOME; ran build and test, confirmed RED exit code 1 (startup inherited cc4 was assigned cc4 instead of standard ac*, and explicit cc4 selection when busy mutated state and released ac01).
L4. Implemented explicitOptions parameter in acquireOrchestratorTaxi:
   - When isExplicitSelection is false/omitted: VIP units (cc1..cc4) are strictly excluded from acquisition and automatic load balancing, allocating only dynamically discovered standard ac* units (up to ac44) with valid Gemini model fallback (avoiding acXX/gpt...).
   - When isExplicitSelection is true: acquires only the exact requested CC unit; if busy or unavailable, returns null immediately leaving fleet state completely untouched and preserving any existing legitimate reservation.
   - Defer release of existing reservation until candidate lease is confirmed, eliminating premature release on failed/busy attempts.
   - Routine bookkeeping preserves existing authorized VIP reservations.
L5. Guarded all internal setModel sites in dc-agents.ts (session_start, handleOrchestratorQuotaHandover, turn_end workshop failover) using isInternalModelSwitch so they are never misclassified as human manual selections in model_select. Updated model_select to handle explicit VIP requests with notification and previousModel revert on busy rejection.
L6. Ran tests with isolated HOME: test/dc-taxi-vip-selection.test.ts (5/5 pass) and test/dc-taxi-vip.test.ts (3/3 pass) both pass with GREEN exit code 0. Adjacent suites (dc-taxi-excluded-reservation, dc-taxi-quota-diagnostics, dc-taxi-reservation-ownership) pass 26/26.
L7. Updated docs/03-agents-taxis-and-lego-system.md with clear specifications for VIP accounts isolation, manual selection requirements, startup behavior, and busy rejection invariants.
L8. Concurrency risk item 4 assessed: all state inspections and mutations in acquireOrchestratorTaxi remain strictly guarded under withFleetLock; no fleet locks are retained across asynchronous setModel or modelRegistry calls; candidate release is conditional on exact reservation confirmation. Independent verification required per protocol.
L9. Independent verification passed: 8/8 tests in dc-taxi-vip*.test.ts and 26/26 tests in adjacent suites pass with exit code 0. Clean isolated task branch fix/dc-taxi-vip-explicit-selection prepared for commit.
