# 09 - ReMe: Memory as File y Memoria de Procedimientos (ACL 2026)

- **Fuente:** Repositorio `agentscope-ai/ReMe` & Paper de Findings of ACL 2026: *"Remember Me, Refine Me: A Dynamic Procedural Memory Framework for Experience-Driven Agent Evolution"*.
- **URL:** https://github.com/agentscope-ai/ReMe

---

## 1. Resumen y Filosofía
ReMe defiende la soberanía absoluta de los datos con el lema: **"Memory as File, File as Memory"**. La memoria a largo plazo vive en archivos Markdown comunes con frontmatter y wikilinks (`[[link]]`). Cualquier base de datos o índice es estado derivado reconstruible.

## 2. Las Cuatro Capas de Memoria
```text
source records -> session/ + resource/ (chat crudo sin ruido de tools)
working memory -> daily/               (mesa de trabajo del día)
long memory    -> digest/              (conocimiento permanente)
system state   -> metadata/            (índices SQLite/BM25 reconstruibles)
```

## 3. La Memoria de Procedimientos (`digest/procedure/*.md`)
El mayor aporte de ReMe es formalizar la **Memoria de Procedimientos**:
- A diferencia de los hechos descriptivos, registra **runbooks ejecutables paso a paso** para solucionar errores repetitivos o ejecutar flujos complejos.
- Cada procedimiento incluye: síntomas, prerrequisitos, pasos de comando y criterio de verificación.

## 4. Qué adoptamos en DC Studio (`dc-sentinel`)
- **Soberanía "Memory as File":** Los Markdown en `docs/chronicle/` y `docs/live/` son la fuente de verdad inmutable versionada en Git.
- **Carpeta de Procedimientos:** Incorporar `docs/live/procedures/*.md` para registrar recetas de solución de bugs recurrentes.
- **Wikilinks nativos (`[[...]]`)** para enlazar notas entre sí.
