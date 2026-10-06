# 12 - Anthropic Claude Managed Agents: Memory Stores & Dreams

- **Fuente:** Documentación oficial de Anthropic (`agent-memory-2026-07-22` & `dreaming-2026-04-21`).
- **URL:** https://platform.claude.com/docs/en/managed-agents/memory | https://platform.claude.com/docs/en/managed-agents/dreams

---

## 1. Resumen y Visión Oficial
Es la especificación oficial de Anthropic para persistencia entre sesiones en agentes gestionados.

## 2. Hallazgos Clave
- **Aislamiento Multi-Store con Permisos de Filesystem:**
  Permite montar hasta 8 almacenes como directorios en `/mnt/memory/<slug>/`:
  - Almacén de Directivas (`read_only`): Reglas inviolables protegidas contra prompt injection.
  - Almacén de Proyecto (`read_write`): Notas de la tarea activa.
- **Garantía Inmutable de "Dreams":**
  El proceso de *Dreaming* toma el almacén existente y transcripciones pasadas para consolidar duplicados y contradicciones, pero **NUNCA modifica el almacén de entrada in-place**. Produce un nuevo almacén de salida para que el humano lo revise y decida si lo adopta.
- **Cap de 100 kB por Archivo:** Regla explícita de estructurar la memoria como muchos archivos pequeños y enfocados en vez de un solo monolito gigante.
- **Versionado Inmutable:** Cada cambio genera un `memory_version_id` auditable.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Separación estricta entre directivas de DC Studio (solo lectura) y notas de sesión (lectura y escritura).
- Consolidaciones profundas generadas como propuestas de actualización sin pisar el histórico.
- Límite de tamaño por nota atómica (archivos modulares).
