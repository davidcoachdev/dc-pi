# 11 - Persistent AI Memory (PAM v2.0): Task Coordinator e Idle Heartbeat

- **Fuente:** Repositorio oficial `savantskie/persistent-ai-memory`.
- **URL:** https://github.com/savantskie/persistent-ai-memory

---

## 1. Resumen y Arquitectura
PAM v2.0 es un sistema de memoria para producción en Python y SQLite que opera detrás de OpenWebUI, LM Studio y servidores MCP.

## 2. Hallazgos Clave
- **Task Coordinator Centralizado:** Reemplaza los bucles ciegos `while True: sleep(...)` por un programador de tareas con tres niveles de control de concurrencia:
  - `db_light`: Tareas de lectura que corren libremente.
  - `db_heavy`: Mutex por base de datos (un solo escritor a la vez para evitar `database is locked` en SQLite).
  - `llm`: Mutex global para no saturar la GPU o disparar rate-limits de APIs.
- **Heartbeat de Inactividad (`last_inlet.touch`):** Detecta si el usuario está tipeando activamente; si hay actividad en los últimos 10 minutos, pausa todo el mantenimiento pesado de fondo.
- **Auditoría de Herramientas MCP (`filter_tool_calls`):** Registra el éxito o fallo de herramientas para detectar errores y gotchas recurrentes.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Coordinador de tareas con mutex de base de datos para evitar bloqueos en SQLite.
- Heartbeat de inactividad: no correr consolidaciones pesadas mientras el usuario está programando.
- Registro de fallos de tools para catalogar advertencias `[gotcha]`.
