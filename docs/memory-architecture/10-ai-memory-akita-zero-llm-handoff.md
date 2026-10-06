# 10 - ai-memory: Resumen Zero-LLM y Protocolo de Handoff (Fabio Akita)

- **Fuente:** Repositorio oficial `akitaonrails/ai-memory` (Fabio Akita, Rust core).
- **URL:** https://github.com/akitaonrails/ai-memory

---

## 1. Resumen y Filosofía
Fabio Akita diseñó un sistema en Rust para saltar entre diferentes agentes de programación (Claude Code, Pi, Codex, Cursor) sin perder contexto, con una premisa clave: **costo cero y cero llamadas a LLMs por defecto**.

## 2. Hallazgos Clave
- **Resumen Base Zero-LLM en `SessionEnd`:** Un compilador determinista lee el prompt inicial, el `git diff --stat`, los archivos modificados y los exit codes de los comandos para armar la bitácora sin gastar un solo token de API.
- **Protocolo Formal de Handoff (`Handoff` con estado `claimed_once`):** Al cerrar sesión, deja la posta sellada (qué se completó, qué falló, cuál es la siguiente acción) para que la próxima sesión la reclame automáticamente.
- **Decaimiento Ponderado por Acceso (Access-Weighted Retention):** Las notas que no se consultan pierden prioridad con el tiempo; las notas que se buscan o leen renuevan su vigencia. Todo calculado sin LLMs.
- **Spool Local Atómico:** Los hooks de terminal escriben en un archivo local no bloqueante (<1ms) para no congelar la interacción del usuario.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Resumen base determinista a costo $0 en el hook `session_end`.
- Integración con el protocolo de handoff de `dc-handoff`.
- Envejecimiento de notas por frecuencia de acceso.
- Escrituras locales atómicas sin latencia en la terminal.
