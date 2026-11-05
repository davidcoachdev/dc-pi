# Local webhook trust and issue ownership

## Authentication boundary

The daemon uses `gh webhook forward --events=issues` to forward to a receiver bound to `127.0.0.1`. Every start generates a fresh cryptographic 256-bit capability, passed only in the forwarding URL's `capability` query parameter. Requests without the matching capability receive 401 before JSON parsing, delivery deduplication, or callbacks. Comparison uses `timingSafeEqual` for equal-length values. Manual HTTP callers must now supply this capability; unauthenticated compatibility is intentionally removed.

This authenticates possession of the local forwarding capability, **not a GitHub HMAC signature**. It does not protect against the same OS user inspecting process arguments or a compromised local forwarder. Do not log, copy, or publish the forwarding URL. Status and receiver logs omit the capability, and tunnel failure messages deliberately omit raw subprocess errors.

Authenticated payloads must name the configured repository; absent/wrong repository identity receives 403 without claiming a delivery ID. Only an actual `issues` event with `action: opened` and an issue invokes the existing callback. Authenticated repository-matching ping and unrelated events retain pong/ignored responses. Ignored events do not consume issue delivery IDs. Collaborator ALLOW/PENDING/BLOCK policy is unchanged.

## Duplicate requests and retained work

The dispatcher claims a normalized repository/issue key synchronously before authorization or Git awaits. Pending or already-prepared issues return no launch grant, so the daemon does not launch another worker. The existing task remains discoverable through dispatcher status, including its worktree roadmap: a duplicate is not evidence of success and does not erase prior failure state. Rejected/failed preparation releases the pending claim for an explicit retry.

After a process restart, issue creation opts into recovery. Git's porcelain worktree listing must prove the expected path and branch belong together in the same repository. Conflicting, locked, prunable, unregistered, or branch-only occupancy fails rather than resetting/removing data. Retained tracked/untracked changes and existing ODD specs/roadmaps are not rewritten. Recovery still uses the existing conflict reservation and initialization helpers.

Issue worktrees resolve the base once from origin/HEAD, falling back to local main/master, never the user's active feature branch. The dispatched base is passed unchanged to PR delivery. Repositories without a provable base fail clearly. Generic worktree creation remains current-branch based and does not adopt existing worktrees unless explicitly requested.

Concurrency/security changes require independent parent verification before delivery. No cross-process lock or persistent dispatch schema is introduced.
