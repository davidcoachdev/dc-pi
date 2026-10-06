# 03 - Hindsight: Motor de Memoria Biomimético y Multi-Estrategia

- **Fuente:** Plataforma y documentación oficial `hindsight.vectorize.io`.
- **Benchmark:** 94.6% en LongMemEval-S, 92.0% en LoCoMo.
- **URL:** https://hindsight.vectorize.io/

---

## 1. Resumen y Filosofía
Hindsight demuestra que la búsqueda vectorial simple (RAG tradicional) es insuficiente para agentes. Construye un motor sobre PostgreSQL/SQLite que extrae hechos tipados, conecta un grafo de 4 dimensiones y ejecuta búsquedas paralelas fusionadas por rango.

## 2. Hallazgos Clave
- **Taxonomía Formal de Hechos:**
  - `World Fact`: Hecho objetivo externo.
  - `Experience Fact`: Acción en primera persona del propio agente.
  - `Observation`: Creencia consolidada respaldada por pruebas (`proof_count`) y citas.
  - `Mental Model`: Resumen curado para consultas frecuentes.
  - `Knowledge Page`: Documento vivo proyectado en disco.
- **Búsqueda Paralela Cuádruple (`recall`):**
  Ejecuta 4 búsquedas simultáneas: Semántica (vectores) + Keyword (BM25 exacto para símbolos) + Grafo (entidades a 2 saltos) + Temporal (distribución por ventanas de tiempo).
- **Fusión RRF y Token Budget:** Fusiona con Reciprocal Rank Fusion ($k=60$) y re-rankea con Cross-Encoder. Corta los resultados por presupuesto estricto de tokens (`max_tokens`), nunca por número arbitrario de resultados (`top-k`).
- **Reconciliación Evolutiva:** Captura el viaje de las contradicciones (ejemplo: usuario que pasa de React a Vue).
- **Memory Defense (45 Regex):** Escáner preconstruido que censura API keys, tokens de GitHub/AWS/Slack y credenciales de BD.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- La distinción formal entre `World Facts` y `Experience Facts`.
- Búsqueda híbrida (BM25 para símbolos técnicos + semántica) cortada por `token_budget`.
- Filtro de seguridad Memory Defense con los 45 patrones regex antes de escribir a disco.
- Reconciliación evolutiva de decisiones (registrar el motivo del cambio, no solo la nueva verdad).
