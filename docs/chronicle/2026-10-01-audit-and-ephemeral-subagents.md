# Registro de Vuelo: Auditoría Profunda de Performance y Arquitectura de Subagentes Efímeros

- **Fecha:** 2026-10-01 19:55 (Hora Local)
- **Autor / Orquestador:** el Gentleman & DC Studio
- **Proyecto:** DC Pi (`dc-pi`)
- **Etiquetas:** `#auditoria` `#performance` `#subagentes-efimeros` `#antigravity` `#engram` `#srp` `#sentinel`

---

## 1. Intención Original del Usuario
El usuario solicitó:
1. Una auditoría profunda a `dc-pi`, `gentle-pi` y `pi` para identificar cómo mejorar el performance general.
2. Mantener la soberanía de `dc-pi` sin borrar sus herramientas propias (CodeGraph por binario, Context7 SDK, YouTube yt-dlp, CDP Browser, etc.) ni subordinarse ciegamente a `gentle-pi`.
3. Adoptar el paradigma de **Subagentes Virtuales / Efímeros de una sola vida** (estilo Antigravity / Fresh Context Loop) para aislar herramientas y evitar polución de contexto.
4. Generar documentación canónica en `docs/` (y `doc/`).
5. Crear un subagente Guardián de Bitácora (`dc-sentinel`) con memoria histórica en Engram que documente qué se pidió, qué se respondió, qué se hizo mal y qué decisiones se tomaron para facilitar retomar el proyecto dentro de 6 meses o más.

---

## 2. Decisiones Técnicas Clave y Justificación

### Decisión 1: No fusionar herramientas en switches artificiales (`action: ...`)
- **Motivo:** Preservar el Principio de Responsabilidad Única (SRP). Las herramientas atómicas son más fáciles de testear, evolucionar y auditar de forma independiente.
- **Alternativa Descartada:** Unificar las 35 herramientas en 9 fachadas con parámetros discriminadores `action`. Se descartó porque oscurece el SRP y acopla funciones no relacionadas.

### Decisión 2: Adopción del Patrón Antigravity (Subagentes Efímeros de Contexto Virgen)
- **Motivo:** Resolver el problema del "Tool Bloat" (7.000 a 10.000 tokens de overhead en el prompt principal) sin tocar el código de las herramientas.
- **Mecanismo:** El orquestador principal se mantiene liviano; cuando se requiere una tarea especializada (ej. YouTube o Browser), se dispara un subagente efímero que nace con un contexto virgen (Fresh Context Loop), usa exclusivamente las herramientas necesarias, entrega un Contrato de Artefacto y se destruye inmediatamente.

### Decisión 3: Erradicación del Polling Ciego (`setInterval`) en la UI
- **Motivo:** Cumplir con la Directiva 6 de DC Studio (`dc-pi-architecture`).
- **Puntos Críticos:** Eliminar los intervalos de 300 ms en `dc-body.ts` y de 1.000 ms en `dc-sidebar-host.ts`, reemplazándolos por eventos reactivos (`session_start`, resize de terminal y comandos directos).

### Decisión 4: Sistema de Bitácora Dual (Local Git + Memoria Semántica en Engram)
- **Motivo:** Proporcionar trazabilidad inmediata y legible por humanos en Markdown (`docs/chronicle/`), combinada con búsqueda semántica y recuperación por topic keys en el daemon de Engram (`:7437`).

---

## 3. Subagentes y Herramientas Evaluadas
- **CodeGraph:** Confirmada la superioridad del motor nativo en `dc-codegraph-engine.ts` que ejecuta el binario local por `execFileAsync` con buffer seguro de 10 MB y saneamiento de secretos con `redactSecrets`.
- **Context7:** Confirmada la integración directa con `@upstash/context7-sdk`.
- **Subagentes DC:** Mapeados los 9 subagentes existentes (`dc-news-to-day`, `dc-phase-*`, `dc-researcher`, `dc-ui-visual-inspector`, `dc-smoke-subagent`).

---

## 4. Qué Se Detectó Mal y Lecciones Aprendidas (Post-Mortem Técnico)

1. **El Malentendido de Carga de Herramientas en Pi:**
   - *Error de suposición inicial:* Asumir que Pi cargaba dinámicamente las herramientas solo cuando se invocaban.
   - *Realidad descubierta:* Pi registra todas las herramientas con `pi.registerTool()` en el catálogo global y las inyecta todas juntas en el System Prompt en cada turno.
   - *Lección:* Para no saturar el prompt, las herramientas no deben registrarse masivamente en el agente padre; deben vivir en subagentes o activarse bajo demanda.

2. **Bloqueo Síncrono de Procesos Pesados:**
   - *Error detectado:* `spawnSync("yt-dlp", ["--version"])` y llamadas a `espeak-ng` en caliente dentro de funciones de chequeo de disponibilidad.
   - *Consecuencia:* Congelamiento del hilo de Node.js durante 1.5 a 4.5 segundos por llamada.
   - *Solución:* Implementar memoización en memoria para que el chequeo de binarios se realice una única vez por sesión.

3. **Conflicto de Layout entre Gentle Shell y DC Pi:**
   - *Problema:* Ambos paquetes compitiendo por envolver `layoutRoot` y modificar barras inferiores y editores, generando re-renders redundantes.
   - *Solución:* Fronteras claras de responsabilidad visual.

---

## 5. Próximos Pasos Inmediatos
- [x] Crear documentación de arquitectura en `docs/dc-subagents-and-performance-architecture.md` (con enlace `doc -> docs`).
- [x] Crear el primer registro de vuelo en `docs/chronicle/2026-10-01-audit-and-ephemeral-subagents.md`.
- [ ] Crear la definición del subagente `dc-sentinel` en `agents/dc-sentinel.md`.
- [ ] Registrar `dc-sentinel` en `subagents.json`.
- [ ] Registrar observación persistente en Engram mediante `mem_save`.
