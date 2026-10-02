# Tasks: dc-ephemeral-agents

- [x] Task 1: Contratos, tipos puros y presets de herramientas (`src/features/dc-agents/core/dc-ephemeral-types.ts`)
- [x] Task 2: Despachador de Taxis inter-sesión, histórico de consumo y logger (`src/features/dc-agents/core/dc-taxi-dispatcher.ts`, `src/features/dc-agents/core/dc-taxi-history.ts`, `src/features/dc-agents/core/dc-taxi-logger.ts`)
- [x] Task 3: Calibración adaptativa de esfuerzo y políticas de enrutamiento (`src/features/dc-agents/core/dc-effort-policy.ts`)
- [x] Task 4: Gestor de ciclo de vida efímero, Fresh Context, time-box y sweeper anti-zombis (`src/features/dc-agents/core/dc-ephemeral-manager.ts`)
- [x] Task 5: Registro de herramienta para el orquestador `dc_ephemeral_agent_run` (`src/features/dc-agents/tools/dc-ephemeral-tools.ts`)
- [x] Task 6: Ventana interactiva TUI de monitoreo de unidades de Taxis, historial y logs (`src/features/dc-agents/views/dc-taxis-panel.ts`, comando `/dc-taxis` y shortcut `Alt+Shift+T`)
- [x] Task 7: Pruebas unitarias de leasing, zombis, histórico, effort y validación de suite (`test/dc-ephemeral-agents.test.ts` y `npm test`)
- [x] Task 8: Métricas por taxi individual y ranking de subagentes más usados con tasa de fallo (`dc-ephemeral-types.ts` y `dc-taxi-history.ts`)
- [x] Task 9: Modal de detalle de taxi con [Enter/Clic], telemetría en vivo y vista de subagentes en `DcTaxisPanel` (`dc-taxis-panel.ts`)
