# dc-mobile · camino único de conexión Wi-Fi

Rediseño del wizard de conexión: una sola ruta Wi-Fi (conectar → vincular solo si falla), con pantalla de progreso real (spinner + log) y sin bloqueo del event loop.

## Specs

- **S1 — Una sola opción Wi-Fi.** El menú inicial ofrece exactamente tres opciones: `USB · detectar dispositivo`, `Wi-Fi · conectar`, `Cancelar`. La opción separada de vinculación desaparece. Texto del usuario: «debe ser un unico camnino en este moeento hay dos y eso esta mal debe ser o usb o wifi».
- **S2 — Primera pantalla: la URL principal.** Al elegir Wi-Fi se pide la URL que muestra la pantalla principal de depuración inalámbrica (IP:puerto), con prefijo o valor precargado si hay última dirección conocida, y Enter inicia el intento. Texto del usuario: «debe de abrirme para ingresar el URL que me sale en la pantalla de la pantalla de encima y darle Enter».
- **S3 — Si ya está vinculado, se salta la vinculación.** Si el connect funciona, no aparece ninguna pantalla de vinculación: la ventana termina con éxito y el panel avisa conectado. Texto del usuario: «Si yo pongo Wifi y pongo el URL de oyente y ya está vinculado, automáticamente se tiene que saltar, me tiene que seguir conectado y listo».
- **S4 — Segunda pantalla: URL de vinculación + código juntos.** Solo si el connect falla, aparece una pantalla con dos campos visibles: `IP:puerto del diálogo de vinculación` y `Código de 6 dígitos`. Texto del usuario: «Si es que no se puede conectar, debería salirme otra pantalla pidiéndome el URL y el código».
- **S5 — Pantalla de progreso con spinner y log.** Al confirmar cualquiera de las dos pantallas, la ventana pasa a un estado de progreso con un indicador animado y un log incremental de lo que ocurre (intentos, orden ejecutada, stdout/stderr de adb). La UI debe repintarse mientras el comando corre: prohibido bloquear el event loop con `execFileSync` en este flujo. Esc cancela. Texto del usuario: «debería irme a otra pantalla que tenga como un slider, un logger, mientras se conecta, que me vaya conectando».
- **S6 — Éxito y error.** Éxito: la ventana cierra con la dirección conectada y el panel reporta conectado, persistiendo la preferencia. Error de vinculación: se vuelve a la pantalla de vinculación conservando lo escrito y mostrando el log, sin cerrar la ventana.
- **S7 — Reintento automático tras vincular.** Tras una vinculación correcta se reintenta el connect contra la URL principal ya ingresada, sin pedirla de nuevo. Texto del usuario: «verifique la vinculación y vuelvo a intentar conectarse y me dé OK».
- **S8 — Sin regresiones fuera del wizard.** El flujo USB, los tools (`dc_mobile_connect` y compañía), el supervisor y las funciones síncronas `connectWifi`/`pairWifi` conservan su comportamiento y sus firmas.

- **S9 — Tras vincular, nunca reusar el puerto viejo.** Si la vinculación fue correcta pero el connect posterior falla, la pantalla de dirección vuelve con **host y puerto vacío** (`host:`), nunca con el puerto anterior precargado, y con el aviso de que el puerto de depuración inalámbrica cambia al vincular. Síntoma reportado: «si se vincula pero me pide vincularlo ... el ui me pido que me vincule otra vez»; causa: el reintento usaba el mismo `host:puerto` viejo y Enter lo repetía, así que el fallo volvía a abrir la vinculación en bucle.
- **S10 — Un host ya vinculado no vuelve a pedir vinculación.** El wizard recuerda los hosts vinculados (preferencia persistida + estado de sesión). Si el connect falla contra un host ya vinculado, se queda en la pantalla de dirección con un error explícito sobre el puerto, y la pantalla de vinculación solo se abre si el usuario la pide de forma explícita con la tecla `p`.
- **S11 — La vinculación sobrevive al reload.** Una vinculación correcta devuelve `pairedHost` en el resultado y el panel lo persiste en `prefs.pairedHosts` (lista de hosts, sin duplicados).

## Tasks

- T1 · Wizard de un solo camino: menú de 3 opciones, pantalla URL principal, pantalla URL+código, transiciones S1–S4, S7 · inline/worker · commit pendiente
- T2 · Ejecución asíncrona con log: módulo core con `execFile` asíncrono + estado de progreso con spinner y log incremental (S5) · worker · commit pendiente
- T4 · Anti-bucle de vinculación: puerto vacío tras vincular, hosts recordados, re-vinculación explícita con `p`, persistencia de `pairedHost` (S9–S11) · worker · commit pendiente
- T3 · Verificación: tests de los flujos (connect directo, connect falla → vincular → reintento, error de código), tsc, build, archivos de test de dc-mobile (S6, S8) · worker · commit pendiente

## Log

- L1: «avre antes de continuar esta mal la parte de la coneccion con wifi debe ser un unico camnino en este moeento hay dos y eso esta mal debe ser o usb o wifi Si escojo Wifi, debe de abrirme para ingresar el URL que me sale en la pantalla de la pantalla de encima y darle Enter. Si es que no se puede conectar, debería salirme otra pantalla pidiéndome el URL y el código. Y en lo que yo diente, debería irme a otra pantalla que tenga como un slider, un logger, mientras se conecta, que me vaya conectando. Y una vez que me esté conectado, salga conectado. Y listo. Si yo pongo Wifi y pongo el URL de oyente y ya está vinculado, automáticamente se tiene que saltar, me tiene que seguir conectado y listo. Así que arreglemos eso. Revisa y me avisa.»
- L2: «sigue bb»
- L3: «a ver hay un probelma cuando se conecta por el url directo si se vicncula pero me pide vincularlo no se por que porque sunado lo hace si se vinculo pero el ui me pido que me vincule otra vez puede revisar eso»
- L4: «sigue»
