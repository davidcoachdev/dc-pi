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
