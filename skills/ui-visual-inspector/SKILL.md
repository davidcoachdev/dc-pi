---
name: ui-visual-inspector
description: "Trigger: visual inspect, ui inspect, pixel perfect, visual test, revisar diseño, inspeccion visual, tailwind inspect, check css. Audits frontend layout, responsiveness, and visual fidelity using headless screenshots and layout analysis."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Use this skill when auditing, checking, or verifying frontend interfaces, CSS/Tailwind classes, responsive layouts, and visual fidelity against design specifications.

Activate when:
- Modifying UI components, layouts, pages, or stylesheets.
- Checking for responsive breakage across mobile (375px) and desktop (1440px) screens.
- Auditing arbitrary pixel values and ensuring compliance with design system tokens.
- Reviewing visual changes before opening a PR.

Do not use for purely backend, CLI, or database tasks.

## Hard Rules

- **Isolated Execution**: When reviewing complex UI trees or multi-component layouts, delegate inspection to subagent `ui-visual-inspector` to prevent context inflation.
- **Fail on Arbitrary Values**: Flag hardcoded, arbitrary spacing or font classes (`w-[273px]`, `text-[11px]`) as anti-patterns when design system equivalents exist.
- **Check Mobile Breakpoints**: Never approve frontend changes without verifying the mobile breakpoint (375px width). Layouts that create unexpected horizontal scrollbars must be flagged as blockers.
- **Auditor Does Not Fix**: The inspector reports findings and provides exact CSS/Tailwind replacement recommendations. Code fixes must be applied by a dedicated worker under human review.

## Decision Gates

| Scenario | Inspection Method |
| --- | --- |
| Headless test suite (Playwright/Cypress) exists | Run existing visual regression / component test command |
| Static components (React/Vue/HTML) | Inspect DOM structure, flex/grid constraints, and Tailwind classes |
| Dev server running locally | Run headless screenshot script (if configured) or fetch rendered HTML |
| Minor CSS tweak (< 10 lines) | Inspect directly inline; verify responsive classes |

## Execution Steps

1. **Identify Modified Components**:
   - Run `git diff --name-only` to locate modified `.tsx`, `.vue`, `.jsx`, `.html`, or `.css` files.
2. **Launch Visual Inspector**:
   - Call `subagent_run` with `agent: "ui-visual-inspector"` and label `"audit ui layout"`.
   - Provide modified file paths and relevant design criteria in `task`.
3. **Review Report**:
   - Examine detected blockers (overflows, text clippings, broken grids).
   - Review token alignment suggestions.
4. **Apply Fixes**:
   - If issues are detected, dispatch `gentle-ai-worker` targeting the specific component files with recommended CSS classes.

## Output Contract

Report must include:
- Components audited and viewports evaluated.
- Summary table with Severity, Viewport, Finding, and Exact line references.
- Recommended CSS/Tailwind class diffs.
- Pass/Fail status for Mobile (375px), Tablet (768px), and Desktop (1440px).
