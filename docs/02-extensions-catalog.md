# Catálogo Completo de Extensiones y Herramientas (`dc-pi`)

**Ecosistema:** DC Studio (`dc-pi`)  
**Alcance:** `src/features/*` (38 módulos) y `src/experimental/*` (1 módulo)  

Todas las extensiones se registran de forma unificada a través de `dcStudioExtension` en `src/index.ts`, o pueden importarse de manera individual como biblioteca.

---

## 1. Mapa Rápido de Comandos y Atajos de Teclado

| Comando | Alias | Atajo | Módulo | Propósito |
| :--- | :--- | :--- | :--- | :--- |
| `/dc-models` | — | `Alt+M` | `dc-models` | Selector a 3 columnas de cuentas, modelos y *reasoning effort* |
| `/dc-changes` | — | `Alt+F` | `dc-changes` | Visor a 2 paneles de cambios Git y diff estilizado (`dc-code`) |
| `/dc-git-graph` | `/git-graph` | `Alt+H` | `dc-git-graph` | Explorador visual de grafo de commits (1/3) + diff por pestañas (2/3) |
| `/dc-taxis` | — | `Alt+Shift+T` | `dc-agents` | Panel de Flota de Taxis (estado de cuentas CPAM, telemetría y logs) |
| `/dc-agents` | `/agents` | `Alt+A` | `dc-agents` | Visor de subagentes instalados e historial de ejecuciones |
| `/plan` | `/odd` | `Alt+T` | `dc-plan` | Visor de planes ODD (`odd/tasks/*.md`) y lista `todo` de la sesión |
| `/dc-sentinel` | — | `Alt+Shift+S` | `dc-sentinel` | Bitácora de vuelo por turno y recall automático pre-flight |
| `/dc-engram` | `/dc-enroll` | `Alt+Shift+G` | `dc-engram` | Explorador de memorias persistentes en SQLite y enrolamiento cloud |
| `/dc-owasp` | `/owasp` | `Alt+O` | `dc-owasp` | Explorador interactivo de OWASP Cheat Sheets y motor de auditoría |
| `/dc-quota` | — | `Alt+Shift+Q` | `dc-quota` | Monitor en vivo de cuotas y tiempos de reset de cuentas CLIProxy |
| `/dc-status` | — | `Alt+E` | `dc-status` | Auditor de entorno, rama Git, diagnóstico de extensiones y Changelog |
| `/dc-sidebar` | — | `Alt+Shift+B` | `dc-sidebar` | Control del sidebar retro, breakpoint de ancho y barra inferior |
| `/dc-faces` | `/dc-face` | `Alt+C` | `dc-face` | Selector N-way de perfiles ASCII (`dcdev`, `cubis`, `neko`) y demos |
| `/dc-caritas` | — | `Alt+Shift+C` | `dc-caritas` | Catálogo interactivo de kaomojis con inserción directa en el prompt |
| `/dc-prompt` | — | `Alt+I` | `dc-prompt` | Editor DOS de marco doble y selector de animaciones (`kitt` / `pacman`) |
| `/dc-user` | — | `Alt+N` | `dc-user` | Configuración del nombre/nickname de usuario activo |
| `/dc-preview` | — | `Alt+Shift+V` | `dc-preview` | Lanzador de paneles externos (`yazi`, `nvim`, `fzf`) en Herdr/Tmux |
| `/dc-keys` | — | `Alt+?` | `dc-keys` | Catálogo interactivo y buscador de atajos de teclado |
| `/dc-reload` | — | `F5` | `dc-reload` | Recarga en caliente de extensiones, skills, temas y atajos |
| `/body-frame` | — | — | `dc-body` | Activa/desactiva el marco de doble línea alrededor del chat |
| `/dc-tool-box` | — | — | `dc-tool-box` | Configura las tarjetas redondeadas de ejecución de herramientas |
| `/dc-user-box` | — | — | `dc-user-box` | Configura las tarjetas redondeadas de los prompts enviados por el usuario |
| `/dc-markdown` | — | — | `dc-markdown` | Configura los bloques de código con iconos Nerd Font y copiado |
| `/dc-banner` | — | — | `dc-banner` | Muestra el escudo ASCII de DC Studio con gradiente Blood |
| `/dc-doctor` | — | — | `dc-doctor` | Inspector de diagnóstico del árbol de nodos de layout de `pi-tui` |
| `/dc-services` | — | — | `dc-services` | Estado de demonios y procesos en segundo plano (`.pi/services.json`) |
| `/dc-browser` | — | — | `dc-browser` | Estado de conexión con Chrome DevTools Protocol (`:9222`) |
| `/dc-codegraph` | — | — | `dc-codegraph` | Estado del índice AST de CodeGraph en el proyecto |
| `/dc-websearch` | — | — | `dc-websearch` | Diagnóstico de los motores de búsqueda técnica multi-proveedor |
| `/dc-context7` | — | — | `dc-context7` | Estado de conexión y API key de Context7 SDK |
| `/dc-api` | — | — | `dc-api` | Información de las herramientas de pruebas REST, Swagger y GraphQL |
| `/dc-pdf` | — | — | `dc-pdf` | Estado del extractor local de documentos PDF |
| `/dc-youtube` | — | — | `dc-youtube` | Diagnóstico de `yt-dlp` y extractor de transcripciones WEBVTT |
| `/dc-audio` | — | — | `dc-audio` | Diagnóstico del motor TTS local (`espeak-ng` / `piper`) |
| `/dc-git-sync` | — | — | `dc-git-sync` | Auditoría de sincronización de la rama local frente a `upstream` |
| `/dc-checkpoint`| — | — | `dc-checkpoint`| Crea un snapshot local (`diff.patch` + `restore.sh`) en `.pi/checkpoints/` |
| `/dc-handoff` | — | — | `dc-handoff` | Genera `.pi/handoff.md` con comando de reanudación y cola de charla |
| `/dc-title` | — | — | `dc-title` | Renombra la pestaña/ventana activa en Herdr, Tmux y secuencias OSC 0 |
| `/dc-dialogs` | — | — | `dc-dialogs` | *(Experimental)* Enmarca selectores e inputs nativos de Pi en `DcWindow` |

---

## 2. Detalle por Categoría Funcional

### A. Layout, Shell Visual y Decoradores de Chat

#### 1. `dc-sidebar` (`src/features/dc-sidebar/`)
* **Propósito:** Reemplaza el rail lateral por un panel enmarcado en doble línea (`╔═╗`) con cabecera `⛩ Dc Studio`, tarjetas interactivas y pie dinámico con mascota ASCII. Además intercepta la barra inferior de estado dividiéndola en 3 cajas responsivas.
* **Submódulos:**
  * `components/`: Tarjetas de Estado (`dc-sidebar-status-card.ts`), Contexto (`dc-sidebar-context-card.ts`), Tareas Todo (`dc-sidebar-todo-card.ts`) y Subagentes (`dc-sidebar-agents-card.ts`).
  * `providers/`: Proveedores con caché TTL (Proyecto Git, Cuotas, Flota de Taxis, MCPs, Perfiles, Contexto).
  * `bottom-bar/`: Interceptor que limpia redundancias y distribuye la barra inferior en 3 cajas (`left`, `center`, `right`).
* **Interacciones por Ratón en el Sidebar:**
  * Clic en **Project** -> Abre vista previa con `yazi` en el directorio raíz.
  * Clic en **Branch** -> Abre el visor modal `/dc-git-graph`.
  * Clic en **Quota** -> Abre el monitor `/dc-quota`.
  * Clic en **Taxis** -> Despliega las unidades o abre `/dc-taxis`.
  * Clic en **Engram** -> Abre el explorador `/dc-engram`.
  * Clic en **Cara ASCII (Footer)** -> Alterna el perfil entre `dcdev` y `cubis`.
* **Persistencia:** `~/.pi/agent/dc-studio/sidebar.json` (propiedades `hidden`, `minWidth`, `headerBar`). Breakpoint automático a `< 140` columnas.

#### 2. `dc-body` (`src/features/dc-body/`)
* **Propósito:** Enmarca el contenedor del transcript de conversación en una caja de doble línea (`╔═║═╝`) sin envolver el sidebar ni el dock inferior.
* **Blindaje:** Detecta si `layoutRoot[LAYOUT_NODE]` fue reemplazado durante el trabajo del agente (`agent_start`, `turn_start`, `agent_settled`, `agent_end`) o cuando existe un `hstack` anidado `[chat, sidebar]`, aplicando el marco únicamente al chat.
* **Persistencia:** `~/.pi/agent/dc-studio/body.json`.

#### 3. `dc-prompt` (`src/features/dc-prompt/`)
* **Propósito:** Reemplaza el editor de entrada por un cuadro DOS de doble línea con color dinámico según el *thinking effort*, indicador de mensajes en cola (`⏳`), nickname del usuario en reposo, línea de estado inferior responsiva (`Modelo · Effort │ CTX Gauge % │ Costo $`) y animaciones de actividad.
* **Animaciones (`Alt+I`):** Barrido **KITT** (Auto Fantástico) y **Pacman** comiendo píldoras.
* **Persistencia:** `~/.pi/agent/dc-studio/prompt.json`.

#### 4. `dc-user-box` (`src/features/dc-user-box/`)
* **Propósito:** Parchea `UserMessageComponent.prototype.render` para presentar cada prompt enviado por el usuario dentro de una tarjeta redondeada con su nombre (`╭─── ⛩ Nombre ───╮`), botón interactivo de copiado (`📋`) y recorte automático del padding vacío nativo de Pi.

#### 5. `dc-tool-box` (`src/features/dc-tool-box/`)
* **Propósito:** Parchea `ToolExecutionComponent` para envolver las ejecuciones de herramientas en tarjetas compactas con iconos específicos por herramienta (`📖 read`, `💻 bash`, `✏️ edit`, `🔍 grep`, `🚕 dc_ephemeral_agent_run`, etc.), evitando bordes dobles anidados y normalizando salidas `NestedToolOutcome`.

#### 6. `dc-markdown` (`src/features/dc-markdown/`)
* **Propósito:** Enriquece el renderizado Markdown del asistente: encabezados con glifos jerárquicos, bloques de código en cajas redondeadas con icono Nerd Font del lenguaje y botón `📋` para copiar el bloque limpio al portapapeles, y formateo estético de cajas de error JSON (`dc-error-box.ts`).

#### 7. `dc-face` (`src/features/dc-face/`) & `dc-caritas` (`src/features/dc-caritas/`)
* **`dc-face`:** Conecta `AgentVisualStateStore` y el puente TTS (`dc-face-bridge.ts`) con el arte ASCII de mascotas (`dcdev`, `cubis`, `neko`) y las mini-caras kaomoji. En terminales `>= 46` filas muestra el Big ASCII Face de 12 líneas; debajo de 46 filas conmuta automáticamente a 1 línea. Optimizado con *run-length chunking* ANSI y *Zero-OOM* en modo sueño. Persiste en `~/.pi/agent/dc-studio/face.json`.
* **`dc-caritas`:** Selector modal (`Alt+Shift+C`) de kaomojis categorizados que inserta la expresión elegida directamente en el editor.

#### 8. `dc-banner` (`src/features/dc-banner/`) & `dc-exit` (`src/features/dc-exit/`)
* **`dc-banner`:** Dibuja el escudo ASCII de DC Studio con gradiente RGB Blood en el header al iniciar sesión y lo oculta automáticamente al primer input del usuario.
* **`dc-exit`:** Limpia la pantalla de la terminal (`\x1b[2J\x1b[3J\x1b[H`) únicamente cuando el usuario cierra Pi de verdad, ignorando recargas (`/reload`) o cambios de sesión.

---

### B. Git, Control de Versiones y Flujo de Trabajo

#### 9. `dc-git-graph` (`src/features/dc-git-graph/`)
* **Atajo:** `Alt+H` (`/dc-git-graph`).
* **Propósito:** Visor de historial Git de alta densidad dividido en proporción **1/3 (árbol gráfico de commits)** y **2/3 (detalle del commit)**.
* **Características:**
  * Colores semánticos por tipo de Conventional Commit (`feat`, `fix`, `refactor`, `docs`, `merge`).
  * Buscador integrado en tiempo real por `#hash`, mensaje o autor.
  * Cabecera enriquecida con wordwrap completo sin truncar descripciones largas.
  * Pestañas horizontales deslizantes (*sliding tabs*) por cada archivo tocado en el commit.
  * Renderizado del diff mediante **`renderDcCodeBox`** (números de línea en gutter, sombreado verde/rojo continuo, wordwrap inteligente con sangría).

#### 10. `dc-changes` (`src/features/dc-changes/`)
* **Atajo:** `Alt+F` (`/dc-changes`).
* **Propósito:** Visor de cambios locales del árbol de trabajo (`86% x 86%`, mínimo **36 filas**).
* **Características:**
  * Soporte multi-worktree: barra superior para alternar entre worktrees de Git con las teclas `w` / `W`.
  * Panel izquierdo con lista de archivos modificados/untracked y panel derecho renderizado con **`renderDcCodeBox`**.
  * Tecla `o` o `Enter` abre el archivo seleccionado directamente en `$VISUAL` / `$EDITOR`.

#### 11. `dc-git-sync` (`src/features/dc-git-sync/`)
* **Propósito:** En el primer turno de la sesión (`before_agent_start`), inspecciona pasivamente el estado del repositorio frente a su remoto (`ahead`, `behind`, `diverged`, cambios sin comitear) y alerta si la rama requiere sincronización.

#### 12. `dc-plan` (`src/features/dc-plan/`), `dc-checkpoint` (`src/features/dc-checkpoint/`) & `dc-handoff` (`src/features/dc-handoff/`)
* **`dc-plan` (`Alt+T` / `/plan`):** Visor a 2 paneles que inspecciona los documentos de especificación ODD en `odd/tasks/*.md` y el estado en vivo de las tareas `todo` de la sesión.
* **`dc-checkpoint` (`/dc-checkpoint [nombre]`):** Genera una instantánea de seguridad del worktree actual en `.pi/checkpoints/<timestamp>-<nombre>/` con el parche `diff.patch` y un script ejecutable `restore.sh`.
* **`dc-handoff` (`/dc-handoff`):** Al salir de Pi (o manualmente), guarda `.pi/handoff.md` con el comando exacto para reanudar la sesión (`pi --session <id>`) y el resumen de los últimos turnos, asegurando que `.pi/.gitignore` proteja el directorio.

---

### C. Subagentes, Modelos, Cuotas y Memoria

#### 13. `dc-agents` (`src/features/dc-agents/`)
* Documentado en profundidad en [`03-agents-taxis-and-lego-system.md`](./03-agents-taxis-and-lego-system.md).
* Provee `/dc-taxis` (`Alt+Shift+T`), `/dc-agents` (`Alt+A`), sincronización idempotente de `agents/` y `skills/`, aislamiento de herramientas pesadas en el orquestador y la tool `dc_ephemeral_agent_run`.

#### 14. `dc-models` (`src/features/dc-models/`)
* **Atajo:** `Alt+M` (`/dc-models`).
* **Propósito:** Selector interactivo a **3 columnas** (1: Cuentas/Proveedores, 2: Modelos con autoscroll y scrollbar retro, 3: Nivel de *Reasoning Effort*).
* **Características:** Buscador sensible al foco (filtra cuentas o modelos), vista detallada con `Espacio`, limpieza de prefijos de cuenta y persistencia directa en `~/.pi/agent/settings.json` (`defaultProvider`, `defaultModel`, `modelThinkingLevels`).

#### 15. `dc-quota` (`src/features/dc-quota/`)
* **Atajo:** `Alt+Shift+Q` (`/dc-quota`).
* **Propósito:** Panel de monitoreo en vivo de cuotas de tokens y ventanas de reset para todas las cuentas configuradas en CLIProxyAPI y OpenCode. Auto-selecciona la cuenta del modelo activo al abrirse.

#### 16. `dc-sentinel` (`src/features/dc-sentinel/`) & `dc-engram` (`src/features/dc-engram/`)
* **`dc-sentinel` (`Alt+Shift+S`):** Guardián autónomo de sesión. Registra una bitácora de vuelo continua en `docs/chronicle/YYYY-MM-DD-sentinel-log.md` (prompts, tools ejecutadas, subagentes, errores) y ejecuta **Pre-Flight Recall** antes de cada turno (`before_agent_start`), buscando en la base SQLite de Engram las observaciones más relevantes para inyectarlas sin duplicación en el prompt. Persiste en `~/.pi/agent/dc-studio/sentinel.json`.
* **`dc-engram` (`Alt+Shift+G`):** Visor interactivo a 2 paneles de la base de datos SQLite de Engram (`~/.engram/engram.db`) con filtrado en vivo, y panel de enrolamiento/sincronización cloud (`/dc-engram-enroll`).

---

### D. Seguridad, Diagnóstico y Entorno

#### 17. `dc-owasp` (`src/features/dc-owasp/`)
* **Atajo:** `Alt+O` (`/dc-owasp` / `/owasp`).
* **Propósito:** Suite de seguridad ofensiva/defensiva basada en **OWASP Cheat Sheet Series**.
* **Componentes:**
  * Visor modal interactivo con catálogo curado de hojas OWASP y caché en disco.
  * Motor estático de auditoría de diffs (`auditDiff`) que detecta inyección SQL, XSS (`dangerouslySetInnerHTML`), TLS inseguro (`rejectUnauthorized: false`), secretos hardcodeados y CORS permisivo.
  * **Tools LLM:** `dc_owasp_query` y `dc_owasp_audit`.

#### 18. `dc-scan-guard` (`src/features/dc-scan-guard/`)
* **Propósito:** Escudo pasivo en el hook `tool_call`. Analiza comandos de shell (`bash`, `sh`) antes de que se ejecuten y bloquea búsquedas recursivas (`find`, `grep -r`, `rg`) lanzadas contra la raíz del disco (`/`, `~`, `C:\`, `$HOME`), evitando cuelgues por hidratación de archivos en la nube (OneDrive/WSL) o pseudo-sistemas de archivos (`/proc`, `/sys`).

#### 19. `dc-status` (`src/features/dc-status/`) & `dc-doctor` (`src/features/dc-doctor/`)
* **`dc-status` (`Alt+E`):** Panel de auditoría con 3 pestañas: **[1] Entorno & Git** (versiones de Node, Pi, gentle-pi, multiplexor, estado de rama), **[2] Alertas** (diagnósticos e incidencias de carga de extensiones capturadas limpiamente) y **[3] Changelog** (últimas notas de versión de Pi).
* **`dc-doctor` (`/dc-doctor`):** Inspector estructural del árbol de nodos de `pi-tui` (`layoutRoot`), útil para depurar jerarquías `vstack`/`hstack` y detectar regresiones de layout. Persiste reporte en `~/.pi/agent/dc-studio/doctor.json`.

#### 20. `dc-keys` (`src/features/dc-keys/`), `dc-reload` (`src/features/dc-reload/`), `dc-preview` (`src/features/dc-preview/`), `dc-user` (`src/features/dc-user/`), `dc-title` (`src/features/dc-title/`), `dc-date` (`src/features/dc-date/`)
* **`dc-keys` (`Alt+?`):** Visor por categorías y buscador de atajos de teclado; además `dc-keys-enforcer.ts` libera `Alt+B` y `Alt+F` en `~/.pi/agent/keybindings.json` para que no colisionen con la navegación por palabras.
* **`dc-reload` (`F5`):** Dispara `ctx.reload()` de forma segura desde comando o atajo de teclado.
* **`dc-preview` (`Alt+Shift+V`):** Abre un split horizontal o vertical en Herdr o Tmux ejecutando `yazi`, `nvim` o `fzf` en el `cwd` del proyecto.
* **`dc-user` (`Alt+N`):** Modal para editar el nombre del operador en `~/.pi/agent/dc-studio/user.json`.
* **`dc-title` (`/dc-title`):** Renombra automáticamente la pestaña y el workspace de Herdr/Tmux con el nombre del proyecto derivado del repositorio Git.
* **`dc-date`:** Inyecta la fecha local exacta (`YYYY-MM-DD` y día de la semana) en el arranque y en `before_agent_start` para evitar que el LLM alucine la fecha actual.

---

## 3. Referencia Completa de las 38 Herramientas para el LLM (`Tools`)

Por diseño de rendimiento (**Fresh Context Loop**), el orquestador principal mantiene en su contexto directo únicamente `dc_ephemeral_agent_run` y las herramientas de seguridad `dc_owasp_*`. Las otras 35 herramientas especializadas son inyectadas bajo demanda en los subagentes efímeros mediante **Tool Bricks**.

### 1. Orquestación Efímera (`dc-agents`)
| Nombre de Tool | Parámetros Clave | Descripción |
| :--- | :--- | :--- |
| `dc_ephemeral_agent_run` | `task`, `archetype?`, `role?`, `toolBricks?`, `behaviorBricks?`, `seedContext?`, `effort?`, `mode?` | Crea un subagente efímero de una sola vida, arrienda una cuenta libre de la Flota de Taxis, ejecuta la tarea con herramientas aisladas y limpia todo al finalizar. |

### 2. Seguridad OWASP (`dc-owasp` — Siempre activa)
| Nombre de Tool | Parámetros Clave | Descripción |
| :--- | :--- | :--- |
| `dc_owasp_query` | `topic`, `sheetId?`, `maxChars?` | Consulta directivas oficiales y ejemplos de código seguro de OWASP Cheat Sheets. |
| `dc_owasp_audit` | `diff?`, `path?`, `gitDiff?` | Audita un archivo, un diff provisto o el `git diff HEAD` actual contra reglas de vulnerabilidad OWASP. |

### 3. Inteligencia de Código AST (`dc-codegraph` — Brick: `code-intel`)
| Nombre de Tool | Parámetros Clave | Descripción |
| :--- | :--- | :--- |
| `dc_codegraph_status` | `cwd?` | Verifica el estado del índice AST de CodeGraph en el proyecto. |
| `dc_codegraph_node` | `target`, `cwd?` | Obtiene la definición, firma y ubicación exacta de un símbolo o archivo. |
| `dc_codegraph_impact` | `target`, `cwd?` | Calcula el radio de explosión (*blast radius*) y dependientes de un símbolo. |
| `dc_codegraph_explore` | `query`, `cwd?` | Explora relaciones semánticas y llamadas en el grafo de código. |
| `dc_codegraph_sync` | `cwd?` | Re-indexa el repositorio actual en CodeGraph. |

### 4. Investigación Web y GitHub (`dc-websearch` — Brick: `web-search`)
| Nombre de Tool | Parámetros Clave | Descripción |
| :--- | :--- | :--- |
| `dc_web_search` | `query`, `limit?` | Búsqueda web técnica con protección SSRF y redacción de secretos. |
| `dc_web_fetch` | `url`, `maxChars?` | Descarga y convierte una página web a texto limpio estructurado. |
| `dc_discussion_search` | `query`, `source?`, `limit?` | Busca debates técnicos reales en StackOverflow, Reddit y HackerNews. |
| `dc_discussion_answers_get`| `id`, `source` | Extrae las respuestas votadas y aceptadas de un hilo técnico. |
| `dc_github_code_search` | `query`, `language?`, `repo?` | Busca implementaciones reales de código en repositorios públicos de GitHub. |
| `dc_github_get` | `url` | Descarga el contenido crudo de archivos o issues de GitHub. |
| `dc_research_search` | `query`, `limit?` | Busca papers académicos y publicaciones en ArXiv / Semantic Scholar. |

### 5. Documentación Oficial y PDFs (`dc-context7`, `dc-pdf`, `dc-api` — Brick: `docs`)
| Nombre de Tool | Parámetros Clave | Descripción |
| :--- | :--- | :--- |
| `dc_context7_status` | — | Verifica disponibilidad y configuración de Context7 SDK. |
| `dc_context7_search` | `query` | Busca librerías y frameworks indexados en Context7. |
| `dc_context7_get_context` | `libraryId`, `topic?`, `maxTokens?`| Obtiene documentación oficial actualizada y snippets verificados de una librería. |
| `dc_pdf_extract` | `filePath`, `maxPages?`, `maxChars?`| Extrae texto paginado y metadatos de archivos PDF locales. |
| `dc_api_rest` | `url`, `method?`, `headers?`, `body?` | Ejecuta peticiones HTTP REST seguras con truncado de payload y sanitización. |
| `dc_api_swagger` | `urlOrPath`, `filter?` | Parsea especificaciones OpenAPI/Swagger 2.0 y 3.0 extrayendo endpoints y esquemas. |
| `dc_api_graphql` | `endpoint`, `query`, `variables?` | Ejecuta consultas o introspección de esquemas sobre endpoints GraphQL. |

### 6. Automatización de Navegador (`dc-browser` — Brick: `browser`)
| Nombre de Tool | Parámetros Clave | Descripción |
| :--- | :--- | :--- |
| `dc_browser_status` | `cdpUrl?` | Verifica conexión con Chrome DevTools Protocol (por defecto `http://127.0.0.1:9222`). |
| `dc_browser_tabs` | `cdpUrl?` | Lista las pestañas abiertas y sus `targetId` / URLs. |
| `dc_browser_navigate` | `url`, `targetId?`, `timeoutMs?` | Navega una pestaña a una URL vía WebSocket CDP y espera `Page.loadEventFired`. |
| `dc_browser_screenshot` | `outputPath?`, `fullPage?`, `targetId?`| Captura una imagen PNG de la pestaña activa o de la página completa. |

### 7. Procesos y Servicios en Background (`dc-services` — Brick: `services`)
| Nombre de Tool | Parámetros Clave | Descripción |
| :--- | :--- | :--- |
| `dc_services_list` | `cwd?` | Lista los servicios configurados en `.pi/services.json` y si están vivos (`PID`). |
| `dc_service_start` | `name`, `cwd?` | Inicia un servicio en segundo plano redirigiendo stdout/stderr a `.pi/logs/<name>.log`. |
| `dc_service_stop` | `name`, `timeoutMs?` | Detiene limpiamente un servicio (`SIGTERM` -> `SIGKILL`) y actualiza el estado. |
| `dc_service_restart` | `name`, `cwd?` | Reinicia un servicio registrado. |
| `dc_service_status` | `name`, `cwd?` | Consulta PID, uptime y estado de un servicio específico. |
| `dc_service_logs` | `name`, `lines?` | Lee las últimas N líneas del log de un servicio en segundo plano. |

### 8. Multimedia: YouTube y Síntesis de Voz (`dc-youtube`, `dc-audio` — Bricks: `youtube`, `audio`)
| Nombre de Tool | Parámetros Clave | Descripción |
| :--- | :--- | :--- |
| `dc_youtube_search` | `query`, `limit?` | Busca videos en YouTube mediante `yt-dlp` sin requerir API key. |
| `dc_youtube_video_get` | `urlOrId` | Extrae metadatos detallados (título, canal, duración, capítulos, descripción). |
| `dc_youtube_transcript_get`| `urlOrId`, `lang?` | Descarga y limpia subtítulos WEBVTT eliminando marcas de tiempo y líneas duplicadas. |
| `dc_youtube_channel_search`| `channelUrl`, `limit?` | Lista los últimos videos publicados por un canal. |
| `dc_markdown_to_audio` | `markdown`, `outputPath?`, `voice?` | Limpia formato Markdown a prosa hablada y sintetiza un archivo de audio `.wav`. |
| `dc_text_to_audio` | `text`, `outputPath?`, `voice?` | Sintetiza texto plano a un archivo `.wav` usando el motor TTS local. |
