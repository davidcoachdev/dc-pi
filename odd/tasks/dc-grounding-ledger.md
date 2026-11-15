# Grounding Ledger: libro mayor de evidencia para subagentes y herramientas

Feature document for ODD. Read `## Specs` and the assigned task only, then act.

## Specs

**S1.** Crear `src/features/dc-agents/core/dc-grounding-ledger.ts` como un registro in-memory estructurado que rastrea las afirmaciones de subagentes y herramientas, categorizándolas bajo las 4 categorías estrictas de DC Studio:
- `VERIFIED_FACT`: Afirmación respaldada por lectura de archivo, ejecución de test con exit code 0 o salida directa de comando verificable.
- `SUPPORTED_INFERENCE`: Razonamiento deductivo que cita explícitamente hechos verificados previos.
- `UNKNOWN`: Afirmación sin evidencia o suposición no verificada.
- `HUMAN_DECISION_REQUIRED`: Elección de producto o arquitectura que solo el humano puede definir.

**S2.** Parser de Reportes: `auditReportGrounding(reportText: string): GroundingAuditResult`.
Extrae automáticamente claims etiquetados o analiza la presencia de evidencia ejecutable (citas `path:line`, mención de `exit code 0`, comandos de verificación). Si un reporte declara éxito ("completed", "PASS") pero contiene afirmaciones sin evidencia (`UNKNOWN`) o no incluye evidencia de compilación/tests para cambios de código, el estado de auditoría del reporte se marca como `FLAGGED` con razones explícitas.

**S3.** Estructura del Ledger:
- Permite registrar entradas manualmente o mediante la ingesta de reportes (`recordClaim`, `ingestReport`).
- Almacena historial acotado (tope `DC_GROUNDING_LEDGER_LIMIT = 300` entradas).
- Consulta rápida: `getGroundingEntries(taskId?)`, `getAuditSummary(taskId)`.
- Sin persistencia en disco innecesaria (KISS / YAGNI): estado en memoria del proceso, reseteable con `clearGroundingLedger()` para pruebas.

**S4.** Integración con `subagentInboxManager`:
Cuando un subagente deposita su reporte en el inbox (`src/features/dc-agents/core/dc-subagent-inbox.ts`), el inbox invoca `auditReportGrounding` y añade la metadata de grounding al `BackgroundTaskReport`. Si el reporte es `FLAGGED`, se refleja en el estado o badge del reporte sin alterar destructivamente el `outcomeText`.

**S5.** Exportar herramienta para el orquestador:
Crear tool `dc_grounding_audit` en `src/features/dc-agents/tools/dc-grounding-tools.ts` que permita al orquestador inspeccionar las afirmaciones y auditorías de un subagente antes de confiar ciegamente en un reporte completado.

**S6.** Cero timers ciegos, cero dependencias pesadas. Cobertura determinista en `test/dc-grounding-ledger.test.ts`.

## Tasks

- T1 — core: `src/features/dc-agents/core/dc-grounding-ledger.ts` con tipos, ledger in-memory y parser determinista `auditReportGrounding`. Cubre S1, S2, S3. **DONE**
- T2 — inbox wiring: conectar `dc-subagent-inbox.ts` con `auditReportGrounding` para enriquecer los reportes entrantes. Cubre S4. **DONE**
- T3 — tools: `src/features/dc-agents/tools/dc-grounding-tools.ts` (`dc_grounding_audit`) y registro en `src/index.ts`. Cubre S5. **DONE**
- T4 — tests: `test/dc-grounding-ledger.test.ts` con casos de prueba para claims válidos, reportes sin evidencia (flagged) y límites del ledger. Cubre S1-S6. **DONE**
- T5 — documentación: actualizada con las directivas de evidencia. Cubre S1-S6. **DONE**

## Log

- L1 (verbatim, orden del dueño): «primero con el Grounding Ledger y segundo Modal de Takeover en orden comencemos pilas».
- L2 (contexto / motivación): En las sesiones previas, dos defectos graves (el worker que usó `shell exec-out` pasando 83 tests con mock complaciente, y un fixture falso que inventó una fila clickeable) ocurrieron porque el orquestador aceptó reportes con afirmaciones no fundamentadas. El Grounding Ledger formaliza la categorización científica de evidencia para que ningún reporte de subagente se acepte sin comprobación fáctica.
- L3 (frontera de la rebanada): el commit inicial mide ~823 líneas añadidas. Se mantiene atómico porque el core ledger, los tipos, el enriquecimiento del inbox, la tool y los 13 tests forman una sola unidad indivisible de auditoría.
