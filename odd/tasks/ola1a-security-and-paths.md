# Feature: Ola 1A — Seguridad Crítica (CRIT-01, CRIT-03) y Unificación de Rutas/Confinamiento (CRIT-02)

Branch: `fix/ola1a-security-and-paths`
Risk: item 2 (security — guards, sandbox, auth/permissions)

## Specs
- S1: Cerrar `CRIT-01` en `dc-scan-guard` (`index.ts:40-46`): activar `classifyPtcCode()` en `dc_ptc_run` y proteger herramientas `edit`/`write` contra rutas sensibles (`~/.ssh`, `~/.aws`, credenciales) sin regresiones en `test/dc-zero-integrations.test.ts`.
- S2: Cerrar `CRIT-01` en `dc-ptc` (`dc-ptc-runner.ts`, `dc-ptc-tools.ts`): aislar `userCode` del ámbito léxico de `fs`/`os`/`path`/`execSync`/`process` (bloqueando escape de sandbox e `import()`), acotar `timeoutMs`, conectar `AbortSignal`, limitar `stdoutBuffer`/`stderrBuffer`, aplicar `.unref?.()` al timer y unificar reglas de rutas sensibles con `dc-scan-guard.ts` sin copias regex divergentes.
- S3: Cerrar `CRIT-03` en `dc-approval` / `dc-issue-dispatcher.ts` / `dc-control-daemon-manager.ts`: `allowed-once` no debe persistir `ALLOW` permanente en SQLite y debe invocar `dcApprovalCoordinator.consumeGrant(...)` para evitar fugas en `activeGrants`.
- S4: Extraer confinamiento de rutas puro a `src/core/dc-path-confinement.ts` (0 imports Pi/pi-tui) y reutilizarlo en `dc-browser/core/dc-browser-cdp.ts` y `dc-pdf/core/dc-pdf-extractor.ts`.
- S5: Cerrar `CRIT-02` (Dir #2): unificar split-brain de rutas (`taxis/fleet.json` vs `dc-taxis.json`, `agents/worktrees` vs `worktrees`, `agents/{questions,answers}` vs `{questions,answers}`, `dc-taxis.log`, `dc-agents.json`, `control/daemon-entry.js`) y `ensureDirectory`/`resolveSettingsFilePath` exclusivamente en `src/core/dc-paths.ts` preservando migración transparente.

## Tasks
- [x] T1 | S1, S2 | worker | Cerrar bypass de `dc-scan-guard` (`dc_ptc_run`, `edit`, `write`) y aislar sandbox/límites en `dc-ptc` con fuente única de reglas de seguridad + tests deterministas
- [x] T2 | S3 | worker | Corregir `allowed-once` (sin persistir `ALLOW` permanente en SQLite) y consumir grants con `dcApprovalCoordinator.consumeGrant()` + tests deterministas
- [x] T3 | S4, S5 | worker | Crear `src/core/dc-path-confinement.ts` reutilizado por `dc-browser`/`dc-pdf` y unificar split-brain de `dc-studio/*` en `src/core/dc-paths.ts` + tests deterministas
- [x] T4 | S1-S5 | parent+verify | Compilar (`npm run typecheck && npm run build`), correr todas las suites enfocadas y ejecutar verificación independiente (`gentle-ai-verify`, Risk: item 2) — PASS S1–S5 (20 suites enfocadas + 54/54 verify)

## Log
- L1: Solicitud del usuario: "si" (autorización para abrir `fix/ola1a-security-and-paths` y ejecutar Ola 1A cumpliendo estrictamente las 10 Directivas de `dc-pi-architecture` y `dc-git-branching-workflow`).
