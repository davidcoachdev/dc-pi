# 13 - Why LLM Wiki: El Patrón Karpathy y Separación de Bóvedas (Wanderloots)

- **Fuente:** Video de Callum (*Wanderloots*): *"Why LLM Wiki? 🧠 Future Of Knowledge For Agentic AI & Humans"* & Gist de Andrej Karpathy.
- **URL:** https://www.youtube.com/watch?v=n4EVksU_EOs

---

## 1. Resumen y Filosofía
Andrej Karpathy y Callum proponen que el RAG vectorial clásico está roto para conocimiento duradero. La solución es un **LLM Wiki**: una base de archivos Markdown que el agente compila, enlaza y mantiene de forma continua.

## 2. Hallazgos Clave
- **Separación de Bóvedas:**
  - Bóveda Humana: Donde el desarrollador piensa, anota ideas y define requerimientos.
  - Bóveda del Agente: El LLM Wiki que el agente mantiene y consulta automáticamente.
- **El Rol de "Wiki Gardener" (Jardinero de Memoria):**
  El agente no solo agrega texto; periódicamente audita la wiki buscando contradicciones, enlaces rotos y páginas huérfanas para mantener el grafo sano.
- **Triples de Conocimiento para Graph RAG:**
  Conectar entidades mediante relaciones semánticas `[Sujeto] ➔ [Predicado] ➔ [Objeto]` para resolver preguntas complejas de múltiples saltos (*multi-hop*).

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Separar la documentación humana del repositorio de la wiki compilada por Sentinel.
- Rutina periódica de "Jardinería" para reparar enlaces rotos y podar contradicciones.
- Triples semánticos en las notas para navegación lateral.
