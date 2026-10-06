# 07 - Codebase-Memory MCP: Grafo Estructural y Blast Radius

- **Fuente:** Repositorio oficial `DeusData/codebase-memory-mcp` (C puro + Tree-Sitter).
- **Benchmark:** Indexa el kernel de Linux (28M LOC) en 3 minutos. Respuestas estructurales en <1ms. 120x menos tokens que grep.
- **URL:** https://github.com/DeusData/codebase-memory-mcp

---

## 1. Resumen y Arquitectura
A diferencia de los sistemas de memoria conversacionales, `codebase-memory-mcp` es un motor de memoria estructural del código. Parsea el código con Tree-Sitter en 162 lenguajes y construye un grafo de conocimiento de llamadas, imports, rutas HTTP y tipos.

## 2. Hallazgos Clave
- **`detect_changes` + Blast Radius:** Mapea el `git diff` directamente contra el AST y calcula qué funciones, clases y archivos externos quedan afectados por un cambio, asignando un nivel de riesgo.
- **`manage_adr` con `set_sections`:** Permite mutar registros de decisiones arquitectónicas de forma quirúrgica e idempotente por encabezado `##`, sin reescribir todo el documento Markdown.
- **`trace_path` (Call Graph):** Traversal BFS de llamadas para inspeccionar quién invoca a una función y a quién llama esta.
- **Comparación de Grafos (`compare_graphs`):** Compara dos snapshots para detectar adiciones, eliminaciones y código muerto (*dead code*).

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Anotar el **Blast Radius automático** en cada decisión de refactor de la bitácora.
- Edición quirúrgica de secciones en documentos de arquitectura (`set_sections`).
- Visualización de la cadena de llamadas viva en la tarjeta derecha de la ventana TUI.
