import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inspectGitSync } from "../src/features/dc-git-sync/core/dc-git-sync-inspector.ts";
import dcGitSyncExtension from "../src/features/dc-git-sync/dc-git-sync.ts";

test("dc-git-sync inspector detects current repo status without crashing", async () => {
  const diag = await inspectGitSync(process.cwd());
  assert.equal(diag.isGitRepo, true);
  assert.ok(diag.branch);
  assert.ok(["synced", "ahead", "behind", "diverged", "no_upstream"].includes(diag.status));
  assert.equal(typeof diag.hasUncommittedChanges, "boolean");
  assert.equal(typeof diag.hasUntrackedFiles, "boolean");
});

test("dcGitSyncExtension registers command /dc-git-sync and hooks", () => {
  const registeredCommands: string[] = [];
  const registeredEvents: string[] = [];

  const mockPi = {
    registerCommand(name: string) {
      registeredCommands.push(name);
    },
    on(event: string) {
      registeredEvents.push(event);
    },
  } as unknown as ExtensionAPI;

  dcGitSyncExtension(mockPi);

  assert.ok(registeredCommands.includes("dc-git-sync"));
  assert.ok(registeredEvents.includes("session_start"));
  assert.ok(registeredEvents.includes("before_agent_start"));
});
