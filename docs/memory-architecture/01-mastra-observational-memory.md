# 01 - Mastra: Observational Memory (OM)

- **Fuente:** Repositorio oficial `mastra-ai/mastra` & Paper de Tyler Barnes (Feb 9, 2026).
- **Benchmark:** 94.87% en LongMemEval con `gpt-5-mini`, 84.23% con `gpt-4o`.
- **URL:** https://mastra.ai/research/observational-memory

---

## 1. Resumen y Arquitectura
Mastra rechaza tanto el RAG dinámico por turno (que destruye el prompt cache) como la compactación ciega monolítica (que resume cuando el contexto ya reventó). Introduce **Observational Memory**, un sistema biomimético con dos subagentes en segundo plano:
1. **Observer:** Monitorea la conversación activa. Cuando los mensajes superan un umbral de tokens (~30k), los transforma en un log denso de observaciones estructuradas y descarta el historial crudo ruidoso.
2. **Reflector:** Cuando las observaciones acumuladas superan un segundo umbral (~40k), condensa, desduplica y reorganiza el log de observaciones, eliminando datos superados y descubriendo patrones transversales.

## 2. Hallazgos Clave
- **Prefijo Append-Only y Prompt Caching:** La memoria vive al inicio del context window como un log que solo agrega elementos al final. El prefijo del prompt se mantiene estable entre turnos, permitiendo tasas de acierto de prompt cache de 4x a 10x más baratas.
- **Compresión Agresiva de Herramientas (5x a 40x):** Los resultados de herramientas (lecturas de archivos, volcados de terminal, búsquedas) sufren una compresión extrema al convertirse en observaciones atómicas.
- **Memory Hooks (`beforeObservation`, `afterObservation`, `beforeReflection`, `afterReflection`):** Interceptores del ciclo de vida. Destaca `skillResultRedactor()`, que reemplaza el volcado de archivos de skills (`SKILL.md`) por placeholders (`[Skill loaded: ...]`), evitando quemar miles de tokens en re-observar instrucciones.
- **Saneamiento de Mensajes:** Procesadores como `trailing-assistant-guard` y `provider-history-compat` limpian turnos huérfanos y evitan fallos HTTP 400.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Motor en dos fases (Observer en caliente + Reflector en reposo).
- El hook `skillResultRedactor()` para que la lectura de skills en Pi no contamine la bitácora.
- Saneamiento previo del transcript para evitar errores de API al alternar modelos.
- Inyección como prefijo ordenado para preservar el prompt cache en Pi.
