# Feature: Homogeneidad de Ventanas UI y Animación de Carga

## Specs
S1: Preservar `isDragging` a través de los ciclos de `render()` en `DcWindow`, reiniciando los límites de cajas (`closeStart`, `bodyX`, etc.) sin cancelar el estado de arrastre activo.
S2: En pies de ventana (`DcWindowFooter`) con objetos `{ left, right }`, cuando el ancho interior es insuficiente, truncar el texto izquierdo preservando el control de acción derecho (`[ Cerrar ]`, `[ Usar ]`, etc.) y su hitbox.
S3: Añadir soporte nativo de animación de carga (`loading?: boolean | { message?: string; progress?: number }`, `setLoading`, `onReload`) en `DcWindow` y `openDcModal`. Incluir animación de spinner (`SPINNER_FRAMES`) y barra progresiva cuando esté cargando/recargando contenido, con ciclo de render automatizado y atajo opcional de recarga (`r`/`R`).
S4: Corregir `DcApprovalPanel` para usar `matchesKey` con `Key.left`, `Key.right`, `Key.up`, `Key.down`, `Key.tab`, `Key.enter`, `Key.escape`, manejar teclas `"1"`, `"2"`, `"3"`, soportar clic de ratón en botones y envolver líneas largas.
S5: Estandarizar el contrato de `handleInput` en `dc-plan` y `dc-agents` retornando `true` al consumir teclas, e invocar `requestRender` al mutar estado.
S6: Corregir `dc-profile-duel` para que el botón `[ Usar ]` aplique el perfil seleccionado actualmente y cierre la modal.
S7: Corregir el cálculo de presupuesto vertical en `dc-keys` y `dc-models` para evitar que las últimas filas queden ocultas sin scroll.
S8: Homogeneizar pies de ventana (`[Tecla] Acción`), asignar callbacks reales a botones de cierre (`onFooterRightClick`) y reducir colores quemados en código (*hardcoded*).

## Tasks
T1: (S1, S2) Fix DcWindow drag state and footer reservation -> src/ui/dc-window.ts
T2: (S3) Implement native loading & reload animation in DcWindow and openDcModal -> src/ui/dc-window.ts, src/ui/dc-modal.ts
T3: (S4) Fix DcApprovalModal keyboard and mouse input handling -> src/features/dc-approval/views/dc-approval-modal.ts
T4: (S5) Fix input consumption and repaint in dc-plan and dc-agents -> src/features/dc-plan/views/dc-plan-panel.ts, src/features/dc-agents/views/dc-agents-panel.ts
T5: (S6) Fix dc-face duel footer action state -> src/features/dc-face/views/dc-profile-duel.ts
T6: (S7) Fix viewport height calculations in dc-keys and dc-models -> src/features/dc-keys/dc-keys.ts, src/features/dc-keys/dc-keys-panel.ts, src/features/dc-models/dc-models.ts, src/features/dc-models/dc-models-panel.ts
T7: (S8) Homogenize footer actions, typography and theme tokens -> modales principales
T8: (S1-S8) Verify with unit tests and typecheck -> test/dc-window.test.ts, test/dc-approval.test.ts, npm test

## Log
L1: Usuario solicita: "quiero que revises la ui de las ventanas a ver si esta homegenias las pantalla", "si tyambien hay que agregar la aminacion de carga a la ventanas que permite recargar su contenido pilas y comencemos".
