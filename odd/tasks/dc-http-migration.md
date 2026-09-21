# HTTP JSON Client with Timeout and Abort — fourth isolated slice

Status: in_progress.

## Authorization and scope

Following the roadmap in `HANDOFF-GEMINI.md` (§7.2 "Helpers repetidos: timeout/abort HTTP") and `auditoria-individual-extensiones-2026-09-18.md` (§C "HTTP JSON con timeout y abort"):
- Extract reusable `fetchJson<T>()` in `src/integrations/dc-http/dc-fetch.ts`.
- Requirements:
  - Configurable timeout with automatic cleanup (`clearTimeout`).
  - Signal combination (caller signal + internal timeout signal).
  - Sanitized error messages (redacts bearer tokens, query params with credentials, management keys).
  - Max response size protection (to prevent memory exhaustion).
  - Structured error types (`DcHttpError`, `DcHttpTimeoutError`).
  - Strong typing with generic `<T>`.
- Unit tests in `test/dc-fetch.test.ts`.

## Tasks

- [ ] Implement `src/integrations/dc-http/dc-fetch.ts`.
- [ ] Add unit tests in `test/dc-fetch.test.ts` (timeout, abort, status, headers, json parsing, token redaction).
- [ ] Verify whole test suite and typecheck.
- [ ] Update documentation (`migration/registry.md`, `README.md`).
