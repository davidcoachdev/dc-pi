# Especificación Técnica: dc-control Supervisor Core Multisesión

## 1. Visión y Objetivo
Construir el núcleo autónomo del **Supervisor Multisesión (`dc-control`)** para el ecosistema DC Studio (Debian / WSL2 en Windows 11).
El supervisor monitorea, audita y coordina **todas las sesiones activas de Pi / Orquestadores** en segundo plano (out-of-band), garantizando:
- **Zero-Pollution de Contexto**: La supervisión no inyecta tokens, mensajes ni ruido en el context window del LLM del orquestador.
- **Detección en tiempo real**: Registro de sesiones vivas, PID, estado de ejecución (idle, thinking, tool_call, waiting_human, error, zombie/hung).
- **Watchdog de Cuelgues y Bloqueos**: Detección de procesos colgados o tiempos de inactividad anómalos.
- **Aislamiento e Inmunidad**: El supervisor opera en su propio ciclo de vida e hilo/proceso independiente del orquestador activo.

---

## 2. Límites y Bounded Contract
- **Deliverables**:
  - `src/features/dc-control/core/dc-session-registry.ts`: Descubridor y registro de sesiones locales de Pi (`~/.pi/agent/sessions` y sockets de proceso).
  - `src/features/dc-control/core/dc-supervisor-watchdog.ts`: Monitoreo de heartbeat, salud, cuelgues y métricas por sesión.
  - `src/features/dc-control/core/dc-supervisor-bus.ts`: Bus de eventos local y desacoplado (IPC / EventEmitter / loopback event stream).
  - Tests unitarios y de integración deterministas en `test/dc-supervisor-core.test.ts`.
- **Constraints**:
  - Zero dependencias externas (solo APIs nativas de Node.js: `node:fs`, `node:path`, `node:os`, `node:events`, `node:child_process`).
  - No tocar el prompt ni las ventanas de contexto de los orquestadores.
  - No alterar configuraciones globales sin autorización.
- **Non-Goals**:
  - No implementar aún el render visual de Live2D o audio-queue (Capa 3).
  - No reemplazar el gestor de taxis existente, sino consultar su telemetría.
- **Acceptance Criteria**:
  - `npm run typecheck` y `npm run build` con exit code 0.
  - Suite de pruebas de `dc-supervisor-core.test.ts` pasando 100% en verde con exit code 0.

---

## 3. Arquitectura del Supervisor Core (Capa 1)

```
                    ┌────────────────────────────────────────┐
                    │       SESIONES DE PI ACTIVAS           │
                    │  [Sesión 1: Lab-01]  [Sesión 2: Lab-02] │
                    └───────────────────┬────────────────────┘
                                        │ Telemetría pass-through
                                        │ (Filesystem / Process state)
                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   DC-CONTROL SUPERVISOR CORE                           │
│                                                                        │
│  1. DcSessionRegistry:                                                 │
│     - Escanea directorios de sesiones de Pi.                           │
│     - Mapea PID activo, directorio de trabajo (cwd), modelo y hora.     │
│                                                                        │
│  2. DcSupervisorWatchdog:                                              │
│     - Calcula tiempo transcurrido por estado.                          │
│     - Identifica estados: IDLE, BUSY, WAITING_INPUT, HUNG (> umbral).  │
│                                                                        │
│  3. DcSupervisorBus:                                                   │
│     - Emite eventos: `session:discovered`, `session:heartbeat`,         │
│       `session:hung`, `session:terminated`.                            │
│     - Sin mezclar ni un solo token en el chat del orquestador.         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Eventos
                                    ▼
                    ┌────────────────────────────────────────┐
                    │      CANALES EXTERNOS / DASHBOARD      │
                    │  (Sidebar TUI, CLI, Daemon, Bot)       │
                    └────────────────────────────────────────┘
```

---

## 4. Plan de Implementación (Fase 1: Core hacia afuera)
- [x] **T1: Contratos de Tipos y Bus de Eventos (`dc-supervisor-bus.ts`)** (`commit: 1ed5fb9`)
  Definir las interfaces `SupervisorSessionInfo`, `SessionState`, `SessionHeartbeat` y el emitter de eventos inmutable.
- [x] **T2: Registro y Descubrimiento de Sesiones (`dc-session-registry.ts`)** (`commit: 1ed5fb9`)
  Implementar el scanner seguro de sesiones sin bloquear I/O ni seguir symlinks peligrosos.
- [x] **T3: Watchdog Anti-Cuelgues y Monitoreo de Estado (`dc-supervisor-watchdog.ts`)** (`commit: 1ed5fb9`)
  Implementar el evaluador de salud por PID/sesión con umbrales configurables (ej. advertencia tras 120s sin actividad).
- [x] **T4: Pruebas Automatizadas Deterministas (`test/dc-supervisor-core.test.ts`)** (`commit: 1ed5fb9`, verificado PASS exit 0)
  Crear suite con fixtures temporales en `os.tmpdir()` validando detección, transiciones de estado, eventos y limpieza de recursos.
