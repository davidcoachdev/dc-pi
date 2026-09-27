# DC Skills Registry & Sync (`dc-skills`) — Especificación de Integración

**Módulo:** `src/features/dc-skills/`  
**Ecosistema:** DC Studio (`dc-pi`)  
**Inspiración:** Resolución de skills por intención de `j0k3r-pi/extensions/skill-registry` combinado con sincronización idempotente de DC Studio.

---

## 1. Visión y Propósito

Actualmente `dc-pi` cuenta con un directorio `skills/` en la raíz del repositorio, pero las skills no se sincronizan automáticamente hacia el directorio global de Pi (`~/.pi/agent/skills/`), ni existe una herramienta para que el agente consulte dinámicamente qué skill utilizar según la tarea en curso.

`dc-skills` resuelve ambos frentes:
1. **Sincronizador Idempotente Recursivo (`dc-skills-sync`)**: Replica las carpetas de skills hacia `~/.pi/agent/skills/` en el hook `session_start` sin escrituras redundantes.
2. **Registro y Enrutamiento por Intención (`dc_skill_resolve`)**: Expone una herramienta ligera para que el orquestador o subagentes identifiquen qué skills aplican a la tarea actual sin tener que inyectar el contenido de todas las skills en el prompt inicial (ahorro masivo de ventana de contexto).

---

## 2. Arquitectura de Archivos

```
src/features/dc-skills/
├── core/
│   ├── dc-skills-sync.ts       # Copia recursiva idempotente (skills/ -> ~/.pi/agent/skills/)
│   ├── dc-skills-indexer.ts    # Parseo de YAML frontmatter (name, description, triggers)
│   └── dc-skills-matcher.ts    # Algoritmo de scoring por intención y rutas de archivos tocadas
├── tools/
│   └── dc-tool-skill-resolve.ts # Tool dc_skill_resolve para el LLM
├── dc-skills.ts                # Hook session_start y comando /dc-skills
└── index.ts                    # Exportación pública
```

---

## 3. Beneficios Técnicos para DC Studio

- **Zero-touch deployment**: Al clonar o actualizar `dc-pi`, todas las skills de DC Studio quedan inmediatamente activas y disponibles en la máquina.
- **Eficiencia de Contexto**: La tool `dc_skill_resolve` devuelve solo los metadatos y la ruta de la skill adecuada (`SKILL.md`), permitiendo al agente leerla bajo demanda (`read`) en vez de sobrecargar el system prompt.
