---
name: dc-artifact-contracts
description: "Define los contratos y plantillas canónicas de Markdown para las 4 fases del flujo planificado de DC Studio: discovery.md, plan.md, apply.md y verify.md. Trigger: formato de artefactos, contrato de plan, plantilla de discovery o verificacion estructurada."
license: MIT
metadata:
  author: dc-studio
  version: "1.1"
---

# DC Artifact Contracts (Contratos de Artefactos de Fase)

Esta skill especifica la estructura y el contenido obligatorio de los 4 artefactos que gobiernan las fases del flujo planificado de DC Studio bajo `openspec/changes/<change-slug>/`.

---

## 1. Fase 0: `discovery.md` (Exploración Local)

```markdown
# Discovery: <Título del Cambio>

## Objetivo de la Investigación
<Pregunta puntual o problema a investigar>

## Archivos y Símbolos Relevantes
- `ruta/al/archivo.ts`: descripción del rol en el problema
- `ruta/al/test.ts`: cobertura actual

## Supuestos y Decisiones de Negocio (De-risking)
- Supuesto 1: Default razonable asumido para avanzar sin frenar la exploración.
- Supuesto 2: Criterio de borde aceptado.

## Hallazgos Técnicos Clave
- Comportamiento observado vs esperado
- Causa raíz identificada

## Restricciones y Lo Fuera de Alcance (Non-Goals)
- Lo que explícitamente no se modificará en este cambio

## Handoff
- Status: READY | BLOCKED
- Next Action: Proceder a planificación (Fase 1)
```

---

## 2. Fase 1: `plan.md` (Contrato de Implementación)

```markdown
# Plan de Implementación: <Título del Cambio>

## Alcance Aprobado
- Qué se va a construir o modificar.
- Lo que queda explícitamente fuera de alcance (Non-Goals).

## Superficie de Edición Permitida (Allowed Edit Surfaces)
- `src/features/ejemplo/**/*.ts`
- `test/ejemplo.test.ts`
*(Prohibido el uso de `.` o rutas absolutas)*

## Grafo de Tareas de Implementación (DAG)
1. [ ] **T1**: Título de la primera tarea
   - files: `test/ejemplo.test.ts`, `src/features/ejemplo/core.ts`
   - depends: []
   - evidence: `npm test -- test/ejemplo.test.ts`
   - review: ~40 changed lines
2. [ ] **T2**: Título de la tarea dependiente
   - files: `src/features/ejemplo/index.ts`
   - depends: [T1]
   - evidence: `npm run build`
   - review: ~25 changed lines

## Review Workload (Presupuesto de Revisión)
| Tarea | Líneas Estimadas |
| :--- | :--- |
| T1 | ~40 |
| T2 | ~25 |
| **Total** | **~65 changed lines** |

## Criterios de Aceptación y Verificación
- Criterio 1: La prueba X pasa.
- Criterio 2: TypeScript compila limpio con `tsc`.

## Handoff
- Status: READY
- Next Action: Solicitar autorización al usuario para aplicar cambios (Fase 2)
```

---

## 3. Fase 2: `apply.md` (Evidencia de Implementación)

```markdown
# Evidencia de Implementación: <Título del Cambio>

## Resumen de Cambios Aplicados
- Archivos modificados y qué se añadió/corrigió en cada uno dentro de las superficies autorizadas.

## TDD Cycle Evidence
| Tarea | Test File | Falla Inicial (RED) | Aprobado (GREEN) | Comando Verificación |
| :--- | :--- | :--- | :--- | :--- |
| T1 | `test/ejemplo.test.ts` | Error esperado comprobado | Pass (suite en verde) | `npm test -- test/ejemplo.test.ts` |

## Comprobaciones Globales Ejecutadas
- `npm run build`: Exitoso.
- `node --test ...`: Pasando al 100%.

## Handoff
- Status: READY
- Next Action: Auditoría y verificación independiente (Fase 3)
```

---

## 4. Fase 3: `verify.md` (Auditoría Independiente)

```markdown
# Verificación Independiente: <Título del Cambio>

## Auditoría de Disciplina TDD y Calidad
- [x] TDD Cycle Evidence verificado: Cada cambio de código cuenta con test inicial en RED.
- [x] Calidad de aserciones: Sin aserciones vacías, sin tautologías (`assert.ok(true)`), validaciones de comportamiento real.

## Matriz de Verificación de Criterios
| Criterio del Plan | Estado | Evidencia Observada por Auditor |
| :--- | :--- | :--- |
| Criterio 1 | CUMPLIDO | Test unitario X ejecutado y pasando |
| Criterio 2 | CUMPLIDO | Build de tsc sin errores |

## Análisis de Regresiones
- No se observan efectos secundarios en módulos vecinos.

## Veredicto Final
- Dictamen: APROBADO (o RECHAZADO con motivo exacto)
- Status: READY
- Next Action: Presentar resultado final al usuario para cierre.
```
