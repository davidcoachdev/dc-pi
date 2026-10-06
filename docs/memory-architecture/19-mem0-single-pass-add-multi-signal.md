# 19 - Mem0: Nuevo Algoritmo (Abril 2026) y Single-Pass ADD-Only

- **Fuente:** Repositorio oficial `mem0ai/mem0` (Y Combinator S24).
- **Benchmark:** Salto de 71.4 a **92.5 en LoCoMo**, y de 67.8 a **94.4 en LongMemEval** (con 98.2 en memoria del asistente).
- **URL:** https://github.com/mem0ai/mem0

---

## 1. Resumen y Evolución del Algoritmo
Mem0 reescribió por completo su algoritmo central de memoria en abril de 2026 tras las críticas de Zep y los benchmarks de LongMemEval. Pasó de un enfoque de búsqueda vectorial ingenua con mutaciones destructivas a un pipeline moderno de alta eficiencia de tokens y latencia sub-segundo (P50: 1.09s).

## 2. Los 5 Cambios Críticos del Nuevo Algoritmo
1. **Extracción "Single-Pass ADD-Only":**
   En vez de hacer múltiples llamadas al LLM para decidir si hacer `ADD`, `UPDATE` o `DELETE`, ejecuta **una sola llamada rápida que solo agrega**. Las memorias se acumulan sin sobreescribir destructivamente el pasado.
2. **Hechos del Agente como Ciudadanos de Primera Clase:**
   Cuando el agente confirma una acción o produce código, esa información se almacena con el mismo peso que las órdenes del usuario, resolviendo el histórico punto ciego de olvido de respuestas del asistente.
3. **Multi-Signal Retrieval Fused:**
   Puntúa en paralelo y fusiona tres señales:
   - Coincidencia semántica vectorial.
   - Búsqueda léxica por palabras clave (BM25).
   - Enlace y boosting de entidades.
4. **Razonamiento Temporal Nativo:**
   Recuperación consciente de fechas que clasifica la instancia temporal correcta para consultas sobre el estado actual vs. eventos pasados.
5. **Memoria de Procedimientos y Fechas de Expiración (`expiration_date` / TTL):**
   Soporte nativo para `memory_type: "procedural_memory"` y caducidad automática de recuerdos efímeros sin intervención manual.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- **Extracción ADD-Only en un solo pase:** Evitar rondas complejas de UPDATE/DELETE en caliente; acumular hechos atómicos de forma rápida y diferir la consolidación al reposo.
- **Soporte nativo de `expiration_date` (TTL):** Poder marcar notas de bitácora temporales (ej. credenciales de prueba o puertos provisionales) con fecha de caducidad automática para que se limpien solas.
- **Puntuación Multi-Señal:** Fusión de BM25 + semántica + entidades en la búsqueda de la bitácora.
