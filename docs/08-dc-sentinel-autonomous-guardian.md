# 08 — DC Sentinel: Guardián Autónomo de Bitácora y Pre-Flight Recall

**Módulo:** `src/features/dc-sentinel/`  
**Subagente asociado:** `agents/dc-sentinel.md`  
**Destino de bitácora:** `docs/chronicle/`  
**Integración de memoria:** Engram (`http://127.0.0.1:7437` & `~/.engram/engram.db`)  
**Fecha de Implementación:** 2026-10-01  

---

## 1. Motivación y Propósito

El mayor riesgo en proyectos de software asistidos por IA es la **amnesia histórica**:
* Dentro de 6 meses o un año, ni el humano ni el agente recuerdan por qué se tomó una decisión arquitectónica o qué error se cometió que obligó a descartar una librería.
* En cada prompt complejo, los modelos de lenguaje con razonamiento profundo (como Gemini Flash Thinking o Claude Opus) gastan entre **1.000 y 4.000 tokens de pensamiento** tratando de deducir cómo resolver un problema que quizás ya fue resuelto o descartado semanas atrás.
* Requerir que el usuario invoque un comando manual o subagente para registrar la bitácora falla por fatiga humana.

**DC Sentinel** resuelve esto de forma radical: es un **servicio ambiental autónomo (Ambient Sentinel)** que corre 24/7 en segundo plano en Pi sin necesidad de que el usuario lo llame.

---

## 2. Los Dos Momentos Operativos

```
                            CICLO DE VIDA DEL CENTINELA
                                         
                 [ Usuario tipea prompt ]
                            │
                            ▼
              ┌─────────────────────────────┐
              │    1. PRE-FLIGHT RECALL     │
              │    (before_agent_start)     │
              └─────────────┬───────────────┘
                            │ ➔ Busca en Engram (<15ms)
                            │ ➔ Inyecta decisiones y bugfixes en appendSystemPrompt
                            ▼
              ┌─────────────────────────────┐
              │    2. RAZONAMIENTO AGENTE   │ ──► Ahorro masivo de Thinking Tokens
              │    (In-flight Execution)    │     (Arranca sabiendo la historia)
              └─────────────┬───────────────┘
                            │ ➔ tool_execution_start: Registra tools y subagentes
                            │ ➔ tool_execution_end: Captura errores y resultados
                            ▼
              ┌─────────────────────────────┐
              │    3. POST-FLIGHT RECORDER  │
              │       (agent_settled)       │
              └─────────────┬───────────────┘
                            │ ➔ Genera Markdown canónico en docs/chronicle/
                            │ ➔ Sincroniza observaciones a Engram
                            ▼
                 [ Terminal libre y limpia ]
```

### A. Pre-Flight Semantic Recall (`before_agent_start`)
Antes de que el modelo comience a generar o pensar:
1. `extractKeywords(prompt)`: Normaliza el texto del usuario, elimina stop-words en español e inglés y caracteres no alfanuméricos.
2. `performPreFlightRecall(prompt)`: Consulta las observaciones de Engram y puntúa por relevancia (pesando 3x el título y 1x el contenido, con bonificación para decisiones y bugfixes).
3. `appendRecallToPromptOptions(...)`: Si hay recuerdos relevantes, inyecta un bloque delimitado dentro de `systemPromptOptions.appendSystemPrompt`:
   ```markdown
   <!-- dc:sentinel:recall:start -->
   ## ⛩️ Memoria Histórica del Proyecto (DC Sentinel Pre-Flight Recall)
   > Lecciones, decisiones y arquitectura relevantes recuperadas de Engram para guiar esta respuesta y evitar alucinaciones:
   - **[DECISION] Adoptar Subagentes Efímeros**: Fresh Context Loop de Antigravity para aislar herramientas...
   - **[BUGFIX] Polling en UI**: Prohibido usar setInterval en componentes de TUI...
   <!-- dc:sentinel:recall:end -->
   ```
4. **Impacto:** El LLM no adivina ni delira; arranca el turno sabiendo qué decisiones se tomaron en el pasado.

### B. In-Flight Recorder & Post-Flight Settlement (`agent_settled`)
Mientras el orquestador trabaja:
1. `tool_execution_start`: Si se invoca `subagent_run`, captura automáticamente:
   * Nombre del subagente (`agent`).
   * Tarea asignada (`task`).
   * Modo de ejecución (`task` o `background`).
2. `tool_execution_end`: Registra la duración, si hubo error y un snippet del resultado.
3. `agent_settled`: Cuando la respuesta final se imprimió y el turno termina:
   * Escribe o actualiza la bitácora del día en `docs/chronicle/YYYY-MM-DD-sentinel-log.md`.
   * Cero intervención humana.

---

## 3. Blindaje de Convivencia con Gentle-AI

Para garantizar que `dc-sentinel` **nunca choque ni interfiera con gentle-ai**:

1. **Uso Exclusivo de `appendSystemPrompt` con Idempotencia:**  
   Nunca se retorna un objeto `{ systemPrompt: ... }` de reemplazo. Se concatena al campo estándar `options.appendSystemPrompt` respetando el contrato de Pi y la resolución del issue `#1485` de `gentle-shell`. Gentle-AI mantiene su arnés ODD y TODO intactos.
2. **Aislamiento de Sesiones Hijas:**  
   ```typescript
   if (process.env.GENTLE_PI_AGENTS_CHILD === "1") return;
   ```
   Si un subagente corre en segundo plano, el Centinela se apaga dentro del hijo. Solo corre en la sesión del padre orquestador.
3. **Observación Pasiva:**  
   Los listeners de `tool_execution_*` son de solo lectura; no bloquean ni alteran las herramientas.
4. **Lecturas Engram sin Locks:**  
   Engram opera vía daemon HTTP local (`:7437`) y SQLite en modo WAL, permitiendo lecturas concurrentes instantáneas sin riesgo de bloqueos.

---

## 4. Comandos e Interfaz

El Centinela expone el comando interactivo `/dc-sentinel`:

* `/dc-sentinel` o `/dc-sentinel status`:  
  Muestra el estado del centinela, sesión activa, turnos auditados, subagentes lanzados y ruta de la bitácora.
* `/dc-sentinel recall <pregunta>`:  
  Prueba en caliente el motor de recuperación semántica contra Engram y muestra qué recuerdos activaría para esa consulta.

---

## 5. El Subagente `dc-sentinel`

Además de la extensión reactiva, el archivo `agents/dc-sentinel.md` define al subagente especializado para consultas analíticas profundas:
* *"¿Qué se hizo en este proyecto el mes pasado?"*
* *"¿Por qué decidimos no usar switches action para las herramientas?"*
* *"Mostrame los errores principales que tuvimos al migrar a Pi 0.99"*.

El subagente consulta `docs/chronicle/` y la memoria de Engram (`mem_search`, `mem_get_observation`) y genera un informe estructurado.
