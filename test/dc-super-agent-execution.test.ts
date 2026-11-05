import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Isolate each test process before singleton imports, including parallel suite runs.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "dc-execution-home-"));
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "xdg");
process.env.PI_CODING_AGENT_DIR = path.join(home, "pi");
const { DcWorkerRunner } = await import("../src/features/dc-agents/daemon/dc-worker-runner.ts");
const { getCollaboratorsDatabase } = await import("../src/features/dc-agents/daemon/dc-collaborators-db.ts");
test.after(() => {
  getCollaboratorsDatabase().close();
  fs.rmSync(home, { recursive: true, force: true });
});

class StubRunner extends DcWorkerRunner {
  calls: { command: string; args: string[] }[] = [];
  piExit = 0;
  testExit = 0;
  typecheckExit = 0;
  override async runInWorktree(_cwd: string, command: string, args: string[]) {
    this.calls.push({ command, args });
    if (command === "pi") return { exitCode: this.piExit, stdout: "All tests passed (LLM claim)", stderr: "" };
    if (command === "git") return { exitCode: 0, stdout: " M src/example.ts", stderr: "" };
    const exitCode = args[1] === "typecheck" ? this.typecheckExit : this.testExit;
    return { exitCode, stdout: "deterministic output", stderr: exitCode ? "test failed" : "" };
  }
}

function fixture(scripts: Record<string, string> = { typecheck: "tsc --noEmit", test: "node --test" }, lock = "package-lock.json") {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dc-execution-"));
  fs.mkdirSync(path.join(cwd, "odd/tasks"), { recursive: true });
  const spec = path.join(cwd, "odd/tasks/issue-1.md");
  fs.writeFileSync(spec, "T3: Implementar [pending]\nT4: Verificar [pending]\n");
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts }));
  fs.writeFileSync(path.join(cwd, lock), "");
  return { cwd, spec, options: { worktreePath: cwd, taskSlug: "issue-1", issueNumber: 1, issueTitle: "Fix", issueBody: "Fix it" } };
}

test("Pi exit zero with failing tests fails closed and records exact T4 evidence", async () => {
  const f = fixture();
  try {
    const runner = new StubRunner();
    runner.testExit = 7;
    const result = await runner.executeAutonomousLlmSession(f.options);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 0, "Pi exit remains distinct from verification");
    assert.match(fs.readFileSync(f.spec, "utf8"), /T4:.*\[failed\].*npm run test: exit 7/);
    assert.deepEqual(result.verification.commands.map(c => [c.command, c.args, c.exitCode, c.stdout, c.stderr]), [
      ["npm", ["run", "typecheck"], 0, "deterministic output", ""],
      ["npm", ["run", "test"], 7, "deterministic output", "test failed"],
    ]);
    assert.doesNotMatch(fs.readFileSync(f.spec, "utf8"), /T4:.*\[done\]/);
  } finally { fs.rmSync(f.cwd, { recursive: true, force: true }); }
});

test("nonzero Pi skips verification and does not retain a passed T4", async () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.spec, "T3: Implementar [pending]\nT4: Verificar [done]\n");
    const runner = new StubRunner(); runner.piExit = 2;
    assert.equal((await runner.executeAutonomousLlmSession(f.options)).ok, false);
    assert.deepEqual(runner.calls.map(c => c.command), ["pi", "git"]);
    assert.match(fs.readFileSync(f.spec, "utf8"), /T4:.*\[pending\]/);
  } finally { fs.rmSync(f.cwd, { recursive: true, force: true }); }
});

for (const [lock, manager] of [["package-lock.json", "npm"], ["pnpm-lock.yaml", "pnpm"], ["bun.lock", "bun"], ["yarn.lock", "yarn"]]) {
  test(`${manager}: applicable typecheck and tests really run before T4 done`, async () => {
    const f = fixture(undefined, lock);
    try {
      const runner = new StubRunner();
      assert.equal((await runner.executeAutonomousLlmSession(f.options)).ok, true);
      assert.deepEqual(runner.calls.filter(c => c.command !== "pi" && c.command !== "git"), [
        { command: manager, args: ["run", "typecheck"] }, { command: manager, args: ["run", "test"] },
      ]);
      assert.match(fs.readFileSync(f.spec, "utf8"), /T4:.*\[done\].*exit 0/);
    } finally { fs.rmSync(f.cwd, { recursive: true, force: true }); }
  });
}

for (const scripts of [{}, { test: 'echo "Error: no test specified" && exit 1' }, { test: "echo passed" }, { test: "true" }] as Record<string, string>[]) {
  test(`no meaningful verification fails closed: ${JSON.stringify(scripts)}`, async () => {
    const f = fixture(scripts);
    try {
      assert.equal((await new StubRunner().executeAutonomousLlmSession(f.options)).ok, false);
      assert.match(fs.readFileSync(f.spec, "utf8"), /T4:.*\[failed\]/);
    } finally { fs.rmSync(f.cwd, { recursive: true, force: true }); }
  });
}

test("prepared definition body, exact tools, effort and Taxi model reach Pi arguments", async () => {
  const f = fixture();
  try {
    const agentFilePath = path.join(f.cwd, "agent.md");
    fs.writeFileSync(agentFilePath, "---\nname: private-metadata\ntools: read\n---\n# System Prompt\nOnly inspect authorized files.\n");
    const runner = new StubRunner();
    await runner.executeAutonomousLlmSession({ ...f.options, model: "ignored", preparedAgent: {
      agentFilePath, tools: ["read"], effectiveEffort: "high", fullModelRef: "provider/taxi-account/model",
    } });
    const args = runner.calls[0].args;
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    assert.equal(value("--model"), "provider/taxi-account/model");
    assert.equal(value("--tools"), "read");
    assert.equal(value("--thinking"), "high");
    assert.equal(value("--append-system-prompt"), "# System Prompt\nOnly inspect authorized files.");
    assert.doesNotMatch(value("-p"), /becarios|dc_research_swarm|dc_ephemeral_agent_run/);
  } finally { fs.rmSync(f.cwd, { recursive: true, force: true }); }
});

test("failing typecheck stops before tests", async () => {
  const f = fixture();
  try {
    const runner = new StubRunner(); runner.typecheckExit = 3;
    const result = await runner.executeAutonomousLlmSession(f.options);
    assert.equal(result.ok, false);
    assert.deepEqual(result.verification.commands.map(c => c.args), [["run", "typecheck"]]);
    assert.match(fs.readFileSync(f.spec, "utf8"), /T4:.*\[failed\].*npm run typecheck: exit 3/);
  } finally { fs.rmSync(f.cwd, { recursive: true, force: true }); }
});

test("ambiguous lockfiles fail closed without guessing a manager", async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.cwd, "pnpm-lock.yaml"), "");
    const result = await new StubRunner().executeAutonomousLlmSession(f.options);
    assert.equal(result.ok, false);
    assert.equal(result.verification.commands.length, 0);
    assert.match(result.verification.error || "", /ambigua/);
  } finally { fs.rmSync(f.cwd, { recursive: true, force: true }); }
});

for (const exit of [0, 9]) {
  test(`real npm verification exit ${exit} controls ok independently of stubbed Pi`, async () => {
    const f = fixture({ test: `node -e "console.log('fixture verification'); console.error('fixture stderr'); process.exit(${exit})"` });
    class RealVerificationRunner extends DcWorkerRunner {
      override async runInWorktree(cwd: string, command: string, args: string[]) {
        if (command === "pi" || command === "git") return { stdout: "", stderr: "", exitCode: 0 };
        return super.runInWorktree(cwd, command, args);
      }
    }
    try {
      const result = await new RealVerificationRunner().executeAutonomousLlmSession(f.options);
      assert.equal(result.ok, exit === 0);
      assert.equal(result.verification.commands[0].exitCode, exit);
      assert.match(result.verification.commands[0].stdout, /fixture verification/);
      assert.match(result.verification.commands[0].stderr, /fixture stderr/);
    } finally { fs.rmSync(f.cwd, { recursive: true, force: true }); }
  });
}
