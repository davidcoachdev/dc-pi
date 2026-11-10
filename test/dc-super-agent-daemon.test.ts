import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

// Isolate before any singleton import, including parallel focused-suite runs.
const home = fs.mkdtempSync(path.join(os.homedir(), "dc-daemon-home-"));
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "xdg");
process.env.PI_CODING_AGENT_DIR = path.join(home, "pi");
test.after(async () => {
  const { getCollaboratorsDatabase } = await import("../src/features/dc-agents/daemon/dc-collaborators-db.ts");
  getCollaboratorsDatabase().close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("public daemon preserves one launch and records actual worker/delivery outcomes", async (t) => {
  fs.mkdirSync(os.homedir(), { recursive: true });
  const root = fs.mkdtempSync(path.join(os.homedir(), "daemon-fixture-"));
  const git = (...args: string[]) => childProcess.execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(path.join(root, "tracked"), "base"); git("add", "."); git("commit", "-m", "fixture");
  git("remote", "add", "origin", "https://github.com/fixture/daemon-fixture.git");
  const logs: string[] = [];
  let prepares = 0, workers = 0, deliveries = 0, cleanups = 0;
  let releaseWorker!: () => void;
  const workerGate = new Promise<void>(resolve => { releaseWorker = resolve; });
  let workerStarted!: () => void;
  const started = new Promise<void>(resolve => { workerStarted = resolve; });
  let cleaned!: () => void;
  const finished = new Promise<void>(resolve => { cleaned = resolve; });
  let now = 1_800_000_000_000;
  const clock = mock.method(Date, "now", () => now);
  let outcome = "success";
  const preparedPlan = { leasedAccount: "fixture", fullModelRef: "fixture/model", tools: ["read"], effectiveEffort: "low", agentFilePath: "unused" };
  const launches: unknown[] = [];
  const history: { startedAt: number; endedAt: number; status: string; error?: string }[] = [];
  const actualRunner = await import("../src/features/dc-agents/daemon/dc-worker-runner.ts");
  const runner = Object.create(actualRunner.dcWorkerRunner);
  runner.executeAutonomousLlmSession = async (options: unknown) => {
    launches.push(options);
    workers++; workerStarted(); await workerGate;
    now += 100;
    if (outcome === "worker-throw") throw new Error("worker crashed");
    return { ok: outcome !== "verification-failed", exitCode: 0, stdout: "", stderr: "", filesModified: [],
      verification: { ok: outcome !== "verification-failed", commands: outcome === "verification-failed"
        ? [{ command: "pnpm", args: ["run", "test"], exitCode: 7, stdout: "", stderr: "assertion failed" }] : [] } };
  };
  mock.module("../src/features/dc-agents/daemon/dc-worker-runner.js", { namedExports: {
    dcWorkerRunner: runner, updateWorktreeOddRoadmap: actualRunner.updateWorktreeOddRoadmap,
  } });
  mock.module("../src/features/dc-agents/core/dc-ephemeral-manager.js", { namedExports: {
    prepareEphemeralAgent: () => { prepares++; return preparedPlan; },
    cleanupEphemeralAgent: (_plan: unknown, result: typeof history[number]) => { history.push(result); cleanups++; cleaned(); },
  } });
  mock.module("../src/features/dc-agents/daemon/dc-pr-delivery.js", { namedExports: {
    dcPrDelivery: { deliverIssue: async (options: { baseBranch: string }) => {
      deliveries++; assert.equal(options.baseBranch, "main");
      now += 250;
      if (outcome === "delivery-throw") throw new Error("delivery crashed");
      if (outcome === "delivery-failed") return { ok: false, error: "push rejected" };
      return { ok: true, prUrl: "fixture" };
    } },
  } });
  mock.module("../src/integrations/dc-notify/dc-notifier.js", { namedExports: {
    dcNotifier: { notify: (...args: unknown[]) => { logs.push(JSON.stringify(args)); }, notifyHerdr: (message: string) => { logs.push(message); } },
  } });
  let forwardingUrl = "";
  const tunnel = new EventEmitter() as EventEmitter & { kill: () => boolean; unref: () => void };
  tunnel.kill = () => true; tunnel.unref = () => {};
  const spawnMock = mock.method(childProcess, "spawn", (command: string, args: string[]) => {
    assert.equal(command, "gh");
    assert.equal(args[0], "webhook");
    assert.equal(args[1], "forward");
    assert.equal(args[2], "--repo=fixture/daemon-fixture");
    assert.ok(args[3]?.startsWith("--events="));
    forwardingUrl = args.find(arg => arg.startsWith("--url="))!.slice(6);
    return tunnel;
  });
  syncBuiltinESMExports();
  const { getCollaboratorsDatabase } = await import("../src/features/dc-agents/daemon/dc-collaborators-db.ts");
  getCollaboratorsDatabase().setCollaborator("fixture-author", "ALLOW", "CONTRIBUTOR", "fixture");
  const { DcControlDaemonManager, DcWebhookDaemonManager } = await import("../src/features/dc-agents/daemon/dc-control-daemon-manager.ts");
  const manager = DcControlDaemonManager.getInstance();
  const { registerControlDaemonCommands, registerWebhookDaemonCommands } = await import("../src/features/dc-agents/daemon/dc-control-commands.ts");
  const { dcIssueDispatcher } = await import("../src/features/dc-agents/daemon/dc-issue-dispatcher.ts");
  const commands = new Map<string, any>();
  let shutdown: any;
  let manualNumber = 99;
  let manualAuthor = "fixture-author";
  let manualRepo = "fixture/daemon-fixture";
  let manualDetail: unknown;
  const ctx: any = { cwd: root, hasUI: true, mode: "tui", ui: {
    select: async (_title: string, options: string[]) => options[0], confirm: async () => true,
  } };
  const detail = () => ({ number: manualNumber, title: "fixture", body: "body", author: { login: manualAuthor },
    url: `https://github.com/${manualRepo}/issues/${manualNumber}`, state: "OPEN", labels: [] });
  registerControlDaemonCommands({ registerCommand: (name: string, command: any) => commands.set(name, command), registerShortcut: () => {},
    on: (name: string, handler: any) => { if (name === "session_shutdown") shutdown = handler; },
    exec: async (_command: string, args: string[], options: { cwd: string }) => {
      assert.equal(options.cwd, ctx.cwd);
      assert.equal(args[args.indexOf("--repo") + 1], manualRepo);
      return { code: 0, stdout: JSON.stringify(args[1] === "list" ? [detail()] : manualDetail ?? detail()), stderr: "", killed: false };
    },
  } as any);
  const check = () => commands.get("dc-control").handler("check", ctx);
  try {
    // Manual dispatch works before any receiver/tunnel exists, using the actual singleton dispatcher.
    assert.equal(manager.getStatus().running, false);
    await check(); await started;
    assert.equal(prepares, 1); assert.equal(workers, 1);
    assert.equal(manager.getStatus().running, false);
    await check(); assert.equal(prepares, 1);
    await manager.start({ cwd: root, hasUI: false } as Parameters<typeof manager.start>[0]);
    const url = new URL(forwardingUrl);
    const secret = url.searchParams.get("capability")!;
    assert.equal(url.hostname, "127.0.0.1"); assert.match(secret, /^[a-f0-9]{64}$/);
    const payload = { action: "opened", issue: { number: 99, title: "fixture", body: "body", user: { login: "fixture-author" } }, repository: { full_name: "fixture/daemon-fixture" } };
    const send = async (delivery: string, target = forwardingUrl) => {
      const response = await fetch(target, { method: "POST", headers: { "x-github-event": "issues", "x-github-delivery": delivery }, body: JSON.stringify(payload) });
      const text = await response.text(); assert.ok(!text.includes(secret)); return response.status;
    };
    assert.equal(await send("first", `${url.origin}${url.pathname}`), 401);
    assert.deepEqual(await Promise.all([send("first"), send("second"), send("third")]), [202, 202, 202]);
    await started;
    assert.equal(prepares, 1); assert.equal(workers, 1); assert.equal(deliveries, 0);
    assert.equal(await send("fourth"), 202);
    assert.equal(prepares, 1); assert.equal(workers, 1);
    releaseWorker(); await finished;
    assert.equal(deliveries, 1); assert.equal(cleanups, 1);
    await t.test("prepared plan is forwarded exactly and success records measured duration", () => {
      assert.equal((launches[0] as { preparedAgent: unknown }).preparedAgent, preparedPlan);
      assert.equal(history[0].status, "completed");
      assert.equal(history[0].startedAt, 1_800_000_000_000);
      assert.equal(history[0].endedAt, 1_800_000_000_350);
      assert.equal(history[0].error, undefined);
    });
    assert.equal(await send("fifth"), 202);
    assert.equal(prepares, 1); assert.equal(workers, 1); assert.equal(deliveries, 1);
    await t.test("rejected manual details and BLOCK author preserve actual dispatcher state", async () => {
      const before = dcIssueDispatcher.getActiveDispatches();
      const counts = [prepares, workers, deliveries, cleanups];
      manualNumber = 220;
      manualDetail = { ...detail(), state: "CLOSED" };
      await check();
      assert.deepEqual(dcIssueDispatcher.getActiveDispatches(), before);
      assert.deepEqual([prepares, workers, deliveries, cleanups], counts);
      manualDetail = undefined;
      manualAuthor = "blocked-author";
      getCollaboratorsDatabase().setCollaborator(manualAuthor, "BLOCK", "EXTERNAL", "fixture");
      await check();
      assert.deepEqual(dcIssueDispatcher.getActiveDispatches(), before);
      assert.deepEqual([prepares, workers, deliveries, cleanups], counts);
      assert.ok(logs.some(log => log.includes("bloqueado")));
      manualAuthor = "fixture-author";
    });
    await t.test("manual B leaves listener A unchanged and concurrent webhook/manual share one claim", async () => {
      const other = path.join(home, "repo-b"); fs.mkdirSync(other);
      const gitB = (...args: string[]) => childProcess.execFileSync("git", ["-C", other, ...args], { stdio: "ignore" });
      gitB("init", "-b", "main"); gitB("config", "user.name", "Fixture"); gitB("config", "user.email", "fixture@example.invalid");
      fs.writeFileSync(path.join(other, "tracked"), "base"); gitB("add", "."); gitB("commit", "-m", "fixture");
      gitB("remote", "add", "origin", "https://github.com/fixture/other.git");
      const previous = manager.getStatus();
      ctx.cwd = other; manualRepo = "fixture/other"; manualNumber = 230;
      const done = new Promise<void>(resolve => { cleaned = resolve; });
      await check(); await done;
      assert.equal(manager.getStatus().repo, previous.repo);
      assert.equal(manager.getStatus().port, previous.port);
      assert.equal(manager.getStatus().running, true);
      assert.equal(manager.getStatus().tunnelActive, previous.tunnelActive);
      ctx.cwd = root; manualRepo = "fixture/daemon-fixture"; manualNumber = 231;
      payload.issue.number = manualNumber;
      const counts = [prepares, workers, deliveries, cleanups];
      const concurrentDone = new Promise<void>(resolve => { cleaned = resolve; });
      await Promise.all([check(), send("concurrent-one"), send("concurrent-two")]);
      await concurrentDone;
      assert.deepEqual([prepares, workers, deliveries, cleanups], counts.map(count => count + 1));
      await check(); assert.equal(prepares, counts[0] + 1);
    });
    for (const [scenario, expectedError, duration, deliveryCount] of [
      ["verification-failed", /pnpm run test.*exit 7.*assertion failed/, 100, 0],
      ["delivery-failed", /push rejected/, 350, 1],
      ["worker-throw", /worker crashed/, 100, 0],
      ["delivery-throw", /delivery crashed/, 350, 1],
    ] as const) {
      await t.test(`${scenario} records failure and cleans up exactly once`, async () => {
        outcome = scenario;
        payload.issue.number++;
        now += 1000;
        const startedAt = now;
        const previousDeliveries = deliveries;
        const previousCleanups = cleanups;
        const completed = new Promise<void>(resolve => { cleaned = resolve; });
        assert.equal(await send(scenario), 202);
        await completed;
        assert.equal(cleanups, previousCleanups + 1);
        assert.equal(deliveries, previousDeliveries + deliveryCount);
        const result = history.at(-1)!;
        assert.equal(result.status, "failed");
        assert.equal(result.startedAt, startedAt);
        assert.equal(result.endedAt, startedAt + duration);
        assert.match(result.error || "", expectedError);
        if (scenario === "verification-failed") assert.doesNotMatch(result.error || "", /exit code 0/);
      });
    }
    tunnel.emit("error", new Error(`simulated failure ${forwardingUrl}`));
    assert.ok(!JSON.stringify(manager.getStatus()).includes(secret));
    assert.ok(!logs.join("\n").includes(secret));
  } finally {
    releaseWorker(); await shutdown({ reason: "reload" }); await manager.stop(); spawnMock.mock.restore(); clock.mock.restore(); syncBuiltinESMExports(); mock.restoreAll();
  }
});
