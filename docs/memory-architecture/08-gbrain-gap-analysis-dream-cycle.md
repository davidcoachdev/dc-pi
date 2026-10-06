# 08 - GBrain: Gap Analysis y el Ciclo de Sueño (Garry Tan)

- **Fuente:** Repositorio oficial `garrytan/gbrain` (Garry Tan, CEO de Y Combinator).
- **Escala en Producción:** 155.795 páginas, 24.589 personas, 66 cron jobs autónomos.
- **URL:** https://github.com/garrytan/gbrain

---

## 1. Resumen y Filosofía
Garry Tan construyó GBrain para alimentar a sus propios agentes personales (OpenClaw, Hermes). Su objetivo es crear un "foso estratégico" de conocimiento personal y empresarial que se consolide mientras duerme.

## 2. Hallazgos Clave
- **Gap Analysis (Análisis de Brechas):** Al responder o consultar la memoria, el sistema no solo entrega lo que sabe; incluye una advertencia explícita sobre lo que **NO sabe** o qué información está "fría" (>20 días sin actualizar).
- **El 24/7 "Dream Cycle":** Procesos en segundo plano que corren fuera de turno para enriquecer entidades, reparar citas rotas y consolidar notas mientras el usuario no está activo.
- **Voice Gate de Ingeniería (`DESIGN.md`):** Reglas estrictas de tono:
  - Habla como un colega técnico senior.
  - Basado en datos concretos y verificables ("2 de 3 tests fallaron").
  - Cero sermones ("we recommend").
  - Máximo 25 palabras para la narrativa; menos de una línea para el estado.
- **Capa "Decide" (System 1):** Preguntas tipadas rápidas (probabilidades, opciones cerradas) para resolver conflictos de memoria en milisegundos.

## 3. Qué adoptamos en DC Studio (`dc-sentinel`)
- **Gap Analysis:** Alerta en la ventana TUI si el módulo consultado tiene conocimiento frío o desactualizado.
- **Dream Cycle:** Consolidación profunda cuando el agente está en reposo (`idle`).
- **Voice Gate:** Tono de *el Gentleman* en toda la síntesis de la bitácora.
