# Feature: Desviar diagnósticos de extensiones al tab Alertas de Información

## Contexto y Diagnóstico
Pi emite diagnósticos y advertencias de extensiones en el body de la terminal de dos formas:
1. `loadedResourcesContainer`: Se agregan componentes `ThemedText` con `[Extension issues]`, `[Skill conflicts]`, etc. El patch previo en `patchPiLoadedResources` no los capturaba porque `child.text` es `""` en `ThemedText` antes de renderizarse (el contenido reside en la función `build()`).
2. `this.showWarning(...)`, `this.showError(...)` y `this.showExtensionError(...)` en `InteractiveMode`: Durante el arranque, Pi ejecuta `startupDiagnostics` imprimiendo advertencias como `Warning: Extension package "builtin:mcp": Extension ... registers command /mcp...` directo al `chatContainer` (body). El patch previo sólo interceptaba `"No models available"`.
3. Al renderizar en `dc-status-panel.ts`, las líneas indentadas con comas se fragmentaban arbitrariamente como si fueran listas de etiquetas en lugar de texto explicativo corrido.

## Tareas

- [x] 1. Corregir intercepción de `loadedResourcesContainer` en `dc-resources-patch.ts` soportando `ThemedText.build()`, y eliminar `Spacer` contiguos.
- [x] 2. Ampliar intercepción en `InteractiveMode.prototype.showWarning`, `showError` y `showExtensionError` para capturar diagnósticos de extensiones en `G_DIAGNOSTICS` sin volcarlos al body (`chatContainer`).
- [x] 3. Implementar deduplicación inteligente en `G_DIAGNOSTICS` (preferir el bloque jerárquico estructurado frente al aviso plano).
- [x] 4. Ajustar el formateo de líneas en `DcStatusPanel` (`alerts`) para no mutilar oraciones con comas y formatear diagnósticos de extensiones limpiamente.
- [x] 5. Crear pruebas unitarias exhaustivas para validar la intercepción, supresión del body y correcta visualización en la pestaña Alertas (`test/dc-resources-patch.test.ts`).
