---
name: dc-mobile-testing
description: "Trigger: mobile testing, probar app android, emulador, adb, celular, whatsapp, extraer conversación. Ciclo determinista de control y verificación de apps Android desde dc-pi con adb, inspect/action sobre ids @eN, visor en vivo y veredicto honesto."
license: MIT
metadata:
  author: dc-studio
  version: "1.4"
---

# dc-mobile-testing: Probar Apps Android con ADB desde dc-pi

## Activation Contract

Usa esta skill cuando haya que operar o verificar una app Android real o emulada desde dc-pi.

Activar cuando:
- El usuario pide probar un flujo en un celular o emulador Android.
- Se necesita navegar la UI, escribir texto, disparar teclas o deslizar pantallas vía adb.
- Hay que confirmar en pantalla que un flujo funciona, no solo asumir que la app "debería" funcionar.

No usar para:
- Testing web o de escritorio (usar la suite correspondiente).
- Automatización de UI dentro del código de la app (unit/instrumentation tests de Android).

## Hard Rules

- **Inspeccionar antes de actuar**: `dc_mobile_screen_inspect` es obligatorio antes de cualquier `dc_mobile_action`. Sin un dump fresco no hay acción válida.
- **Ids semánticos, no píxeles**: acciona con `elementId` (`@eN`) del último inspect de ese `serial`. Las coordenadas crudas solo valen como fallback cuando el nodo no expone id utilizable.
- **Nunca adivinar coordenadas**: no inventes ni estimes un `(x, y)` que no aparezca en la última inspección. Si el elemento no está en el dump, vuelve a inspeccionar o reporta el bloqueo.
- **Re-inspeccionar después de cada acción**: todo tap/text/key/swipe/launch/stop cambia la pantalla; el dump anterior queda obsoleto y sus `@eN` también.
- **Un serial explícito**: pasa siempre `serial`; antes verifica `dc_adb_devices` y no asumas que solo hay un dispositivo conectado.
- **No mentir sobre lo visto**: si un paso no se pudo verificar en pantalla, el resultado es `[Unknown / Unverifiable]`, nunca un PASS inventado.
- **Un dump, un archivo**: cada inspección escribe en un archivo nuevo (`/sdcard/<prefijo><n>.xml`). Releer el mismo path es la fuente número uno de falsos negativos.
- **Comparar el mapa, no la imagen**: un cambio de píxeles no prueba un cambio de estado; un mapa `@eN` idéntico con imagen distinta suele ser solo decoración (overscroll, cursor, teclado).
- **Ningún envío accidental**: toda app con botón `Enviar`/`Send` exige guardas antes de escribir texto (ver «Guardas antes de escribir»).

## El Ciclo

Primero dejá el dispositivo conectado y en estado `device`: ver «Conexión del Dispositivo» al final de esta skill.

1. **devices** — `dc_adb_devices` lista `serial`, `state` y `model`. Elegí un dispositivo en estado `device`; `unauthorized` u `offline` se reportan como bloqueo, no se reintentan a ciegas.
2. **inspect** — `dc_mobile_screen_inspect` devuelve el mapa semántico del frame actual: una línea por nodo accionable con `@eN`, texto o `content-desc`, `resource-id`, `bounds` y centro.
3. **action** — `dc_mobile_action` ejecuta una sola acción: `tap` (`elementId` o `x`/`y`), `text`, `key` (`back`, `home`, `enter`, `tab`), `swipe`, `launch` o `stop`.
4. **inspect** — repetí `dc_mobile_screen_inspect` y comprobá el efecto real en el nuevo dump: texto esperado, pantalla esperada, nodo esperado.
5. **verdict** — con la evidencia del último inspect, marcá cada paso como verificado o `[Unknown / Unverifiable]` y recién entonces emití el veredicto del flujo.

Si el `elementId` no existe, la respuesta correcta es `elemento @eN desconocido. Ejecutá dc_mobile_screen_inspect primero.` — no insistas con la acción ni caigas a coordenadas improvisadas.

## Visor en Vivo

Para seguir la pantalla mientras se prueba:

- El comando `/dc-mobile` o el atajo `Alt+Shift+M` abren el panel del dispositivo en una ventana flotante, sin decoraciones, al estilo del visor de Herdr.
- El mismo panel es la puerta de conexión: elegís `USB · detectar dispositivo` o `Wi-Fi · conectar`, y en Wi-Fi el intento muestra el log de adb en vivo. Si la conexión falla y el teléfono no confía en esta computadora, el panel abre la vinculación; después de vincular vuelve a la dirección con el puerto vacío porque Android rotó el puerto.
- El visor se refresca por evento al cambiar el frame guardado en `~/.cache/dc-mobile/<serial>/latest.png`; no hace polling ni abre ventanas duplicadas para el mismo serial.
- Al inspeccionar con `preview: true` se mantiene la captura visible en el visor, útil para observar transiciones y confirmar visualmente el resultado de una acción.

Usá el visor como evidencia complementaria: el veredicto se basa en el dump semántico, la imagen solo confirma lo que el árbol de UI puede ocultar.

## Conexión del Dispositivo

Antes del primer inspect, el dispositivo tiene que estar en estado `device`. Dos caminos, uno solo por sesión:

**USB en WSL.** El cable no llega solo a WSL: necesita `usbipd-win` en Windows.

```bash
winget install dorssel.usbipd-win                      # una vez
usbipd list                                             # BUSID + VID:PID
usbipd bind --busid <BUSID>                             # requiere administrador
usbipd attach --wsl --busid <BUSID>                     # no requiere administrador
```

Cada re-enumeración del teléfono rompe el bind y pide elevación otra vez. Si `adb devices` muestra el serial pero los comandos fallan por permisos, el nodo necesita escritura:

```bash
sudo chmod a+rw /dev/bus/usb/<bus>/<dev>
```

**Wi-Fi.** Modelo de dos fases, no las confundas:

1. `adb pair <ip>:<puerto-de-vinculación> <código-de-6-dígitos>` — crea la confianza TLS. Es **una vez por computadora y teléfono** y ese puerto se cierra al terminar.
2. `adb connect <ip>:<puerto-de-la-pantalla-principal>` — abre el transporte usando la clave guardada. Es repetible.

Reglas que evitan el bucle clásico de «ya está vinculado y me pide vincular otra vez»:

- Android **rota el puerto de depuración inalámbrica al completar la vinculación**. Nunca reintentes el connect contra el puerto de vinculación.
- Si una vinculación salió bien, el siguiente connect va a la URL nueva de la pantalla principal. Si el teléfono ya confía en esta computadora, no vuelvas a pedir código: el camino correcto es conectar, no vincular.
- `adb mdns services` puede venir vacío por diseño de red. En WSL2 el multicast link-local no cruza el NAT: la discovery por mDNS es un no-op ahí y **no** es evidencia de que el teléfono esté mal configurado.
- `adb connect` solo no basta para concluir: verificá con `dc_adb_devices` que el estado sea `device`.

## Modo Crudo con `adb`

`dc_mobile_*` es el camino por defecto. Cuando una capacidad todavía no existe como tool, usá `adb` directo con estas reglas:

- **Usuarios múltiples**: `pm list packages` sin `--user` aborta con `SecurityException: Shell does not have permission to access user <uid>` en teléfonos con Secure Folder o perfiles. Usá `pm list packages --user 0 ...` y `pm list users` para ver los usuarios.
- **Foco real**: `dumpsys window | grep mCurrentFocus` puede devolver varias líneas, incluida `mCurrentFocus=null` de una pantalla secundaria mientras la app sí está al frente. La verdad está en `dumpsys activity activities | grep topResumedActivity`.
- **Texto con espacios**: `adb shell input text 'Miss%sLusia'`; el espacio crudo rompe el comando.
- **Acciones**: `input tap`, `input swipe`, `input keyevent <n>` funcionan con normalidad. Si una acción parece no tener efecto, el problema suele ser pantalla equivocada o dump viejo, no la inyección.
- **Árbol de UI**: `adb shell uiautomator dump /sdcard/<nuevo>.xml` seguido de `adb exec-out cat /sdcard/<nuevo>.xml`, y parsealo con `parseUiHierarchy` de `src/features/dc-mobile/core/dc-ui-hierarchy-parser.ts` para obtener los mismos `@eN` que usan las tools.

## Falsos Negativos

Dos casos reales que enseñan a dudar del instrumento antes que de la app:

- La imagen cambió y el mapa `@eN` no: con un `md5` distinto del screenshot y del XML, el mapa idéntico significa que no cambió nada semántico. Un overscroll o un cursor mueve píxeles sin cambiar la pantalla.
- El mapa no cambió y la acción sí se ejecutó: el dump se leyó de un archivo reciclado, o la acción cayó en otra pantalla. Escribí siempre a un path nuevo y compará el `md5` del XML crudo antes de declarar que el dispositivo ignora la inyección.

## Guardas antes de Escribir

Escribir texto en una app de mensajería puede terminar en un envío real. Antes de cada `text`:

- Confirmá que el dump muestra un campo de búsqueda o de composición identificable por `content-desc` o `resource-id`. Sin campo verificado, no se escribe.
- Si aparece chrome de compartir (`Reenviar a…`, `Enviar`, `Compartir`), **abortá** con `key back` y re-inspeccioná: esas hojas listan contactos y un nombre escrito a ciegas puede seleccionar a una persona.
- Nunca confirmes `Enviar` en un flujo que el usuario no pidió explícitamente.

## Recetario: Extraer una Conversación

Patrón verificado sobre WhatsApp; se generaliza a cualquier chat con burbujas.

1. Abrí la app con `monkey -p <paquete> -c android.intent.category.LAUNCHER 1` (o `launch` de la tool).
2. Buscá el contacto desde la lista: barra de búsqueda, `input text`, y tap sobre el **contenedor** del resultado, no sobre el texto.
3. Verificá que abriste el chat correcto: el `header` del dump debe contener el nombre, y debe existir el campo de composición.
4. Extraé con `y` ascendente los nodos `message_text`, los `content-desc` de multimedia y las marcas de hora.
5. Para historial anterior, `input swipe` de arriba hacia abajo (dedo baja = mensajes más viejos) y repetí con dump nuevo cada vez.

Atribución de lado en un chat 1:1, heurística con evidencia de bounds:

- Saliente (tuyo) si `bounds.x2 > 950` o `bounds.x1 > 540`.
- Entrante si el globo arranca a la izquierda (`x1` bajo, `x2` lejos del borde derecho).
- La marca de hora es un nodo hermano **debajo** del globo: se empareja por orden de `y`, no por contención.
- `content-desc` que arranca con `Tú,` es saliente; `Reproducir mensaje de voz` es un control del reproductor, no un mensaje.

Límites que hay que reportar, no disimular:

- Con **mensajes temporales** activos el historial se borra por diseño: encontrar solo avisos de sistema y llamadas no es un fallo de extracción.
- Un dump no trae el contenido de audio ni de video. Sin transcripción aparte, la evidencia es «nota de voz de N segundos a las HH:MM», no el texto hablado.

## El Puerto Wi-Fi Rota: Se Escribe a Mano

El puerto de depuración inalámbrica cambia en cada activación y no vive en `settings`. Ya no hay atajo que lo lea de la pantalla del teléfono (se removió la tecla `d`): el wizard prellena `host:` desde la última dirección y el usuario tipea sólo el puerto.

1. El host se conserva entre sesiones; el puerto no. Si `prefs.lastWifiAddress` es `192.168.100.222:41779`, el campo abre como `192.168.100.222:`.
2. El puerto correcto es el de la **pantalla principal** de Depuración inalámbrica, no el del diálogo de vinculación.
3. Verificá el transporte con `adb -s <host>:<puerto> get-state`; `connected` en `adb devices` sin `device` en `get-state` no sirve.

Trampas verificadas en este host:

- Un puerto abierto no implica ADB: el puerto de **vinculación** acepta TCP y habla TLS/SPAKE2, así que `adb connect` lo deja `offline` y `adb pair` responde `protocol fault`. El puerto principal es otro.
- Los puertos rotan con cada activación y un escaneo de rango puede dar falsos negativos: verificá con `adb -s <host>:<puerto> get-state`, no con un solo barrido.
- El teléfono duerme la depuración inalámbrica con la pantalla: `adb shell svc power stayon true` antes de una corrida larga.
- Leer la pantalla del teléfono por script sigue siendo viable si alguna vez hace falta: `adb exec-out uiautomator dump /dev/tty` (nunca `adb shell exec-out …`, que responde `exec-out: inaccessible or not found`). La fila `Depuración inalámbrica` son **dos nodos**: el título `android:id/title` con texto y `clickable="false"`, y el switch `com.android.settings:id/switchWidget` clickeable con texto vacío y etiqueta en `content-desc`. Nunca tapees el switch: apaga la depuración y el puerto buscado.
- El intent directo al fragmento (`--es ":settings:show_fragment" com.android.settings.development.WirelessDebuggingFragment`) tira `SecurityException` en Samsung.
- Abrir Settings secuestra la pantalla del usuario: si algo lo necesita, debe ser acción explícita y devolver las pantallas con `back`.

## Takeover Humano

Pedile al humano que tome el control físico del dispositivo cuando aparezca:
- Biometría (huella, rostro, iris).
- Segundo factor (2FA, OTP por SMS o app autenticadora).
- Diálogos del sistema que adb no puede resolver de forma fiable.

Mientras esperás el takeover, no simules el paso ni lo marques como aprobado: registralo como `[Unknown / Unverifiable]` hasta que el humano confirme que lo completó y una nueva inspección muestre la pantalla esperada.

## Veredicto

El reporte final debe seguir el orden del ciclo y citar evidencia concreta:

- `serial` y `model` usados.
- Secuencia de acciones con el `@eN` accionado y el dump posterior que lo confirma.
- Cada criterio: verificado con evidencia, o `[Unknown / Unverifiable]` con la razón (paso no observable, takeover pendiente, dump vacío).
- Un veredicto explícito: PASS solo si todos los criterios quedaron verificados en pantalla; FAIL si una inspección muestra un resultado distinto al esperado.
