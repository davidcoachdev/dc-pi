import test from "node:test";
import assert from "node:assert/strict";
import { DcPrConflictResolver } from "../src/features/dc-agents/daemon/dc-pr-conflict-resolver.ts";
import { dcChatDispatcher } from "../src/features/dc-agents/daemon/dc-chat-dispatcher.ts";

test("DcPrConflictResolver - Instancia singleton existe con interfaz pública", () => {
  const resolver = DcPrConflictResolver.getInstance();
  assert.ok(resolver);
  assert.equal(typeof resolver.resolve, "function");
});

test("DcChatDispatcher - Super-Agente #99 orienta sobre resolución de conflictos", async () => {
  const res = await dcChatDispatcher.dispatch({
    threadId: "general-99",
    sender: "davidcoachdev",
    text: "hay un conflicto en el pr lo puedes resolver",
  });

  assert.equal(res.respondent, "super_agent_99");
  assert.ok(res.reply.includes("Resolución de Conflictos") || res.reply.includes("worktree"));
  assert.ok(res.reply.includes("force-with-lease"));
});
