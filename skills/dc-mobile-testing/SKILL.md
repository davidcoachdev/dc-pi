---
name: dc-mobile-testing
description: "Trigger: mobile testing, probar app android, emulador, adb, celular. Ciclo determinista de control y verificación de apps Android desde dc-pi con adb, inspect/action sobre ids @eN, visor en vivo y veredicto honesto."
license: MIT
metadata:
  author: dc-studio
  version: "1.0"
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

## El Ciclo

1. **devices** — `dc_adb_devices` lista `serial`, `state` y `model`. Elegí un dispositivo en estado `device`; `unauthorized` u `offline` se reportan como bloqueo, no se reintentan a ciegas.
2. **inspect** — `dc_mobile_screen_inspect` devuelve el mapa semántico del frame actual: una línea por nodo accionable con `@eN`, texto o `content-desc`, `resource-id`, `bounds` y centro.
3. **action** — `dc_mobile_action` ejecuta una sola acción: `tap` (`elementId` o `x`/`y`), `text`, `key` (`back`, `home`, `enter`, `tab`), `swipe`, `launch` o `stop`.
4. **inspect** — repetí `dc_mobile_screen_inspect` y comprobá el efecto real en el nuevo dump: texto esperado, pantalla esperada, nodo esperado.
5. **verdict** — con la evidencia del último inspect, marcá cada paso como verificado o `[Unknown / Unverifiable]` y recién entonces emití el veredicto del flujo.

Si el `elementId` no existe, la respuesta correcta es `elemento @eN desconocido. Ejecutá dc_mobile_screen_inspect primero.` — no insistas con la acción ni caigas a coordenadas improvisadas.

## Visor en Vivo

Para seguir la pantalla mientras se prueba:

- El comando `/dc-mobile` abre el visor del dispositivo en una ventana flotante, sin decoraciones, al estilo del visor de Herdr.
- El visor se refresca por evento al cambiar el frame guardado en `~/.cache/dc-mobile/<serial>/latest.png`; no hace polling ni abre ventanas duplicadas para el mismo serial.
- Al inspeccionar con `preview: true` se mantiene la captura visible en el visor, útil para observar transiciones y confirmar visualmente el resultado de una acción.

Usá el visor como evidencia complementaria: el veredicto se basa en el dump semántico, la imagen solo confirma lo que el árbol de UI puede ocultar.

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
