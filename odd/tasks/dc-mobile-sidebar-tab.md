# dc-mobile: pestaña `[4] MOBILE` en el sidebar

Feature document for ODD. Read `## Specs` and the assigned task only, then act.

## Specs

**S1.** El sidebar gana una pestaña `MOBILE` con la tecla `4`, entre `CTRL` (3) y `TREE`. Las pestañas existentes se corren un número: `tree` pasa a `5`, `mem` a `6`, `sys` a `7`. Los atajos `Alt+1..9`, el comando `/dc-sidebar <n>` y el match por key o por ordinal deben apuntar todos a la misma pestaña: si divergen, se corrige el match, no los keys.

**S2.** La pestaña muestra el estado de conexión de uno o varios teléfonos a la vez. Encabezado con el conteo (`1 dispositivo`, `2 dispositivos`, `sin dispositivos`) y el transporte dominante (`USB`, `Wi-Fi`, `mixto`). Una fila por dispositivo con `serial`, estado (`device`, `offline`, `unauthorized`) y `model` cuando adb lo reporta.

**S3.** En lugar de un «todo», la pestaña muestra una **bitácora en vivo** de lo que pasa en el teléfono: líneas con hora `HH:MM:SS` y un verbo corto, por ejemplo `conectando 192.168.100.222:41234`, `conectado (device)`, `buscando dispositivos`, `eligiendo @e12 en pantalla`, `capturando pantalla`, `visor abierto (pid 1234)`, `vínculo apagado`. Se conservan como máximo 200 eventos en memoria y se renderizan los últimos que caben.

**S4.** Sin sondeo: prohibido `setInterval` y prohibido llamar `adb` dentro de `render()`. La tarjeta se repinta por suscripción a eventos y por acción del usuario; el snapshot de dispositivos se toma de forma asíncrona al montar la pestaña y después de cada acción, y se guarda en memoria del módulo.

**S5.** Tres botones, con el idioma de mouse ya usado en el sidebar (`DcJustifiedRow.onClick`): `[Reconectar]`, `[Apagar vínculo]`, `[Abrir visor]`. `Reconectar` reusa `ensureConnection`; `Apagar vínculo` ejecuta `adb disconnect <serial>` (o `adb kill-server` cuando no hay serial) y registra el evento; `Abrir visor` reusa `openLiveViewer`. El sidebar no tiene manejo de teclado, así que no se inventan teclas nuevas para esta tarjeta.

**S6.** Sin visor de imagen incrustado: el rail mide 50 columnas y `render()` devuelve líneas de texto. La tarjeta muestra `visor: abierto (pid N)` o `último frame hace Ns` y delega la imagen a la ventana flotante que ya existe.

**S7.** El «todo» no se toca: sigue viviendo en `[1] MAIN` con su comportamiento actual. Esta pestaña no lo duplica.

**S8.** Al cambiar de pestaña el componente se destruye y se reconstruye. El snapshot y la bitácora viven en alcance de módulo (`core/dc-mobile-activity.ts`), no en la instancia de la tarjeta.

**S9.** Si `adb` no está disponible, la tarjeta muestra `adb no disponible` y sus botones de conexión no se dibujan como accionables; nunca lanza excepción durante `render()`.

**S10.** Conectarse o desconectar desde la tarjeta registra el evento en la bitácora y actualiza el snapshot sin recargar el TUI.

## Tasks

- T1 — sidebar: `MOBILE` como key `4`, renumerar `tree/mem/sys` y sus comentarios `[n:TAG]`. Cubre S1. **DONE** — `SIDEBAR_TABS` con `mobile=4`, `tree=5`, `mem=6`, `sys=7`; comentarios `[5:TREE] [6:MEM] [7:SYS]` en `views/dc-sidebar-body.ts`; `test/dc-sidebar-sentinel-tabs.test.ts` actualizado (+test de coherencia key↔ordinal↔slot, 11/11). Commit: —
- T2 — core: `src/features/dc-mobile/core/dc-mobile-activity.ts` con registro, lectura y suscripción de eventos, tope de 200. Cubre S3, S4, S8. **DONE** — 115 líneas, 8/8 en `test/dc-mobile-activity.test.ts`. Commit: —
- T3 — emisión real de eventos en supervisor, conexión async, tools y visor. Cubre S3, S10. **DONE (con L5)** — `tools/dc-mobile-tools.ts` +50: emite discover/connect/pair/inspect/action/tap/visor/errores; la tarjeta emite sus propias acciones. Commit: —
- T4 — `views/dc-mobile-sidebar-card.ts`: encabezado, dispositivos, bitácora, botones. Cubre S2, S5, S6, S9. **DONE** — 558 líneas, deps inyectables, sin timers ni adb en `render()`. Commit: —
- T5 — wiring en `dc-sidebar-body.ts` para el caso `mobile`. Cubre S1, S7. **DONE** — `case "mobile"` con comentario `[4:MOBILE]` entre CTRL y TREE, MAIN intacto. Commit: —
- T6 — tests de tarjeta y bus con estado inyectado, sin adb real. Cubre S2-S6, S9. **DONE** — `test/dc-mobile-sidebar-card.test.ts` 358 líneas, 8/8. Commit: —
- T7 — documentación: `skills/dc-mobile-testing/SKILL.md` y README. Cubre S1-S6. **DONE** — skill v1.5 con sección «Pestaña `[4] MOBILE` del Sidebar»; README con la tabla de las 7 pestañas. Commit: —

## Log

- L1 (verbatim, pedido original): «super esta super pero vamos a crear en el sider bar como pestana [4 mobile] hay vamos a ver si esta conectado un cell o varios y un todo y un visro de tyrabajo y tambein un boton para reconectar o apanagar el vinculo pilas» + «sigue».
- L2 (verbatim, corrección de diseño): «si ya existe la 4 hay quwe correla las demas un numero, si el "to do" era para saber lo que se hace pero mejor que un todo es ejeplo conecvtando buscvarndo escojiendo algo como una bitacora en vido de lo que se va haciendo en el cell, el visor si mas o menos pero abria que ver si mejor ponemos su[ervisor y demos lo s eventos y eliminamos lo del "to do" y el visor y pomenos uno solo como supervisor que opinas».
- L3 (búsqueda previa, hechos): `SIDEBAR_TABS` declara keys explícitos `main/fleet/ctrl/tree/mem/sys` = `1..6` (`views/dc-sidebar-tabs.ts:5-12`); `Alt+1..9` se registra en un bucle y `/dc-sidebar` resuelve por key o por ordinal (`dc-sidebar.ts:32-40,157-162,225-232`); el cuerpo despacha por `switch` sobre el id (`views/dc-sidebar-body.ts:118-160`); el sidebar no maneja teclado (`grep handleInput` sin resultados); `listDevices`/`ensureConnection` son **síncronos y lanzan adb** con 15-20 s de timeout, por lo que jamás pueden ejecutarse en `render()`.
- L4 (decisión del orquestador, aceptada por el dueño): una sola tarjeta supervisor; se descarta el «todo» propio y se descarta embeber imagen en el rail de 50 columnas.
- L5 (frontera de T3, orquestador): la emisión de eventos se limita a `tools/dc-mobile-tools.ts` y a la tarjeta. No se tocan `supervisor.ts`, `async-connection.ts` ni `viewer.ts`, para no alterar los 85 tests de dc-mobile ya verdes.
- L6 (incidente, orquestador): los dos workers en background de la sesión anterior se perdieron con el reinicio y no escribieron nada (T1 no estaba aplicado). T3-T6 se re-delegaron en modo bloqueante; T7 y la auditoría del rango publicado se hicieron en línea. Lección: en este entorno, trabajo en background solo si el turno sigue vivo.
- L7 (frontera de rebanada, orquestador): T4+T6 (tarjeta + sus tests + emisión en tools + wiring) suman ~970 líneas y van en un solo commit porque son un mismo comportamiento: una tarjeta y la evidencia que la prueba. La renumeración de pestañas (T1) y el bus de bitácora (T2) son unidades separadas, y la documentación (T7) va aparte.
