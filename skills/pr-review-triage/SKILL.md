---
name: pr-review-triage
description: "Trigger: pr review, triage pr, revisar pr, comentarios pr, pr comments, review comments, pr feedback, address review. Inspects and triages GitHub PR comments on-demand using a read-only analyst subagent."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Use this skill when checking, triaging, analyzing, or addressing review comments and feedback on a GitHub Pull Request.

Activate when:
- The user asks to check or review comments on a PR (e.g., "revisá si el PR tiene comentarios", "triage pr", "check pr comments").
- A PR is open and needs human or bot feedback analyzed before merging.
- Deciding what fixes or responses are required following a code review.

Do not use for initial PR creation (use `branch-pr` or `chained-pr`).

## Hard Rules

- **On-Demand Only**: Never run continuous polling or background daemon loops. Execute once per invocation.
- **Fast-Path Bailout**: Check for comments first using `gh pr view --json comments,reviews`. If there are zero unresolved comments, report clean status immediately without spawning a subagent.
- **Context Isolation**: When comments exist, delegate parsing, diff cross-checking, and report synthesis to subagent `dc-pr-comment-analyst`. Never dump raw GitHub API JSON into the parent session context.
- **Auditor Does Not Fix**: The analyst produces an actionable triage report. It never modifies code. Bounded implementation fixes must be explicitly approved by the user before dispatching `gentle-ai-worker`.
- **Preserve Human Control**: Never auto-resolve threads or auto-commit fixes without human review of the plan.

## Decision Gates

| Situation | Action |
| --- | --- |
| No active PR or `gh` CLI not authenticated | Report requirement to user; stop. |
| PR exists but has 0 comments / review threads | Return instant clean report (0 tokens overhead); stop. |
| Comments exist (bot or human) | Run subagent `dc-pr-comment-analyst` with PR number and branch context. |
| User approves the triage action plan | Dispatch `gentle-ai-worker` with exact `Allowed edit surfaces`. |
| PR feedback requires clarification/discussion | Draft polite response using `comment-writer` tone guidelines. |

## Execution Steps

1. **Verify Environment**:
   - Check if inside a Git repository.
   - Run `gh pr view --json number,title,url,comments,reviews` to identify the PR for the current branch (or target specified PR number).
2. **Evaluate Fast-Path**:
   - Count total comments and review threads.
   - If empty: report `"PR #<number> has no review comments pending."` and exit.
3. **Delegate Analysis**:
   - Call `subagent_run` with `agent: "dc-pr-comment-analyst"` and label `"triage pr comments"`.
   - Pass PR number, URL, and target branch in `task`.
4. **Present Triage Report**:
   - Render the structured table and prioritized action plan returned by the analyst.
   - Present clear options to the user: approve fixes, draft replies, or close items.
5. **Implement Approved Fixes (Optional)**:
   - If user confirms: derive narrow `## Allowed edit surfaces` from the report.
   - Launch `gentle-ai-worker` to apply fixes under TDD.

## Output Contract

Report must include:
- PR number, title, and link.
- Triage summary (total comments, pending vs. resolved vs. discussion).
- High-level risk assessment.
- Clear action items awaiting user approval.
