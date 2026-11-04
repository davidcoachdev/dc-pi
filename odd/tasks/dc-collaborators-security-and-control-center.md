# Feature: Centro de Control Autónomo, Seguridad SQLite y Worktree ODD Live

## Specs
S1: Persistencia local soberana de colaboradores en SQLite (`node:sqlite`) con estados `ALLOW`, `BLOCK` y `PENDING`, metadatos de usuario (login, rol, fecha de adición, notas) y tabla de log de auditoría inmutable.
S2: Doble Validación en el despachador de Webhooks (`dc-issue-dispatcher`): si el autor del issue no está en `ALLOW`, frena la ejecución automática; si es `PENDING`, eleva solicitud interactiva al usuario en la terminal para clasificarlo.
S3: Ventana modal unificada DOS/Retro (`ControlCenterModal`) con 3 pestañas:
  - Tab 1 [Worktrees & ODD]: Lista de worktrees activos, detalles de rama, tarea y visualizador en vivo de la hoja de ruta ODD (`S#`, `T#`, estado `DONE`/`IN_PROGRESS`/`PENDING`).
  - Tab 2 [Colaboradores]: Lista de colaboradores con toggles interactivos (espacio para conmutar `ALLOW`/`BLOCK`).
  - Tab 3 [Audit Log]: Registro forense cronológico de eventos (webhook recibido, worktree creado, tests ejecutados, archivos bloqueados).
S4: Integración en Pi con comando `/dc-control` y atajo `alt+c`.

## Tasks
T1: (S1) Sentinel Collaborators DB & Audit Logger (node:sqlite) -> src/features/dc-agents/daemon/dc-collaborators-db.ts
T2: (S2) Double Validation Gate in Issue Dispatcher -> src/features/dc-agents/daemon/dc-issue-dispatcher.ts
T3: (S3, S4) Control Center Modal View & Pi Extension Commands -> src/features/dc-agents/views/dc-control-center-modal.ts, src/features/dc-agents/daemon/dc-webhook-commands.ts
T4: (S1-S4) Unit Tests & Verification -> test/dc-control-center.test.ts, npm test

## Log
L1: Usuario solicita: "donde agreg a los mienbros en github o en un archvio en el repo", "doble validacion si alguien agreg un colaborador en pi me salga una ventana a ver si lo recomocemos como colaborador y lo pasamos a una lista blanca suarda en un sqleti para poder conservar las lista de permitidos o bloqueados", "tambein una ventana donde pueda var a los mienbro del equipo y poder darle el perimso activar con un togle pilas y esa ventan debe ser parte de la ventana donde vemos los woetee y ademas en esta se dfebe ver los que esta hacioen ejempo si usas odd el ood la taraeas y que tare esta haceindo un hoja de ruta completa y tambein tener un log para saver que hiso".
