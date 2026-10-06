# 15 - Claude-Mem: Matriz Ortogonal y la Directiva When to Skip

- **Fuente:** Repositorio oficial `thedotmack/claude-mem` (TypeScript/Node.js).
- **URL:** https://github.com/thedotmack/claude-mem

---

## 1. Resumen y Disciplina de Prompts
Claude-Mem es un sistema de compresión de memoria para Claude Code, OpenCode y OMP con más de 15.000 estrellas. Sus prompts de extracción son de los más disciplinados de la industria.

## 2. Hallazgos Clave
- **Matriz Ortogonal (9 Tipos + 7 Conceptos):**
  - 9 Tipos con glifos: `⚖` Decisión, `●` Bugfix, `◆` Feature, `↻` Refactor, `○` Discovery, `✓` Change, `⚠` Alerta de seguridad, `⚷` Nota de seguridad, `⊘` Sensible.
  - 7 Conceptos de razonamiento: `how-it-works`, `why-it-exists`, `what-changed`, `problem-solution`, `gotcha`, `pattern`, `trade-off`.
- **Directiva "When to Skip":**
  Filtra bucles de reintentos idénticos. Si una operación ya fue registrada en la sesión, emite `<skip_summary reason="noise" />` y no gasta tokens.
- **Regla "No Pronouns":**
  Hechos atómicos redactados sin pronombres ("él", "esto"), obligando a nombrar archivos, funciones y valores exactos.
- **Modelo ACT-R de Activación Cognitiva:**
  Ponderación por recencia + frecuencia de consulta.
- **Métrica de Tokens Ahorrados:**
  Contador visual de cuántos tokens de lectura ahorró la memoria en la sesión.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Los 9 tipos con sus glifos visuales y los 7 conceptos para la ventana TUI.
- El filtro `<skip_summary reason="noise" />` para bucles de terminal.
- Regla "Sin pronombres" en la redacción de hechos.
- Contador de tokens ahorrados en el pie de la ventana.
