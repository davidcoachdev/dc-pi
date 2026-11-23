import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

import { DcPrInspectorAgent } from "../src/features/dc-agents/daemon/dc-pr-inspector-agent.ts";
import { dcChatDispatcher } from "../src/features/dc-agents/daemon/dc-chat-dispatcher.ts";

test("DcPrInspectorAgent - Inspección de Pull Request genera veredicto objetivo", async () => {
  const inspector = DcPrInspectorAgent.getInstance();

  const result = await inspector.inspectPullRequest({
    prNumber: 42,
    repoNwo: "davidcoachdev/dc-pi",
    headBranch: "feat/test-pr",
    baseBranch: "master",
    authorLogin: "colaborador",
    title: "Nueva funcionalidad de prueba",
    worktreePath: process.cwd(),
  });

  assert.equal(result.prNumber, 42);
  assert.ok(["APPROVE", "REQUEST_CHANGES", "NEEDS_DISCUSSION"].includes(result.verdict));
  assert.ok(result.summary.includes("Inspección de Calidad"));
  assert.ok(typeof result.blastRadius.filesChanged === "number");
  assert.ok(result.checks.buildPassed === true || result.checks.buildPassed === false);

  const stored = inspector.getInspection(42);
  assert.ok(stored);
  assert.equal(stored?.prNumber, 42);
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
  assert.ok(resStatus.reply.includes("PR #42") || resStatus.reply.includes("no hay Pull Requests"));
});
