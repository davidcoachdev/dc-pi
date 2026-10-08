# Subagentes, Flota de Taxis y Sistema de Legos (`dc-agents`)

**Ecosistema:** DC Studio (`dc-pi`)  
**Alcance:** `src/features/dc-agents/`, `agents/*.md`, `subagents.json`  

El subsistema `dc-agents` resuelve dos de los mayores problemas de los agentes de codificación modernos: el **Tool Bloat** (sobrecarga de esquemas de herramientas en cada turno) y los **Rate Limits / Colisiones de Cuota** cuando corren múltiples sesiones o subagentes en paralelo.

---

## 1. Arquitectura de Dos Capas de Agentes

En `dc-pi` conviven **Subagentes Fijos** (sincronizados en `~/.pi/agent/agents/`) y **Subagentes Efímeros de Una Sola Vida** (creados al vuelo mediante `dc_ephemeral_agent_run`).

### Capa A: Los 10 Subagentes Fijos (`agents/*.md`)

Sincronizados idempotentemente al iniciar sesión desde el directorio `agents/` del paquete y configurados en `subagents.json`:

| Subagente | Modelo / Effort por Defecto | Rol y Contrato de Salida |
| :--- | :--- | :--- |
| **`dc-researcher`** | `cpam/ac08/gemini-3.8-flash-high` (`high`) | Investigación técnica profunda en documentación oficial (Context7), web, discusiones (SO/Reddit/HN), código en GitHub, papers académicos y YouTube. Escribe `report.md` y `sources.md`. |
| **`dc-news-to-day`** | `cpam/ac08/gemini-3.8-flash-high` (`high`) | Investigador de noticias tech, IA y lanzamientos. Genera un informe narrativo en español pensado para ser locutado por TTS (`report.md`) y su auditoría (`sources.md`). |
| **`dc-sentinel`** | `cpam/ac08/gemini-3.8-flash-high` (`high`) | Guardián de memoria y síntesis arquitectónica para consolidar hallazgos en Engram. |
| **`dc-ui-visual-inspector`** | Heredado (`medium`) | Auditor visual de solo lectura para frontend (React, Vue, Tailwind, CSS). Usa Chrome CDP (`dc_browser_*`) para inspeccionar viewports Mobile/Desktop y detectar overflows o valores arbitrarios. |
| **`dc-pr-comment-analyst`** | Heredado (`medium`) | Analista de solo lectura que descarga, clasifica y prioriza comentarios de revisión de Pull Requests de GitHub (`gh api`). |
| **`dc-phase-discovery`** | `cpam/ac08/gemini-3.8-flash-high` (`high`) | Fase 1 del Flujo Planificado: explora el repositorio y genera `discovery.md` con alcance, riesgos y archivos impactados. |
| **`dc-phase-planning`** | `cpam/ac08/gemini-3.8-flash-high` (`high`) | Fase 2 del Flujo Planificado: diseña la estrategia técnica y los pasos atómicos en `plan.md`. |
| **`dc-phase-apply`** | Heredado (`high`) | Fase 3 del Flujo Planificado: ejecuta los cambios de código ceñidos a `plan.md` y documenta la evidencia en `apply.md`. |
| **`dc-phase-verify`** | Heredado (`high`) | Fase 4 del Flujo Planificado: corre pruebas, typecheck y contratos de aceptación, emitiendo el dictamen en `verify.md`. |
| **`dc-smoke-subagent`** | Heredado (`low`) | Agente ligero de diagnóstico rápido (*smoke test*) para validar la salud de delegación del runtime. |

---

### Capa B: Subagentes Efímeros y el Sistema de Legos (`dc_ephemeral_agent_run`)

Para evitar que el orquestador principal cargue con 35 herramientas pesadas (~8.000 tokens de overhead por mensaje), `isolateSpecializedToolsForOrchestrator()` retira las herramientas especializadas del prompt principal y deja activa `dc_ephemeral_agent_run`.

Cuando el orquestador necesita ejecutar una tarea especializada:
1. Invoca `dc_ephemeral_agent_run` pasando un **Arquetipo Canónico** o una combinación a medida de **Tool Bricks** + **Behavior Bricks**.
2. `prepareEphemeralAgent` arrienda una cuenta libre de la **Flota de Taxis** y escribe una definición temporal `~/.pi/agent/agents/dc-ephem-<uuid>.md` que contiene **únicamente** las herramientas requeridas y el *Seed Context* (contexto semilla limpio).
3. En modo `task` (síncrono), mantiene un *heartbeat* cada 45 segundos y, en el bloque `finally`, **autodestruye el archivo `.md`**, libera el taxi y registra las métricas de tokens/costo en el historial.
4. En modo `background`, preserva el archivo `.md` y el arriendo del taxi hasta que el proceso en segundo plano concluya o venza su TTL.

#### El Catálogo Canónico de Arquetipos (`archetype`)

> ⚠️ **Regla Estricta de Nomenclatura:** Todos los arquetipos en el ecosistema DC Studio llevan obligatoriamente el prefijo `dc-`. Los nombres legados (`odd-*`) se conservan únicamente como alias de compatibilidad automática.

##### A. Mini SDD de DC Studio (Planned Workflow Formal)
| Arquetipo | Tool Bricks Incluidos | Behavior Bricks Incluidos | Modelo Recomendado | Effort |
| :--- | :--- | :--- | :--- | :--- |
| **`dc-phase-discovery`** | `fs-read`, `code-intel`, `docs` | `read-only-analyst`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |
| **`dc-phase-planning`** | `fs-read`, `code-intel`, `docs` | `read-only-analyst`, `dag-planning`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |
| **`dc-phase-apply`** | `fs-read`, `fs-write`, `terminal`, `code-intel` | `bounded-worker`, `strict-tdd`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |
| **`dc-phase-verify`** | `fs-read`, `terminal`, `code-intel` | `read-only-analyst`, `verify-independent`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |

##### B. Flujo ODD de DC Studio (Organic Driven Development)
| Arquetipo | Tool Bricks Incluidos | Behavior Bricks Incluidos | Modelo Recomendado | Effort |
| :--- | :--- | :--- | :--- | :--- |
| **`dc-odd-scout`** | `fs-read`, `code-intel` | `read-only-analyst`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |
| **`dc-odd-worker`** | `fs-read`, `fs-write`, `terminal` | `bounded-worker`, `strict-tdd`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |
| **`dc-odd-verifier`** | `fs-read`, `terminal` | `read-only-analyst`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |
| **`dc-odd-planner`** | `fs-read`, `code-intel` | `read-only-analyst`, `dag-planning`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |

##### C. Auxiliares Especializados y Herramientas
| Arquetipo | Tool Bricks Incluidos | Behavior Bricks Incluidos | Modelo Recomendado | Effort |
| :--- | :--- | :--- | :--- | :--- |
| **`dc-researcher`** | `web-search`, `docs`, `fs-read` | `source-verification`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |
| **`dc-news-to-day`** | `web-search`, `youtube`, `audio`, `fs-read` | `source-verification`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |
| **`dc-ui-visual-inspector`** | `fs-read`, `browser`, `terminal` | `read-only-analyst`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `medium` |
| **`dc-browser-inspector`**| `browser` | `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `medium` |
| **`dc-pr-comment-analyst`** | `fs-read`, `terminal` | `read-only-analyst`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `medium` |
| **`dc-sentinel`** | `fs-read` | `read-only-analyst`, `artifact-contract`, `non-empty-response` | `gemini-3.8-flash-high` | `high` |
| **`dc-media`** | `youtube`, `audio` | `artifact-contract`, `non-empty-response` | `gemini-3-flash` | `low` |
| **`dc-service-ops`** | `services` | `artifact-contract`, `non-empty-response` | `gemini-3-flash` | `low` |
| **`dc-smoke`** | `fs-read` | `artifact-contract`, `non-empty-response` | `gemini-3-flash` | `low` |

#### Bloques de Herramientas (`toolBricks`)

| Brick | Herramientas que Inyecta |
| :--- | :--- |
| `fs-read` | `read`, `find`, `grep` |
| `fs-write` | `edit`, `write` |
| `terminal` | `bash` |
| `code-intel` | `dc_codegraph_status`, `dc_codegraph_node`, `dc_codegraph_impact`, `dc_codegraph_explore`, `dc_codegraph_sync` |
| `web-search` | `dc_web_search`, `dc_web_fetch`, `dc_discussion_search`, `dc_discussion_answers_get`, `dc_github_code_search`, `dc_github_get`, `dc_research_search` |
| `docs` | `dc_pdf_extract`, `dc_context7_status`, `dc_context7_search`, `dc_context7_get_context` |
| `browser` | `dc_browser_status`, `dc_browser_tabs`, `dc_browser_navigate`, `dc_browser_screenshot` |
| `services` | `dc_services_list`, `dc_service_start`, `dc_service_stop`, `dc_service_restart`, `dc_service_status`, `dc_service_logs` |
| `youtube` | `dc_youtube_search`, `dc_youtube_video_get`, `dc_youtube_transcript_get`, `dc_youtube_channel_search` |
| `audio` | `dc_markdown_to_audio`, `dc_text_to_audio` |

#### Bloques de Comportamiento (`behaviorBricks`)

| Brick | Directiva Operativa Inyectada en el System Prompt del Hijo |
| :--- | :--- |
| `strict-tdd` | Exige observar RED antes de implementar, GREEN tras el cambio mínimo y REFACTOR con checks focalizados. |
| `read-only-analyst` | Prohíbe toda mutación de código y exige citar evidencia con formato `archivo:línea`. |
| `bounded-worker` | Obliga a respetar estrictamente las rutas declaradas en `## Allowed edit surfaces` sin hacer commits ni pushes. |
| `dag-planning` | Diseña el plan como un DAG acíclico y topológicamente ejecutable, con tareas atómicas de ~150 líneas y dependencias explícitas. |
| `verify-independent` | Auditoría independiente de tests y calidad de aserciones; rechaza pruebas con tautologías o tipos vacíos. |
| `source-verification`| Exige atribuir cada afirmación técnica a URLs oficiales o líneas exactas del repositorio local. |
| `artifact-contract` | Exige cerrar con un Resumen Ejecutivo, Archivos Creados/Modificados y Herramientas Usadas. |
| `non-empty-response` | Garantiza que la respuesta final siempre contenga texto visible para el usuario y nunca termine solo con bloques de thinking. |

---

## 2. La Flota de Taxis (`dc-taxi-dispatcher.ts`)

Cuando múltiples terminales de Pi y múltiples subagentes usan la misma cuenta de proveedor al mismo tiempo, se producen errores `429 Too Many Requests`. La **Flota de Taxis** administra un pool de cuentas (`ac01` a `ac10` en CLIProxyAPI) como si fueran unidades de radiotaxi.

### Máquina de Estados de una Unidad Taxi

1. **`libre` (🟢):** La unidad está disponible en la parada y tiene cuota saludable. Puede ser arrendada por un nuevo orquestador (`acquireOrchestratorTaxi`) o por un subagente (`leaseTaxi`).
2. **`ocupado` (🟡):** La unidad lleva un pasajero activo (`orchestrator`, `subagent` o `ephemeral_subagent`). Registra el `pid` del proceso de Node, `sessionId`, `model`, `startedAt` y `heartbeatAt`.
3. **`recargando` (🔴):** Si al liberar un taxi (`releaseTaxi`) o al auditar cuotas su saldo restante cae por debajo del **5%**, la unidad entra automáticamente en enfriamiento (`recargando`). El despachador ignora las unidades en recarga hasta que su cuota se recupere al **>= 60%**, momento en que vuelve automáticamente a `libre`.

### Blindaje Multiproceso y Anti-Colisiones

* **Lockfile Atómico (`withFleetLock`):** Todas las lecturas/escrituras sobre `~/.pi/agent/dc-studio/dc-taxis.json` adquieren un lockfile exclusivo (`O_CREAT | O_EXCL`) con soporte de reentrancia en el mismo proceso y espera con *backoff* sincrónico vía `Atomics.wait`. Si un lock tiene más de 10 segundos o su `PID` murió, se rompe automáticamente.
* **Reaper de Taxis Abandonados (`reapAbandonedTaxis`):** Antes de cada despacho, verifica con `process.kill(pid, 0)` si el proceso dueño de cada taxi ocupado sigue vivo y si su TTL (5 minutos sin heartbeat) no expiró. Si el proceso murió, libera la unidad inmediatamente.
* **Escritura Atómica y Respaldo contra Corrupción:** El estado de la flota y el historial de viajes (`dc-taxis-history.json`) se escriben en un archivo temporal `.tmp` y se renombran con `fs.renameSync`. Si se detecta un JSON corrupto, se respalda en `.corrupt.<timestamp>.bak` sin perder el servicio.

---

## 3. Panel Interactivo `/dc-taxis` (`Alt+Shift+T`)

Abre una ventana modal (`88% x 82%`) con 3 pestañas y buscador integrado:
1. **[1] Flota en Vivo:** Lista todas las unidades (`ac01`..`ac10`), su estado (`LIBRE`, `OCUPADO`, `RECARGANDO`), barras de progreso de cuota 5h/Semanal y qué agente o sesión la está utilizando. Presionar `Enter` o `Espacio` sobre una unidad abre la vista de telemetría detallada de esa cuenta.
2. **[2] Historial & Tokens:** Registro de los últimos 100 viajes con duración, tokens de entrada/salida/razonamiento, costo estimado y ranking de consumo por subagente.
3. **[3] Bitácora (Logs):** Flujo de eventos estructurados de arriendo, liberación, enfriamiento y errores (`~/.pi/agent/dc-studio/dc-taxis.log`).

---

## 4. Enjambre de Becarios Efímeros (`dc_research_swarm` — Fan-Out / Fan-In)

Para investigaciones técnicas profundas, en lugar de que un solo subagente consulte secuencialmente múltiples fuentes durante minutos, la herramienta `dc_research_swarm` implementa un patrón **Fan-Out / Fan-In**:

1. **Fan-Out Paralelo:** Dispara concurrentemente un enjambre de subagentes becarios efímeros (`dc-scout-*`), uno por canal especializado:
   - **`web` (`dc-scout-web`):** Búsqueda web general (`dc_web_search`, `dc_web_fetch`).
   - **`docs` (`dc-scout-docs`):** Documentación técnica oficial y PDFs (`dc_context7_*`, `dc_pdf_extract`).
   - **`discussions` (`dc-scout-community`):** Discusiones y bugs de comunidad (`dc_discussion_*` en Hacker News y Stack Overflow).
   - **`github` (`dc-scout-github`):** Código e implementaciones reales (`dc_github_*`, `dc_codegraph_*`).
   - **`academic` (`dc-scout-academic`):** Papers formales en ArXiv y OpenAlex (`dc_research_search`).
   - **`youtube` (`dc-scout-media`):** Conferencias técnicas y transcripciones (`dc_youtube_*`).
2. **Aislamiento Multiproceso & Taxis:** Cada becario arrienda una unidad diferente de la **Flota de Taxis** (`ac01`-`ac23`) y carga estrictamente su bloque de herramientas (*Tool Brick*).
3. **Resiliencia con `Promise.allSettled`:** Si un canal falla o no encuentra resultados, los demás continúan y entregan su evidencia normalmente sin interrumpir la investigación.
4. **Fan-In (Síntesis):** El orquestador unifica las respuestas y genera de forma determinista dos artefactos:
   - `report.md`: Síntesis ejecutiva multicanal en prosa limpia.
   - `sources.md`: Matriz de fuentes consultadas, tiempos de ejecución y taxis utilizados.
5. **Fresh Context Loop:** Todos los archivos temporales de los becarios (`dc-ephem-*.md`) se autodestruyen en el bloque `finally` y sus taxis vuelven al estado `libre`.
