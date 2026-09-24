---
name: dc-pi-architecture
description: "Trigger: dc-pi, refactorizar dc-pi, dc-studio, arquitectura dc, extensiones dc, migrar a dc-pi, directivas dc. Las 10 directivas estrictas de arquitectura, modularidad, persistencia y rendimiento del ecosistema DC Studio."
license: MIT
metadata:
  author: dc-studio
  version: "1.0"
---

# Las 10 Directivas Obligatorias de DC Studio (dc-pi)

Aplica estrictamente estas directivas en todo trabajo sobre `/home/dc-studio/dc-lab/dc-projects/dc-pi`.

## 1. Desacoplamiento Estricto por Feature (`src/features/<feature>/`)
- Prohibido código monolítico. Descomponer cada feature en capas con responsabilidad única:
  - `core/` o `tokens`: Tipos, interfaces, constantes, fórmulas y formateadores puros. Cero imports de Pi o pi-tui.
  - `views/` o `renderers`: Clases y funciones de dibujo visual (`DcWindow`, cards, gutters, marcos).
  - `<feature>.ts`: Entrypoint exclusivo (comandos `/`, atajos `Alt+...`, hooks de ciclo de vida).
  - `index.ts`: Barril público que exporta la API limpia hacia `src/index.ts`.

## 2. Persistencia Aislada en `~/.pi/agent/dc-studio/` (Blast Radius Cero)
- Prohibido el monolito JSON compartido. Cada feature tiene su archivo independiente en `~/.pi/agent/dc-studio/<feature>.json`.
- Rutas resueltas exclusivamente con `resolveDcConfigPath("<feature>")` de `src/core/dc-paths.ts`.
- Migración transparente: si existe un JSON viejo en `~/.pi/agent/dc-<feature>.json`, se copia al nuevo destino automáticamente sin perder datos.

## 3. Ejecución Enfocada de Pruebas (Test Scoping)
- Durante desarrollo/refactorización, compilar con `tsc` y correr **únicamente** la prueba unitaria del archivo tocado:
  `cd /home/dc-studio/dc-lab/dc-projects/dc-pi && npm run build && node --test .test-build/test/<feature>.test.js`
- Prohibido correr la suite global completa en cada paso intermedio. La suite completa (200+ tests) solo se corre al cerrar la entrega final.

## 4. Servicio Unificado de Notificaciones
- Prohibido llamar directamente a `ctx.ui.notify` en código nuevo o refactorizado.
- Usar siempre `dcNotifier.notify(ctx, ...)` para integrar con sockets de Herdr y fallback visual nativo de Pi.

## 5. Repositorio Único y Git Seguro
- Único destino de escritura: `/home/dc-studio/dc-lab/dc-projects/dc-pi`.
- `lab-cofig-pi` queda estrictamente congelado como snapshot histórico de solo lectura.
- Prohibido hacer `git commit`, `git push`, reset o mutaciones destructivas en Git sin autorización expresa del usuario.

## 6. Cero Polling Ciego (Event-Driven Reactive State)
- Terminantemente prohibido el uso de `setInterval` para espiar el layout de Pi, detectar cambios de transcript o chequear dimensiones de pantalla.
- Todo cambio visual o de estado debe ser reactivo por eventos: `AgentVisualStateStore`, hooks de Pi (`session_start`, `model_select`, etc.) o eventos de layout de `pi-tui`.

## 7. Ciclo de Vida Limpio de Timers y Memoria (Anti-Zombis)
- Toda animación o pulso visual (`pulseMs`, parpadeo de cursores, KITT, Pacman):
  1. Debe invocar `.unref?.()` inmediatamente al instanciarse para no dejar colgado el proceso de Node al salir.
  2. Debe exponer y ejecutar un método `dispose()` que limpie intervalos y timeouts al desmontar el componente o cerrar la ventana.

## 8. Blindaje contra Re-envolturas y Bucles de Layout (`BODY_FRAMED` & `WeakMap`)
- Prohibido comparar referencias directas de funciones de layout (`root[LAYOUT_NODE] === wrapperFn`).
- Toda envoltura estructural debe controlarse mediante símbolos globales (`Symbol.for("dc.body.framed")`) y registrarse en `WeakMap` para memoizar componentes y preservar su identidad estable entre renders, evitando recursiones infinitas.

## 9. Aislamiento durante Desarrollo (Sin Instalar Globalmente)
- Mientras se desarrolle o refactorice en `dc-pi`, NO se toca la instalación global ni los scripts de `~/.pi/agent/extensions/`.
- Validación en 2 fases:
  1. En frío: Tests unitarios locales simulados (`npm test`).
  2. En caliente efímero: `pi -e /home/dc-studio/dc-lab/dc-projects/dc-pi` (en memoria para esa sesión de prueba, sin tocar `settings.json`).

## 10. Ecosistema de Temas Integrado
- Los temas retro de DC Studio (Rojo Sangre insignia y secundarios) deben vivir versionados dentro de `dc-pi/themes/`.
- Declarados formalmente en `package.json` del paquete (`"pi": { "themes": ["./themes"] }`), eliminando los JSONs huérfanos sueltos en `~/.pi/agent/themes/`.
