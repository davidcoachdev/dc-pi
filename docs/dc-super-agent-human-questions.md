# Responder consultas del Super-Agent

Los workers publican preguntas mediante `dcRemoteQuestionManager`. El supervisor de
`registerWebhookDaemonCommands` consulta `getPendingQuestions()` y abre
`promptAgentQuestionModal` usando el contexto TUI que el sidebar ya publica en
`Symbol.for("dc.sidebar.ctx")`. No modifica el sidebar ni inicia un daemon para
mostrar preguntas. Sin contexto, sin UI o fuera de modo TUI, deja la consulta pendiente.

## Controles

- `1..9`: responder una opción disponible; flechas para seleccionar y Enter o espacio para enviar.
- Tab: pasar a texto libre o volver a las opciones.
- Escribir: iniciar una respuesta propia, incluyendo `ñ`, tildes y texto pegado.
- En texto libre: izquierda/derecha, retroceso y Supr operan sobre grafemas completos,
  sin dividir emojis ni letras con tildes combinadas (como `n` + `◌̃`). La inserción
  mantiene el cursor en un límite de grafema incluso si une caracteres adyacentes.
  Enter envía el texto sin espacios exteriores. Un campo vacío envía la opción seleccionada.
- Esc: descartar la pregunta, tanto en selección como en edición.
- Si `allowCustomText` es falso, escribir y pegar no habilitan texto libre.

El panel admite texto imprimible Unicode, pegados ordinarios y el paquete completo
bracketed-paste que entrega el terminal de Pi. Los dígitos dentro de un pegado no
seleccionan opciones. También usa el decodificador imprimible Kitty de Pi para
teclados con ese protocolo. Rechaza bloques que contengan controles C0, DEL o C1,
incluidas secuencias de terminal; un pegado con saltos de línea se rechaza, no se
interpreta como Enter ni se inserta en el campo de una sola línea.

## Centro de Control en la terminal

La pestaña Central conserva la lista de decisiones y tareas a la izquierda y el
inspector a la derecha. Por debajo de 80 columnas, el inspector se coloca debajo
de la lista. La selección desplaza la lista para mantener visible el elemento.

- Abre en **EN VIVO**: solo muestra preguntas pendientes y despachos locales reales.
  No afirma sincronización con GitHub ni inventa capacidad de agentes o historial
  de entregas. `r` vuelve a consultar el estado al renderizar.
- `1..3`, Tab y izquierda/derecha (también con Ctrl): Central, Colaboradores y Audit Log.
- Arriba/abajo o `j/k`: seleccionar; PageUp/PageDown o Ctrl+arriba/abajo: avanzar cinco.
- En una pregunta, `[` y `]` seleccionan la opción; Enter, `a` o `s` envían
  **esa opción**, no una aprobación implícita. `n` descarta únicamente la pregunta:
  no cancela tareas ni descarta PRs.
- `/` o Ctrl+K: respuesta libre cuando la pregunta la admite. Enter envía;
  Esc cancela la edición sin cerrar la ventana. Admite Unicode, pegados de una
  línea y retroceso por grafemas. Los bloques con controles se rechazan.
  La edición permanece asociada a la pregunta original aunque lleguen otras;
  si ya fue respondida o expiró, no se envía de nuevo.
- `m`: demostración opcional con ejemplos separados de los datos reales.
  No responde preguntas, escribe auditoría ni cambia permisos. Volver a `m`
  recupera la vista real y limpia selección y edición.
- Los detalles de una tarea muestran su rama, worktree y tareas del documento ODD,
  incluidas las líneas con iconos de estado. Si no hay hoja legible, se informa;
  nunca se inventa progreso. La vista no ejecuta arreglos, merges, recordatorios
  ni aperturas de GitHub; `d` y `o` indican que no están disponibles.
- En Colaboradores, espacio o clic sobre una fila real conserva la alternancia
  existente ALLOW → BLOCK → PENDING. En demostración está deshabilitada.
  La lista de colaboradores y las últimas 50 entradas de auditoría se desplazan.
- El ratón selecciona filas y pestañas según su posición renderizada. Pulsar
  contenido arbitrario del inspector nunca envía una respuesta.
- `?`: ayuda; Esc o `q`: salir (Esc primero cierra ayuda o edición).

`test/dc-control-center-live.test.ts` usa HOME y buzones aislados y los métodos
públicos de la vista para comprobar datos reales, aislamiento de demostración,
respuestas por buzón, ODD, navegación, ratón y límites de anchura. Las pruebas de
la ventana anterior conservan navegación de pestañas, edición y ayuda y activan
explícitamente la demostración para inspeccionar sus ejemplos.

## Ciclo de vida y pruebas

Se conserva el buzón y los tipos de respuesta existentes: `option`, `custom_text`
y `dismissed`. Mientras una pregunta está abierta no se abre otra en paralelo.
El temporizador supervisor usa `unref` y se limpia en `session_shutdown`, incluso
al recargar; una recarga no detiene el daemon, pero una salida real sí.

`test/dc-remote-question.test.ts` ejercita el registro público del supervisor y la
modal real mediante una UI simulada, sin daemon ni red. Comprueba el contexto
publicado, modos no interactivos, exclusión de aperturas concurrentes, respuesta
por buzón y limpieza del temporizador. `test/dc-agent-question-modal.test.ts`
ejercita Unicode, pegados, Kitty, rechazo de controles y los controles anteriores.
Incluye regresiones públicas de retroceso/Supr, límites izquierda/derecha e inserción
con caracteres suplementarios y `ñ` descompuesta, además de ASCII y selección.
Ambos aíslan HOME antes de importar los singletons y usan buzones temporales.
