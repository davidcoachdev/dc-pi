# Feature: Resolución Autónoma de Conflictos de PR en Segundo Plano (Super-Agente #99)

## Specs
- S1: "si me gusta pero recuertda que debe abrir un pi en segundo plano y hacerlo"
- S2: "dale" (aprobación para implementar el flujo autónomo en worktree con Pi en background)

## Tasks
- [ ] T1: (Fase 1 - Detección y Aislamiento) Implementar en `DcPrInspectorAgent` el método `resolveConflicts(target)` que crea worktree temporal aislado y lanza `git rebase` | route: inline
- [ ] T2: (Fase 2 - Worker Autónomo en Background) Configurar el despacho de la sesión autónoma de Pi en segundo plano con taxi arrendado de la Flota para resolver marcadores de conflicto | route: inline
- [ ] T3: (Fase 3 - Verificación Determinista y Push Seguro) Ejecutar verificación de build/tests (exit code 0), `git rebase --continue`, `git push --force-with-lease` y desmontaje limpio del worktree | route: inline
- [ ] T4: (Fase 4 - Comandos en Chat y GitHub) Habilitar disparador en el router de comentarios de PR ("resuelve conflictos") y en el Chat Global de DC-Control | route: inline
- [ ] T5: (Fase 5 - Pruebas Unitarias y Validación) Test suite para la detección, pipeline de rebase y despacho del worker con exit code 0 | route: inline

## Log
- L1: Solicitud inicial: Dotar a la Super-Agente #99 de capacidad para resolver conflictos en PRs abriendo una sesión autónoma de Pi en segundo plano en un worktree aislado con verificación estricta.
