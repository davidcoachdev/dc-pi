# Feature: DC Super-Agent Interactive Remote Questions, Contextual Modals and Autonomous LLM Engine

## Specs
S1: Canal IPC de Consultas Remotas (`DcRemoteQuestionManager`):
  - Directorio en `~/.pi/agent/dc-studio/questions/` y `answers/`.
  - Permite que un worker en background escriba un `AgentQuestionPacket` (issueNumber, issueTitle, contextSummary, question, options?, allowCustomText).
  - El proceso supervisor o daemon detecta la solicitud y abre una ventana modal interactiva en la terminal del usuario.
S2: Ventana Modal Interactiva de Consulta (`DcAgentQuestionModal`):
  - Marco retro DOS con `openDcModal` y `DcWindow` de tamaño fijo y consistente.
  - Sección 1: 📌 Contexto enriquecido (qué ha hecho el agente, qué archivos analizó).
  - Sección 2: ❓ Pregunta clara y directa.
  - Sección 3: 💡 Opciones rápidas enumeradas (`[1]`, `[2]`, `[3]`).
  - Sección 4: ✍️ Entrada interactiva de texto libre (`allowCustomText`) con cursor, backspace y submit en `Enter`.
S3: Script/Herramienta CLI invocable por el subagente (`dc-ask-human`):
  - Invocable por el worker dentro de su worktree: `node <dc-ask-human-path> --issue=N --context="..." --question="..." --options="A|B"`.
  - Queda bloqueado esperando sincrónicamente la respuesta del usuario (con timeout defensivo) y devuelve la respuesta elegida (opción o texto libre) a stdout para que el LLM la consuma de inmediato.
S4: Motor de Ejecución Autónomo con LLM Real (`DcWorkerRunner.executeAutonomousLlmSession`):
  - Spawnea `pi -p` dentro de `worktreePath` utilizando el modelo del Taxi arrendado (`plan.fullModelRef`).
  - Inyecta en el prompt las directivas de seguridad, requerimiento verbatim, y la disponibilidad del comando `dc-ask-human` ante dudas de diseño o bloqueos.
  - Supervisa que el LLM genere código real y verifique con tests antes de proceder a la creación de la Pull Request.

## Tasks
T1: (S1, S3) Remote Question IPC Channel & CLI Helper -> src/features/dc-agents/daemon/dc-remote-question.ts
T2: (S2) Interactive Question Modal Component with Context & Free Text -> src/features/dc-agents/views/dc-agent-question-modal.ts
T3: (S4) Autonomous LLM Execution Engine in DcWorkerRunner & Daemon -> src/features/dc-agents/daemon/dc-worker-runner.ts, src/features/dc-agents/daemon/dc-webhook-daemon-manager.ts
T4: (S1-S4) Unit Tests & Verification -> test/dc-remote-question.test.ts, npm test

## Log
L1: Usuario solicita: "pero si tiene que preguntarme algo como lo va hacer", "dale la opcion que yo pueda enviarle texto si no estoy deacuerdo a las opciones asi que la preguinta debe ser clara y se se puede con contexto recuerda que yo no estoy viendo que esta haciendo", "que sea una ventana interactiva siempre si vamos".
