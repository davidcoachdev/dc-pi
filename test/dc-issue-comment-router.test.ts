import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dc-comment-home-"));
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "xdg");
process.env.PI_CODING_AGENT_DIR = path.join(home, "pi");

const { DcIssueCommentRouter } = await import("../src/features/dc-agents/daemon/dc-issue-comment-router.ts");
const { getCollaboratorsDatabase } = await import("../src/features/dc-agents/daemon/dc-collaborators-db.ts");
import type { GitHubIssueCommentPayload } from "../src/features/dc-agents/daemon/dc-issue-comment-types.ts";

test.after(() => {
  try {
    getCollaboratorsDatabase().close();
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

test("DcIssueCommentRouter: rechaza autores que no son OWNER y procesa comandos del OWNER", async () => {
  const router = DcIssueCommentRouter.getInstance();
  const db = getCollaboratorsDatabase();

  // Asegurar que davidcoachdev es ALLOW y OWNER
  db.setCollaborator("davidcoachdev", "ALLOW", "OWNER");
  db.setCollaborator("external-user", "ALLOW", "CONTRIBUTOR");

  const buildPayload = (author: string, text: string): GitHubIssueCommentPayload => ({
    action: "created",
    issue: {
      number: 16,
      title: "actualización de ventana",
      html_url: "https://github.com/davidcoachdev/dc-pi/issues/16",
      user: { login: "davidcoachdev" },
    },
    comment: {
      id: 12345,
      body: text,
      user: { login: author },
      html_url: "https://github.com/davidcoachdev/dc-pi/issues/16#comment-12345",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    repository: {
      name: "dc-pi",
      full_name: "davidcoachdev/dc-pi",
      owner: { login: "davidcoachdev" },
      html_url: "https://github.com/davidcoachdev/dc-pi",
    },
    sender: { login: author },
  });

  // 1. Autor externo no debe ser procesado
  const resExternal = await router.handleComment(buildPayload("external-user", "¿Cómo vamos?"));
  assert.equal(resExternal.handled, false);
  assert.equal(resExternal.reason, "unauthorized author");

  // 2. Comentario del propio bot ignorado
  const resBot = await router.handleComment(buildPayload("davidcoachdev", "🤖 **DC Super-Agent**: Hola"));
  assert.equal(resBot.handled, false);
  assert.equal(resBot.reason, "ignoring self comment");

  // 3. Consulta de estado del OWNER respondida
  const resOwnerStatus = await router.handleComment(buildPayload("davidcoachdev", "¿Cómo vamos?"));
  assert.equal(resOwnerStatus.handled, true);
  assert.ok(resOwnerStatus.response?.includes("reporte en vivo") || resOwnerStatus.response?.includes("DC Super-Agent"));
});
