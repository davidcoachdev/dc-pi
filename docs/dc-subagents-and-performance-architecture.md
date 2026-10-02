# Arquitectura de Performance y Subagentes Efímeros de DC Studio

**Ecosistema:** DC Pi (`dc-pi`)  
**Autor:** DC Studio  
**Fecha:** 2026-10-01  
**Estado:** Documento Canónico de Arquitectura de Rendimiento  

---

## 1. Resumen Ejecutivo de la Auditoría

Este documento consolida la auditoría profunda realizada al runtime de **Pi**, al paquete **gentle-pi** y a la suite **dc-pi**, estableciendo el nuevo paradigma de rendimiento basado en **Subagentes Virtuales Efímeros**, **Desacoplamiento Estricto de Herramientas** y **Bitácora Continua con Engram**.

### 1.1. Principios Innegociables
1. **No se borra ninguna herramienta de DC Studio:** Las 35 herramientas creadas para `dc-pi` resuelven capacidades que ni Pi ni gentle-pi cubren (CDP para Chrome, CodeGraph por binario directo local, transcripciones limpias con yt-dlp, TTS local, Context7 SDK, gestión de servicios en background, etc.).
2. **gentle-pi no es la fuente de la verdad:** Es una herramienta de orquestación más dentro del entorno, no el estándar absoluto al que `dc-pi` deba someterse.
3. **Respeto irrestricto al Single Responsibility Principle (SRP):** Cada herramienta debe mantenerse atómica, enfocada y modular en su propio archivo fuente. No se fusionan en switches artificiales (`action: ...`).
4. **Optimización por Infraestructura, no por Castración:** El rendimiento se gana eliminando el polling ciego de la UI, pasando las lecturas a asíncronas con caché, y aislando las herramientas en subagentes efímeros para no sobrecargar el System Prompt del agente principal.

---

## 2. Diagnóstico de Cuellos de Botella en dc-pi

La auditoría sobre el código de `dc-pi` (a pesar de sus 280 tests en verde) identificó 4 fuentes críticas de degradación de rendimiento:

### A. Polling Ciego con `setInterval` (Violación de la Directiva 6)
* **`dc-sidebar-host.ts`:** Ejecutaba `setInterval` cada 1.000 ms inspeccionando recursivamente el árbol de layout de Pi (`hstack`/`vstack`).
* **`dc-body.ts`:** Ejecutaba `setInterval` cada 300 ms (más de 3 veces por segundo) llamando a `tryAttachBodyFrame`.
* **`dc-prompt-editor.ts` y `dc-prompt-status.ts`:** Pulsos a 100 ms y 110 ms forzando `tui.requestRender()` continuamente.
* **Impacto:** Entre 10 y 15 renders por segundo en la terminal en reposo, consumo constante de 15-25% de CPU y micro-tirones al tipear en el prompt.

### B. Bloqueo de I/O Síncrono en el Event Loop
* Múltiples llamadas a `fs.readFileSync` en caliente en proveedores de datos (`dc-models`, `dc-profile-provider`, `dc-mcp-provider`) en cada render.
* Ejecución de `spawnSync` en frío para verificar binarios (`yt-dlp --version` tardando entre 1.5 y 4.5 segundos; `espeak-ng` tardando 1.3 segundos).

### C. Sobrecarga del Context Window (Tool Bloat)
* `src/index.ts` registraba incondicionalmente las 35 herramientas en el arranque de Pi.
* Pi envía el esquema JSON de **todas** las herramientas registradas en cada mensaje hacia el LLM.
* **Costo:** Entre 7.000 y 10.000 tokens de overhead en CADA turno de conversación, degradando el *Time To First Token* (TTFT) y saturando la atención del modelo.

### D. Renderizado de Markdown con Regex per-frame en Streaming
* `dc-markdown-patch.ts` analizaba todas las líneas del mensaje del asistente con regex (`\x1b_dc:code:...`) en cada chunk de tokens que llegaba por streaming, con un costo computacional creciente de orden cuadrático ($O(N)$ sobre texto en crecimiento).

---

## 3. El Paradigma de Subagentes Virtuales Efímeros (Inspirado en Antigravity)

Para resolver la sobrecarga de herramientas sin romper la responsabilidad única ni fusionar código, adoptamos el patrón de **Subagentes Efímeros de Una Sola Vida (Fresh Context Loop)** de Google Antigravity:

```
┌─────────────────────────────────────────────────────────────┐
│                 DC ORCHESTRATOR (LIVIANO)                   │
│      Prompt limpio: ~1.500 tokens (cero tools pesadas)      │
│      Libre para chatear, diseñar y coordinar                │
└──────────────────────────────┬──────────────────────────────┘
                               │
            Necesidad puntual (YouTube, Browser, Audio, Research)
                               │
                               ▼
            ┌────────────────────────────────────┐
            │   SUBAGENTE EFÍMERO (UNA VIDA)    │
            │  - Contexto virgen (0% alucinación)│
            │  - Isolated Toolset: SOLO sus tools│
            │    (ej: dc_youtube_*)              │
            └─────────────────┬──────────────────┘
                              │
                    Ejecuta su tarea aislada
                              │
                              ▼
            ┌────────────────────────────────────┐
            │   Devuelve Contrato de Artefacto   │
            │        Y SE AUTODESTRUYE           │
            └────────────────────────────────────┘
```

### 3.1. Contexto Semilla (Seed Context) vs Chat Completo
* **Nunca se pasa todo el historial:** Pasar el chat acumulado contamina al hijo con decisiones pasadas irrelevantes, ruido y potenciales alucinaciones ("Ghost Context").
* **Seed Context:** El subagente recibe únicamente:
  1. La instrucción clara, determinista y autocontenida.
  2. Un extracto sintetizado de contexto relevante (ej: tecnologías del proyecto o ruta de trabajo).
  3. Los archivos o variables estrictamente necesarios.

### 3.2. Contratos de Artefacto (Artifact Contracts)
Para no ensuciar el contexto del agente padre:
* El hijo **nunca** devuelve volcados de texto crudo de cientos de líneas.
* Devuelve un artefacto estándar:
  * **Resumen Ejecutivo:** 2-3 párrafos con la respuesta directa.
  * **Artefacto en Disco:** Archivos guardados bajo ruta estructurada (ej: `docs/research/`, audio `.wav`, o diff de código).
  * **Evidencia Operativa:** Herramientas ejecutadas y fuentes contrastadas.

### 3.3. Comunicación Bidireccional (IPC Padre ⇄ Hijo)
Aprovechando el protocolo de agentes del runtime (`gentle-agents.ts`):
* **El Hijo Consulta:** Usa `subagent_parent_message({ kind: "query", message: "..." })` y entra en estado de espera (`waiting`).
* **El Padre Responde:** El orquestador recibe el evento y contesta con `subagent_reply({ task_id, request_id, message })`.
* **Orquestación en Cadena:** Si el hijo necesita que se investigue algo fuera de su scope, el padre puede disparar un subagente explorador, obtener el dato y pasárselo al hijo sin que el hijo pierda su estado de ejecución.

### 3.4. Ejecución en Background y Steering
* **Terminal Libre Inmediata:** Con `mode: "background"`, `subagent_run` devuelve el control a la terminal del desarrollador en el milisegundo 0. Podés seguir programando o charlando con el padre.
* **Steering en Vuelo:** Mediante `subagent_send_message({ task_id, message })` podés reorientar al subagente antes de su siguiente turno sin necesidad de matarlo.
* **Cancelación Quirúrgica:** Mediante `subagent_cancel({ task_id })` podés abortar la tarea inmediatamente si ya no es requerida.

---

## 4. El Guardián de Bitácora y Memoria (DC Sentinel)

Para garantizar la continuidad del proyecto a lo largo del tiempo (ej: retomar el código dentro de 6 meses y saber con exactitud **qué se hizo, por qué se decidió, qué salió mal y qué lecciones se aprendieron**), se incorpora el subagente **`dc-sentinel`**.

### 4.1. Arquitectura de Persistencia Dual
El Guardián opera en dos planos complementarios:

1. **Plano de Repositorio Local (`docs/chronicle/`):**
   * Archivos Markdown cronológicos versionados con Git: `YYYY-MM-DD-<slug>.md`.
   * Permite a cualquier desarrollador humano leer la historia completa del proyecto sin depender de bases de datos externas.

2. **Plano de Memoria Semántica en Engram:**
   * Utiliza el daemon de Engram (`:7437`) y las herramientas `mem_save`, `mem_search`, `mem_context`.
   * Registra observaciones categorizadas con **topic keys estables** y etiquetas (`#tags`):
     * `decision`: Por qué se eligió una arquitectura y qué alternativas se descartaron.
     * `bugfix`: Qué falló, causa raíz, solución aplicada y cómo prevenirlo.
     * `architecture`: Estructuras, límites de módulos y contratos de comunicación.
     * `discovery`: Hallazgos no obvios sobre Pi, TypeScript, TUI o dependencias.
     * `lesson_learned` (Qué se hizo mal): Análisis post-mortem honesto para no repetir errores.

### 4.2. Estructura Canónica de una Entrada de Bitácora
```markdown
# Registro de Vuelo: [Título de la Tarea / Sesión]
- **Fecha:** YYYY-MM-DD HH:mm (UTC)
- **Sesión ID:** <id-de-sesion>
- **Etiquetas:** #arquitectura #performance #subagentes #ui #engram

## 1. Intención Original del Usuario
[Prompt o requerimiento textual exacto]

## 2. Decisiones Técnicas y Trade-offs
- **Decisión:** [Qué se decidió]
- **Motivo:** [Por qué se decidió esto en lugar de la alternativa]
- **Impacto:** [Archivos y componentes afectados]

## 3. Subagentes y Herramientas Delegadas
- Subagente: `dc-researcher` | Tarea: Investigación de APIs | Resultado: OK
- Herramientas ejecutadas: `dc_codegraph_status`, `execFileAsync`

## 4. Qué Salió Mal y Lecciones Aprendidas (Post-Mortem)
- **Error / Cuello de botella:** [Qué falló o anduvo lento]
- **Causa Raíz:** [Explicación técnica]
- **Solución / Aprendizaje:** [Qué se aprendió para nunca más cometer ese error]

## 5. Estado Final y Próximos Pasos
- [x] Tarea A completada con tests verificados.
- [ ] Tarea B pendiente de aprobación.
```

---

## 5. Plan Táctico de Implementación

1. **Documentación e Historial Inicial:**  
   Crear `docs/chronicle/` y registrar la primera entrada con la auditoría de performance y la arquitectura de subagentes.
2. **Creación del Subagente `dc-sentinel`:**  
   Definir `agents/dc-sentinel.md` con acceso a herramientas de lectura, bitácora y Engram, y registrarlo en `subagents.json`.
3. **Limpieza del Polling en `dc-body` y `dc-sidebar`:**  
   Reemplazar los `setInterval` ciegos por escuchadores de eventos reactivos (`session_start`, resize de terminal y comandos de usuario).
4. **Caché en Memoria para Verificación de Binarios:**  
   Memoizar chequeos pesados (`yt-dlp`, `espeak`, git) para bajar su tiempo de ejecución de 4.5 segundos a 0 milisegundos.
5. **Aislamiento de Tools a Subagentes:**  
   Vincular las 35 herramientas a sus respectivos subagentes especializados, aliviando el System Prompt del orquestador principal.
