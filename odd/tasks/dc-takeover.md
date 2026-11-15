# dc-takeover: Modal interactivo de Takeover Humano

Feature document for ODD. Read `## Specs` and the assigned task only, then act.

## Specs

**S1.** Crear `src/features/dc-takeover/` con arquitectura estándar de feature:
- `core/dc-takeover-types.ts`: Tipos canónicos del takeover.
- `views/dc-takeover-modal.ts`: Panel y ventana interactiva TUI retro (`openDcTakeoverModal`).
- `tools/dc-takeover-tools.ts`: Tool `dc_takeover_request` registrada para subagentes y orquestador.
- `dc-takeover.ts` e `index.ts`: Punto de entrada y exportaciones.

**S2.** Contrato de Takeover (`TakeoverRequest` / `TakeoverOutcome`):
- `TakeoverOutcome`: `"continued"` | `"retry"` | `"aborted"`
- `TakeoverRequest`:
  - `id`: identificador único de la solicitud
  - `title`: Título de la solicitud (ej. "Autenticación 2FA requerida", "Intervención física en Celular")
  - `reason`: Razón detallada de por qué se requiere intervención humana
  - `suggestedAction`: Qué debe hacer exactamente el usuario (ej. "Ingresá el PIN en el dispositivo y tocá Continuar")
  - `timeoutMs`?: Tiempo máximo opcional antes de abortar por inactividad
  - `createdAt`: timestamp

**S3.** Interfaz del Modal (`views/dc-takeover-modal.ts`):
- Montado sobre `openDcModal` y `DcWindow` con theme responsivo y padding retro.
- Renderiza el título en negrita/color de advertencia, el mensaje de razón, y la acción sugerida.
- 3 botones seleccionables por teclado (Flechas Izquierda/Derecha, Tab, Enter) y clickeables por mouse:
  1. `[Continuar]`: El usuario ya completó la acción manual; el agente continúa (`continued`).
  2. `[Reintentar]`: El usuario pide que el agente repita el paso anterior (`retry`).
  3. `[Abortar / Cancelar]`: Se cancela la tarea (`aborted`).
- Tecla `Escape` equivale a `aborted`.

**S4.** Herramienta `dc_takeover_request`:
- Tool invocable por agentes (`mobile-controller`, `dc-researcher`, subagentes o scripts).
- Parámetros: `title: string`, `reason: string`, `suggestedAction: string`.
- Abre el modal interactivo de forma asíncrona, bloquea la herramienta hasta que el usuario decida, y retorna:
  `{ outcome: "continued" | "retry" | "aborted", note?: string }`.
- Si `ctx.hasUI` es falso (ej. headless/CI), devuelve `aborted` con nota explicativa sin crashear.

**S5.** Integración en `src/index.ts`:
- Registrar `dcTakeoverExtension(pi)` en el ciclo de extensiones de dc-pi.

**S6.** Cobertura determinista en `test/dc-takeover.test.ts`:
- Pruebas unitarias de navegación por teclado (Enter, Flechas, Tab, Escape).
- Pruebas de selección por mouse (hitboxes).
- Pruebas de ejecución de la tool `dc_takeover_request`.

## Tasks

- T1 — core & types: `src/features/dc-takeover/core/dc-takeover-types.ts`. Cubre S1, S2. **DONE**
- T2 — views: `src/features/dc-takeover/views/dc-takeover-modal.ts` con teclado y mouse. Cubre S3. **DONE**
- T3 — tools & entry: `src/features/dc-takeover/tools/dc-takeover-tools.ts`, `dc-takeover.ts`, `index.ts`. Cubre S1, S4, S5. **DONE**
- T4 — wiring: registrar en `src/index.ts`. Cubre S5. **DONE**
- T5 — tests: `test/dc-takeover.test.ts` probando modal, teclado, mouse y tool. Cubre S6. **DONE**
- T6 — documentación: actualizada en `skills/dc-mobile-testing/SKILL.md` y `README.md`. Cubre S1-S6. **DONE**

## Log

- L1 (verbatim, orden del dueño): «respuesta 1.-si, 2.- dc-taskeover» -> 3 botones: [Continuar], [Reintentar], [Abortar]; ubicado en módulo dedicado `dc-takeover`.
- L2 (motivación): Habilita al agente móvil y agentes de escritorio/navegador a ceder el control al humano ante CAPTCHAs, 2FA, huella dactilar o validaciones físicas, y reanudar con exactitud según la respuesta del usuario.
- L3 (frontera de la rebanada): el commit inicial mide 647 líneas añadidas. Se mantiene atómico porque el panel visual, la tool, los contratos de tipos, la integración en index y los 9 tests forman una sola unidad indivisible de feature.
