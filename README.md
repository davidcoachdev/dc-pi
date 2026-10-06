# DC Studio — Pi TUI Suite (`dc-pi`)

Comprehensive TUI enhancement suite and windowing system for [Pi](https://github.com/earendil-works/pi-coding-agent).

*Suite integral de mejoras visuales, ventanas retro, componentes modulares y extensiones para el agente de codificación Pi.*

---

## Architecture / Arquitectura

The `dc-pi` ecosystem is organized into four modular layers:

### 1. Core UI Primitives (`src/ui/`)
- **`DcWindow`**: Terminal window component built on `@earendil-works/pi-tui`. Features classic DOS single (`│ ─ ┌ ┐`) and double (`║ ═ ╔ ╗`) border frames, title bar drag-to-move, mouse wheel & keyboard scrolling, interactive retro scrollbar (`▲ ░ █ ▼`), and click-to-close button `[X]`.
- **`openDcModal<T>()`**: Dynamic modal helper that mounts custom content inside a centered or movable `DcWindow` using Pi's `ctx.ui.custom()`, handling idempotent closing and non-TUI fallbacks.

### 2. Core State (`src/core/`)
- **`AgentVisualStateStore`**: Reactive state machine capturing Pi agent lifecycle events (`session_start`, `agent_start`, `agent_settled`, `agent_end`, tool executions) to drive visual indicators across the suite (`idle`, `thinking`, `working`, `dormant`, etc.).

### 3. Integrations (`src/integrations/`)
- **`dcClipboard`**: Multiplatform clipboard client supporting Wayland (`wl-copy`), X11 (`xclip`/`xsel`), macOS (`pbcopy`), Windows (`clip.exe`), and OSC 52 ANSI escape sequences.
- **`fetchJson<T>()`**: Resilient HTTP client with timeouts, abort signals, payload size limits, and sensitive credential redaction.
- **`CliProxyClient`**: API client for CLIProxy auth files, management endpoints, and quota status.
- **`dcNotifier` / `notifyHerdr`**: Unified notification service bridging Herdr socket notifications with automatic Pi toast fallback (`ctx.ui.notify`).
- **`getGitChanges` / `parseGitStatus`**: Git status porcelain parser and diff extractor.

### 4. Features & Extensions (`src/features/` & `src/experimental/`)
- **38+ modular extensions** delivering rich interactive dialogs, status monitors, retro editors, visual decorators, background supervisors, developer tools, and workflow enhancements.

---

## Documentation Hub / Manuales Técnicos

Complete reference guides for every subsystem in `dc-pi`:

| Guide | Scope |
| :--- | :--- |
| **[01 — Architecture, Directives & UI Primitives](./docs/01-architecture-and-ui-primitives.md)** | The 10 Mandatory Directives, `DcWindow`, `openDcModal`, `DcCard`, `AgentVisualStateStore`, `dcNotifier`, and themes (`dc-sangre`, `dc-studio`, `dc-robo`). |
| **[02 — Extensions & Tools Catalog](./docs/02-extensions-catalog.md)** | Complete reference of all **38+ extensions**, slash commands, keyboard shortcuts, isolated persistence paths (`~/.pi/agent/dc-studio/`), and **38 LLM tools**. |
| **[03 — Subagents, Taxi Fleet & Lego System](./docs/03-agents-taxis-and-lego-system.md)** | The **10 fixed subagents** (`agents/*.md`), **8 ephemeral archetypes**, composable **Tool Bricks** & **Behavior Bricks**, and the multi-process **Taxi Fleet** (`dc-taxis.json`). |
| **[04 — Skills Reference](./docs/04-skills-reference.md)** | Catalog of the **12 bundled DC Studio skills** (`skills/`), activation triggers, planned workflow contracts, and E2E testing guides. |
| **[08 — DC Sentinel Guardian](./docs/08-dc-sentinel-autonomous-guardian.md)** | Flight log recorder (`docs/chronicle/`) and automatic Pre-Flight Engram memory recall. |
| **[Performance & Subagents Architecture](./docs/dc-subagents-and-performance-architecture.md)** | Deep dive into Zero-Polling UI, Fresh Context Loop, and Context Window optimization. |

---

## Commands and Shortcuts / Comandos y Atajos

All extensions are unified under the canonical `dcStudioExtension` entrypoint.

| Command | Shortcut | Description (ES / EN) | Feature Module |
| :--- | :--- | :--- | :--- |
| `/dc-caritas` | `Alt+Shift+C` | Selector interactivo de kaomojis con inserción en editor / Interactive kaomoji picker | `dc-caritas` |
| `/dc-faces` / `/dc-perfil` | `Alt+C` | Duelo de perfiles de usuario (`dcdev` vs `cubis`) / Profile duel switcher | `dc-faces` |
| `/dc-keys` | `Alt+?` | Visor interactivo y buscador de atajos de teclado / Keyboard shortcuts catalog | `dc-keys` |
| `/dc-changes` | `Alt+F` | Visor a 2 columnas de cambios git y diffs / Two-column Git diff & changes viewer | `dc-changes` |
| `/dc-models` | `Alt+M` | Selector a 3 columnas de modelos, cuentas y reasoning effort / Model & effort selector | `dc-models` |
| `/dc-quota` | `Alt+Shift+Q` | Monitor interactivo de cuotas y tokens de CLIProxy / Token quota dashboard | `dc-quota` |
| `/dc-status` | `Alt+E` | Auditor de entorno, branch git y alertas / Environment & Git auditor with copyable alerts | `dc-status` |
| `/dc-banner` | — | Logo en arte ASCII con gradiente Blood al inicio / Startup Blood gradient ASCII shield | `dc-banner` |
| `/dc-user` | `Alt+N` | Configuración y persistencia del nombre de usuario / User nickname config & switcher | `dc-user` |
| `/dc-title` | — | Renombra pestañas/ventanas en Herdr, Tmux y terminal / Rename active tab or window | `dc-title` |
| `/dc-exit` | — | Limpieza completa de pantalla en shutdown real (preserva reloads) / Clean screen on quit | `dc-exit` |
| `/dc-preview` | `Alt+Shift+V` | Lanzador de vistas previas externas (nvim, fzf, yazi) / External preview launcher | `dc-preview` |
| `/dc-doctor` | — | Diagnóstico e inspección del árbol de nodos de layout / Layout tree node inspector | `dc-doctor` |
| `/dc-face` | — | Animador de kaomojis en el indicador de actividad / Animated kaomoji working indicator | `dc-face-anim` |
| `/dc-reload` | `F5` | Recarga en caliente extensiones, atajos, prompts y temas / Hot-reload Pi environment | `dc-reload` |
| `/dc-tool-box` | — | Enmarca bloques de herramientas en cards redondeadas con copiado / Tool execution cards | `dc-tool-box` |
| `/dc-user-box` | — | Enmarca prompts del usuario en cards redondeadas con copiado / User message cards | `dc-user-box` |
| `/dc-markdown` | — | Bloques de código con iconos Nerd Font y cajas redondeadas / Styled code blocks & markdown | `dc-markdown` |
| `/dc-sidebar` | `Alt+Shift+B` | Marco retro, auditor de tokens y control del sidebar / Sidebar frame & context monitor | `dc-sidebar` |
| `/dc-prompt` | — | Editor de prompt DOS marco doble con línea de estado / Retro DOS prompt editor | `dc-prompt` |
| `/dc-dialogs` | — | *(Experimental)* Enmarca diálogos nativos de Pi en `DcWindow` / Modal overlay wrapper | `dc-dialogs-overlay` |
| `/dc-taxis` | `Alt+Shift+T` | Flota de Taxis, arriendo de cuentas y monitoreo de tokens / Taxi Fleet manager | `dc-agents` |
| `/agents` / `/dc-agents` | `Alt+A` | Visor interactivo de subagentes y ejecuciones / Subagents and task executions viewer | `dc-agents` |
| `/git-graph` / `/dc-git-graph` | `Alt+H` | Visor visual de historial y diffs de Git / Visual Git commit graph & diff explorer | `dc-git-graph` |
| `/owasp` / `/dc-owasp` | `Alt+O` | Catálogo oficial de seguridad OWASP y auditoría / OWASP security explorer & auditor | `dc-owasp` |
| `/dc-sentinel` | `Alt+Shift+S` | Visor de turnos de sesión y recall de memoria / Sentinel session turns & recall viewer | `dc-sentinel` |
| `/plan` / `/odd` | `Alt+T` | Visor interactivo de planificación ODD y tareas / ODD plan & tasks viewer | `dc-plan` |
| `/dc-services` | — | Supervisor de servicios y procesos en background / Background services manager | `dc-services` |
| `/dc-browser` | — | Estado y control de Chrome DevTools Protocol / Chrome CDP status & controls | `dc-browser` |
| `/dc-checkpoint` | — | Snapshot del worktree (`diff.patch` + `restore.sh`) / Worktree checkpoint snapshot | `dc-checkpoint` |
| `/dc-handoff` | — | Nota de handoff en `.pi/handoff.md` para reanudar / Handoff resume note generator | `dc-handoff` |
| `/dc-engram` / `/dc-enroll` | `Alt+Shift+G` | Visor de memorias y enrolamiento en Engram / Engram persistent memory explorer | `dc-engram` |
| `/body-frame` | — | Activa o desactiva el marco doble del área de chat / Toggle double-line chat body frame | `dc-body` |
| `/dc-codegraph` | — | Estado del índice AST de CodeGraph / CodeGraph AST index status | `dc-codegraph` |
| `/dc-websearch` | — | Estado de motores de búsqueda técnica / Technical websearch status | `dc-websearch` |
| `/dc-context7` | — | Estado de integración con Context7 SDK / Context7 documentation SDK status | `dc-context7` |
| `/dc-api` | — | Estado de herramientas REST, Swagger y GraphQL / API testing tools status | `dc-api` |
| `/dc-pdf` | — | Estado del extractor de documentos PDF / PDF text extractor status | `dc-pdf` |
| `/dc-youtube` | — | Diagnóstico de `yt-dlp` y transcripciones / YouTube & WEBVTT tools status | `dc-youtube` |
| `/dc-audio` | — | Diagnóstico del sintetizador de voz TTS / Local TTS audio synthesizer status | `dc-audio` |
| `/dc-git-sync` | — | Auditoría de sincronización de rama contra upstream / Git upstream sync auditor | `dc-git-sync` |

---

## Specialized LLM Tools / Herramientas Especializadas para Agentes

| Tool | Description |
| :--- | :--- |
| `dc_ephemeral_agent_run` | Ejecuta subagentes efímeros de un solo uso con Fresh Context Loop y arriendo de cuentas taxi. |
| `dc_owasp_query` | Consulta directivas y snippets de seguridad de OWASP Cheat Sheets. |
| `dc_owasp_audit` | Audita código fuente o git diffs contra vectores OWASP (SQLi, XSS, TLS, Secrets). |
| `dc_browser_*` | Automatización de navegador vía Chrome CDP (navegación, capturas PNG, evaluación JS). |
| `dc_services_*` | Control de procesos en background definidos en `.pi/services.json` (start, stop, logs, status). |
| `dc_codegraph_*` | Análisis estático, AST y resolución de referencias de código fuente. |
| `dc_pdf_extract` | Extracción estructurada de texto y metadatos de documentos PDF. |
| `dc_youtube_*` | Descarga de subtítulos WEBVTT y análisis de videos de YouTube. |
| `dc_audio_*` | Limpieza de markdown para síntesis de voz y renderizado de audio WAV vía TTS. |
| `dc_web_*` / `dc_github_*` | Búsqueda web segura (anti-SSRF), foros técnicos (SO/Reddit/HN), código en GitHub y papers. |
| `dc_context7_*` | Búsqueda y extracción de documentación oficial actualizada vía Context7 SDK. |
| `dc_api_*` | Pruebas de endpoints REST, parseo de esquemas Swagger/OpenAPI y consultas GraphQL. |

---

## Bundled Subagents, Skills & Themes / Subagentes, Skills y Temas

- **10 Bundled Subagents (`agents/`)**: `dc-researcher`, `dc-news-to-day`, `dc-sentinel`, `dc-ui-visual-inspector`, `dc-pr-comment-analyst`, `dc-smoke-subagent`, and the 4 planned-workflow phase agents (`dc-phase-discovery`, `dc-phase-planning`, `dc-phase-apply`, `dc-phase-verify`).
- **8 Ephemeral Archetypes (`dc_ephemeral_agent_run`)**: `odd-scout`, `odd-worker`, `odd-verifier`, `dc-researcher`, `dc-media`, `dc-browser-inspector`, `dc-service-ops`, `dc-smoke` + 10 composable **Tool Bricks** and 6 **Behavior Bricks**.
- **12 Bundled Skills (`skills/`)**: `dc-pi-architecture`, `dc-pi-extension-authoring`, `dc-anti-overengineering`, `dc-planned-workflow`, `dc-artifact-contracts`, `dc-project-documentation`, `dc-e2e-testing`, `acceptance-contract`, `qa-human-recipe`, `ui-visual-inspector`, `pr-review-triage`, `dc-tech-intel-briefing`.
- **3 Retro Themes (`themes/`)**: `dc-sangre` (flagship crimson/blood dark theme), `dc-studio`, and `dc-robo`.

---

## Installation / Instalación

### Option 1: Install as a Pi package / Instalar como paquete de Pi
Run inside Pi or from your shell:

```bash
pi install /home/dc-studio/dc-lab/dc-projects/dc-pi
```

### Option 2: Load via CLI flag / Cargar temporalmente con bandera CLI
Launch Pi with the entrypoint loaded directly:

```bash
pi -e /home/dc-studio/dc-lab/dc-projects/dc-pi/src/index.ts
```

### Option 3: Programmatic usage as a library / Uso como biblioteca
Import UI components or specific feature extensions in your custom Pi extensions:

```typescript
import {
  DcWindow,
  openDcModal,
  AgentVisualStateStore,
  dcClipboard,
  dcModelsExtension,
} from "dc-pi";
```

---

## Development & Verification / Desarrollo y Verificación

Requires **Node.js >=22.19.0**. Development dependencies pin `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to version `0.85.1`.

```bash
cd /home/dc-studio/dc-lab/dc-projects/dc-pi

# Typecheck source and tests
npm run typecheck

# Build and run comprehensive automated test suite
npm test
```
