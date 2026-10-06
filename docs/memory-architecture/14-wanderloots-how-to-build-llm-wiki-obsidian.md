# 14 - Cómo Construir un LLM Wiki en Obsidian (Wanderloots)

- **Fuente:** Video de Callum (*Wanderloots*): *"How To Build LLM Wiki In Obsidian? 🧠 A Memory Layer For Any Agentic AI"*.
- **URL:** https://www.youtube.com/watch?v=QbjAQFJJyt0

---

## 1. Resumen y Plano de Construcción
Tutorial práctico que detalla la estructura física de archivos, la gobernanza del agente y las herramientas necesarias para operar un LLM Wiki en Obsidian con Git.

## 2. La Estructura de 3 Capas del Vault
```text
.sentinel/
├── raw/     -> Fuentes crudas inmutables (transcripts, logs, diffs).
├── wiki/    -> Conocimiento compilado con wikilinks [[...]].
└── schema/  -> Constitución del agente (agents.md) y templates YAML.
```

## 3. Herramientas Operativas
- **Linter de Memoria:** Script que valida que cada nota respete el frontmatter YAML, que no haya enlaces rotos y que cada hecho cite su fuente en `raw/`.
- **Agentic Firewall:** Restricción de permisos para que el agente jamás pueda salir de su bóveda asignada.
- **Codificación en 3 Colores:**
  - 🟢 Verde: Fuentes crudas (`raw/`).
  - 🔵 Azul: Conocimiento estructurado (`wiki/`).
  - 🟠 Naranja: Contratos y directivas (`schema/`).

## 4. Qué adoptamos en DC Studio (`dc-sentinel`)
- Organización en carpetas: `raw/`, `wiki/` y `schema/`.
- Linter de bitácora para validar integridad de enlaces y metadatos.
- Paleta visual de 3 colores en la ventana TUI de Pi.
