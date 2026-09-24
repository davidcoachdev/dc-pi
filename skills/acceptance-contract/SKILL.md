---
name: acceptance-contract
description: "Trigger: acceptance contract, criterios ejecutables, executable criteria, acceptance script, contrato de aceptacion, qa code. Generates and verifies binary exit-code acceptance scripts for features."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Use this skill during the planning or verification phase of a feature to replace ambiguous, subjective text checkboxes with deterministic, executable acceptance scripts.

Activate when:
- Creating technical plans or specs that require automated programmatic proof of completion.
- Generating executable verification scripts before or during implementation.
- Running the `QACode` step to validate that a feature meets its acceptance contract (`exit 0` vs `exit 1`).

Do not use for standard unit test authoring (use TDD / language-specific test suites).

## Hard Rules

- **Binary Outcome**: The acceptance script must exit strictly with `0` on success and non-zero (`1`) on any failure. Never emit ambiguous warnings that exit with `0`.
- **Fail-Closed Shell**: Shell scripts must begin with `set -eo pipefail`. Unhandled errors must immediately terminate execution.
- **Hermetic & Clean**: The script must clean up temporary files, database test records, and child processes upon termination (e.g. using `trap cleanup EXIT` in Bash).
- **Public Interface Verification**: Test through the public interface (HTTP endpoints, CLI commands, generated build outputs, or exported module APIs). Do not assert against internal private implementation details.
- **Deterministic**: The test must not depend on non-deterministic external network conditions without mocks or local sandboxes.
- **Location Convention**: Store acceptance scripts under `qa/acceptance/test-<ticket-or-feature>.sh` (or language equivalent).

## Decision Gates

| Target Type | Acceptance Script Pattern |
| --- | --- |
| CLI Tool / Binary | Execute binary with flags, verify stdout/stderr matches schema, assert exit code |
| REST / GraphQL API | Run sequential `curl` commands against local test instance, assert HTTP status & JSON bodies with `jq` |
| File / Build Output | Run build command, assert expected artifacts exist with non-zero byte size and valid headers |
| Module / Library | Run standalone node/python/go smoke test script importing the built distribution |

## Execution Steps

### Phase 1: Planning / Contract Generation
1. Extract acceptance criteria from ticket or spec.
2. Formulate 1 to 5 deterministic check assertions.
3. Scaffold `qa/acceptance/test-<feature-name>.sh` using the standard executable template.
4. Ensure script is marked executable (`chmod +x qa/acceptance/...`).

### Phase 2: Verification (QACode Phase)
1. Run the acceptance script from repo root: `bash qa/acceptance/test-<feature-name>.sh`.
2. Inspect exit code:
   - `0`: PASS — Criterios de aceptación plenamente cumplidos.
   - `non-zero`: FAIL — Capturar stdout/stderr y remitir al agente de implementación con la falla exacta.

## Script Template Reference

```bash
#!/usr/bin/env bash
set -eo pipefail

echo "==> Running Acceptance Contract: [FEATURE-NAME]"

# Setup & cleanup trap
TMP_DIR=$(mktemp -d)
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Assertion 1: Build / Setup
echo "Checking build artifact..."
test -f dist/index.js || { echo "FAIL: dist/index.js not found"; exit 1; }

# Assertion 2: Functional behavior
echo "Checking CLI execution..."
OUTPUT=$(node dist/index.js --version)
[[ "$OUTPUT" =~ [0-9]+\.[0-9]+ ]] || { echo "FAIL: Invalid version output"; exit 1; }

echo "==> Acceptance Contract PASSED (exit 0)"
exit 0
```
