# DC Super-Agent 86 - Ciclo de Vida Continuo de Issues y PRs
Objective: renombrar el agente a `dc-super-agente-86`, soportar ciclo de vida continuo mientras el issue esté abierto (ejecución automática ante nuevas directivas por comentarios de GitHub y actualización de PR existente), y enriquecer `/dc-webhook check` con modal flotante para issues cerrados, detección de PR existente y confirmación de nuevas tareas añadidas.
Branch: `feat/dc-super-agent-86-lifecycle`

## Specs
S1. Rebranding a `dc-super-agente-86`: Renombrar la identidad, logs y mensajes de notificación del agente a `dc-super-agente-86`.
S2. Reactivación automática ante nuevas directivas en comentarios de GitHub: Mientras el issue permanezca abierto (`state === 'OPEN'`), ante directivas del OWNER (`añade:`, `agrega:`, `/dc add`), el enrutador debe no solo anotar en la hoja ODD sino despachar/reanudar automáticamente la sesión autónoma del agente, resolver las directivas y actualizar la rama del PR existente. Si el agente requiere aclaraciones durante la ejecución, debe consultar interactivamente vía modal TUI.
S3. Comprobación inteligente en `/dc-webhook check`:
    - Si el issue seleccionado está cerrado (`state === 'CLOSED'`), mostrar un modal flotante / notificación informando que el issue está cerrado y no debe ejecutarse.
    - Si el issue tiene un Pull Request existente, mostrar la información del issue y el enlace del PR.
    - Si el issue tiene un PR existente pero hay nuevas directivas/tareas pendientes, comunicarlo y preguntar interactivamente si el usuario desea implementarlas. Al confirmar, ejecutar sobre el worktree y actualizar la rama del PR.
S4. Entrega continua sobre PR existente: `dc-pr-delivery.ts` debe detectar si la rama ya tiene una PR abierta asociada (`gh pr list --head <branch>` o metadatos de entrega previos), y en lugar de fallar al intentar recrear la PR (`gh pr create`), debe hacer push a la rama para actualizar el PR existente y comentar en el issue y PR con la nueva evidencia de verificación determinista.
S5. Suite de tests deterministas cubriendo reactivación por comentario, detección de issue cerrado, PR existente con nuevas tareas, push update de PR, typecheck y build en verde.

## Tasks
T1 | S1 | inline | pending | Renombrar identidad y referencias a `dc-super-agente-86`
T2 | S4 | inline | pending | Actualización continua de PR existente en `dc-pr-delivery.ts`
T3 | S2 | inline | pending | Reactivación automática de implementación ante comentarios en `dc-issue-comment-router.ts` y daemon manager
T4 | S3 | inline | pending | Modal flotante para issues cerrados, detección de PR y confirmación de nuevas tareas en `dc-webhook-commands.ts`
T5 | S5 | inline | pending | Tests unitarios y de integración, typecheck y build

## Log
L1. Usuario verbatim: "no primero el dc-super-agnet-86 ese va hacer su nuevo nombre y si cunado revisa una nueva tarea debe realizarla mientras el iossues no este cerrado debe realiozar lo que se le pide y actualizar el pr para que el nuevo agnete que vamos a implementer el dc-super-agnete-99 que va ahcer el encargado de lo pr lo revise pero esa implementacion va despues ahorra trabajemos en arreglar eso asi si yo puedo hacer el check y escoger el sisues y si el isues ya esta cerrado me de un nese en euna ventana flotante que el isues ya esta cerrado , y si ya esta el pr me de un nsm del isuues y el pr, pero si hay nuevas tareas anadidas me lo dija y me pregunte si deseo implementarloa pero si yo popr msn de giothub le envio una nuea tarea y el isues no esta cerrado  el debe automaticamente comenzar la imple mentacion y si neceesita perguintyarm,e algo para el trabajo hacer por el model de forma interctiv apilas bb"
