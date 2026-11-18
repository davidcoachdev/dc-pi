import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseDiffStat,
  evaluateArenaWinner,
  runArenaContest,
  type ArenaCandidateResult,
} from "../src/features/dc-agents/core/dc-arena-runner.ts";
import { registerDcEphemeralTools } from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";

test("dc-arena: parseDiffStat parses standard git diff --stat summary lines", () => {
  const sample1 = ` src/index.ts | 12 +++++++++---
 test/index.test.ts | 4 ++++
 2 files changed, 13 insertions(+), 3 deletions(-)`;

  const res1 = parseDiffStat(sample1);
  assert.equal(res1.filesChanged, 2);
  assert.equal(res1.insertions, 13);
  assert.equal(res1.deletions, 3);
  assert.equal(res1.totalChanges, 16);

  const sample2 = ` README.md | 1 +
 1 file changed, 1 insertion(+)`;
  const res2 = parseDiffStat(sample2);
  assert.equal(res2.filesChanged, 1);
  assert.equal(res2.insertions, 1);
  assert.equal(res2.deletions, 0);
  assert.equal(res2.totalChanges, 1);

  const empty = "";
  const resEmpty = parseDiffStat(empty);
  assert.equal(resEmpty.filesChanged, 0);
  assert.equal(resEmpty.insertions, 0);
  assert.equal(resEmpty.deletions, 0);
});

test("dc-arena: evaluateArenaWinner prioritizes passing verification and KISS (minimal diff)", () => {
  const candA: ArenaCandidateResult = {
    name: "Model-A",
    model: "gemini-3.8-flash",
    worktreePath: "/tmp/a",
    diffStat: { filesChanged: 2, insertions: 10, deletions: 2, totalChanges: 12 },
    diff: "...",
    verificationStatus: "passed",
    durationMs: 1200,
  };

  const candB: ArenaCandidateResult = {
    name: "Model-B",
    model: "claude-3-5-sonnet",
    worktreePath: "/tmp/b",
    diffStat: { filesChanged: 5, insertions: 150, deletions: 40, totalChanges: 190 },
    diff: "...",
    verificationStatus: "passed",
    durationMs: 3400,
  };

  // Both pass, but Model-A is much simpler (KISS: 12 changes vs 190) -> Model-A wins
  const eval1 = evaluateArenaWinner(candA, candB);
  assert.equal(eval1.winner, "Model-A");
  assert.ok(eval1.reason.includes("KISS") || eval1.reason.includes("menor impacto"));

  // If Model-A failed verification and Model-B passed -> Model-B wins
  const candAFailing: ArenaCandidateResult = { ...candA, verificationStatus: "failed" };
  const eval2 = evaluateArenaWinner(candAFailing, candB);
  assert.equal(eval2.winner, "Model-B");
  assert.ok(eval2.reason.includes("pruebas") || eval2.reason.includes("verificación"));
});

test("dc-arena: runArenaContest executes two contenders in isolated worktrees and builds scorecard", async () => {
  // 1. Setup real git repository
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-arena-test-"));
  const repoRoot = path.join(tempDir, "arena-repo");
  fs.mkdirSync(repoRoot, { recursive: true });

  execFileSync("git", ["init", "-b", "master", repoRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "ArenaTester"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "arena@test.local"], { stdio: "ignore" });

  fs.writeFileSync(path.join(repoRoot, "math.js"), "function add(a, b) { return 0; }\nmodule.exports = { add };\n", "utf8");
  execFileSync("git", ["-C", repoRoot, "add", "math.js"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "initial math implementation"], { stdio: "ignore" });

  try {
    // 2. Ejecutar arena contest con mock workers modificando sus respectivos worktrees
    const contestResult = await runArenaContest({
      repoRoot,
      task: "Fix add function to return a + b",
      candidates: [
        {
          name: "Contender-Minimal",
          model: "gemini-3.8-flash-high",
          workerFn: async (worktreeDir) => {
            // Contender A modifies math.js simply
            fs.writeFileSync(
              path.join(worktreeDir, "math.js"),
              "function add(a, b) { return a + b; }\nmodule.exports = { add };\n",
              "utf8"
            );
          },
        },
        {
          name: "Contender-Overengineered",
          model: "complex-model-v1",
          workerFn: async (worktreeDir) => {
            // Contender B writes extra files and complicated logic
            fs.writeFileSync(
              path.join(worktreeDir, "math.js"),
              "const { addCore } = require('./helper.js');\nfunction add(a, b) { return addCore(a, b); }\nmodule.exports = { add };\n",
              "utf8"
            );
            fs.writeFileSync(
              path.join(worktreeDir, "helper.js"),
              "function addCore(a, b) {\n  if (typeof a !== 'number') throw new TypeError();\n  return a + b;\n}\nmodule.exports = { addCore };\n",
              "utf8"
            );
            execFileSync("git", ["-C", worktreeDir, "add", "helper.js"], { stdio: "ignore" });
          },
        },
      ],
    });

    assert.equal(contestResult.winner, "Contender-Minimal");
    assert.equal(contestResult.candidates.length, 2);
    assert.ok(contestResult.markdownScorecard.includes("Contender-Minimal"));
    assert.ok(contestResult.markdownScorecard.includes("Contender-Overengineered"));
    assert.ok(contestResult.markdownScorecard.includes("GANADOR"));

    // Verificar que el working tree original no fue modificado
    const originalContent = fs.readFileSync(path.join(repoRoot, "math.js"), "utf8");
    assert.equal(originalContent, "function add(a, b) { return 0; }\nmodule.exports = { add };\n");
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test("dc-arena: dc_arena_run tool is registered and returns markdown scorecard", async () => {
  const registeredTools = new Map<string, any>();
  const mockPi: any = {
    registerTool(tool: any) {
      registeredTools.set(tool.name, tool);
    },
    on() {},
  };

  registerDcEphemeralTools(mockPi);
  const arenaTool = registeredTools.get("dc_arena_run");
  assert.ok(arenaTool, "dc_arena_run should be registered in pi");
  assert.equal(typeof arenaTool.execute, "function");
  assert.equal(arenaTool.parameters.properties.candidateA.type, "object");
  assert.equal(arenaTool.parameters.properties.candidateB.type, "object");
});
