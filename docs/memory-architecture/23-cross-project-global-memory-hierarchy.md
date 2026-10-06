# 23 - Cross-Project Global Memory Hierarchy (Ámbitos Jerárquicos)

- **Propósito:** Compartir decisiones arquitectónicas, gotchas y runbooks de tecnologías entre proyectos sin contaminar rutas de archivos privadas.
- **Ámbitos:** `Scope Local (Proyecto)` vs. `Scope Global (Tecnología)` vs. `Scope Personal (Desarrollador)`.

---

## 1. El Problema del Aislamiento Extremo
Si la memoria es 100% local al repositorio, cuando un desarrollador crea un nuevo proyecto con Next.js, el agente vuelve a cometer los mismos errores que ya se resolvieron en proyectos anteriores. Sin embargo, si se comparte todo a ciegas, se contaminan los prompts con rutas privadas (`src/components/MyNavbar.tsx`) que no existen en el nuevo proyecto.

## 2. La Solución: Ámbitos Jerárquicos en DC Studio
```text
  [PROYECTO LOCAL]        Rutas privadas, variables de negocio, endpoints locales.
         │
         ▼ (Proceso de Graduación / Descontextualización)
  [GLOBAL TECNOLOGÍAS]    Gotchas y patrones de frameworks (#nextjs, #bun, #vitest).
         │
         ▼
  [PERSONAL DESARROLLADOR] Preferencias de estilo, directivas inmutables y voseo.
```

## 3. El Algoritmo de Descontextualización ("Graduación" con [g])
Cuando una lección aprendida en un proyecto local se promueve a nivel global:
1. Se eliminan las rutas absolutas y nombres de componentes privados del proyecto origen.
2. Se extrae la **Regla Técnica Universal** (ej. *"En Next.js 15, `params` en Server Components es una promesa que requiere `await`"*).
3. Se almacena en el Hub local de DC Studio: `~/.pi/agent/dc-studio/knowledge/technologies/<tech>.md`.

## 4. Detección Automática de Stack en Proyectos Nuevos
Al inicializar un proyecto nuevo (`package.json`, `Cargo.toml`, etc.):
- Sentinel detecta las dependencias activas (`next`, `vitest`, `tailwind`).
- Precarga en el Memory Pack efímero los gotchas globales correspondientes.
- El agente inicia la sesión con experiencia acumulada previa, evitando errores conocidos.
