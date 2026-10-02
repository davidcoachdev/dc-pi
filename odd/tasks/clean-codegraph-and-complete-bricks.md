# Tasks: clean-codegraph-and-complete-bricks

- [x] Task 1: Completar `DC_TOOL_BRICKS` y `DC_TOOL_PRESETS` en `dc-ephemeral-types.ts` (`dc_context7_status` en docs, `dc_web_fetch`, `dc_discussion_answers_get`, `dc_github_get` en web-search).
- [x] Task 2: Actualizar `isolateSpecializedToolsForOrchestrator` en `dc-ephemeral-manager.ts` para abarcar todos los bricks e incluir `codegraph` en el aislamiento.
- [x] Task 3: Desactivar `codegraph-tools.ts` de gentle-pi en `~/.pi/agent/settings.json` mediante `!extensions/codegraph-tools.ts`.
- [x] Task 4: Pruebas unitarias de aislamiento y verificación completa de la suite (`test/dc-ephemeral-agents.test.ts` y `npm test`).
