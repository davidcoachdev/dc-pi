# Feature: dc-tts-integration
Status: completed | Branch: feat/dc-tts-integration

## Specs

- **S1 (Motor Go Embebido en `dc-pi/native/dc-tts/`)**: Incorporar el código fuente Go del túnel binario y motor TTS/STT (`go.mod`, `cmd/dc-tts`, `cmd/dc-tts-win`, `cmd/fake-win`, `internal/core`, `internal/protocol`, `internal/transport`, `internal/orchestrator`, `internal/winhost`, `pkg/client`) dentro de `/home/dc-studio/dc-lab/dc-projects/dc-pi/native/dc-tts/` (`"es por la parte del binario de go es que quiero que todo sea parte del dc-pi porque es un plugins completo de entorme para pi y el tts y el dictado tambien es parte de este ecocistema"`).
- **S2 (Auto-Build y Auto-Start del Daemon en `~/.pi/agent/dc-studio/bin/`)**: Implementar `src/features/dc-tts/core/dc-tts-daemon.ts` que verifique o compile los binarios estáticos (`CGO_ENABLED=0`) en `~/.pi/agent/dc-studio/bin/dc-tts` y `~/.pi/agent/dc-studio/bin/dc-tts-win`, y que en `session_start` levante automáticamente `dc-tts-win` en background (`spawn(..., { detached: true, stdio: "ignore" }).unref()`) si `127.0.0.1:9877/health` no responde.
- **S3 (Arquitectura Modular `src/features/dc-tts/` según Directivas DC Studio)**: Desacoplar la feature en `core/` (`dc-tts-types.ts`, `dc-tts-prefs.ts` con persistencia en `~/.pi/agent/dc-studio/dc-tts.json` vía `resolveDcConfigPath("dc-tts")`, `dc-tts-client.ts`, `dc-tts-daemon.ts`), `views/` (`dc-tts-panel.ts` usando `DcWindow`, `renderDcCard`, `renderProgressBar`, `openProfilePicker`), `dc-tts.ts` (hooks `message_end`, `agent_settled`, `tool_call` para `ask_user_question`/`ask_user_choice`, comando `/dc-tts`, atajos `Alt+U`, `Alt+P`, `Alt+,`, `Alt+.`, `Alt+R`, `Alt+X`, `Alt+V`) e `index.ts`.
- **S4 (Registro Unificado en `dc-pi` y Catálogo de Atajos)**: Exportar y registrar `dcTtsExtension` en `src/index.ts` dentro de `dcStudioExtension`, documentar los atajos y comando `/dc-tts` en `src/features/dc-keys/dc-keys-panel.ts`, y validar con pruebas unitarias focalizadas en `test/dc-tts.test.ts` y `test/index.test.ts`.

## Tasks

- [x] **T1** (S1) | Route: inline | Commit: pending — Incorporar el módulo Go completo en `/home/dc-studio/dc-lab/dc-projects/dc-pi/native/dc-tts/` y verificar que `go test ./...` pase en la nueva ubicación.
- [x] **T2** (S2, S3) | Route: inline | Commit: pending — Crear `src/features/dc-tts/core/` (`dc-tts-types.ts`, `dc-tts-prefs.ts`, `dc-tts-client.ts`, `dc-tts-daemon.ts`) con persistencia en `~/.pi/agent/dc-studio/dc-tts.json`, auto-build de binarios Go en `~/.pi/agent/dc-studio/bin/` y auto-start desacoplado (`.unref()`).
- [x] **T3** (S3, S4) | Route: inline | Commit: pending — Crear `src/features/dc-tts/views/dc-tts-panel.ts`, `src/features/dc-tts/dc-tts.ts` y `src/features/dc-tts/index.ts`, integrando `dcTtsExtension` en `src/index.ts` y `src/features/dc-keys/dc-keys-panel.ts`.
- [x] **T4** (S2, S3, S4) | Route: inline | Commit: pending — Escribir pruebas unitarias en `test/dc-tts.test.ts`, actualizar `test/index.test.ts` y verificar compilación TypeScript + tests enfocados (`dc-tts.test.js` e `index.test.js`) + daemon en vivo.

## Log

- **L1**: `ok revisemos dc-pi y quiero que sea parte tambien de el dame opciones o como lo ariamos es por la parte del binario de go es que quiero que todo sea parte del dc-pi porque es un plugins completo de entorme para pi y el tts y el dictado tambien es parte de este ecocistema`
- **L2**: Selección del usuario: `Opción 1: Fuente Go en dc-pi + Auto-build y Auto-start (Rec)`, `Auto-start transparente al abrir Pi (Recomendado)`, `Autorizar lectura y escritura en dc-pi`.
- **L3**: `commit`
