import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { registerDcEphemeralTools } from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";

test("dc_ephemeral_agent_run: creates isolated git worktree when isolateWorktree is true", async () => {
  // 1. Setup dummy git repo
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-ephemeral-worktree-test-"));
  const repoRoot = path.join(tempDir, "repo");
  fs.mkdirSync(repoRoot, { recursive: true });

  execFileSync("git", ["init", "-b", "master", repoRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Tester"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "tester@test.local"], { stdio: "ignore" });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Init\n", "utf8");
  execFileSync("git", ["-C", repoRoot, "add", "README.md"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "init"], { stdio: "ignore" });

  const oldCwd = process.cwd();
  process.chdir(repoRoot);

  try {
    let capturedToolName: string | undefined;
    let capturedParams: any = undefined;

    const registeredTools = new Map<string, any>();
    const mockPi: any = {
      registerTool(tool: any) {
        registeredTools.set(tool.name, tool);
      },
      on() {},
    };

    registerDcEphemeralTools(mockPi);
    const ephemeralTool = registeredTools.get("dc_ephemeral_agent_run");
    assert.ok(ephemeralTool, "dc_ephemeral_agent_run should be registered");

    // Check schema exposes isolateWorktree
    assert.equal(ephemeralTool.parameters.properties.isolateWorktree?.type, "boolean");

    const mockCtx: any = {
      sessionManager: { getSessionId: () => "test-session-wt" },
      executeTool: async (name: string, params: any) => {
        capturedToolName = name;
        capturedParams = params;
        return {
          result: {
            content: [{ type: "text", text: "Subagent completed work" }],
          },
        };
      },
    };

    const result = await ephemeralTool.execute(
      "call-1",
      {
        task: "Refactor database query",
        role: "db-specialist",
        isolateWorktree: true,
      },
      undefined,
      undefined,
      mockCtx
    );

    assert.equal(capturedToolName, "subagent_run");
    assert.ok(capturedParams, "should have called subagent_run");
    assert.ok(capturedParams.workspace_root, "should pass workspace_root to subagent_run");
    assert.ok(
      capturedParams.workspace_root.includes("dc-studio") || capturedParams.workspace_root.includes("worktree"),
      "workspace_root should point to an isolated worktree directory"
    );
  } finally {
    process.chdir(oldCwd);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});
