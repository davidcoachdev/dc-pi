# Feature: Sistema Integral de Moderación, Analizador de Seguridad, Strikes y Gestión en DC-Control

## Specs
- S1: "hay que crear dos cosas una estandarizar las respuesta de los agentes"
- S2: "cuando llege un comentario de alguien sin permiso en la ventana de consulta al usuario tambien quiero la opcion de bloquear y caundo llege un comentario de alguien bloquedo lo made al log y borre el comentario sin respuesta del agente"
- S3: "pensar como tener un analizador de los comentario porque si es un comentario pasado de tono o comando malicioso automaticamente lo bloque y borre el comentario pero siempre pidiendo confirmacion del usuario con las opciones: ignorar -> no hace nada, borrar -> borra el comentario y va un ultimatum por no cumplir las normas de la comunidad, bloquear -> eliminar el comentario, agregar al usuario a la lista negra y bloquear el usuario en github"
- S4: "cuando ponga borrar hay que crear una base para anadir al usuario y darle 2 oportunidades y a la tercera se procede a bloquear"
- S5: "agregar a la ventana de control para ver usuarios bloqueados y poderlos desbloquear y cuando se bloquea guardar en base de datos el motivo y las evidencias de cada oportunidad"

## Tasks
- [ ] T1: (Fase 1 - Formateador Estandarizado) Crear `DcAgentResponseFormatter` con firmas institucionales canónicas para #86, #99, DC-Control y Shield | route: inline
- [ ] T2: (Fase 2 - Analizador de Comentarios) Implementar `DcCommentAnalyzer` para clasificar riesgo (`BENIGN`, `OFFENSIVE`, `PROMPT_INJECTION`, `DESTRUCTIVE_COMMAND`) | route: inline
- [ ] T3: (Fase 3 - Esquema de Strikes & Moderación) Crear tabla `moderation_records` y gestor `DcModerationManager` (3-Strikes, borrado en GitHub, bloqueo/desbloqueo de cuentas) | route: inline
- [ ] T4: (Fase 4 - Router & Modal Interactivo) Integrar en `dc-issue-comment-router.ts` y en el modal de intervención las opciones [1. Ignorar], [2. Borrar + Strike], [3. Bloquear] y auto-purga de bloqueados | route: inline
- [ ] T5: (Fase 5 - Vista de Moderación en DC-Control) Añadir sección interactiva en la Oficina Central `/dc-control` con tabla de bloqueados, visualizador de expedientes y botón de desbloqueo | route: inline
- [ ] T6: (Fase 6 - Verificación Determinista) Pruebas automatizadas de moderación, análisis, strikes y compilación `tsc` exit 0 | route: inline

## Log
- L1: Solicitud inicial: Estandarización de respuestas, analizador semántico de comentarios, sistema de 3 strikes con borrado de comentarios en GitHub y visualizador/desbloqueador en la ventana de DC-Control.
