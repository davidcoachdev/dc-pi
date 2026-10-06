# 06 - OpenHuman: Memory Pack Efímero y Memory Chips en UI

- **Fuente:** Repositorio oficial `tinyhumansai/openhuman` (Rust core, Memory v2 / `tinymemory`).
- **URL:** https://github.com/tinyhumansai/openhuman

---

## 1. Resumen y Arquitectura
OpenHuman es un arnés para agentes en Rust con soporte para desktop, web y terminal. Su arquitectura de memoria desacopla completamente el almacenamiento de la sesión interactiva del modelo.

## 2. Hallazgos Críticos
- **La Invariante: *"The Pack Never Enters the Transcript"*:**
  El bloque de memoria inyectado para el turno (`Memory Pack`) se envía como una instrucción efímera (`push_ephemeral_instruction`) envuelta en `<memory-context>`. **Jamás se persiste en el archivo JSONL de la sesión ni en el historial de Git**. Esto evita que la memoria se duplique en el chat y protege el prompt caching.
- **Memory Chips en Vivo en la Interfaz (`memory-chips.tsx`):**
  La UI muestra chips compactos con las memorias citadas en cada turno, diferenciando estados: `added` (verde), `updated` (amarillo), `existing` (azul).
- **Acción "Forget" en Vivo:** Cada chip incluye un botón de descarte (`[d]` / `[x]`) para que el usuario pueda purgar una memoria errónea directamente desde la pantalla sin tocar la base de datos.
- **Rescate en Compactación (`recall_for_compaction`):** Cuando la sesión llega a 150k tokens y Pi debe compactar, el sistema extrae los hechos clave de los turnos a borrar y los sella en el checkpoint.
- **Retardo de Consolidación (`build_delay_secs`):** Encola la consolidación con un delay de 2 a 5 minutos para consolidar ráfagas de comandos juntas en reposo.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- Inyección efímera: el contexto de bitácora no ensucia el transcript de Pi.
- Componente visual de **Memory Chips** en la ventana TUI con acción interactiva `[d]` para olvidar recuerdos.
- Rescate de contexto en los hooks de compactación de Pi.
- Retardo de consolidación cuando el agente está en reposo (`idle`).
