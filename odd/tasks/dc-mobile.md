# dc-mobile — soberano control de dispositivos Android desde dc-pi

Feature nueva en `src/features/dc-mobile/`: driver ADB nativo, parser de jerarquía de UI,
herramientas `dc_mobile_*`, visor en vivo reutilizando el patrón `Ctrl+A` + `i` de Herdr,
brick `mobile-controller` y skill `dc-mobile-testing`. Sin dependencias de terceros, sin APK.

## Specs

- **S1** — Layout de feature dc-pi: `src/features/dc-mobile/` con `core/` (lógica pura),
  `tools/` (registro de herramientas), entrypoint `dc-mobile.ts` y barrel `index.ts`.
  Export por defecto `dcMobileExtension(pi: ExtensionAPI): void`.
- **S2** — Herramienta `dc_adb_devices`: ejecuta `adb devices -l` y devuelve una línea por
  dispositivo con `serial`, `state` y `model`. Si `adb` no existe responde texto de error
  exacto: `adb no está disponible. Instalá Android platform-tools y reintentá.`
- **S3** — Herramienta `dc_mobile_screen_inspect`: ejecuta `adb -s <serial> exec-out screencap -p`
  (PNG en memoria) y `adb -s <serial> exec-out uiautomator dump /dev/tty`, guarda el PNG en
  `~/.cache/dc-mobile/<serial>/frame-<timestamp>.png` (más symlink/copia `latest.png`) y devuelve
  un mapa semántico: una línea por nodo accionable con id `@e1`…`@eN`, `text` o `content-desc`,
  `resource-id`, `bounds` y centro `(x, y)`. Nodos sin texto, sin `content-desc` y sin
  `clickable=true` no se listan.
- **S4** — Herramienta `dc_mobile_action` con acciones `tap`, `text`, `key`, `swipe`, `launch`,
  `stop`. Recibe `serial` y:
  - `tap`: acepta `elementId` (`@e3`) del último inspect de ese serial **o** `x`/`y`; si el
    `elementId` no existe responde `elemento @eN desconocido. Ejecutá dc_mobile_screen_inspect primero.`
  - `text`: usa `adb shell input text` con escape de espacios (`%s`) y rechaza texto vacío con
    `texto vacío: nada que escribir.`
  - `key`: acepta nombre (`back`, `home`, `enter`, `tab`) mapeado a keycodes.
  - `swipe`: `x1,y1,x2,y2[,durationMs]`.
  - `launch` / `stop`: reciben `package` y usan `monkey -p <pkg> -c android.intent.category.LAUNCHER 1`
    / `am force-stop`.
- **S5** — Visor en vivo: `core/dc-mobile-viewer.ts` escribe el frame en `~/.cache/dc-mobile/<serial>/latest.png`
  y lanza `scripts/dc-mobile-viewer.mjs` en una ventana Kitty flotante sin decoraciones, con el
  mismo estilo que `~/.config/herdr/scripts/dc-image-viewer.mjs` (`kitten icat --place`).
  El refresco es **dirigido por evento**: el script observa el archivo del frame con `fs.watch`
  y redibuja solo cuando cambia. Prohibido `setInterval` de sondeo. Si ya hay un visor vivo para
  ese serial, se reutiliza (no se abren ventanas nuevas).
- **S6** — Brick `mobile-controller` agregado a `DcToolBrick`, `DC_TOOL_BRICKS` (mapea
  `dc_adb_devices`, `dc_mobile_screen_inspect`, `dc_mobile_action`) y `DC_TOOL_BRICK_GUIDELINES`
  en `src/features/dc-agents/core/dc-ephemeral-types.ts`.
- **S7** — Skill `skills/dc-mobile-testing/SKILL.md` con frontmatter válido (`name`, `description`
  con trigger `mobile testing, probar app android, emulador, adb, celular`) y el ciclo:
  devices → inspect → action → inspect → veredicto.
- **S8** — Tests unitarios en `test/dc-mobile.test.ts` para parser de jerarquía (mapeo `@eN`, nodos
  filtrados, bounds malformados) y para el formateador de comandos ADB (escape de texto,
  keycodes, rechazo de texto vacío). Los tests no invocan `adb` real: el driver recibe un
  `execFn` inyectable.
- **S9** — Robustez: toda llamada a `adb` con timeout explícito; los errores se devuelven como
  `isError: true` con el mensaje de la causa, nunca lanzan y tumban la sesión. Sin `setInterval`,
  sin `exec` con shell interpolado para texto del usuario.

- **S10** — Selector de conexión flotante. `/dc-mobile` sin dispositivo activo abre una ventana
  `DcWindow` (infra existente `openDcModal` + `src/ui/dc-modal.ts`, mismo patrón que
  `src/features/dc-approval/views/dc-approval-modal.ts`) titulada `📱 DC Mobile — Conexión` con las
  opciones, en este orden: `USB · detectar dispositivo`, `Wi-Fi · ingresar IP:puerto`,
  `Wi-Fi · vincular con código`, `Cancelar`. Navegación con ↑/↓ y Enter, `Esc` cancela. Con
  dispositivo ya conectado, `/dc-mobile` solo reporta estado y frame, sin abrir modal.
- **S11** — Clasificación de transporte: un serial que contiene `:` se considera `wifi`, cualquier
  otro se considera `usb`. `listUsbDevices()` devuelve solo entradas sin `:` en estado `device`. Si
  se elige USB y la lista está vacía, el mensaje es exactamente:
  `No hay dispositivos USB visibles. En WSL el cable requiere usbipd-win: winget install dorssel.usbipd-win, luego usbipd bind --busid <BUSID> y usbipd attach --wsl --busid <BUSID>.`
- **S12** — Flujo Wi-Fi: la opción de IP valida `host:puerto` (host IPv4 o dominio, puerto 1-65535) y
  ejecuta `adb connect`; informa el serial conectado o el error de adb tal cual. La opción de
  vinculación pide dirección y código de 6 dígitos, ejecuta `adb pair`, y si el `connect` posterior
  falla, explica que el puerto de vinculación se cierra y pide el puerto de la pantalla principal.
- **S13** — Persistencia por feature en `resolveDcConfigPath("dc-mobile")`
  (`~/.pi/agent/dc-studio/dc-mobile.json`) con `{ lastSerial, mode, lastWifiAddress }`; se lee al
  abrir el modal para preseleccionar el modo y precargar la última dirección. Escritura atómica y
  tolerante a archivo corrupto (JSON inválido → configuración por defecto, sin lanzar).
- **S14** — Herramienta `dc_mobile_connect` con `mode: "usb" | "wifi"`, `address` y `code`
  opcionales, para que un agente conecte sin pasar por el modal; devuelve serial y modo, o
  `isError: true` con el motivo.
- **S15** — Supervisor de conexión (`core/dc-mobile-supervisor.ts`): `ensureConnection(driver, prefs)`
  devuelve `{ ok, serial, transport, message, guided }` y nunca lanza. Orden: si adb ya lista un
  dispositivo en estado `device`, gana ese. Si no, en modo USB corre reparación de permisos y, si
  reparó algo, reinicia el servidor adb antes de listar. Si sigue vacío y el último modo fue Wi-Fi,
  intenta `adb connect` a la última dirección conocida una sola vez. Se invoca al inicio de **cada**
  herramienta `dc_mobile_*`; no hay temporizadores ni reintentos periódicos.
- **S16** — USB auto-attach: al conectar por USB, `dc-mobile` descubre el BUSID comparando
  `usbipd list` contra los vendor ids Android (`18d1`, `04e8`) y lanza
  `usbipd attach --wsl --auto-attach --busid <BUSID>` en segundo plano, de modo que una
  re-enumeración o un reencendido del cable se re-adjunten sin UAC. Si el binario no está o el
  comando falla, devuelve la guía manual en vez de un error. El ejecutable se resuelve por
  `DC_USBIPD_PATH` y, en su defecto, por `/mnt/c/Program Files/usbipd-win/usbipd.exe`.
- **S17** — Wi-Fi sin teclear puertos: `adb mdns services` se parsea buscando entradas
  `_adb-tls-connect._tcp` (formato `<nombre>\t<servicio>\t<ip>:<puerto>`); si hay una, el modal ofrece
  conectarse a ella directamente y la persiste. Si no hay ninguna o el parseo falla, cae al ingreso
  manual de `IP:puerto` de S12 sin romper el flujo.

## Tasks

| ID | Specs | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | S1, S3, S9 | core driver + parser (`dc-adb-driver.ts`, `dc-ui-hierarchy-parser.ts`) | done |
| T2 | S5 | visor en vivo (`core/dc-mobile-viewer.ts` + `scripts/dc-mobile-viewer.mjs`) | done |
| T3 | S2, S3, S4 | herramientas (`tools/dc-mobile-tools.ts`, `dc-mobile.ts`, `index.ts`) | done |
| T4 | S6 | brick `mobile-controller` en `dc-ephemeral-types.ts` | done |
| T5 | S7 | skill `skills/dc-mobile-testing/SKILL.md` | done |
| T6 | S8 | tests `test/dc-mobile.test.ts` | done |
| T7 | S1 | registro de `dcMobileExtension` en `src/index.ts` (import, lista, barrel, llamada) | done |
| T8 | S10, S11, S12, S13 | `core/dc-mobile-connection.ts` + `views/dc-mobile-connect-modal.ts` | done |
| T9 | S14 | `dc_mobile_connect` en `tools/dc-mobile-tools.ts` + carga del modal en `dc-mobile.ts` | done |
| T10 | S8 | tests `test/dc-mobile-connection.test.ts` (clasificación, validación, persistencia) | done |
| T11 | S15 | `core/dc-mobile-supervisor.ts` + llamada en las tres herramientas | pending |
| T12 | S16, S17 | auto-attach USB y descubrimiento mDNS en modal y `dc_mobile_connect` | pending |
| T13 | S8 | tests `test/dc-mobile-supervisor.test.ts` | pending |

## Log

- **L1** (usuario, literal): «es un tools en herdr» / «es cuando pongo las tecla [ctrl+a+i]» —
  aclaración de que el visor flotante de Herdr se dispara con `prefix+i` (`paste-image.sh` +
  `dc-image-viewer.mjs`).
- **L2** (usuario, literal): «comienza» — autoriza construir `dc-mobile` en `dc-pi` y conectar
  el visor de Herdr/Kitty para las capturas.
- **L3** (decisión): el visor propio vive dentro del repo (`scripts/dc-mobile-viewer.mjs`) para
  no modificar configuración del usuario fuera del proyecto.
- **L4** (evidencia): `grep -rn "mobile-controller" src/features/dc-agents/` sin resultados →
  el brick nunca existió; T4 lo crea desde cero.
- **L5** (corrección): los workers no podían tocar `src/index.ts`, así que la extensión quedaba
  sin registrar y las herramientas inalcanzables. T7 cierra ese hueco y el path de tests pasa a
  `test/dc-mobile.test.ts`, que es la convención plana del repo (`test/*.test.ts`).
- **L6** (evidencia real, 2026-11-14): `adb` 37.0.1 instalado en `~/.local/bin/adb` (symlink a
  `~/.local/share/android-platform-tools`, sin sudo). Verificación de punta a punta contra
  `SM_G781U1` por depuración inalámbrica en `192.168.100.222:41779`: `screencap -p` → PNG de
  199.015 bytes; `uiautomator dump` → 23.658 bytes de XML → 20 elementos `@e1…@e20` con bounds y
  centro reales (1080x2400); `inputKey back` → nueva pantalla con 36 elementos y frame de 237.338
  bytes; visor Kitty levantado con el script y paleta de DC Studio.
- **L7** (límite conocido): `tsc` no copia `scripts/dc-mobile-viewer.mjs` a `.test-build/`, así que
  `openLiveViewer` solo resuelve el script desde el árbol fuente. En producción es correcto porque
  `package.json` declara `pi.extensions = ./src/index.ts`; si alguna vez se publica compilado, el
  script deberá copiarse en el paso de build.
- **L8** (usuario, literal): «pero tambien me gustaria poder conectar por usd hay que ver como se lo
  agrega p[ara] poder escoger como se conecta hay que cuando corra el debugaer a cell pueda
  escvogar con una ventana flotante si se conecta por wiffi y hay poner el url o por usb hazlo para
  porbar otra vez yo voy a desvinvular el cell para hacerlo desde cerro otra vez» → autoriza el
  selector flotante USB/Wi-Fi y el flujo de vinculación desde cero.
- **L9** (evidencia): `winget list --id dorssel.usbipd-win` → «No se encontró ningún paquete».
  `usbipd-win` **no** está instalado, por eso el cable hoy no es visible desde WSL. `powershell.exe`
  (`/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`) y `winget.exe`
  (`/mnt/c/Users/Dc Laptop/AppData/Local/Microsoft/WindowsApps/winget.exe`) sí son ejecutables desde
  WSL, así que la instalación es posible sin salir de la sesión.
- **L10** (evidencia USB real, 2026-11-14): tras `winget install dorssel.usbipd-win` (5.3.0), `bind`
  elevado + `attach --wsl`, el celular expone `1-1:1.4 ff/42/01` (ADB). `adb devices -l` →
  `RFCNB0MET4V device usb:1-1 product:r8quex model:SM_G781U1`. E2E por USB con el driver: PNG de
  251.974 bytes y 36 elementos. Dos hechos de estabilidad: (a) cada re-enumeración cambia el devnum y
  vuelve a dejar el nodo en `root:root`, y el servidor adb cachea el fallo — hace falta chmod +
  reinicio; (b) `usbipd attach` soporta `--auto-attach`, que re-adjunta solo mientras el proceso vive.
- **L11** (decisión): el usuario pide estabilizar la conexión «con adaptadores que revisen y creen la
  conexión estable», por USB o Wi-Fi. Se resuelve en S15-S17 dentro de la feature, sin reglas udev del
  sistema y sin dependencias nuevas.
- **L12** (evidencia): `adb mdns services` devuelve vacío con la depuración inalámbrica apagada, pero
  el binario soporta descubrimiento; es la vía para no volver a teclear puertos efímeros.
- **L13** (estrategia de entrega y límites de slice): la feature completa ronda las 4.200 líneas, así
  que se entrega en cuatro slices sobre `feat/dc-mobile`, sin push, ordenados por dependencia y con
  sus tests en el mismo commit:
  1. `903e6d1` — driver, parser de jerarquía, visor y `test/dc-mobile.test.ts` (1.108 líneas; supera la
     guía de 400 porque driver y parser comparten el mismo contrato de `@eN` y no se pueden separar
     sin dejar un test huérfano de su implementación).
  2. conexión + permisos USB + `test/dc-mobile-connection.test.ts`.
  3. supervisor + `test/dc-mobile-supervisor.test.ts`.
  4. modal, herramientas, comando, brick, skill y documentación.
  La revisión se pide por slice, no por feature completa.
