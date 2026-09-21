# CLIProxy Client — fifth isolated slice

Status: in_progress.

## Authorization and scope

Following the roadmap in `HANDOFF-GEMINI.md` (§7.2 "Helpers repetidos: cliente CLIProxy") and `auditoria-individual-extensiones-2026-09-18.md` (§D "CLIProxy: base URL y management key"):
- Unify CLIProxy connection parameters:
  - Base URL resolution (`process.env.CLIPROXY_BASE_URL ?? "http://127.0.0.1:8317"`).
  - Management key resolution (checks `process.env.CLIPROXY_MGMT_KEY` first, optional local file fallback with safe try-catch).
  - Strongly typed client class `CliProxyClient` using `fetchJson<T>()`.
  - Methods for common endpoints:
    - `getAuthFiles()`: retrieves list of accounts.
    - `downloadAuthFile(name)`: retrieves account details (email/prefix mapping).
    - `getManagement<T>(path)`: generic management API helper.
    - `postManagementApiCall<T>(body)`: management API-call helper.
- Unit tests in `test/dc-cliproxy.test.ts`.

## Tasks

- [ ] Implement `src/integrations/dc-cliproxy/dc-cliproxy-client.ts`.
- [ ] Add unit tests in `test/dc-cliproxy.test.ts`.
- [ ] Verify test suite and typecheck.
- [ ] Update documentation (`migration/registry.md`, `README.md`).
