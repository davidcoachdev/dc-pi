# Arquitectura, Directivas y Primitivas UI (`dc-pi`)

**Ecosistema:** DC Studio (`dc-pi`)  
**Alcance:** `src/core/`, `src/ui/`, `src/integrations/`, `themes/`  

Esta guía documenta los cimientos arquitectónicos de `dc-pi`: las 10 Directivas Obligatorias, el sistema de ventanas y componentes TUI (`src/ui/`), la máquina reactiva de estados del agente (`src/core/`) y la capa de integraciones de bajo nivel (`src/integrations/`).

---

## 1. Las 10 Directivas Obligatorias de DC Studio

Todo código en `dc-pi` se rige por 10 reglas arquitectónicas estrictas:

| # | Directiva | Regla de Ingeniería |
| :--- | :--- | :--- |
| **1** | **Desacoplamiento por Feature** | Prohibido el código monolítico. Cada feature en `src/features/<feature>/` separa `core/` (lógica pura sin imports de Pi/TUI), `views/` (componentes visuales), `tools/` (herramientas LLM), `<feature>.ts` (entrypoint) e `index.ts` (barril público). |
| **2** | **Persistencia Aislada (Blast Radius Cero)** | Prohibido un JSON global único. Cada feature persiste su estado en `~/.pi/agent/dc-studio/<feature>.json` usando `resolveDcConfigPath("<feature>")` con migración transparente desde rutas legadas. |
| **3** | **Test Scoping (Ejecución Enfocada)** | Durante el desarrollo se compila con `tsc` y se corre únicamente el test del módulo tocado (`node --test .test-build/test/<feature>.test.js`). La suite completa (360+ tests) se ejecuta al cerrar la entrega. |
| **4** | **Servicio Unificado de Notificaciones** | Prohibido invocar `ctx.ui.notify` directamente. Se utiliza siempre `dcNotifier.notify(ctx, title, msg, level)` para garantizar envío a sockets de Herdr, fallback toast en Pi y seguridad en modo headless/subagentes (`ctx.hasUI === false`). |
| **5** | **Repositorio Único y Git Seguro** | Nunca trabajar directo sobre `master`/`main`. Crear rama por feature/fix y mergear únicamente con `--no-ff`. |
| **6** | **Cero Polling Ciego (Event-Driven)** | Prohibido usar `setInterval` para espiar el layout o el transcript de Pi. Todo cambio responde a eventos (`AgentVisualStateStore`, `process.stdout.on("resize")`, hooks de Pi). |
| **7** | **Ciclo de Vida Anti-Zombis** | Todo timer de animación (`setInterval` / `setTimeout`) debe invocar `.unref?.()` al crearse y limpiarse en `destroy()` / `dispose()` al desmontar el componente. |
| **8** | **Blindaje contra Bucles de Layout** | Las envolturas de nodos de layout (`[LAYOUT_NODE]`) se controlan con símbolos globales (`Symbol.for("dc.body.framed")`) y memoización en `WeakMap` para evitar recursión infinita. |
| **9** | **Aislamiento durante Desarrollo** | Las pruebas se validan en frío con `npm test` y en caliente efímero con `pi -e /ruta/a/dc-pi/src/index.ts`. |
| **10** | **Ecosistema de Recursos Integrado** | Los temas (`./themes`) y skills (`./skills`) viven versionados dentro del repositorio y declarados en el manifiesto `"pi"` de `package.json`. |

---

## 2. Primitivas UI (`src/ui/`)

`dc-pi` proporciona un toolkit de componentes sobre `@earendil-works/pi-tui` diseñado con estética retro DOS/Cyberpunk y soporte completo de ratón y teclado.

### Catálogo de Componentes UI

| Componente | Archivo | Responsabilidad Principal |
| :--- | :--- | :--- |
| **`DcWindow`** | `src/ui/dc-window.ts` | Ventana de terminal con marcos simples (`┌─┐`) o dobles (`╔═╗`), barra de título arrastrable (*drag-to-move*), botón de cierre `[X]` con hitbox exacto, scroll por teclado/rueda, scrollbar retro interactivo (`▲ ░ █ ▼`) y pie de ventana con acción clicable a la derecha. |
| **`openDcModal<T>`** | `src/ui/dc-modal.ts` | Orquestador de modales sobre `ctx.ui.custom()`. Garantiza bloqueo de exclusividad (*single-modal lock*), cierre idempotente, auto-invocación de `destroy()`/`dispose()` sobre el contenido al cerrar, y cálculo dinámico de altura (`maxHeight` en `%` o función). |
| **`DcCard`** | `src/ui/dc-card.ts` | Tarjeta con bordes redondeados (`╭─╮` / `╰─╯`), cabecera con icono/título, badge derecho interactivo y modo colapsable. |
| **`DcSidebarCard`** | `src/ui/dc-sidebar-card.ts` | Variante especializada de tarjeta con marco doble (`╔═╗`) para las secciones apiladas del sidebar de DC Studio. |
| **`DcTabs`** | `src/ui/dc-tabs.ts` | Barra de navegación por pestañas con selección por clic de ratón, atajos numéricos y ciclado con `Tab` / flechas. |
| **`DcSearchInput`** | `src/ui/dc-search-input.ts` | Campo de búsqueda interactivo con ventana deslizante (*sliding window*) para textos largos, cursor visual y limpieza rápida con `Esc`. |
| **`DcProgressBar`** | `src/ui/dc-progress-bar.ts` | Barra de progreso ANSI personalizable con animación de spinner (`.unref?.()` + `destroy()`) y porcentaje. |
| **`DcCollapsible`** | `src/ui/dc-collapsible.ts` | Contenedor desplegable (`▸` / `▾`) para agrupar ítems secundarios (ej. unidades de la Flota de Taxis o métricas de Engram en el sidebar). |
| **`justifyRow`** | `src/ui/dc-row.ts` | Formateador de filas a dos columnas (izquierda/derecha) que respeta códigos de escape ANSI y trunca sin romper secuencias de color. |
| **`DcVStack`** | `src/ui/dc-vstack.ts` | Contenedor de apilamiento vertical ligero para componer paneles complejos. |
| **`DcText`** | `src/ui/dc-text.ts` | Primitiva de texto enriquecido con soporte de truncado seguro en ancho visible. |

### Ejemplo de Uso: Abrir un Modal con `openDcModal`

```typescript
import { openDcModal } from "dc-pi";

await openDcModal<void>(ctx, {
  title: "Mi Herramienta DC Studio",
  glyph: "⛩ ",
  frame: "double",
  width: "80%",
  maxHeight: "80%",
  footer: {
    left: " [↑/↓] Navegar  [Enter] Seleccionar ",
    right: " [Esc] Cerrar ",
  },
  content: (close, theme, tui) => new MiPanelInteractivo({ theme, onClose: () => close() }),
});
```

---

## 3. Estado Reactivo y Ejecución (`src/core/`)

| Módulo | Archivo | Descripción |
| :--- | :--- | :--- |
| **`AgentVisualStateStore`** | `src/core/dc-agent-state/dc-agent-state.ts` | Máquina de estados reactiva que escucha los eventos del ciclo de vida de Pi (`session_start`, `agent_start`, `turn_start`, `tool_execution_start`, `agent_settled`, `agent_end`, `auto_compaction_start`, `auto_retry_start`). Expone estados (`idle`, `thinking`, `working`, `writing`, `speaking`, `compacting`, `retrying`, `dormant`, `permission`, `question`) y transiciona automáticamente a `dormant` tras 30s de inactividad sin usar polling continuo. |
| **`resolveDcConfigPath`** | `src/core/dc-paths.ts` | Resuelve rutas de configuración en `~/.pi/agent/dc-studio/<feature>.json`. Si detecta un archivo legado en `~/.pi/agent/dc-<feature>.json`, migra su contenido automáticamente sin pérdida de datos. |
| **`executeSlashCommand`** | `src/core/dc-command-executor.ts` | Ejecutor programático de comandos slash (`/mcp`, `/dc-models`, etc.). Captura limpiamente la instancia activa de `InteractiveMode` e invoca el handler registrado en `extensionRunner` o delega a `session.prompt()`. |

---

## 4. Capa de Integraciones (`src/integrations/`)

Servicios transversales que conectan `dc-pi` con el sistema operativo, multiplexores de terminal, servidores proxy y Git:

| Integración | Archivo | Capacidades |
| :--- | :--- | :--- |
| **`dcNotifier`** | `src/integrations/dc-notify/dc-notifier.ts` | Servicio unificado de notificaciones. Detecta si corre dentro de **Herdr** (vía variables de entorno o socket UNIX) para emitir notificaciones nativas de escritorio/multiplexor, y cae graciosamente a `ctx.ui.notify` en Pi interactivo. Incluye parches (`dc-core-patches.ts`, `dc-resources-patch.ts`, `dc-text-patch.ts`) que interceptan advertencias de arranque y anuncios de changelog de Pi para redirigirlos limpiamente al panel `/dc-status` sin ensuciar el chat. |
| **`dcClipboard`** | `src/integrations/dc-clipboard/dc-clipboard.ts` | Cliente portapapeles multiplataforma. Soporta secuencias ANSI **OSC 52** (terminales remotas/SSH), Wayland (`wl-copy`), X11 (`xclip`, `xsel`), macOS (`pbcopy`) y Windows/WSL (`clip.exe`). |
| **`CliProxyClient`** | `src/integrations/dc-cliproxy/dc-cliproxy-client.ts` | Cliente HTTP para **CLIProxyAPI (CPAM)**. Resuelve la URL base y la clave de administración (`managementKey`), consulta archivos de autenticación y obtiene el estado de cuotas en tiempo real de las cuentas conectadas. |
| **`fetchJson`** | `src/integrations/dc-http/dc-fetch.ts` | Cliente HTTP resiliente con soporte de `AbortSignal`, timeouts configurables (`DcHttpTimeoutError`), manejo tipado de errores HTTP (`DcHttpError`) y sanitización de query params sensibles (`api_key`, `token`, `secret`) en logs y mensajes de error. |
| **`dc-git`** | `src/integrations/dc-git/dc-git.ts` | Motor de consultas Git basadas en `execFileSync` con timeouts defensivos: parseo de `git status --porcelain`, listado de `git worktree`, extracción de diffs por archivo (incluyendo archivos untracked contra `/dev/null`), historial de grafo (`git log --graph`) y detalle de commits. |
| **`dc-herdr-agent-state`** | `src/integrations/dc-herdr-agent-state/dc-herdr-agent-state.ts` | Puente en tiempo real que sincroniza el estado del agente de Pi con los indicadores visuales de pestañas y paneles del multiplexor Herdr. |
| **`dc-no-telemetry`** | `src/integrations/dc-no-telemetry/dc-no-telemetry.ts` | Guardián de privacidad que fuerza `PI_TELEMETRY=0` en el entorno y limpia flags de telemetría/tracking en `~/.pi/agent/settings.json` al iniciar sesión. |

---

## 5. Temas Oficiales (`themes/`)

Declarados en `package.json` bajo `"pi": { "themes": ["./themes"] }`:

1. **`dc-sangre.json` (`DC Sangre`)**: Tema insignia de DC Studio con paleta oscura profunda y acentos rojo carmesí/sangre (`#ff3333`, `#8c3c50`).
2. **`dc-studio.json` (`DC Studio`)**: Variante equilibrada de alto contraste para sesiones prolongadas de programación.
3. **`dc-robo.json` (`DC Robo`)**: Estética cyber-industrial con acentos neón fríos y grises metálicos.
