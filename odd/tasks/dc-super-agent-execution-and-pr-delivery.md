# Feature: DC Super-Agent Autonomous Execution, TDD and PR Delivery (Fase 2)

## Specs
S1: Ejecutor autónomo de Worktree (`DcWorkerRunner`): toma un `DispatchedIssueTask`, arrienda un Taxi libre de la flota (`dc-taxi-dispatcher`), prepara el entorno y ejecuta la resolución con subagente efímero (`dc-odd-worker`) aislado en `handle.worktreePath`.
S2: Actualización de Hoja de Ruta ODD en vivo en `odd/tasks/<taskSlug>.md`: actualiza dinámicamente las tareas `T1: Análisis`, `T2: Tests (RED)`, `T3: Implementación (GREEN)`, `T4: Verificación` y `T5: Entrega PR` para que se reflejen en tiempo real en el Centro de Control (`Alt+Shift+W`) y Sentinel Live (`Alt+S`).
S3: Ciclo de Entrega Automática a GitHub (Pull Request):
    - Tras verificar que los tests pasan con exit code 0 (`npm test` o `npm run typecheck`), ejecuta `git add` y `git commit` en la rama del worktree.
    - Ejecuta `git push origin <branchName>`.
    - Crea la Pull Request en GitHub con `gh pr create --title ... --body ...`.
    - Comenta en el Issue vinculando la PR: "He implementado la solución en la PR #X para revisión humana".
    - Registra el evento en `AuditLog` de SQLite y notifica en la TUI vía `dcNotifier`.
S4: Circuit Breaker y Elevación Interactiva: si la ejecución se bloquea por ambigüedad o fallas de tests repetidas, frena de inmediato y dispara una ventana modal interactiva (`openDcModal`) en la terminal solicitando la decisión del usuario.

## Tasks
T1: (S1, S2) Worktree Autonomous Worker Runner & ODD Updater -> src/features/dc-agents/daemon/dc-worker-runner.ts
T2: (S3) GitHub Pull Request & Issue Comment Delivery Automator -> src/features/dc-agents/daemon/dc-pr-delivery.ts
T3: (S1, S4) Wire Worker Execution in Issue Dispatcher & Webhook Daemon -> src/features/dc-agents/daemon/dc-issue-dispatcher.ts, src/features/dc-agents/daemon/dc-webhook-daemon-manager.ts
T4: (S1-S4) Unit Tests & Verification -> test/dc-super-agent-delivery.test.ts, npm test

## Log
L1: Usuario solicita: "dale con el dc-super-agente", "para que termine el trabajo hasta el pr deseado para que el usuario lo valide".
