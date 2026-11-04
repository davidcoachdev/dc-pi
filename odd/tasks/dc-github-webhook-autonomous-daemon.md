# Feature: GitHub Webhook Autonomous Daemon & Dynamic Repo Issue Dispatcher

## Specs
S1: Detección dinámica del repositorio Git actual (`owner/repo`) a partir de `git remote get-url origin` en el `cwd` activo de Pi, sin nombres de repo fijos (funciona para dc-pi, dc-tts o cualquier proyecto).
S2: Servidor receptor HTTP local en loopback (127.0.0.1) que recibe eventos `issues` enviados por `gh webhook forward` en tiempo real, con deduplicación por `X-GitHub-Delivery` e idempotencia.
S3: Despachador de Issues a Worktrees aislados: al llegar un issue (`action: "opened"`), crea automáticamente un worktree temporal aislado vía `DcWorktreeManager`, arrienda un Taxi libre de la flota, y prepara el subagente efímero con las herramientas necesarias.
S4: Guardián de Conflictos (File Lock): registra los archivos o superficies que el worker en background tiene asignados; si el usuario intenta modificar un archivo reservado, emite una advertencia de conflicto.
S5: Proceso supervisor del túnel `gh webhook forward` vinculado al ciclo de vida de la sesión (start, status, stop) sin colisiones de puertos ni procesos zombies.
S6: Notificación no invasiva vía `dcNotifier` en la TUI al detectar y procesar un issue, con registro visible en el Inbox de subagentes / Sentinel Live.

## Tasks
T1: (S1, S4) Dynamic Repo Resolver & Conflict Reservation Registry -> src/features/dc-agents/daemon/dc-repo-resolver.ts, src/features/dc-agents/daemon/dc-conflict-guard.ts
T2: (S2, S3) GitHub Webhook HTTP Receiver & Issue Dispatcher -> src/features/dc-agents/daemon/dc-webhook-receiver.ts, src/features/dc-agents/daemon/dc-issue-dispatcher.ts
T3: (S5, S6) Daemon Lifecycle Manager & Tunnel Supervisor -> src/features/dc-agents/daemon/dc-webhook-daemon-manager.ts, src/features/dc-agents/daemon/dc-webhook-commands.ts
T4: (S1-S6) Unit Tests & Integration with Pi Extension -> test/dc-webhook-daemon.test.ts, src/features/dc-agents/dc-agents.ts

## Log
L1: Usuario solicita: "optemos por algo que nos avisa github de un nuevo isues en vez de estar coriendo peticiones cada sierto tiempo", "recuerda que este debe conectar a la repo que estmos trabajando en pi en este moemento es dc-pi pero manana puede ser tts".
