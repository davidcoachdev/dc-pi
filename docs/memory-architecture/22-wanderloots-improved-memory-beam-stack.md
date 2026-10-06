# 22 - Improved AI Memory: El Stack BEAM y Memoria Operativa (Wanderloots)

- **Fuente:** Video de Callum (*Wanderloots*): *"Improved AI Memory? 🧠 Full Hermes Tutorial (Mnemosyne & Hindsight)"*.
- **Concepto Rector:** El Stack de Memoria en 3 Niveles y la arquitectura biológica BEAM (Working, Episodic, Semantic, Scratchpad).
- **URL:** https://www.youtube.com/watch?v=R1TNGOZAOZs

---

## 1. El Stack de Memoria en 3 Niveles
Callum aclara que la memoria agéntica no es una sola capa, sino un stack con responsabilidades divididas:
```text
 ┌─────────────────────────────────────────────────────────────┐
 │ 1. CONOCIMIENTO DEL MUNDO (World Knowledge / LLM Wiki)     │
 │    • La verdad duradera del proyecto (Obsidian / docs/live).│
 │    • Permanece entre proyectos, versiones y agentes.       │
 ├─────────────────────────────────────────────────────────────┤
 │ 2. PROVEEDOR DE MEMORIA OPERATIVA (External Provider)       │
 │    • Recuperación bajo demanda en runtime (SQLite local).   │
 │    • Mantiene el contexto magro y ahorra miles de tokens.   │
 ├─────────────────────────────────────────────────────────────┤
 │ 3. MEMORIA ESTÁTICA EMBEBIDA (Built-in Files)               │
 │    • Archivos simples inyectados siempre (soul, user).      │
 │    • Debe mantenerse mínima para no inflar el prompt.       │
 └─────────────────────────────────────────────────────────────┘
```

> **La Prueba del Ácido de Callum:**
> - Si es conocimiento organizado que querés preservar para siempre en el repositorio ➔ **LLM Wiki (`docs/live/`)**.
> - Si es un hecho sobre la tarea activa o cómo resolver el problema actual ➔ **Memoria Operativa de Sentinel**.

---

## 2. La Arquitectura Biológica BEAM (Mnemosyne / Nemesis)
El video detalla el modelo biológico BEAM para memoria local en SQLite de alta velocidad (sub-100ms) sin dependencias pesadas:
1. **Working Memory:** La memoria de trabajo activa del turno (lo que se está procesando ahora).
2. **Scratchpad (Pizarra Efímera):** Variables intermedias, rutas temporales y datos de prueba que se descartan al cerrar la tarea.
3. **Episodic Memory:** Los eventos y experiencias vividas en sesiones pasadas (el histórico cronológico).
4. **Semantic Memory:** Hechos consolidados y relaciones estructuradas (triples Sujeto-Predicado-Objeto).

---

## 3. Desactivar la Inyección Estática para Evitar Duplicación
Callum advierte sobre un error clásico: tener un archivo `memory.md` que se inyecta completo en cada turno y, al mismo tiempo, un sistema de memoria dinámica.
* **El resultado:** Duplicación masiva de información y quema inútil de tokens.
* **La regla:** La memoria estática debe limitarse al perfil de identidad; todo el contexto operativo debe recuperarse **bajo demanda y de forma dinámica**.

---

## 4. Qué adoptamos en DC Studio (`dc-sentinel`)
- **Partición BEAM en `dc-sentinel`:**
  - `Scratchpad`: Pizarra temporal en memoria para la tarea activa (se borra al terminar).
  - `Working`: Contexto del turno actual (Memory Pack efímero).
  - `Episodic`: Crónicas de vuelo de sesiones anteriores (`docs/chronicle/`).
  - `Semantic`: Directivas y decisiones permanentes de arquitectura (`docs/live/`).
- **Eliminación de inyecciones estáticas duplicadas:** Sentinel inyecta solo lo relevante bajo demanda para mantener el prompt cache limpio.
- **Scope Global vs. Local:** Soporte para filtrar recuerdos por proyecto o acceder a lecciones globales del desarrollador.
