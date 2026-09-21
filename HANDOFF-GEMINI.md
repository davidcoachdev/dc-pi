# Traspaso a Gemini — refactorización DC Pi

## 1. Objetivo y punto exacto de continuación

El usuario quiere convertir su colección personal de extensiones de Pi en un proyecto portable, instalable y eventualmente compartible. La migración es incremental: una pieza por vez, preservando los originales.

**No reinicies la implementación. DcWindow ya está migrado y sus 10 pruebas pasan. El siguiente paso es completar su aceptación visual aislada.** Después, proponé la siguiente migración al usuario; no la des por autorizada automáticamente.

El usuario pide un informe al iniciar y otro al terminar, sin confirmaciones repetidas dentro del alcance autorizado. Pedí decisiones solo ante bloqueos reales o ampliaciones de alcance. Conversación en español. Este documento se escribió en español para facilitar el traspaso solicitado.

## 2. Rutas y reglas de seguridad

- Proyecto nuevo, único destino de cambios: `/home/dc-studio/dc-lab/dc-projects/dc-pi`.
- Repositorio original, solo lectura: `/home/dc-studio/dc-lab/lab-cofig-pi`.
- NO modificar extensiones instaladas, configuración global de Pi ni dependencias globales.
- El `node_modules` del ORIGINAL es un enlace a `/home/dc-studio/.pi/agent/npm/node_modules`: NO instalar a través de él.
- El nuevo proyecto tiene repositorio Git independiente. Su directorio padre cae dentro de un repositorio del HOME: comprobá siempre la raíz antes de operar.
- No hay commits creados en esta tarea. Los archivos nuevos están sin seguimiento; NO usar reset/clean ni asumir que lo untracked es descartable.
- No hay autorización para commits, push, publicación, instalación global ni elección de licencia.
- La copia en `original/` conserva la referencia; no la reformatees ni la refactorices.
- No lanzar escritores simultáneos sobre el mismo árbol.
- Cada comando de shell debe empezar con `cd /home/dc-studio/dc-lab/dc-projects/dc-pi && ...`. La terminal del agente anterior estaba en el ORIGINAL y dos verificaciones fallaron por no cambiar el cwd.
- El índice CodeGraph disponible estaba asociado al ORIGINAL, no al proyecto nuevo. No uses sus resultados como prueba de archivos de dc-pi.

## 3. Lectura inicial, en orden

1. Este documento.
2. `README.md`: instalación local, limitaciones, receta completa de prueba manual aislada.
3. `odd/tasks/dc-window-migration.md`: tareas y evidencia.
4. `migration/registry.md`: procedencia y estado.
5. `src/ui/dc-window.ts`, `examples/dc-window-demo.ts`, `test/dc-window.test.ts`.
6. `package.json`, `tsconfig.json`, `.gitignore` cuando necesites trabajar con herramientas.

Auditorías anteriores opcionales, solo lectura, en el original:
- `auditoria-astra-2026-09-18.md`.
- `auditoria-individual-extensiones-2026-09-18.md`.

Las auditorías orientan; no reemplazan inspeccionar el código actual y los contratos públicos.

## 4. Qué existe y qué se implementó

- `src/ui/dc-window.ts`: exportación reutilizable de DcWindow; sin factory de extensión ni registro global al importar.
- `examples/dc-window-demo.ts`: demo opt-in que registra `/dc-window-demo`.
- `test/dc-window.test.ts`: 10 pruebas con `node:test`, incluyendo integración simulada de la demo.
- `original/dc-window.ts` y `original/SHA256SUMS`: snapshot y checksum.
- `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`: herramientas y dependencias locales.
- `README.md`, `migration/registry.md`, `odd/tasks/dc-window-migration.md`: documentación real existente.

Correcciones implementadas:
1. `handleMouse` usa el resultado público `TuiMouseEventResult | undefined`.
2. Títulos largos no ocultan un botón de cierre cuyo hitbox siga activo.
3. Solo se reenvía mouse dentro del cuerpo, con coordenadas y dimensiones locales.
4. Demo y ventana comparten presupuesto dinámico de altura para preservar footer/borde.

Límites conocidos, no defectos pendientes para ampliar de oficio:
- Cuerpo recortado, sin scroll.
- No se propaga `Focusable` a hijos de entrada; no se certifica IME para Input/Editor embebidos.
- Marco mínimo: 4 filas sin footer, 6 con footer. En ese mínimo no quedan filas de cuerpo. Por debajo no se renderiza.
- Demo con footer y `floor(rows * 0.7)`: queda vacía con terminal de menos de 9 filas; comprobar Escape y recuperación.
- Mouse requiere modo fullscreen en Pi.
- Pruebas de demo usan un TUI simulado, NO un terminal real.

## 5. Herramientas y resultados realmente observados

- Node observado: 24.14.0; requisito declarado >=22.19.0.
- TypeScript local: 5.9.3.
- Pi/pi-tui de desarrollo: 0.85.1.
- `@types/node`: 22.19.19.
- Paquete privado; peers Pi `*` conforme a guía de paquetes, pero solo se verificó la versión de desarrollo. No prometer compatibilidad universal.
- TDD OFF, elegido explícitamente por el usuario para ESTA primera migración: implementar y después probar. No extrapolar esa decisión automáticamente a todo proyecto futuro.
- Tests compilados a `.test-build/`, luego Node ejecuta JavaScript; no depender del stripping nativo de TS.
- `skipLibCheck: true`: evita fallos de declaraciones externas de proveedores Pi (imports JSON y dependencia MCP opcional). El código propio sí se comprueba; no afirmar validación completa de declaraciones de dependencias.

Última revalidación ejecutada por el agente padre desde el destino:
- Typecheck: PASS.
- Pruebas: 10/10 PASS, ninguna omitida.
- `cmp` snapshot/original: PASS.
- `sha256sum --check`: PASS.

Hash del original y snapshot:
`fe4cb7a6cfc7f3167080b72a5af6afca5ac42441bdf1b6dd0f843be90920c0e5`.

**No observados:** ejecución real de Pi, renderizado real, clics, resize, foco restaurado. La aceptación manual sigue abierta.

El antiguo `git diff --check` no cubrió archivos sin seguimiento. No usarlo como evidencia de limpieza de todo el proyecto. Queda pendiente una comprobación explícita de whitespace sobre los archivos propios, sin recorrer dependencias/snapshot ni modificar nada automáticamente.

## 6. Plan de continuación concreto

### A. Confirmar contexto, sin escribir

```bash
cd /home/dc-studio/dc-lab/dc-projects/dc-pi && pwd && git rev-parse --show-toplevel && git status --short
```

Si la raíz no coincide exactamente, detenerse. Leer los documentos y no sobrescribir cambios de otra terminal. Verificar que no siga trabajando otro agente.

### B. Revalidar automáticamente

Las dependencias ya están instaladas; no reinstalar por costumbre.

```bash
cd /home/dc-studio/dc-lab/dc-projects/dc-pi && \
  npm --cache ./.npm-cache run typecheck && \
  npm --cache ./.npm-cache test && \
  cmp -- original/dc-window.ts /home/dc-studio/dc-lab/lab-cofig-pi/dc-window.ts && \
  sha256sum --check original/SHA256SUMS
```

Si faltan dependencias, usar solo el procedimiento local del README (`npm ci --ignore-scripts --cache ./.npm-cache --no-audit --no-fund`), nunca npm global ni enlaces al original. No editar node_modules para esconder errores.

### C. Prueba visual aislada — tarea principal pendiente

Usar la receta COMPLETA de `README.md`, sección `Manual acceptance — not yet executed`, desde una terminal interactiva. No sustituirla por `pi -e ...` en el perfil activo.

La receta crea directorios temporales, usa agente/sesiones separados, desactiva descubrimiento de recursos, carga solo la demo explícita y activa fullscreen. Usa el CLI instalado 0.85.1 con ruta absoluta. Si cambió la instalación, verificar versión y documentación antes de adaptar la ruta.

Esto aísla configuración/recursos, NO es un sandbox ni firewall. No enviar prompts, no hacer login ni invocar herramientas. No borrar temporales automáticamente.

Checklist:
1. Solo demo cargada, sin errores de extensión.
2. `/dc-window-demo` abre.
3. Frame, ANSI, título, control X y footer visibles.
4. Redimensionar ancho y alto; volver al tamaño normal.
5. Escape cierra.
6. Reabrir y clic izquierdo en X cierra.
7. Bordes/cuerpo no provocan cierre accidental.
8. Tamaño extremo menor de 9 filas: Escape funciona y se recupera al ampliar.
9. Editor recupera foco; escribir y borrar texto SIN enviarlo.
10. `/quit` sale correctamente.

Registrar versión real de Pi, emulador de terminal, dimensiones columnas×filas y observación por item. Si el agente no dispone de terminal interactiva observable, pedir al usuario que ejecute la receta y reporte resultados; NO simular aprobación ni iniciar un proceso TUI colgado en un shell no interactivo.

### D. Si aparece un fallo

Reproducir y registrar antes de editar. Cambiar únicamente lo necesario en el nuevo proyecto, agregar prueba cuando sea automatizable y volver a correr verificaciones. Preservar snapshot. Si requiere nueva capacidad (scroll, IME, integración interna), acordar alcance antes de implementarla.

### E. Cierre verificable

Actualizar README, registry y task doc con resultados reales. Marcar manual pendiente hasta tenerlos. Si no hay acceso a TUI, entregar cierre parcial honesto con bloqueo explícito.

No afirmar aprobación de revisión nativa: la evaluación `gentle_review assess` devolvió unavailable/unassessable; se hizo revisión independiente de documentación, no una aprobación nativa del código. Esa revisión pidió precisar alturas con/sin footer y se corrigieron los tres documentos. No hubo ciclo nativo completo aprobado. Si el harness nuevo exige revisión de código, seguir sus reglas sin inventar un recibo.

Informe final: qué cambió, comandos y resultados, comprobación de original, aceptación manual real o pendiente, límites restantes. Commits solo con autorización del usuario.

## 7. Hoja de ruta posterior — propuesta, NO autorizada aún

Después de cerrar DcWindow, proponer explorar `openDcModal()` como siguiente extracción. Localizar implementaciones y consumidores en modo solo lectura, definir contrato mínimo y plan acotado ANTES de escribir. No dar por sentado que existe en un archivo concreto.

Orden conceptual recomendado:
1. Componentes UI públicos y helper de modal.
2. Helpers repetidos, uno por unidad: notificaciones, timeout/abort HTTP, cliente CLIProxy, clipboard, estado visual.
3. Migrar extensiones individualmente con snapshot/hash/tests/registro.
4. Separar integraciones opcionales: Herdr, tmux, CLIProxy, TTS, clipboard.
5. Dejar para el final sidebar, dialogs y parches de transcript/internals.

Arquitectura propuesta originalmente: core portable, integraciones opcionales y experimental aislado. Nombres sugeridos `@dc-studio/pi-core`, `@dc-studio/pi-integrations`, `@dc-studio/pi-experimental-overlay` son PROPUESTAS: no crear un monorepo ni publicar por asumir que están aprobados. El proyecto actual es un único paquete privado `dc-pi`.

Antes de compartir: licencia con decisión del usuario, revisión de secretos/rutas personales, compatibilidad real, recursos de paquete y documentación portable. El README actual usa rutas locales para recuperar esta tarea; todavía no es guía pública portable.

## 8. Fallos de proceso que no repetir

- Un escritor falló tras dejar código: se inspeccionó lo existente y recuperó; no borrar ni empezar desde cero por un fallo del agente.
- Un resumen afirmó que había README antes de crearlo: ahora existe, pero verificar siempre artefactos, no resúmenes.
- No confundir tests unitarios con validación visual.
- No confundir archivo untracked con archivo prescindible ni `git diff --check` vacío con revisión completa.
- No usar cwd ni CodeGraph del original para operar sobre el destino.
- No declarar la migración aceptada hasta resolver explícitamente la aceptación manual.
