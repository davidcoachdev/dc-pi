---
name: dc-planned-workflow
description: "Orquesta el flujo de trabajo planificado y por fases de DC Studio como alternativa estructurada a ODD. Ejecuta un pipeline cerrado de 4 fases (Discovery -> Planning -> Apply -> Verify) con contratos formales en openspec/changes/<slug>/. Trigger: flujo planificado, modo planificado, planned workflow, desarrollo por fases, o tareas que requieran contratos estrictos."
license: MIT
metadata:
  author: dc-studio
  version: "1.1"
---

# DC Planned Workflow (Flujo de Desarrollo Planificado)

## Filosofía
El **DC Planned Workflow** es la alternativa estructurada a ODD dentro del ecosistema DC Studio. Mientras ODD es orgánico, ágil y sin fricción de archivos previos, el flujo planificado es **formal, cerrado y guiado por contratos escritos**.

Ideal para tareas complejas, refactors arquitectónicos de alto riesgo o cuando el usuario solicita expresamente un ciclo por fases independientes ("modo planificado", "hacelo por fases", "planned workflow").

---

## Cuándo Activar y Cuándo NO (Anti-Hijacking)
Para proteger la agilidad del desarrollador y evitar fricción burocrática innecesaria:

- **Cuándo Activar**:
  1. El pedido describe un **trabajo no trivial** (nueva feature, refactor estructural, o cambio multi-módulo que requiera especificación).
  2. Existe una **señal explícita de intención** ("usá el flujo planificado", "hacelo con spec", "modo fases").
- **Cuándo NO Activar (Conservadurismo estricto)**:
  - Preguntas explicativas o de investigación ("cómo funciona X").
  - Fixes puntuales o cambios mecánicos de 1 o 2 archivos conocidos (mantenerse en ODD / Inline Direct).
  - Intención ambigua o no solicitada expresamente.

---

## Regla de Traspaso Literal (Pass Verbatim)
Al delegar el pedido del usuario a la Fase 0 (`Discovery`) o a la Fase 1 (`Planning`):
- **Traspaso Literal Obligatorio**: Pasá el texto del requerimiento del usuario **verbatim** (exactamente como lo redactó).
- **Prohibido Deformar**: No resumas, no traduzcas, no podes requerimientos ni reinterpretes las restricciones originales en la orden de fase. El subagente debe recibir la señal original sin pérdida de contexto.

---

## Las 4 Fases Obligatorias

```text
[ Inicio ]
    │
    ▼
1. FASE 0: DISCOVERY (Subagente: dc-phase-discovery)
   • Explora código local de solo lectura.
   • Aplica Clarify con sesgo a asumir supuestos razonables por defecto.
   • Escribe: openspec/changes/<slug>/discovery.md
    │
    ▼
2. FASE 1: PLANNING (Subagente: dc-phase-planning)
   • Diseña la solución, define 'Allowed edit surfaces' y tareas TDD como DAG acíclico.
   • Escribe: openspec/changes/<slug>/plan.md
    │
    ▼
[ ⚠️ GATE DE AUTORIZACIÓN: El usuario aprueba el plan.md antes de escribir código ]
    │
    ▼
3. FASE 2: APPLY (Subagente: dc-phase-apply)
   • Implementa código dentro de las superficies autorizadas.
   • Aplica ciclo Strict TDD (RED -> GREEN -> TRIANGULATE -> REFACTOR).
   • Registra tabla obligatoria 'TDD Cycle Evidence'.
   • Escribe: openspec/changes/<slug>/apply.md
    │
    ▼
4. FASE 3: VERIFY (Subagente: dc-phase-verify)
   • Verificación independiente de criterios de aceptación y tests.
   • Audita la calidad de las aserciones y la evidencia TDD.
   • Escribe: openspec/changes/<slug>/verify.md
    │
    ▼
[ Cierre y reporte final al usuario ]
```

---

## Reglas de Orquestación

1. **Directorio Canónico**:
   - Cada cambio se aísla bajo `openspec/changes/<YYYY-MM-DD-slug>/`.
2. **Circuit Breaker Activo**:
   - Si en cualquier fase falta un dato, requisito o decisión de producto, el subagente se detiene con `BLOCKED` y el orquestador consulta al usuario. Prohibido especular.
3. **Aislamiento de Escritura en Fase 0 y 1**:
   - Durante Discovery y Planning, los archivos del proyecto son de **estricta solo lectura**. Solo se escriben `discovery.md` y `plan.md`.
4. **Pre-Mutation Summary Gate**:
   - Antes de lanzar `dc-phase-apply`, el orquestador presenta al usuario el resumen del plan y solicita confirmación explícita.

---

## Ejecución Efímera de las Fases (`dc_ephemeral_agent_run`)

Cada fase se ejecuta de forma efímera, aislada y con taxi exclusivo de la flota mediante `dc_ephemeral_agent_run`:

- **Fase 0 (Discovery)**:
  `dc_ephemeral_agent_run({ archetype: "dc-phase-discovery", role: "dc-phase-discovery", task: "..." })`
- **Fase 1 (Planning)**:
  `dc_ephemeral_agent_run({ archetype: "dc-phase-planning", role: "dc-phase-planning", task: "..." })`
- **Fase 2 (Apply)**:
  `dc_ephemeral_agent_run({ archetype: "dc-phase-apply", role: "dc-phase-apply", task: "..." })`
- **Fase 3 (Verify)**:
  `dc_ephemeral_agent_run({ archetype: "dc-phase-verify", role: "dc-phase-verify", task: "..." })`

