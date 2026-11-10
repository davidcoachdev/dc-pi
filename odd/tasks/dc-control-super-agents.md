# Feature: DC-Control Oficina Central y Pestaña de Super-Agentes

## Specs
- S1: "cambien también los scripts, no quiero ver de nuevo el DC Westwood, ya no quiero ver nada de eso en ningún lado, quiero que todo se llame DC Control, cambia lo que tenga que cambiar, elimina lo que tenga que eliminar y actualiza lo que tenga que actualizar, pero todo se tiene que llamar DC Control"
- S2: "crea la ventana de dc-control... para que sea como la oficina de donde pertenece nuestro super agentes y lo demas que vamos a crear"
- S3: "tambien quiero una tab en el sidebar qye sea la tercera hay que mover las demas un puesto y hay deamos el trabajo en tiempo real de nuestros super agentes que esuve esta va a estra dibidias eb tab con el tirulo el numero del agentes por el moemento solo va estar el 86"
- S4: "pero tambien una de configuracion para poder ver si el binary esta activo o no y la scondiguraciones de este agente tambein las conciones de este en forma de cbotones recuerda que vamos a cionstruir mas dc-super-agnets"
- S5: "mieres la ventan ya creada y refactoricenos para tener un cretro de control por eso el nombde de dc-control"

## Tasks
- [ ] T1: Renombrar y purgar todo rastro de `dc-webhook` a `dc-control` en comandos, archivos, scripts y tests | route: inline
- [ ] T2: Insertar la 3ª pestaña `CTRL` en `dc-sidebar` desplazando `TREE`, `MEM`, `SYS` y reasignando atajos `alt+1` a `alt+6` | route: inline
- [ ] T3: Implementar la vista del sidebar para Super-Agentes con sub-tabs (`[#86]` y `[⚙ CONFIG]`), monitoreo en tiempo real, estado de binarios y botones de acción | route: inline
- [ ] T4: Refactorizar la ventana modal `/dc-control` para que funcione como la Oficina Central multi-agente | route: inline
- [ ] T5: Verificación determinista (typecheck y tests de dc-control y sidebar con exit code 0) | route: inline

## Log
- L1: Solicitud del usuario: Reemplazo total de dc-webhook por dc-control, creación de la 3ª pestaña en sidebar con sub-tabs por agente y configuración con botones, y refactorización de la ventana modal como oficina central.
