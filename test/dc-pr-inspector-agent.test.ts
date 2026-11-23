import test from "node:test";
import assert from "node:assert/strict";

import {
  DcPrInspectorAgent,
  type PrInspectorExecCommand,
} from "../src/features/dc-agents/daemon/dc-pr-inspector-agent.ts";
import { dcChatDispatcher } from "../src/features/dc-agents/daemon/dc-chat-dispatcher.ts";

function createMockExec(config: {
  gitDiffStat?: string;
  buildError?: string;
  testError?: string;
  calls?: string[];
}): PrInspectorExecCommand {
  return async (file, args) => {
    const commandKey = `${file} ${args.join(" ")}`;
    config.calls?.push(commandKey);

    if (file === "git" && args[0] === "diff") {
      return {
        stdout: config.gitDiffStat ?? " 3 files changed, 45 insertions(+), 12 deletions(-)\n",
        stderr: "",
      };
    }

    if (file === "npm" && args[0] === "run" && args[1] === "build") {
      if (config.buildError) {
        const err = Object.assign(new Error(config.buildError), { stdout: config.buildError });
        throw err;
      }
      return { stdout: "build ok", stderr: "" };
    }

    if (file === "npm" && args[0] === "test") {
      if (config.testError) {
        const err = Object.assign(new Error(config.testError), { stdout: config.testError });
        throw err;
      }
      return { stdout: "tests ok", stderr: "" };
    }

    throw new Error(`Unexpected command in mock: ${commandKey}`);
  };
}

test("DcPrInspectorAgent - Inspección limpia genera veredicto APPROVE", async () => {
  const inspector = DcPrInspectorAgent.getInstance();
  const calls: string[] = [];

  const result = await inspector.inspectPullRequest(
    {
      prNumber: 42,
      repoNwo: "davidcoachdev/dc-pi",
      headBranch: "feat/test-pr",
      baseBranch: "master",
      authorLogin: "colaborador",
      title: "Nueva funcionalidad de prueba",
      worktreePath: process.cwd(),
    },
    { execCommand: createMockExec({ calls }) },
  );

  assert.equal(result.prNumber, 42);
  assert.equal(result.verdict, "APPROVE");
  assert.ok(result.summary.includes("Inspección de Calidad"));
  assert.ok(result.summary.includes("**APPROVE**"));
  assert.equal(result.blastRadius.filesChanged, 3);
  assert.equal(result.blastRadius.insertions, 45);
  assert.equal(result.blastRadius.deletions, 12);
  assert.equal(result.blastRadius.isOversized, false);
  assert.equal(result.checks.buildPassed, true);
  assert.equal(result.checks.testsPassed, true);
  assert.equal(result.comments.length, 0);
  assert.deepEqual(calls, [
    "git diff --shortstat origin/master...HEAD",
    "npm run build",
    "npm test",
  ]);

  const stored = inspector.getInspection(42);
  assert.ok(stored);
  assert.equal(stored?.prNumber, 42);
});

test("DcPrInspectorAgent - Fallo en tests genera veredicto REQUEST_CHANGES", async () => {
  const inspector = new DcPrInspectorAgent({
    execCommand: createMockExec({
      testError: "AssertionError: expected 1 to equal 2",
    }),
  });

  const result = await inspector.inspectPullRequest({
    prNumber: 43,
    repoNwo: "davidcoachdev/dc-pi",
    headBranch: "fix/failing-test",
    baseBranch: "master",
    authorLogin: "colaborador",
    title: "PR con test fallido",
    worktreePath: process.cwd(),
  });

  assert.equal(result.prNumber, 43);
  assert.equal(result.verdict, "REQUEST_CHANGES");
  assert.equal(result.checks.buildPassed, true);
  assert.equal(result.checks.testsPassed, false);
  assert.ok(result.summary.includes("Inspección de Calidad"));
  assert.ok(result.summary.includes("**REQUEST_CHANGES**"));
  assert.ok(result.summary.includes("❌ Fallidos"));
  assert.equal(result.comments.length, 1);
  assert.ok(result.comments[0]?.body.includes("Fallo de Tests"));
  assert.ok(result.comments[0]?.body.includes("AssertionError"));
});

test("DcPrInspectorAgent - Fallo en build genera veredicto REQUEST_CHANGES", async () => {
  const inspector = new DcPrInspectorAgent({
    execCommand: createMockExec({
      buildError: "error TS2322: Type 'string' is not assignable to type 'number'",
    }),
  });

  const result = await inspector.inspectPullRequest({
    prNumber: 44,
    repoNwo: "davidcoachdev/dc-pi",
    headBranch: "fix/failing-build",
    baseBranch: "master",
    authorLogin: "colaborador",
    title: "PR con error de compilación",
    worktreePath: process.cwd(),
  });

  assert.equal(result.prNumber, 44);
  assert.equal(result.verdict, "REQUEST_CHANGES");
  assert.equal(result.checks.buildPassed, false);
  assert.equal(result.checks.testsPassed, true);
  assert.ok(result.summary.includes("**REQUEST_CHANGES**"));
  assert.ok(result.summary.includes("❌ Fallido"));
  assert.equal(result.comments.length, 1);
  assert.ok(result.comments[0]?.body.includes("Fallo de Compilación"));
  assert.ok(result.comments[0]?.body.includes("TS2322"));
});

test("DcPrInspectorAgent - Blast radius excesivo genera veredicto NEEDS_DISCUSSION", async () => {
  const inspector = new DcPrInspectorAgent({
    execCommand: createMockExec({
      gitDiffStat: " 12 files changed, 350 insertions(+), 120 deletions(-)\n",
    }),
  });

  const result = await inspector.inspectPullRequest({
    prNumber: 45,
    repoNwo: "davidcoachdev/dc-pi",
    headBranch: "feat/large-pr",
    baseBranch: "master",
    authorLogin: "colaborador",
    title: "PR con blast radius alto",
    worktreePath: process.cwd(),
  });

  assert.equal(result.prNumber, 45);
  assert.equal(result.verdict, "NEEDS_DISCUSSION");
  assert.equal(result.blastRadius.filesChanged, 12);
  assert.equal(result.blastRadius.insertions, 350);
  assert.equal(result.blastRadius.deletions, 120);
  assert.equal(result.blastRadius.isOversized, true);
  assert.equal(result.checks.buildPassed, true);
  assert.equal(result.checks.testsPassed, true);
  assert.equal(result.comments.length, 1);
  assert.ok(result.comments[0]?.body.includes("Blast Radius Alto"));
});

test("DcChatDispatcher - Consulta a la Super-Agente #99 en el Chat Global", async () => {
  const resHelp = await dcChatDispatcher.dispatch({
    threadId: "general-99",
    sender: "davidcoachdev",
    text: "ayuda",
  });

  assert.equal(resHelp.respondent, "super_agent_99");
  assert.ok(resHelp.reply.includes("Super-Agente #99"));

  const resStatus = await dcChatDispatcher.dispatch({
    threadId: "general-99",
    sender: "davidcoachdev",
    text: "¿qué has revisado?",
  });

  assert.equal(resStatus.respondent, "super_agent_99");
  assert.ok(resStatus.reply.includes("PR #42"));
});
