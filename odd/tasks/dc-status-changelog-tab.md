# Feature: Tab de Changelog y Actualizaciones en la Ventana de Información

## Context and Goals
El aviso de actualización de Pi Core (`showStartupNoticesIfNeeded`), que muestra el banner "Updated to vX.Y.Z. Use /changelog to view full changelog." con bordes ASCII, actualmente ensucia el transcript inicial de la terminal.
El usuario solicitó que esta notificación se muestre en su propia pestaña dentro de la ventana de información (`DcStatusPanel`, `/dc-status`, Alt+E), en lugar de ensuciar el body/chat.

Objetivos:
1. Interceptar `InteractiveMode.prototype.showStartupNoticesIfNeeded` en `src/integrations/dc-notify/dc-core-patches.ts` (`patchPiChangelogNotice`) para evitar agregar componentes de bordes y texto al `chatContainer`, preservando el flag `startupNoticesShown`, guardando el notice en `dc.env.changelog-notice` y el markdown en `dc.env.changelog-markdown`, y notificando opcionalmente por Herdr.
2. Extender `EnvStatus` en `src/features/dc-status/dc-status-collector.ts` con `changelogNotice?: string` y `changelogMarkdown?: string`, resolviendo el aviso capturado o el changelog de la versión actual instalada de Pi como fallback.
3. Integrar la pestaña `[3] Changelog` en `DcStatusPanel` (`src/features/dc-status/dc-status-panel.ts`) con soporte de navegación mediante tecla `3`, flechas cíclicas `left`/`right`, badge de "Nuevo" si hay actualización pendiente, visualización del notice destacado y renderizado con scroll del changelog completo.
4. Adaptar footer y hints en `src/features/dc-status/dc-status.ts`.
5. Asegurar cobertura mediante tests unitarios automáticos.

## Tasks
- [x] Task 1: Interceptar aviso de actualización y changelog en `dc-core-patches.ts` y registrarlo en `dc-notifier.ts`
- [x] Task 2: Recolectar `changelogNotice` y `changelogMarkdown` en `dc-status-collector.ts`
- [x] Task 3: Implementar la pestaña `[3] Changelog` con scroll y badges en `dc-status-panel.ts`
- [x] Task 4: Actualizar footer y ayuda de atajos en `dc-status.ts`
- [x] Task 5: Crear tests unitarios en `test/dc-status.test.ts` y validar suite completa

## Evidence
- `src/integrations/dc-notify/dc-core-patches.ts`: Creado `patchPiChangelogNotice` para interceptar `InteractiveMode.prototype.showStartupNoticesIfNeeded`, marcar `startupNoticesShown = true`, capturar el aviso condensado en `dc.env.changelog-notice` y el markdown en `dc.env.changelog-markdown`, y notificar por Herdr si está activo, suprimiendo la inyección al `chatContainer`.
- `src/integrations/dc-notify/dc-notifier.ts`: Registrada la llamada a `patchPiChangelogNotice()`.
- `src/features/dc-status/dc-status-collector.ts`: Extendido `EnvStatus` con `changelogNotice` y `changelogMarkdown`. Implementado lector de changelog de Pi local con fallback a `parseRecentChangelogEntries`.
- `src/features/dc-status/dc-status-panel.ts`: Agregada pestaña `[3] Changelog` a `DcTabs`, navegación con tecla `3` y flechas cíclicas `left`/`right`, badge "Nuevo" si hay notice pendiente, caja de notificación destacada y visualización formateada de notas de versión.
- `src/features/dc-status/dc-status.ts`: Adaptadas hints del footer para reflejar la pestaña changelog y el scroll con `↑ / ↓`.
- Tests: 297/297 pasando exitosamente (`test/dc-status.test.ts`, `test/dc-notifier.test.ts` y suite global completa).
