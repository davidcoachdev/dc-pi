import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DcPrConflictResolver,
  type ConflictResolutionRequest,
  type ConflictResolverExecCommand,
  type ConflictResolverTaxiLease,
} from "../src/features/dc-agents/daemon/dc-pr-conflict-resolver.ts";
import { DcPrInspectorAgent } from "../src/features/dc-agents/daemon/dc-pr-inspector-agent.ts";
import { DcChatDispatcher, dcChatDispatcher } from "../src/features/dc-agents/daemon/dc-chat-dispatcher.ts";

function makeTempWorktreeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dc-pr-conflict-test-"));
}

function createMockExec(opts: {
  commands: string[];
  conflictFile?: string;
  failTest?: boolean;
  onWorktreeCreated?: (dir: string) => void;
}): ConflictResolverExecCommand {
  return async (file, args) => {
    opts.commands.push(`${file} ${args.join(" ")}`);

    if (file === "git" && args[0] === "worktree" && args[1] === "add") {
      const wtDir = args[2]!;
      fs.mkdirSync(wtDir, { recursive: true });
      if (opts.conflictFile) {
        const target = path.join(wtDir, opts.conflictFile);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "<<<<<<< HEAD\nexport const v = 1;\n=======\nexport const v = 2;\n>>>>>>> feat\n", "utf8");
      }
      opts.onWorktreeCreated?.(wtDir);
      return { stdout: "", stderr: "" };
    }
    if (file === "git" && args[0] === "rebase" && args[1] === "origin/master" && opts.conflictFile) {
      throw new Error(`CONFLICT in ${opts.conflictFile}`);
    }
    if (file === "git" && args[0] === "diff" && args.includes("--diff-filter=U")) {
      return { stdout: opts.conflictFile ? `${opts.conflictFile}\n` : "", stderr: "" };
    }
    if (file === "npm" && args[0] === "test" && opts.failTest) {
      throw new Error("1 test failed");
    }
    if (file === "git" && args[0] === "worktree" && args[1] === "remove") {
      fs.rmSync(args[3]!, { recursive: true, force: true });
    }
    return { stdout: "ok", stderr: "" };
  };
}

test("DcPrConflictResolver - Instancia singleton existe con interfaz pública", () => {
  const resolver = DcPrConflictResolver.getInstance();
  assert.ok(resolver);
  assert.equal(typeof resolver.resolve, "function");
});

test("DcPrInspectorAgent.resolveConflicts - Delega rebase limpio sin conflictos y limpia worktree", async () => {
  const tmpRoot = makeTempWorktreeRoot();
  const commands: string[] = [];
  const notifications: string[] = [];
  let taxiLeased = false;
  let piSpawned = false;

  try {
    const resolver = new DcPrConflictResolver({
      execCommand: createMockExec({ commands }),
      worktreeBaseDir: tmpRoot,
      repoRoot: tmpRoot,
      leaseTaxi: () => { taxiLeased = true; return null; },
      spawnPi: async () => { piSpawned = true; return { exitCode: 0 }; },
      notify: async (_target, msg) => { notifications.push(msg); },
    });

    const inspector = new DcPrInspectorAgent({ conflictResolver: resolver });
    const result = await inspector.resolveConflicts({
      prNumber: 51,
      repoNwo: "davidcoachdev/dc-pi",
      headBranch: "feat/clean-rebase",
      baseBranch: "master",
      authorLogin: "davidcoachdev",
    });

    assert.equal(result.ok, true);
    assert.equal(result.prNumber, 51);
    assert.equal(result.pushed, true);
    assert.deepEqual(result.conflictedFiles, []);
    assert.equal(taxiLeased, false);
    assert.equal(piSpawned, false);
    assert.ok(commands.some((c) => c.startsWith("git worktree add ")));
    assert.ok(commands.includes("git rebase origin/master"));
    assert.ok(commands.includes("git push --force-with-lease origin feat/clean-rebase"));
    assert.ok(commands.filter((c) => c.startsWith("git worktree remove --force ")).length >= 2);
    assert.ok(notifications.some((n) => n.includes("rebasada limpiamente")));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("DcPrConflictResolver - Flujo completo: conflicto -> taxi -> Pi -> cero marcadores -> build+test -> rebase --continue -> push --force-with-lease -> cleanup", async () => {
  const tmpRoot = makeTempWorktreeRoot();
  const commands: string[] = [];
  const notifications: string[] = [];
  const leasedTaxis: ConflictResolverTaxiLease[] = [];
  const releasedTaxis: ConflictResolverTaxiLease[] = [];
  let spawnedArgs: string[] = [];
  let spawnedCwd = "";

  try {
    const resolver = new DcPrConflictResolver({
      execCommand: createMockExec({ commands, conflictFile: "src/app.ts" }),
      worktreeBaseDir: tmpRoot,
      repoRoot: tmpRoot,
      leaseTaxi: ({ sessionId, plate, baseModel, provider }) => {
        const lease: ConflictResolverTaxiLease = { account: "ac07", modelRef: `${provider}/ac07/${baseModel}`, sessionId, plate };
        leasedTaxis.push(lease);
        return lease;
      },
      releaseTaxi: (lease) => { releasedTaxis.push(lease); return true; },
      spawnPi: async ({ cwd, args }) => {
        spawnedCwd = cwd;
        spawnedArgs = args;
        fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const v = 3;\n", "utf8");
        return { exitCode: 0 };
      },
      notify: async (_target, msg) => { notifications.push(msg); },
    });

    const result = await resolver.resolve({
      prNumber: 42,
      repoNwo: "davidcoachdev/dc-pi",
      headBranch: "feat/conflict",
      baseBranch: "master",
      authorLogin: "davidcoachdev",
    });

    assert.equal(result.ok, true);
    assert.equal(result.pushed, true);
    assert.equal(result.leasedAccount, "ac07");
    assert.deepEqual(result.conflictedFiles, ["src/app.ts"]);
    assert.deepEqual(result.resolvedFiles, ["src/app.ts"]);
    assert.equal(leasedTaxis.length, 1);
    assert.equal(releasedTaxis.length, 1);
    assert.equal(releasedTaxis[0]?.plate, leasedTaxis[0]?.plate);
    assert.equal(spawnedArgs[0], "--model");
    assert.ok(spawnedArgs[1]?.startsWith("cpam/ac07/"));
    assert.ok(spawnedArgs.includes("-p") && spawnedArgs.includes("--no-session"));

    const idxBuild = commands.indexOf("npm run build");
    const idxTest = commands.indexOf("npm test");
    const idxContinue = commands.indexOf("git rebase --continue");
    const idxPush = commands.indexOf("git push --force-with-lease origin feat/conflict");
    const idxFinalRemove = commands.map((c) => c.startsWith("git worktree remove --force ")).lastIndexOf(true);

    assert.ok(idxBuild >= 0);
    assert.ok(idxTest > idxBuild);
    assert.ok(idxContinue > idxTest);
    assert.ok(idxPush > idxContinue);
    assert.ok(idxFinalRemove > idxPush);
    assert.equal(fs.existsSync(spawnedCwd), false);
    assert.ok(notifications.some((n) => n.includes("Conflictos resueltos exitosamente")));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("DcPrConflictResolver - Fallo en tests del supervisor aborta rebase, no pushea, libera taxi y limpia worktree", async () => {
  const tmpRoot = makeTempWorktreeRoot();
  const commands: string[] = [];
  const releasedTaxis: ConflictResolverTaxiLease[] = [];
  let createdWorktree = "";

  try {
    const resolver = new DcPrConflictResolver({
      execCommand: createMockExec({
        commands,
        conflictFile: "src/broken.ts",
        failTest: true,
        onWorktreeCreated: (dir) => { createdWorktree = dir; },
      }),
      worktreeBaseDir: tmpRoot,
      repoRoot: tmpRoot,
      leaseTaxi: ({ sessionId, plate, baseModel, provider }) => ({
        account: "ac09",
        modelRef: `${provider}/ac09/${baseModel}`,
        sessionId,
        plate,
      }),
      releaseTaxi: (lease) => { releasedTaxis.push(lease); return true; },
      spawnPi: async ({ cwd }) => {
        fs.writeFileSync(path.join(cwd, "src", "broken.ts"), "export const fixed = true;\n", "utf8");
        return { exitCode: 0 };
      },
      notify: async () => {},
    });

    const result = await resolver.resolve({
      prNumber: 77,
      repoNwo: "davidcoachdev/dc-pi",
      headBranch: "feat/fail-tests",
      baseBranch: "master",
      authorLogin: "davidcoachdev",
    });

    assert.equal(result.ok, false);
    assert.equal(result.pushed, false);
    assert.equal(result.leasedAccount, "ac09");
    assert.ok(result.message.includes("test"));
    assert.ok(commands.includes("npm run build"));
    assert.ok(commands.includes("npm test"));
    assert.ok(commands.includes("git rebase --abort"));
    assert.equal(commands.includes("git rebase --continue"), false);
    assert.equal(commands.some((c) => c.startsWith("git push")), false);
    assert.equal(releasedTaxis.length, 1);
    assert.equal(fs.existsSync(createdWorktree), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("DcPrConflictResolver - Rechazo de cuenta VIP / sin taxis aborta de forma segura sin pushear", async () => {
  const tmpRoot = makeTempWorktreeRoot();
  const commands: string[] = [];
  let piSpawned = false;
  let vipReleased = false;

  try {
    const resolver = new DcPrConflictResolver({
      execCommand: createMockExec({ commands, conflictFile: "README.md" }),
      worktreeBaseDir: tmpRoot,
      repoRoot: tmpRoot,
      leaseTaxi: ({ sessionId, plate }) => ({
        account: "cc4",
        modelRef: "cpam/cc4/gemini-3.8-flash-high",
        sessionId,
        plate,
      }),
      releaseTaxi: (lease) => { if (lease.account === "cc4") vipReleased = true; return true; },
      spawnPi: async () => { piSpawned = true; return { exitCode: 0 }; },
      notify: async () => {},
    });

    const result = await resolver.resolve({
      prNumber: 88,
      repoNwo: "davidcoachdev/dc-pi",
      headBranch: "feat/no-taxi",
      baseBranch: "master",
      authorLogin: "davidcoachdev",
    });

    assert.equal(result.ok, false);
    assert.equal(result.pushed, false);
    assert.equal(piSpawned, false);
    assert.equal(vipReleased, true);
    assert.ok(commands.includes("git rebase --abort"));
    assert.equal(commands.some((c) => c.startsWith("git push")), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("DcChatDispatcher - Super-Agente #99 despacha resolveConflicts cuando recibe número de PR en Chat Global", async () => {
  const dispatched: ConflictResolutionRequest[] = [];
  const dispatcher = new DcChatDispatcher({
    prInspector: {
      getActiveInspections: () => [],
      resolveConflicts: async (target) => {
        dispatched.push(target);
        return {
          ok: true,
          prNumber: target.prNumber,
          conflictedFiles: [],
          resolvedFiles: [],
          message: "ok",
          pushed: true,
        };
      },
    },
  });

  const res1 = await dispatcher.dispatch({
    threadId: "general-99",
    sender: "davidcoachdev",
    text: "resuelve conflictos del PR #42",
  });

  assert.equal(res1.respondent, "super_agent_99");
  assert.ok(res1.reply.includes("#42"));
  assert.ok(res1.reply.includes("Iniciada") || res1.reply.includes("En curso"));
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.prNumber, 42);
  assert.equal(dispatched[0]?.authorLogin, "davidcoachdev");

  const res2 = await dispatcher.dispatch({
    threadId: "general-99",
    sender: "davidcoachdev",
    text: "rebase pr 105",
  });

  assert.equal(res2.respondent, "super_agent_99");
  assert.ok(res2.reply.includes("#105"));
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1]?.prNumber, 105);
});

test("DcChatDispatcher - Super-Agente #99 orienta sobre resolución de conflictos si no se indica PR", async () => {
  let called = false;
  const dispatcher = new DcChatDispatcher({
    prInspector: {
      getActiveInspections: () => [],
      resolveConflicts: async (target) => {
        called = true;
        return {
          ok: true,
          prNumber: target.prNumber,
          conflictedFiles: [],
          resolvedFiles: [],
          message: "ok",
          pushed: true,
        };
      },
    },
  });

  const res = await dispatcher.dispatch({
    threadId: "general-99",
    sender: "davidcoachdev",
    text: "hay un conflicto en el pr lo puedes resolver",
  });

  assert.equal(called, false, "No debe despachar sin número de PR");
  assert.equal(res.respondent, "super_agent_99");
  assert.ok(res.reply.includes("Resolución de Conflictos") || res.reply.includes("worktree"));
  assert.ok(res.reply.includes("force-with-lease"));

  // Verificar también singleton
  const singletonRes = await dcChatDispatcher.dispatch({
    threadId: "general-99",
    sender: "davidcoachdev",
    text: "hay un conflicto en el pr lo puedes resolver",
  });
  assert.equal(singletonRes.respondent, "super_agent_99");
  assert.ok(singletonRes.reply.includes("force-with-lease"));
});
