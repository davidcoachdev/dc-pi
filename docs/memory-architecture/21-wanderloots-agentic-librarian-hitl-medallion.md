# 21 - The Agentic Librarian: Gobernanza HITL y Arquitectura Medallion (Wanderloots)

- **Fuente:** Video de Callum (*Wanderloots*): *"What Is An Agentic Librarian? 🧠 Full Hermes & Obsidian Workflow (HITL)"*.
- **Concepto Rector:** La Arquitectura Medallion (Bronze ➔ Silver ➔ Gold) aplicada a la memoria para erradicar el envenenamiento de datos (*Memory Poisoning*).
- **URL:** https://www.youtube.com/watch?v=_bieksxg6oY

---

## 1. El Problema Crítico: Memory Poisoning (Envenenamiento de Memoria)
Cuando un agente tiene permiso para escribir directamente de las fuentes crudas a la base de conocimiento permanente (de Bronze a Gold directo), **una sola alucinación o contradicción inventada por el modelo contamina la memoria para siempre**. En sesiones futuras, todos los agentes leerán esa información falsa como si fuera una verdad histórica del proyecto.

## 2. La Solución: La Arquitectura Medallion en Memoria
```text
  [BRONZE LAYER]  Fuentes crudas (transcripts, diffs de git, logs de terminal).
        │
        ▼ (La IA genera propuestas, NO modifica la wiki directamente)
  [SILVER LAYER]  Bandeja de Propuestas / Review Inbox (HITL - Human-in-the-Loop).
        │         • El desarrollador inspecciona, aprueba o descarta.
        ▼ (Solo lo aprobado pasa a la base limpia)
  [GOLD LAYER]    Conocimiento Permanente Verificado (docs/live/ y SQLite local).
```

## 3. Los Tres Caminos de Evolución
1. **Path 1 (Raw-to-Gold directo):** Peligroso; no hay validación humana.
2. **Path 2 (Review Companion Skill):** Intercepta las observaciones y las guarda en una carpeta `proposals/`.
3. **Path 3 (The Agentic Librarian con Tooling Determinista):**
   - El Bibliotecario Agéntico no es un prompt suelto: es un flujo gobernado por código y herramientas.
   - **Pre-flight check:** Comprueba qué existe en la base antes de proponer cambios.
   - **Decision Studio:** Interfaz interactiva donde el usuario aprueba (`[a]`) o rechaza (`[r]`) con un clic o tecla.
   - **Commits atómicos de Git:** Cada aprobación humana dispara un commit en Git como punto de restauración inmediato.

## 4. Qué adoptamos en DC Studio (`dc-sentinel`)
- **Capa Silver (Bandeja de Propuestas en Sentinel):** Cuando Sentinel consolida decisiones de arquitectura o nuevas reglas, las marca como `[🟡 PROPUESTA]` en la ventana TUI.
- **Aprobación Interactiva en la Ventana Modal:** En `openSentinelViewer`, el desarrollador puede presionar `a` para aprobar (promover a Gold) o `d` para descartar, garantizando que ninguna alucinación contamine la memoria del repositorio.
- **Rollback con Git:** Cada promoción a Gold se acompaña de un guardado trazable.
