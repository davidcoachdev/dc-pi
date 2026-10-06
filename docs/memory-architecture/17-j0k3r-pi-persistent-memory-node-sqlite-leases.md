# 17 - pi-persistent-memory: Motor Nativo en Node.js SQLite y Leases

- **Fuente:** Repositorio `j0k3r-dev-rgl/j0k3r-pi` (`extensions/pi-persistent-memory`).
- **Compatibilidad:** 100% nativo para `@earendil-works/pi-coding-agent` y `pi-tui`.

---

## 1. Resumen y Arquitectura
Es la única extensión de memoria persistente desarrollada en TypeScript puro exclusivamente para el runtime de Pi, sin intermediarios ni daemons externos.

## 2. Hallazgos Clave
- **Persistencia Nativa con `node:sqlite` (`DatabaseSync`):**
  Usa el módulo SQLite integrado en Node.js con modo WAL, `foreign_keys = ON` y `busy_timeout = 5000`. Cero dependencias externas.
- **Subagent Invocation Lease Protocol (`lease.ts`):**
  Gestiona la identidad de memoria cuando se lanzan subagentes en Pi (`memory:invocation:bind:v1`). Si el subagente termina sin crear recuerdos de valor, purga su sesión vacía automáticamente para no acumular basura.
- **Techo Rígido de 6 KiB por Salida de Tool:**
  Ninguna herramienta de memoria puede devolver más de 6.144 bytes UTF-8, protegiendo el context window con paginación stateless segura.
- **Renderizado Nativo en la TUI de Pi (`renderShell: 'self'`):**
  Línea colapsable compacta en cian (`#87cefa`) con soporte de clics de mouse y tecla de expansión de tools de Pi.
- **Grafo Local en SQLite:** 5 entidades y 6 relaciones con traversal BFS limitado a 2 saltos y 20 nodos (<1ms).

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Persistencia local en SQLite nativo con WAL dentro de `~/.pi/agent/dc-studio/`.
- Protocolo de leasing para subagentes efímeros de DC Studio.
- Techo de 6 KiB por consulta de herramienta.
- Componente de renderizado en terminal colapsable e interactivo.
