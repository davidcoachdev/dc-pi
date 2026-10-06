# 02 - Zep vs. Mem0: Desmitificando Benchmarks y la Falla del Asistente

- **Fuente:** Paper de investigación de Zep: *"Lies, Damn Lies, & Statistics: Is Mem0 Really SOTA in Agent Memory?"* (Daniel Chalef & Preston Rasmussen).
- **Benchmark:** LongMemEval (115k tokens promedio por conversación) vs. LoCoMo (16k-26k tokens).

---

## 1. Resumen y Controversia
Zep analiza las debilidades de los benchmarks de juguete como LoCoMo, donde el simple contexto completo (*full-context*) superaba a los sistemas de memoria dedicados (72.9% vs 68.4% de Mem0). En cambio, en LongMemEval se estresan verdaderas conversaciones largas con cambios de estado temporal.

## 2. Hallazgos Críticos y el "Punto Ciego" del Asistente
- **La Caída en `single-session-assistant` (-17.7%):**
  Al auditar el desglose por categorías de preguntas, mientras Zep mejoraba la memoria del usuario (+14.1%) y el razonamiento temporal (+38.4%), **empeoraba drásticamente la memoria de lo que el asistente había dicho o programado (de 94.6% a 80.4%)**.
  *Causa:* Los sistemas de memoria se obsesionaban con recordar al usuario y podaban o descartaban las respuestas y el código generado por el propio agente. En programación, si el agente olvida qué función escribió hace 5 turnos, rompe contratos y reescribe código en bucle.
- **Atribución de Actores:** Mem0 falló al asignar rol `user` a ambos participantes, rompiendo el grafo de identidades.
- **Timestamps de Primer Orden:** Incrustar fechas en prosa libre destruye el razonamiento temporal; deben ser campos estructurados (`created_at`).
- **Knowledge Updates:** La memoria debe invalidar estados superados cuando una verdad cambia en el tiempo.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- **Preservación obligatoria de `Experience Facts`:** Sentinel jamás poda el código o decisiones tomadas por el propio asistente.
- **Atribución estricta de 4 actores:** `[USER]`, `[ORCHESTRATOR]`, `[SUBAGENT]`, `[TOOL]`.
- **Timestamps ISO-8601 formales** en cada entrada.
- **Invalidación de verdades previas:** Registrar explícitamente cuándo una regla o decisión técnica reemplaza a una anterior.
