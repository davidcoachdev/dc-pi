---
name: qa-human-recipe
description: "Trigger: qa recipe, human qa, test recipe, guia de pruebas, plan de pruebas humano, receta qa, manual testing guide, qaes. Generates a step-by-step human verification recipe for PRs and issue trackers."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Use this skill when preparing human testing instructions, closing a feature, writing PR descriptions, or populating QA notes for issue trackers (Linear, Jira, GitHub Issues).

Activate when:
- Preparing the manual verification plan for QA engineers, Product Managers, or teammates.
- Writing PR description sections for testing and review.
- Documenting how to verify a newly completed ticket end-to-end.

Do not use for automated unit or integration test suites (use standard test runners or `acceptance-contract`).

## Hard Rules

- **Zero Test Runner Jargon**: Never paste raw test runner outputs (e.g. `npm test` logs, Vitest summaries) as human QA steps. Human testing requires concrete user actions.
- **Copy-Paste Ready**: Every sample payload, cURL command, test email, and input value must be explicit and directly copy-pasteable. Never write placeholders like `"<insert your payload here>"`.
- **Bilingual Context Awareness**: Default technical output to English unless the repository, issue, or user explicitly calls for Spanish/regional documentation.
- **Explicit Failure Expectations**: In the Sad Path / Edge Cases section, state the exact expected user-facing error message or status code, not generic phrases like `"it should fail"`.
- **Read-Only Generation**: This skill analyzes repository changes (diffs, specs, route definitions) and produces documentation. It does not modify application code.

## Decision Gates

| Change Type | Primary Focus of Recipe |
| --- | --- |
| Frontend UI Feature | Browser steps, exact URLs, button labels, viewport tests (Mobile + Desktop), visual state transitions |
| Backend API Endpoint | Ready-to-run `curl` commands, JSON payloads, expected HTTP status codes, DB assertions |
| Background Worker / Queue | Trigger event, CLI command, log inspection command, queue monitoring check |
| Full-Stack Feature | Combined recipe: UI interaction triggering backend change, verified via UI and API |

## Execution Steps

1. **Inspect Changes**:
   - Run `git diff --stat HEAD~1` (or compare branch against base) to identify modified endpoints, UI routes, and components.
   - Review relevant ticket/spec acceptance criteria.
2. **Draft Preconditions**:
   - Target environment (Local dev, Staging, Preview deployment URL).
   - Required user role/permissions (e.g. Admin, Tenant Owner, Unauthenticated).
   - Seed data requirements or environment variable flags.
3. **Draft Happy Path**:
   - Sequential numbered steps: Navigation URL -> Action (Click/Type) -> Expected visual/system result.
4. **Draft Sad Path & Edge Cases**:
   - Boundary tests: Invalid input, empty required field, unauthorized access.
   - Exact error messages or fallback states displayed.
5. **Add Quick Smoke Commands**:
   - Provide runnable `curl` or CLI validation snippets where applicable.

## Output Contract

Produce a clean Markdown block ready to copy into Linear or GitHub PR:

```markdown
### 🧪 QA Walkthrough Recipe — [Ticket-ID] <Title>

#### ⚙️ Preconditions
- **Environment:** Local (`http://localhost:3000`) or Staging Preview
- **Auth Role:** `User` with active workspace
- **Feature Flag:** `ENABLE_NEW_FEATURE=true` (if applicable)

#### 🟢 Happy Path (Step-by-Step)
1. Navigate to `/dashboard/settings`.
2. Click on the **"Integrations"** tab.
3. Enter `<test-value>` in the **API Key** input field.
4. Click **"Save Changes"**.
5. **Expected Result:** Green toast notification appears with *"Settings updated successfully"*, and the status badge switches to **"Active"**.

#### 🔴 Sad Path & Edge Cases
1. **Empty Key Submission:** Clear the field and click **"Save"**.
   - **Expected Result:** Input border turns red with error *"API Key is required"*. No network mutation occurs.
2. **Unauthorized Access:** Open `/dashboard/settings` with a guest role.
   - **Expected Result:** Redirects to `/403` with *"Access Denied"*.

#### 💻 Direct API Verification (cURL)
```bash
curl -X POST http://localhost:3000/api/v1/settings \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"key": "test_12345"}'
# Expected HTTP 200: {"status": "ok"}
```
```
