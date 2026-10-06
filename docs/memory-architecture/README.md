# Arquitectura de Memoria Unificada de DC Studio: Sentinel 2.0

> **Soberanía tecnológica total, cero vendor lock-in y máxima disciplina de ingeniería.**

Este directorio documenta la síntesis definitiva de los 18 repositorios, papers y conferencias de memoria para agentes de IA analizados para construir el motor de **`dc-sentinel`** en **`dc-pi`**.

---

## Índice de Documentos de Referencia

1. [Mastra: Observational Memory y Prompt Caching](./01-mastra-observational-memory.md)
2. [Zep vs. Mem0: Desmitificando Benchmarks y la Falla del Asistente](./02-zep-vs-mem0-longmemeval.md)
3. [Hindsight: Motor de Memoria Biomimético y Multi-Estrategia](./03-hindsight-memory-engine.md)
4. [Zettelkasten: Notas Atómicas y la Regla de los 10 Años (Rubén Loan)](./04-zettelkasten-atomic-notes-ruben-loan.md)
5. [La Metáfora del Metro: Visualización y Conectividad (Emowe)](./05-subway-map-visual-knowledge-emowe.md)
6. [OpenHuman: Memory Pack Efímero y Memory Chips en UI](./06-openhuman-ephemeral-pack-chips.md)
7. [Codebase-Memory MCP: Grafo Estructural y Blast Radius](./07-codebase-memory-mcp-ast-blast-radius.md)
8. [GBrain: Gap Analysis y el Ciclo de Sueño (Garry Tan)](./08-gbrain-gap-analysis-dream-cycle.md)
9. [ReMe: Memory as File y Memoria de Procedimientos (ACL 2026)](./09-reme-memory-as-file-procedural.md)
10. [ai-memory: Resumen Zero-LLM y Protocolo de Handoff (Fabio Akita)](./10-ai-memory-akita-zero-llm-handoff.md)
11. [Persistent AI Memory (PAM v2.0): Task Coordinator e Idle Heartbeat](./11-persistent-ai-memory-pam-coordinator.md)
12. [Anthropic Claude Managed Agents: Memory Stores & Dreams](./12-anthropic-claude-managed-memory-dreams.md)
13. [Why LLM Wiki: El Patrón Karpathy y Separación de Bóvedas (Wanderloots)](./13-wanderloots-why-llm-wiki-karpathy.md)
14. [Cómo Construir un LLM Wiki en Obsidian (Wanderloots)](./14-wanderloots-how-to-build-llm-wiki-obsidian.md)
15. [Claude-Mem: Matriz Ortogonal y la Directiva When to Skip](./15-claude-mem-orthogonal-matrix-skip.md)
16. [TencentDB Agent Memory: Auto-Skills y Guardas de Seguridad](./16-tencentdb-agent-memory-auto-skills-guards.md)
17. [pi-persistent-memory: Motor Nativo en Node.js SQLite y Leases](./17-j0k3r-pi-persistent-memory-node-sqlite-leases.md)
18. [Memvid: Smart Frames Inmutables y Time-Travel Debugging](./18-memvid-smart-frames-time-travel.md)
19. [Mem0: Nuevo Algoritmo (Abril 2026) y Single-Pass ADD-Only](./19-mem0-single-pass-add-multi-signal.md)
20. [Cavemem: Compresión Determinista Offline y Privacidad](./20-cavemem-deterministic-compression-privacy.md)
21. [The Agentic Librarian: Gobernanza HITL y Arquitectura Medallion (Wanderloots)](./21-wanderloots-agentic-librarian-hitl-medallion.md)
22. [Improved AI Memory: El Stack BEAM y Memoria Operativa (Wanderloots)](./22-wanderloots-improved-memory-beam-stack.md)
23. [Cross-Project Global Memory Hierarchy (Ámbitos Jerárquicos)](./23-cross-project-global-memory-hierarchy.md)
24. [Mecánicas Internas de Engram: Reimplementación Nativa Soberana](./24-engram-mechanics-reimplemented-natively.md)

---

## Los 4 Pilares de la Arquitectura de Sentinel 2.0

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   DC SENTINEL (EL SISTEMA UNIFICADO DE DC STUDIO)                │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 1. INGESTA QUIRÚRGICA & HIGIENE (Mastra + Akita + CMem + Tencent + j0k3r + Cavemem)│
│    • Compresión Determinista Offline de Prosa (40%-75% ahorro sin LLM, Cavemem). │
│    • Límite de Privacidad `<private>...</private>` en la frontera (Cavemem).     │
│    • Extracción Single-Pass ADD-Only: un solo pase rápido sin UPDATE/DELETE (Mem0)│
│    • Resumen base a costo $0 sin LLM (Akita).                                    │
│    • Expiración y TTL automático (`expiration_date`) para notas efímeras (Mem0). │
│    • Inyección efímera: "The pack never enters the transcript" (OpenHuman).      │
│    • Filtro de ruido: `skillResultRedactor()` (Mastra) + `skip_summary` (CMem).  │
│    • Memory Defense: 45 regex para purgar credenciales (Hindsight).             │
│    • Subagent Lease Protocol: sesiones limpias para subagentes (j0k3r).          │
│    • Techo de 6 KiB por respuesta y guardián de inyección (Tencent + j0k3r).     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 2. ESTRUCTURA Y SOBERANÍA (ReMe + Zettelkasten + Hindsight + Karpathy + Wander) │
│    • Topic Keys evolutivos (`topic_key`) con `revision_count` y `last_seen_at`.  │
│    • Deduplicación matemática por `normalized_hash` y `duplicate_count`.         │
│    • FTS5 con `tokenize='trigram'` para subcadenas de código y variables.       │
│    • Motor de relaciones semánticas (`supersedes`, `conflicts_with`, Engram).   │
│    • Partición biológica BEAM: Working, Scratchpad, Episodic, Semantic (Wander). │
│    • Arquitectura Medallion (Bronze ➔ Silver/Proposals ➔ Gold Verificado).       │
│    • "Memory as File": Markdown en Git es la verdad, SQLite local es caché.      │
│    • 3 Carpetas físicas: raw/ (inmutable), wiki/ (destilado), schema/ (contrato).│
│    • 5 Tipos (World vs Experience) + 9 Glifos + 7 Conceptos de razonamiento.     │
│    • Regla de los 10 años y "Sin Pronombres": hechos atómicos autocontenidos.    │
│    • Memoria de Procedimientos (recetas de fixes) + Auto-Skills (ReMe + Tencent).│
│    • Reconciliación evolutiva de decisiones (React ➔ Fastify).                   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 3. INTELIGENCIA DE CÓDIGO & ESTADO (Codebase-Mem + GBrain + PAM + Akita + Memvid)│
│    • Blast Radius automático en el AST sobre git diff (Codebase-Mem).            │
│    • Mutación quirúrgica de ADRs con `set_sections` (Codebase-Mem).              │
│    • Gap Analysis: advertencia de conocimiento frío en módulos viejos (GBrain).  │
│    • Dream Cycle en reposo con Idle Heartbeat y mutex SQLite (GBrain + PAM).     │
│    • Protocolo de Handoff entre sesiones con `dc-handoff` (Akita).               │
│    • Smart Frames y Time-Travel para rebobinar decisiones pasadas (Memvid).      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 4. VENTANA TUI INTERACTIVA EN dc-pi (Emowe + OpenHuman + j0k3r + Wanderloots)   │
│    • Mapa de Metro: Líneas temáticas de colores con transbordos interactivos.    │
│    • Memory Chips en pantalla con botón [d] para olvidar recuerdos en vivo.      │
│    • Visor de tres colores: 🟢 Raw, 🔵 Wiki, 🟠 Schema.                          │
│    • Navegación Time-Travel con [← / →] para inspeccionar fotogramas pasados.    │
│    • Contador en vivo de tokens ahorrados (`discovery_tokens`).                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Política de Soberanía y Blast Radius (Directivas 2 y 5 de DC Studio)

1. **Cero Dependencias Externas:** No dependemos de daemons en Go, servidores en la nube ni paquetes de terceros privativos. El motor corre en TypeScript nativo embebido en `dc-pi` con `node:sqlite`.
2. **Persistencia Aislada:** Los datos de runtime se almacenan en `~/.pi/agent/dc-studio/sentinel-<proyecto>.db`.
3. **Soberanía en Git:** La documentación viva y la bitácora residen en `docs/chronicle/` y `docs/live/` del repositorio, legibles por humanos y sincronizables sin herramientas propietarias.
