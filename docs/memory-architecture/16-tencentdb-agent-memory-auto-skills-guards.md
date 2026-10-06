# 16 - TencentDB Agent Memory: Auto-Skills y Guardas de Seguridad

- **Fuente:** Repositorio oficial `TencentCloud/TencentDB-Agent-Memory`.
- **URL:** https://github.com/TencentCloud/TencentDB-Agent-Memory

---

## 1. Resumen y Arquitectura Enterprise
Framework de memoria desarrollado por Tencent Cloud para equipos de agentes, diseñado para compartir experiencia entre múltiples modelos y herramientas.

## 2. Hallazgos Clave
- **Jerarquía L0 a L3:**
  - L0: Conversación cruda.
  - L1: Hechos atómicos.
  - L2: Escenario y contexto de tarea.
  - L3: Doctrina permanente del equipo.
- **Auto-Skills (`SkillExtractor`):**
  Cuando un agente supera un problema técnico complejo, el sistema analiza la secuencia exitosa de tool calls y **sintetiza automáticamente una Skill reutilizable (`SKILL.md`)** con versión, disparadores y pasos de ejecución.
- **Guardián de Inyección `<SYSTEM_CUSTOM_STRATEGY_GUARD>`:**
  Envuelve cualquier bloque de memoria inyectado con una cláusula de máxima prioridad: las reglas y directivas del arnés ganan incondicionalmente sobre cualquier recuerdo previo.
- **Integración Nativa con Pi:**
  Plugin oficial para Pi (`pi-plugin`) mediante `pi.registerProvider` e inyección de headers de contexto.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- **Auto-Skills:** Convertir soluciones técnicas complejas superadas en archivos ejecutables `SKILL.md`.
- **Etiqueta de guardia de inyección:** Blindar la memoria efímera para que nunca rompa las directivas de DC Studio.
