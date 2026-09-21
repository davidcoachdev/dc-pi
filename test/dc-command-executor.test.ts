import test from "node:test";
import assert from "node:assert/strict";
import { executeSlashCommand } from "../src/core/dc-command-executor.ts";

test("executeSlashCommand executes slash command via session.prompt", async () => {
  let executedPrompt = "";
  const mockSession = {
    prompt: async (text: string) => {
      executedPrompt = text;
    },
  };

  const mockCtx = {
    session: mockSession,
  } as any;

  const res = await executeSlashCommand(mockCtx, "/mcp", "MCP");
  assert.equal(res, true);
  assert.equal(executedPrompt, "/mcp");
});

test("executeSlashCommand notifies error if command fails or is unavailable", async () => {
  let notifiedTitle = "";
  let notifiedMsg = "";
  let notifiedType = "";

  const mockCtx = {
    ui: {
      notify: (text: string, type: string) => {
        notifiedMsg = text;
        notifiedType = type;
      },
    },
  } as any;

  const res = await executeSlashCommand(mockCtx, "/nonexistent-cmd", "Prueba");
  assert.equal(res, false);
  assert.ok(notifiedMsg.includes("No se pudo abrir /nonexistent-cmd"));
  assert.equal(notifiedType, "error");
});
