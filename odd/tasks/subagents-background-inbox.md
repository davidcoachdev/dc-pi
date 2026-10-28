# Subagents Background Inbox, Passive Handshake and Parent-Child Channel

## Specs
S1. User statement: "primero la comunicacion debe ser entre padre ah hijo al menos que tenga yo que aceptar o tenga que ver algo importante". The parent orchestrator and child subagent must communicate directly (`subagent_send_message`, `subagent_reply`) for technical inquiries, scope clarification, and context handoff without bothering the user, unless explicit user consent or a critical product decision is required.
S2. User statement: "siempre tener la comunicacion con el orquestador ponte que envio a hacer algo y quiero que revise un repo para ver que podemos usar puedo enviar a una cedula asi yo puedo seguir orquestando con el orquestador y los subagentes van en segundo plano". Background subagents must run as decoupled task cells. Background execution must never hijack, stall, or lock the interactive user-orchestrator terminal turn.
S3. User statement: "debe avisar al padre termine y ver el informe y cuando ocurra un problema tambien debe enviar el informe con el formato que ya esta predefinido". When a background subagent finishes, it must deposit its completion into an immutable session inbox and emit a non-invasive visual notification (UI toast/status); it must NEVER force an automatic turn takeover via `{ triggerTurn: true }`. When a failure occurs, it must structure the report with the canonical failure schema: Error Summary, Root Cause, Falsified Premises, and Actionable Recovery Steps.

## Tasks
T1 | S2 | inline | pending | Implement passive background delivery interceptor: prevent background completion wake from invoking `triggerTurn: true` while the user is interacting, routing completions to a structured inbox.
T2 | S3 | inline | pending | Implement canonical failure report formatter for background subagents and ephemeral agents (Error, Root Cause, Falsified Premises, Recovery).
T3 | S1-S2 | inline | pending | Wire autonomous parent-child handshake: subagent queries route to orchestrator context first, bubbling to user only on explicit approval or blocking uncertainty.
T4 | S1-S3 | inline | pending | Comprehensive deterministic test suite for inbox delivery, non-invasive notification, error reporting schema, and parent-child communication.

## Log
L1. User requested architecture: autonomous parent-child channel, decoupled background worker cells without terminal locking, passive completion inbox, and standardized error reports. Feature initialized on branch feat/subagents-background-inbox-and-handshake.
