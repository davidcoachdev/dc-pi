# dc-mobile: descubrir el puerto Wi-Fi en el propio teléfono

Feature document for ODD. Read `## Specs` and the assigned task only, then act.

**Estado: revertido (L6).** La tecla `d` y `core/dc-mobile-settings-discovery.ts` se retiraron del producto; el wizard ahora prellena `host:` y el usuario escribe sólo el puerto. Este documento queda como historial de la mecánica verificada en el dispositivo.

## Specs

**S1.** El wizard abre una ventana `address` que hoy solo ofrece escribir o aceptar la última dirección conocida. Se agrega una acción explícita, tecla `d` en el paso `address`, rotulada `Detectar en el teléfono`, que lee del dispositivo el `IP:puerto` vigente de depuración inalámbrica y rellena el campo. No hay detección automática ni se abre Settings sin que el usuario lo pida.

**S2.** Mecánica verificada en el dispositivo `SM_G781U1` (no inventar otra):

- `adb shell am start -a android.settings.APPLICATION_DEVELOPMENT_SETTINGS` abre `com.android.settings/.Settings$DevelopmentSettingsDashboardActivity`.
- El intent directo al fragmento (`--es ":settings:show_fragment" com.android.settings.development.WirelessDebuggingFragment`) falla con `SecurityException`; está prohibido usarlo.
- La fila `Depuración inalámbrica` puede quedar debajo del fold: hay que hacer `input swipe` hacia arriba hasta encontrarla (máximo 6 intentos).
- La pantalla destino muestra `Dirección IP y puerto` y, en otra fila, el valor con forma `192.168.100.222:44523`.

**S3.** Extracción: se acepta `/\b(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\b/`, con puerto entre 1 y 65535 y host privado o link-local (10/8, 172.16/12, 192.168/16, 169.254/16). Cualquier otra coincidencia se descarta.

**S4.** Falla silenciosa: si no aparece la fila, no aparece el valor o el parseo no valida, la función devuelve `undefined` y el wizard conserva su comportamiento actual (`prefs.lastWifiAddress`, entrada manual). No se muestra error nuevo.

**S5.** Nunca bloquea la TUI: la lectura usa el runner asíncrono (`execFile`) del módulo `dc-mobile-async-connection.ts`, no `execFileSync`. Un resultado que llega tarde no pisa texto que el usuario ya escribió: si el campo cambió respecto del valor inicial del paso, se descarta.

**S6.** El teléfono queda usable: después de leer, se retrocede con `back` como máximo las dos pantallas que abrió la detección. No se intenta reabrir la app anterior.

**S7.** Tests con runner falso, sin dispositivo: (a) dump con etiquetas en español, fila debajo del fold y valor válido; (b) rechazo de `:0`, `:99999`, host público y texto sin IP; (c) `undefined` cuando falta la fila; (d) la tecla `d` rellena el campo en el wizard; (e) un resultado tardío no sobrescribe texto escrito por el usuario.

## Tasks

- ~~T1~~ — core: `readWirelessDebuggingAddress` + tests. Cubre S2, S3, S4, S5, S7a-c. *(revertido, L6)*
- ~~T2~~ — wizard: tecla `d` en `address`, prefill y descarte de resultados tardíos + tests. Cubre S1, S5, S7d-e. *(revertido, L6)*
- ~~T3~~ — documentación: sección en `skills/dc-mobile-testing/SKILL.md` con la mecánica y su límite. Cubre S2, S6. *(revertido, L6)*
- ~~T4~~ — bug real de hardware: el matcher `clickable && text` no encontraba la fila y podía tocar el switch. Corregido a etiqueta-sin-toggle + fixture fiel al dump real. Cubre S2, S7. *(revertido, L6)*

## Log

- L1 (verbatim, selección del frente): «A · descubrir el puerto en el teléfono».
- L2 (contexto previo que motiva la feature): después de vincular, Android rota el puerto y el wizard vuelve con el puerto vacío para que el usuario copie la URL; esta feature elimina ese copiado.
- L3 (prueba física, dispositivo `192.168.100.222:37271`): la primera corrida devolvió `undefined` tras 6 swipes y 0 taps. El dump real muestra dos nodos: título `clickable="false"` con texto y switch `clickable="true"` con `text=""` y `content-desc`. El matcher viejo exigía ambas cosas en el mismo nodo.
- L4 (prueba física post-fix): `RESULT: {"address":"192.168.100.222:37271","host":"192.168.100.222","port":37271}`, tap en `300 1492` (título) y la sesión ADB siguió en `device`. Coincide con el `192.168.100.222:37271` que mostraba la pantalla del teléfono. 85/85 en el cuarteto.
- L5 (frontera de la rebanada): esta unidad entra en un solo commit de 692 líneas, por encima de la guía de ~400. Se mantiene atómica porque el módulo, la tecla del wizard y los fixtures describen un único comportamiento y separarlos dejaría tests que no compilan o código sin cobertura. La próxima unidad arranca en una rama nueva.
- L6 (verbatim, dueño del producto): «oye pero segun el cell esta ciculado pero si el puerto cambia asi que no le veo utilida a eso si solo cambia erl puerto puedes poner el texto como ejemplo [192.168.100.22:}asi solo pongo el p[uerto porque cada vez que inicia cambia el puerto pilas  a ese atajo no ,o veo uil elimnalo». Decisión: se elimina la tecla `d` y el módulo de descubrimiento (T1-T4 revertidos, 8 tests de descubrimiento y 3 tests de la tecla `d` borrados); el campo `address` abre prellenado con `host:` tomado de `prefs.lastWifiAddress` y el usuario escribe sólo el puerto. Motivo admitido: un atajo que necesita un transporte ADB vivo para leer un valor que rota en cada activación no paga su costo. Nueva prueba en `test/dc-mobile.test.ts`; 76/76 en el trío dc-mobile.
- L7 (frontera de la rebanada): el commit de la reversión mide 682 líneas cambiadas (51 inserciones, 631 eliminaciones), por encima de la guía de ~400. Se mantiene en un solo commit porque es una eliminación de feature: partirla dejaría imports colgando o tests sin módulo. La próxima unidad arranca en una rama nueva.
