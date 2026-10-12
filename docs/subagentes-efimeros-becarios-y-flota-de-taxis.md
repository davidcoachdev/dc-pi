# Arquitectura de Subagentes Efímeros, Sistema de Becarios y Flota de Taxis (`dc-pi`)

> **Módulo principal:** `src/features/dc-agents/`  
> **Documentación relacionada:** `docs/03-agents-taxis-and-lego-system.md`

---

## 1. Visión General: ¿Por qué existe este sistema?

En `dc-pi`, cargar las **+35 herramientas especializadas** (YouTube, Browser, CodeGraph, Context7, OWASP, Audio, APIs, etc.) directamente en el Orquestador Principal provocaba **Tool Bloat** (~7,000 a 10,000 tokens de sobrecarga por turno) y colisiones de cuota (`HTTP 429`) al lanzar subagentes concurrentes sobre una misma cuenta.

La solución implementada en `src/features/dc-agents/` divide la arquitectura en tres pilares:

1. **Subagentes Temporales Efímeros (`dc_ephemeral_agent_run`):** Nacen para una única tarea con solo las herramientas necesarias (ensambladas como bloques de Lego), se ejecutan en un proceso aislado con contexto limpio (**Fresh Context Loop**) y se autodestruyen al terminar.
2. **Sistema de Becarios en Paralelo (`dc_research_swarm` y `dc_ephemeral_batch_run`):** Despliega múltiples agentes efímeros en el mismo milisegundo (**Fan-Out**) y consolida sus hallazgos en un único reporte estructurado (**Fan-In**).
3. **Flota de Taxis Inter-Sesión (`dc-taxi-dispatcher.ts`):** Pool de cuentas CPAM (`ac01`..`acXX`) sincronizado entre todas las terminales abiertas. Cada subagente arrienda un "Taxi" libre con la mayor cuota disponible y lo devuelve al finalizar.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                   ORQUESTADOR PRINCIPAL (Contexto Limpio)                  │
│  Solo tiene tools core + 3 tools de delegación (Ahorra ~10k tokens/turno): │
│  • dc_ephemeral_agent_run   • dc_research_swarm   • dc_ephemeral_batch_run │
└───────────────┬─────────────────────────┬──────────────────────────┬───────┘
                │                         │                          │
                ▼                         ▼                          ▼
     ┌────────────────────┐    ┌────────────────────┐     ┌────────────────────┐
     │  Becario Efímero 1 │    │  Becario Efímero 2 │     │  Becario Efímero 3 │
     │  Lego: [web, docs] │    │  Lego: [github]    │     │  Lego: [youtube]   │
     └──────────┬─────────┘    └──────────┬─────────┘     └──────────┬─────────┘
                │ Lease                   │ Lease                    │ Lease
                ▼                         ▼                          ▼
     ┌────────────────────┐    ┌────────────────────┐     ┌────────────────────┐
     │ 🚕 Taxi: ac02      │    │ 🚕 Taxi: ac04      │     │ 🚕 Taxi: ac05      │
     │ Cuota: 98% (Ocup.) │    │ Cuota: 95% (Ocup.) │     │ Cuota: 92% (Ocup.) │
     └────────────────────┘    └────────────────────┘     └────────────────────┘
```

---

## 2. Subagentes Temporales Efímeros (Lego Assembler + Fresh Context Loop)

**Archivos clave:**
- `src/features/dc-agents/core/dc-ephemeral-manager.ts` (`assembleLegoAgentPlan`, `prepareEphemeralAgent`, `cleanupEphemeralAgent`, `isolateSpecializedToolsForOrchestrator`)
- `src/features/dc-agents/core/dc-ephemeral-types.ts` (`DC_AGENT_ARCHETYPES`, `DC_TOOL_BRICKS`, `DC_BEHAVIOR_BRICKS`, `DC_TOOL_PRESETS`)

### A. Cómo se ensambla un Subagente (Sistema de Legos)

En lugar de mantener decenas de agentes estáticos en disco, `assembleLegoAgentPlan()` (`dc-ephemeral-manager.ts:51`) construye la definición del agente de forma determinista combinando tres piezas:

#### 1. Arquetipo (`archetype`) — Fast-Path preconfigurado (`dc-ephemeral-types.ts:326-358`)
- **Flujo ODD:** `dc-odd-scout`, `dc-odd-worker`, `dc-odd-verifier`, `dc-odd-planner`.
- **Flujo Planificado (Mini SDD):** `dc-phase-discovery`, `dc-phase-planning`, `dc-phase-apply`, `dc-phase-verify`.
- **Auxiliares Especializados:** `dc-researcher`, `dc-news-to-day`, `dc-ui-visual-inspector`, `dc-browser-inspector`, `dc-pr-comment-analyst`, `dc-sentinel`, `dc-smoke`, `dc-media`, `dc-service-ops`, `dc-security-auditor`, `dc-api-tester`.
- **Alias retrocompatibles:** `odd-scout`, `odd-worker`, `odd-verifier`, `odd-planner`, `dc-smoke-subagent`, `ui-visual-inspector`, `pr-comment-analyst`, `security-auditor`, `api-tester`.

#### 2. Bloques de Herramientas (`toolBricks`) (`dc-ephemeral-types.ts:168-239`)
Cada bloque habilita únicamente un subconjunto de herramientas e inyecta su directiva operativa (`DC_TOOL_BRICK_GUIDELINES`) en el prompt del subagente:
- `fs-read`: `read`, `find`, `grep`
- `fs-write`: `edit`, `write`
- `terminal`: `bash`
- `code-intel`: `dc_codegraph_status`, `dc_codegraph_node`, `dc_codegraph_impact`, `dc_codegraph_explore`, `dc_codegraph_sync`
- `web-search`: `dc_web_search`, `dc_web_fetch`
- `discussions`: `dc_discussion_search`, `dc_discussion_answers_get`
- `github`: `dc_github_code_search`, `dc_github_get`
- `academic`: `dc_research_search`
- `browser`: `dc_browser_status`, `dc_browser_tabs`, `dc_browser_navigate`, `dc_browser_screenshot`
- `audio`: `dc_markdown_to_audio`, `dc_text_to_audio`
- `services`: `dc_services_list`, `dc_service_start`, `dc_service_stop`, `dc_service_restart`, `dc_service_status`, `dc_service_logs`
- `docs`: `dc_pdf_extract`, `dc_context7_status`, `dc_context7_search`, `dc_context7_get_context`
- `youtube`: `dc_youtube_search`, `dc_youtube_video_get`, `dc_youtube_transcript_get`, `dc_youtube_channel_search`
- `api`: `dc_api_rest`, `dc_api_swagger`, `dc_api_graphql`
- `security`: `dc_owasp_query`, `dc_owasp_audit`

#### 3. Bloques de Comportamiento (`behaviorBricks`) (`dc-ephemeral-types.ts:260-284`)
Directivas de ingeniería que gobiernan la disciplina del subagente:
- `strict-tdd`: Ciclo RED -> GREEN -> REFACTOR sin omitir checks.
- `read-only-analyst`: Solo lectura, cita evidencia en formato `archivo:línea`, cero mutaciones.
- `artifact-contract`: Obliga a retornar Resumen Ejecutivo + Archivos Creados/Modificados + Herramientas Usadas.
- `non-empty-response`: Garantiza respuesta con texto visible (evita turnos vacíos).
- `source-verification`: Exige atribución de hechos a fuentes primarias verificables (URLs o rutas/líneas).
- `bounded-worker`: Modifica únicamente las rutas declaradas en `## Allowed edit surfaces`.
- `dag-planning`: Estructura planes como un grafo acíclico dirigido (DAG) topológico sin dependencias circulares.
- `verify-independent`: Auditor independiente que rechaza pruebas tautológicas.
- `scoped-search`: Acota búsquedas al proyecto o subdirectorios específicos; prohíbe escanear `/`, `~` o directorios padre.

---

### B. Diagrama del Ciclo de Vida (Fresh Context Loop y Autodestrucción)

```text
[1. Aislamiento Inicial en el Padre]
       │  isolateSpecializedToolsForOrchestrator(pi) oculta las +35 tools de DC en el padre.
       ▼
[2. Solicitud del Orquestador]
       │  Llama a dc_ephemeral_agent_run({ role, archetype, toolBricks, behaviorBricks, task })
       ▼
[3. Ensamblaje Lego] ──► assembleLegoAgentPlan()
       │  Resuelve herramientas exactas, modelo (cpam/<cuenta>/gemini-3.8-flash-high) y directivas.
       ▼
[4. Arriendo de Taxi] ──► leaseTaxi() en dc-taxi-dispatcher.ts
       │  Adquiere lock atómico y asigna la cuenta libre con mayor cuota disponible.
       ▼
[5. Materialización Efímera en Disco] ──► prepareEphemeralAgent()
       │  Escribe `~/.pi/agent/agents/dc-sub-<rol>-<hash>.md` con YAML frontmatter + System Prompt virgen.
       ▼
[6. Ejecución Aislada (Subproceso)] ──► ctx.executeTool("subagent_run", ...)
       │  • Corre en un proceso hijo con contexto 100% limpio (sin historial acumulado del padre).
       │  • Vincula el PID real del proceso hijo (`findDirectChildPid` leyendo /proc).
       │  • Envía pulso de vida cada 45 segundos (`heartbeatTaxi`).
       ▼
[7. Autodestrucción Garantizada (bloque finally)] ──► cleanupEphemeralAgent()
       ├── 1. Borra `~/.pi/agent/agents/dc-sub-<rol>-<hash>.md` (`fs.unlinkSync`).
       ├── 2. Libera el Taxi (`releaseTaxi` -> estado "libre" o "recargando").
       └── 3. Registra métricas y tokens del viaje en `dc-taxis-history.json` (`recordTaxiTrip`).
```

#### Mecanismos de Limpieza Anti-Huérfanos
- **Modo Background (`ensureBackgroundSweeper` en `dc-ephemeral-tools.ts:44`):** Cuando un subagente se lanza con `mode: "background"`, un sweeper en memoria monitorea cada **5 segundos** el estado en `~/.pi/agent/gentle-agents/tasks/<taskId>.json`. En cuanto pasa a `completed`, `failed`, `stopped` o `aborted` (o tras un timeout defensivo de 12 minutos), borra el `.md` y libera el taxi.
- **Purga de Huérfanos (`dcCleanOrphanedEphemeralAgents` en `dc-ephemeral-manager.ts:232`):** Al iniciar sesión (`session_start`) y antes de preparar nuevos agentes, elimina cualquier archivo `dc-sub-*.md` o `dc-ephem-*.md` con más de 15 minutos de antigüedad.

---

## 3. El Sistema de Becarios en Paralelo (Fan-Out / Fan-In)

**Archivos clave:**
- `src/features/dc-agents/core/dc-research-swarm.ts` (`executeResearchSwarm`, `compileSwarmReport`)
- `src/features/dc-agents/tools/dc-ephemeral-tools.ts` (`dc_research_swarm` en `línea 505`, `dc_ephemeral_batch_run` en `línea 574`)

Existen dos herramientas para orquestar becarios efímeros en paralelo puro:

### A. `dc_research_swarm` (Enjambre de Investigación Multicanal)
Recibe una `query` técnica y despliega hasta **6 becarios especializados en simultáneo** (por defecto activa `['web', 'docs', 'discussions', 'github']`), cada uno con su propio juego de herramientas y su propio Taxi:

| Canal | Rol del Becario | Herramientas Asignadas | Effort Default |
| :--- | :--- | :--- | :---: |
| **`web`** | `dc-scout-web` | `dc_web_search`, `dc_web_fetch`, `read`, `find`, `grep` | `high` |
| **`docs`** | `dc-scout-docs` | `dc_context7_search`, `dc_context7_get_context`, `dc_pdf_extract`, `read`, `find`, `grep` | `high` |
| **`discussions`**| `dc-scout-community` | `dc_discussion_search`, `dc_discussion_answers_get`, `read`, `find`, `grep` | `medium` |
| **`github`** | `dc-scout-github` | `dc_github_code_search`, `dc_github_get`, `dc_codegraph_*`, `read`, `find`, `grep` | `high` |
| **`academic`** | `dc-scout-academic` | `dc_research_search`, `read`, `find`, `grep` | `medium` |
| **`youtube`** | `dc-scout-media` | `dc_youtube_search`, `dc_youtube_transcript_get`, `dc_youtube_video_get` | `low` |

- Todos los becarios del enjambre llevan inyectados los bloques `read-only-analyst`, `source-verification`, `artifact-contract` y `non-empty-response`.
- Si se especifica el parámetro `outputDir`, persiste automáticamente `report.md` (informe consolidado) y `sources.md` (auditoría de fuentes verificadas).

### B. `dc_ephemeral_batch_run` (Despacho Masivo de Tareas Independientes)
Recibe una lista `items: DcBatchSubagentItem[]` con tareas arbitrarias y un `mode` (`"task"` o `"background"`). Despacha todos los subagentes en el mismo milisegundo asignando una unidad de la Flota de Taxis a cada uno sin bloquear turnos intermedios.

### C. Diagrama de Ejecución Paralela (Fan-Out / Fan-In)

```text
                         ┌──────────────────────────────┐
                         │  dc_research_swarm(query)    │
                         │              ó               │
                         │  dc_ephemeral_batch_run([])  │
                         └──────────────┬───────────────┘
                                        │
                    Promise.allSettled( items.map(...) )
             ┌──────────────────────────┼──────────────────────────┐
             │ (Milisegundo 0)          │ (Milisegundo 0)          │ (Milisegundo 0)
             ▼                          ▼                          ▼
   ┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
   │ Becario 1 (Web)   │      │ Becario 2 (Docs)  │      │ Becario 3 (GitHub)│
   │ 🚕 Taxi: ac02     │      │ 🚕 Taxi: ac04     │      │ 🚕 Taxi: ac05     │
   │ PID: 41021        │      │ PID: 41022        │      │ PID: 41023        │
   ├───────────────────┤      ├───────────────────┤      ├───────────────────┤
   │ Crea .md efímero  │      │ Crea .md efímero  │      │ Crea .md efímero  │
   │ Ejecuta búsqueda  │      │ Ejecuta Context7  │      │ Busca en repos    │
   │ Heartbeat c/ 45s  │      │ Heartbeat c/ 45s  │      │ Heartbeat c/ 45s  │
   │ finally:          │      │ finally:          │      │ finally:          │
   │  - Borra .md      │      │  - Borra .md      │      │  - Borra .md      │
   │  - Libera ac02    │      │  - Libera ac04    │      │  - Libera ac05    │
   └─────────┬─────────┘      └─────────┬─────────┘      └─────────┬─────────┘
             │                          │                          │
             └──────────────────────────┼──────────────────────────┘
                                        ▼
                         ┌──────────────────────────────┐
                         │      FAN-IN CONSOLIDATOR     │
                         │  • Tolera fallos parciales   │
                         │  • Unifica hallazgos y citas │
                         │  • Opcional: guarda report.md│
                         │    y sources.md en disco     │
                         └──────────────────────────────┘
```

---

## 4. La Flota de Taxis Inter-Sesión

**Archivos clave:**
- `src/features/dc-agents/core/dc-taxi-dispatcher.ts` (Motor de estados, locks atómicos, arriendo y reaper)
- `src/features/dc-agents/core/dc-taxi-quota.ts` (Consulta de cuotas en tiempo real en `http://127.0.0.1:8325/quota/<account>`)
- `src/features/dc-agents/core/dc-taxi-accounts.ts` (Descubrimiento dinámico desde `~/.pi/agent/models.json` o `models-store.json`)
- `src/features/dc-agents/core/dc-taxi-history.ts` & `dc-taxi-logger.ts` (Historial de viajes y bitácora rotativa)
- `~/.pi/agent/dc-studio/dc-taxis.json` (Estado global compartido en disco)

### A. Estructura de un Taxi (`DcTaxiUnit`)
Cada unidad representa una cuenta en CLIProxyAPI (`ac01`..`acXX`) y registra su estado y pasajero activo (`dc-ephemeral-types.ts:12-27`):

```ts
export type DcTaxiStatus = "libre" | "ocupado" | "recargando";
export type DcPassengerType = "orchestrator" | "subagent" | "ephemeral_subagent";

export interface DcTaxiPassenger {
  type: DcPassengerType;
  sessionId: string;
  pid: number;
  taskId?: string;
  agentName?: string;
  model?: string;
  taskLabel?: string;
  startedAt: number;
  heartbeatAt: number;
}
```

### B. Máquina de Estados de un Taxi

```text
                  ┌───────────────────────────────────────────┐
                  │                                           │
                  │  Cuota cae < 5% (gemini5hPct)             ▼
        ┌───────────────────┐                       ┌───────────────────┐
        │                   │                       │                   │
        │   🟢 LIBRE        │◄──────────────────────│  🔴 RECARGANDO    │
        │ (Disponible pool) │  Cuota sube >= 60%    │ (En enfriamiento) │
        │                   │                       │                   │
        └─────────┬─────────┘                       └───────────────────┘
                  │                                           ▲
   leaseTaxi() ó  │                                           │ Al liberar, si
   acquireOrch()  │                                           │ su cuota < 5%
                  ▼                                           │
        ┌───────────────────┐                                 │
        │                   │─────────────────────────────────┘
        │   🟡 OCUPADO      │
        │ (Con pasajero +   │───► releaseTaxi() (Terminó tarea, cuota >= 5%) ──► 🟢 LIBRE
        │  PID + Heartbeat) │
        │                   │───► reapAbandonedTaxis() (PID muerto en /proc  ──► 🟢 LIBRE
        └───────────────────┘     o sin heartbeat por > 5 min)
```

1. **`libre` (🟢):** Unidad disponible en la parada, sin pasajero (`passenger: null`) y con cuota saludable ($\ge 5\%$).
2. **`ocupado` (🟡):** Unidad asignada a un `orchestrator` (terminal TUI interactiva) o arrendada por un `subagent` / `ephemeral_subagent`.
3. **`recargando` (🔴):** Estado de enfriamiento automático (`updateTaxiRechargingState` en `dc-taxi-dispatcher.ts:394`). Cuando la cuota de 5 horas (`gemini5hPct`) cae por debajo del **5%**, la unidad queda bloqueada para nuevos despachos hasta que su cuota se recupere al **$\ge 60\%$**.

### C. Coordinación Inter-Sesión, Lockfile Atómico y Reaper de Zombis

Cuando múltiples terminales de Pi o múltiples becarios paralelos intentan arrendar un taxi al mismo tiempo, `dc-taxi-dispatcher.ts` garantiza consistencia mediante:

1. **Lockfile Exclusivo Multiproceso (`~/.pi/agent/dc-studio/dc-taxis.json.lock`):**
   - `acquireFleetLock` (`dc-taxi-dispatcher.ts:50`) abre el lockfile con flag exclusivo `wx` (`O_CREAT | O_EXCL`) y escribe `{ pid: process.pid, createdAt: Date.now() }`.
   - Soporta reentrancia dentro del mismo proceso mediante `activeFleetLocks`.
   - **Backoff Sincrónico sin quemar CPU:** Si otro proceso posee el lock, espera entre `10ms` y `30ms` usando `Atomics.wait` sobre un `SharedArrayBuffer` hasta un máximo de 15 segundos.
   - **Rotura de Stale Locks:** Si el lockfile tiene más de `10 segundos` (`LOCK_STALE_MS`) o el PID dueño ya murió (`!isProcessAlive(parsed.pid)`), elimina el lock obsoleto y reintenta de inmediato.
2. **Escritura Atómica (`saveFleetState` en `dc-taxi-dispatcher.ts:323`):**
   - Escribe el estado completo en `dc-taxis.json.tmp` y ejecuta `fs.renameSync` hacia `dc-taxis.json`, evitando lecturas parciales o corrupción de JSON.
3. **Reaper de Zombis (`reapAbandonedTaxis` en `dc-taxi-dispatcher.ts:353`):**
   - Antes de cada arriendo o consulta de flota, verifica todas las unidades en estado `ocupado`:
     - **Comprobación de PID en el SO (`isProcessAlive`):** Ejecuta `process.kill(pid, 0)` y en Linux inspecciona `/proc/<pid>/stat` para descartar procesos en estado Zombie (`Z`) o Dead (`X`).
     - **Expiración por TTL (`leaseTtlMs` = 5 minutos):** Para pasajeros que no son orquestadores interactivos, verifica que `now - heartbeatAt <= 300,000 ms`.
     - Si el proceso murió o el TTL expiró, libera la unidad automáticamente y registra `TAXI_ZOMBIE_REAPED`.
4. **Algoritmo de Arrendamiento por Mayor Cuota (`leaseTaxi` en `dc-taxi-dispatcher.ts:592`):**
   - Si se pide una `preferredAccount` y está estrictamente `libre`, la asigna.
   - En caso contrario, filtra todas las unidades en estado `libre` y las ordena de forma descendente según su porcentaje de cuota disponible (`gemini5hPct ?? 100`), desempatando alfanuméricamente (`ac01`, `ac02`...).
   - Si no quedan unidades libres en toda la flota, registra `TAXI_FLEET_EXHAUSTED` y retorna `null`.
5. **Auto-Reasignación del Orquestador (`acquireOrchestratorTaxi` en `dc-taxi-dispatcher.ts:434`):**
   - Al abrir una nueva terminal interactiva de Pi (`session_start`), si la cuenta configurada por defecto ya está ocupada por otra terminal, toma automáticamente el primer taxi `libre` y cambia el modelo de la sesión en caliente vía `pi.setModel(...)`. Al cerrar la terminal (`session_shutdown` o `process.on("exit")`), `releaseOrchestratorTaxi` devuelve la unidad a la parada.

---

## 5. Mapa de Archivos Clave en el Repositorio (`dc-pi`)

| Ruta de Archivo | Funciones / Componentes Clave | Responsabilidad |
| :--- | :--- | :--- |
| `src/features/dc-agents/dc-agents.ts` | `dcAgentsExtension`, `openTaxisViewer` | Extensión principal: engancha `session_start`/`session_shutdown`, asigna taxi al orquestador, aísla las +35 tools especializadas y registra `/dc-taxis`. |
| `src/features/dc-agents/core/dc-ephemeral-types.ts` | `DC_AGENT_ARCHETYPES`, `DC_TOOL_BRICKS`, `DC_BEHAVIOR_BRICKS`, `DcTaxiUnit` | Contratos TypeScript, catálogo de arquetipos canónicos, bloques de herramientas, bloques de comportamiento y estados de taxi. |
| `src/features/dc-agents/core/dc-ephemeral-manager.ts` | `assembleLegoAgentPlan`, `prepareEphemeralAgent`, `cleanupEphemeralAgent`, `dcCleanOrphanedEphemeralAgents` | Motor de ensamblaje Lego, escritura de definiciones efímeras en `~/.pi/agent/agents/`, limpieza garantizada y purga de huérfanos. |
| `src/features/dc-agents/tools/dc-ephemeral-tools.ts` | `registerDcEphemeralTools`, `ensureBackgroundSweeper` | Registro y ejecución de `dc_ephemeral_agent_run`, `dc_research_swarm` y `dc_ephemeral_batch_run`, pulso de heartbeat (45s) y sweeper de background (5s). |
| `src/features/dc-agents/core/dc-research-swarm.ts` | `executeResearchSwarm`, `compileSwarmReport` | Orquestador Fan-Out / Fan-In de los 6 canales de becarios de investigación (`web`, `docs`, `discussions`, `github`, `academic`, `youtube`). |
| `src/features/dc-agents/core/dc-taxi-dispatcher.ts` | `withFleetLock`, `reapAbandonedTaxis`, `leaseTaxi`, `releaseTaxi`, `acquireOrchestratorTaxi`, `heartbeatTaxi` | Gestión de estado de la Flota de Taxis, locks multiproceso con `Atomics.wait`, reaper de procesos muertos en `/proc` y selección por cuota. |
| `src/features/dc-agents/core/dc-taxi-accounts.ts` | `discoverCpamAccounts` | Descubrimiento dinámico de cuentas `acXX` desde `~/.pi/agent/models.json` y `models-store.json`. |
| `src/features/dc-agents/core/dc-taxi-quota.ts` | `fetchTaxiQuota`, `fetchAllTaxisQuotas` | Consulta de cuotas de 5 horas y semanales al bridge local (`:8325`) con caché en memoria. |
| `src/features/dc-agents/core/dc-taxi-history.ts` | `recordTaxiTrip`, `loadTaxiTripHistory`, `getTaxiHistoryMetrics` | Registro histórico de hasta 200 viajes con métricas de duración, tokens y costos en `~/.pi/agent/dc-studio/dc-taxis-history.json`. |
| `src/features/dc-agents/core/dc-taxi-logger.ts` | `appendTaxiLog`, `readRecentTaxiLogs` | Bitácora rotativa de eventos de flota (`TAXI_LEASED`, `TAXI_RELEASED`, `TAXI_ZOMBIE_REAPED`, `TAXI_FLEET_EXHAUSTED`) en `~/.pi/agent/dc-studio/dc-taxis.log`. |
| `src/features/dc-agents/views/dc-taxis-panel.ts` | `DcTaxisPanel` | Panel TUI interactivo (`/dc-taxis`) con vista en vivo de unidades, cuotas, historial de viajes y logs. |
