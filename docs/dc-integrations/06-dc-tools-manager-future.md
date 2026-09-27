# Plan Futuro: DC Tools Manager / Selector de Componentes Visuales

**Estado:** Planificado para la fase final del ecosistema visual  
**Ubicación de persistencia:** `~/.pi/agent/dc-studio/tools.json`

---

## Requerimiento del Usuario

Crear un modal TUI global (`DcWindow` / selector interactivo) que permita al usuario decidir, componente por componente, si desea utilizar la **versión personalizada de DC Studio** o la **versión nativa/default de Pi**.

### Componentes conmutable:
1. **Banner de bienvenida**: DC Studio Banner (animado/Pacman/KITT) vs Banner nativo de Pi.
2. **Sidebar**: DC Sidebar con cards (Status, Todo, Token Usage) vs Sidebar nativa de Pi.
3. **Selector de Modelos**: DC Models (3 paneles: cuentas, modelos, effort) vs Selector nativo de Pi.
4. **Markdown Renderer**: DC Markdown con badges, streaming mermaid y syntax highlight vs Renderer estándar.
5. **Notificaciones**: DC Notifier (integración Herdr sockets) vs `ctx.ui.notify` nativo de Pi.
6. **Ventanas modales**: `DcWindow` con marcos y glifos `⛩ ` vs Modales estándar.
