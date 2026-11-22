import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

import { DcChatDatabase } from "../src/features/dc-agents/daemon/dc-chat-sqlite-db.ts";
import { dcChatDispatcher } from "../src/features/dc-agents/daemon/dc-chat-dispatcher.ts";

test("DcChatDispatcher - Consulta a DC-Control devuelve estado operativo", async () => {
  const tmpDb = path.join(os.tmpdir(), `test-chat-${Date.now()}.db`);
  const db = new DcChatDatabase(tmpDb);

  const resHelp = await dcChatDispatcher.dispatch({
    threadId: "dc-control",
    sender: "davidcoachdev",
    text: "ayuda",
  });

  assert.equal(resHelp.respondent, "dc_control");
  assert.ok(resHelp.reply.includes("Centro de Mando"));

  const resStatus = await dcChatDispatcher.dispatch({
    threadId: "dc-control",
    sender: "davidcoachdev",
    text: "¿qué sesiones hay vivas?",
  });

  assert.equal(resStatus.respondent, "dc_control");
  assert.ok(resStatus.reply.includes("Sesiones") || resStatus.reply.includes("Sin otras sesiones"));

  try {
    fs.unlinkSync(tmpDb);
  } catch {}
});
