# Feature: DC-Control Gateway Ingress y Super-Agent Factory Framework

## Specs
- S1: "el daemon #86 deberia cambier de monbre a daemnon algo verdada como el de daemon hub no deberia ser con un monbre mas referncial a su labor base"
- S2: "hacer un creador de dc-superagnete autono mos asi podemos crear los que necesito con una vase solida asi no avidinamos cada vez que quiera crear uno"
- S3: "nos falta el super agente supervisor, el 99 q es la engarda de los pr y los que se me ocuran en el camino"
- S4: "si dale con todo en fase crea el plan de implementacion"

## Tasks
- [x] T1: (Fase 1 - Desacoplamiento & Ingress Gateway) Renombrar conceptual y técnicamente la antena de webhooks a `dc-github-gateway` (o Ingress Gateway neutral), separando el servidor Express y el túnel `gh` de la identidad del Agente #86 | route: inline
- [x] T2: (Fase 2 - Contrato Canónico de Super-Agentes) Crear la interfaz canónica `DcSuperAgentDefinition` y el registro central `DcSuperAgentRegistry` con tipado extensible | route: inline | commit: `98c9f1b`
- [x] T3: (Fase 3 - Adaptación del Agente #86 & Scaffold del Agente #99) Registrar al Agente #86 como `issue_resolver` y declarar el scaffold del Agente #99 como `pr_inspector` sobre el nuevo Registry | route: inline | commit: `98c9f1b`
- [x] T4: (Fase 4 - Despachador de Eventos de Gateway) Adaptar el Gateway Ingress para enrutar eventos `issues`/`issue_comment` hacia el #86 y eventos `pull_request` hacia el #99 según sus triggers registrados | route: inline
- [x] T5: (Fase 5 - Creador de Super-Agentes CLI/API) Implementar la fábrica y comando de creación rápida de nuevos Super-Agentes autónomos (`createSuperAgent`) | route: inline
- [x] T6: (Fase 6 - Actualización de Sidebar y Chat Global) Reflejar en la pestaña CTRL del sidebar y en el Chat Global la nueva arquitectura: Ingress Gateway neutral + lista federada de Super-Agentes | route: inline
- [x] T7: (Fase 7 - Verificación Determinista y Tests) Pruebas automatizadas del Gateway, Registry de Super-Agentes, despacho de eventos y typecheck estricto exit code 0 | route: inline | verified: 7 suites PASS exit 0

## Log
- L1: Solicitud inicial: Separar el daemon #86 en un Gateway Ingress neutral con nombre referencial y construir una fábrica/registro canónico de Super-Agentes autónomos para soportar al #86 (Issues), #99 (PRs), Supervisor y nuevos agentes futuros.
