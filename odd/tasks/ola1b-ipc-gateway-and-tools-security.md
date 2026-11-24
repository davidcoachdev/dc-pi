# Feature: Ola 1B — Seguridad en IPC, Webhook Gateway GitHub y Tools Externas (CRIT-04)

Branch: `fix/ola1b-ipc-gateway-and-tools-security`
Risk: item 2 (security — IPC auth/permissions, webhook HMAC, SSRF, path traversal, command/ref injection)

## Specs
- S1: Endurecer `dc-supervisor-ipc-server.ts` (y protocolo/cliente/hub asociados): `chmod 0600` en socket Unix, autenticación de token/credenciales (evitando spoofing de `sessionId` y acceso no autorizado), corregir condición de carrera en `close` para que un socket viejo no mate una sesión reconectada, y acotar tamaño máximo del buffer NDJSON.
- S2: Endurecer `dc-github-gateway.ts` y `dc-control-daemon-manager.ts`: eliminar `?capability=` de `--url`, configurar `--secret` en `gh webhook forward` (único mecanismo soportado por `gh webhook forward --help` para que GitHub firme entregas reales) sin filtrar secretos en logs/status/errores, validar HMAC `X-Hub-Signature-256` con comparación en tiempo constante (`timingSafeEqual`) antes de parsear/deduplicar, y corregir bug `ERR_HTTP_HEADERS_SENT` en respuestas `413` (>5 MB).
- S3: Endurecer `dc-owasp-tools.ts`: confinar lecturas de `params.path` mediante `assertPathWithinRoots` (`src/core/dc-path-confinement.ts`) y redactar secretos literales en `f.snippet`.
- S4: Endurecer `dc-audio-tools.ts` y `dc-audio-synthesizer.ts`: confinar lectura/escritura de archivos mediante `assertPathWithinRoots`, pasar `--` antes del texto en `espeak-ng` y corregir la rama rota de `piper`.
- S5: Evitar SSRF en `dc-browser-cdp.ts` (restringir `cdpUrl` HTTP y WebSocket estrictamente a loopback `localhost`/`127.0.0.1`/`[::1]`) y en `dc-youtube-client.ts` (restringir URLs pasadas a `yt-dlp` a hosts oficiales de YouTube sobre `https:` + `--`).
- S6: Endurecer `dc-adb-driver.ts` (`escapeAdbInputText()` escapando/eliminando `\n`, `\r`, `\t` y caracteres de control), `dc-services-manager.ts` (evitar path traversal `../` en `dc_service_logs` y confinar `config.cwd` con `assertPathWithinRoots` + ejecución segura) y `dc-engram-enroll-panel.ts` (validar esquema `https:`/`http:` y rechazar metacaracteres de shell antes de `cmd.exe /c start` en WSL).
- S7: Evitar path traversal en `${id}.json` dentro de `dc-remote-question.ts` y `dc-super-agent-chat-manager.ts` (validar/sanitizar IDs estrictamente).
- S8: Evitar inyección de opciones en refs/ramas de `git` en `dc-pr-conflict-resolver.ts` y `dc-worktree-manager.ts` (rechazar prefijo `-`, secuencias inválidas y usar `--` cuando corresponda).

## Tasks
- [x] T1 | S1, S2 | worker | Endurecer IPC (`dc-supervisor-ipc-*`) y Webhook Gateway (`dc-github-gateway.ts`, `dc-control-daemon-manager.ts`) + tests deterministas
- [x] T2 | S3, S4, S5 | worker | Endurecer `dc-owasp-tools`, `dc-audio`, `dc-browser-cdp` y `dc-youtube-client` + tests deterministas
- [x] T3 | S6, S7, S8 | worker | Endurecer `dc-adb-driver`, `dc-services-manager`, `dc-engram-enroll-panel`, `dc-remote-question`/`dc-super-agent-chat-manager` y git refs en `dc-pr-conflict-resolver`/`dc-worktree-manager` + tests deterministas
- [x] T4 | S1-S8 | parent+verify | Compilar (`npm run typecheck && npm run build`), correr todas las suites enfocadas y ejecutar verificación independiente de seguridad (`gentle-ai-verify`, Risk: item 2) — PASS S1–S8 (16 suites enfocadas + 116/116 verify)

## Log
- L1: Solicitud del usuario: "continua" (autorización para mergear Ola 1A a `master`, pushear, abrir `fix/ola1b-ipc-gateway-and-tools-security` y ejecutar Ola 1B cumpliendo las 10 Directivas de `dc-pi-architecture` y `dc-git-branching-workflow`).
- L2: Hallazgo empírico (`gh webhook forward --help` + `gentle-ai-verify` `mwv3bfsz-4-6r00`): `gh webhook forward` no lee `GH_WEBHOOK_SECRET`; su único mecanismo upstream para activar firma HMAC `X-Hub-Signature-256` es el flag `-S`/`--secret`. Se corrige S2 para pasar `--secret` efímero (sin `?capability=` en `--url` ni fugas en logs/status), además de corregir redacción de claves JSON/JS entrecomilladas en S3 (`dc-owasp-tools.ts`), rechazo de prefijo `+` y `--` en S8 (`dc-worktree-manager.ts`, `dc-pr-conflict-resolver.ts`), `stdio: "ignore"` en `piper` y `Number.isFinite(limit)` en `dc-youtube-client.ts`.
