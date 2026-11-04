import test from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as path from "node:path";
import { parseGitHubRepoNwo, resolveCurrentRepoIdentity } from "../src/features/dc-agents/daemon/dc-repo-resolver.ts";
import { DcConflictGuard } from "../src/features/dc-agents/daemon/dc-conflict-guard.ts";
import { DcWebhookReceiver } from "../src/features/dc-agents/daemon/dc-webhook-receiver.ts";
import { DcIssueDispatcher, type GitHubIssuePayload } from "../src/features/dc-agents/daemon/dc-issue-dispatcher.ts";
import { handleToolCall } from "../src/features/dc-scan-guard/index.ts";
import { dcConflictGuard } from "../src/features/dc-agents/daemon/dc-conflict-guard.ts";

test("dc-repo-resolver: parseGitHubRepoNwo extrae owner/repo limpiamente", () => {
  assert.deepEqual(parseGitHubRepoNwo("https://github.com/davidcoachdev/dc-pi.git"), {
    owner: "davidcoachdev",
    repo: "dc-pi",
    fullNwo: "davidcoachdev/dc-pi",
  });

  assert.deepEqual(parseGitHubRepoNwo("git@github.com:davidcoachdev/dc-tts.git"), {
    owner: "davidcoachdev",
    repo: "dc-tts",
    fullNwo: "davidcoachdev/dc-tts",
  });

  assert.deepEqual(parseGitHubRepoNwo("https://github.com/myorg/awesome-project"), {
    owner: "myorg",
    repo: "awesome-project",
    fullNwo: "myorg/awesome-project",
  });

  assert.equal(parseGitHubRepoNwo("https://gitlab.com/other/repo"), null);
  assert.equal(parseGitHubRepoNwo(""), null);
});

test("dc-repo-resolver: resolveCurrentRepoIdentity detecta dinámicamente el repo actual", () => {
  const current = resolveCurrentRepoIdentity();
  assert.ok(current, "Debe detectar el repo actual de dc-pi");
  assert.equal(current?.owner, "davidcoachdev");
  assert.equal(current?.repo, "dc-pi");
  assert.equal(current?.fullNwo, "davidcoachdev/dc-pi");
  assert.ok(current?.repoRoot);
});

test("dc-conflict-guard: reserva y detecta colisiones de archivos", () => {
  const guard = new DcConflictGuard();

  // Reserva de tarea A
  const resA = guard.reserveFiles(["src/ui/dc-window.ts", "src/ui/dc-modal.ts"], "issue-8", "Ventana de admin");
  assert.equal(resA.ok, true);

  // Consulta de conflicto
  const check = guard.checkFileConflict("src/ui/dc-window.ts");
  assert.ok(check);
  assert.equal(check?.taskId, "issue-8");

  // Tarea B intenta tocar el mismo archivo -> Conflicto detectado
  const resB = guard.reserveFiles(["src/ui/dc-window.ts"], "issue-9", "Otro issue");
  assert.equal(resB.ok, false);
  assert.equal(resB.conflicts?.length, 1);
  assert.equal(resB.conflicts?.[0]?.taskId, "issue-8");

  // Liberación de tarea A
  guard.releaseTask("issue-8");
  assert.equal(guard.checkFileConflict("src/ui/dc-window.ts"), undefined);

  // Tarea B ahora sí puede reservar
  const resBRetry = guard.reserveFiles(["src/ui/dc-window.ts"], "issue-9", "Otro issue");
  assert.equal(resBRetry.ok, true);
});

test("dc-webhook-receiver: levanta servidor loopback, procesa webhook y deduplica entregas", async () => {
  let receivedIssue: any = null;

  const receiver = new DcWebhookReceiver({
    port: 4599,
    expectedRepoNwo: "davidcoachdev/dc-pi",
    onIssueOpened: (payload) => {
      receivedIssue = payload;
    },
  });

  const port = await receiver.start();
  assert.equal(receiver.isRunning(), true);
  assert.equal(port, 4599);

  const samplePayload: GitHubIssuePayload = {
    action: "opened",
    issue: {
      number: 8,
      title: "prueba de contexto",
      body: "quiero una ventana para administrar las ventanas",
      user: { login: "davidcoachdev" },
      html_url: "https://github.com/davidcoachdev/dc-pi/issues/8",
    },
    repository: {
      name: "dc-pi",
      full_name: "davidcoachdev/dc-pi",
      owner: { login: "davidcoachdev" },
      html_url: "https://github.com/davidcoachdev/dc-pi",
    },
  };

  // Enviar POST HTTP al receptor local
  await new Promise<void>((resolve, reject) => {
    const data = JSON.stringify(samplePayload);
    const req = http.request(
      `http://127.0.0.1:${port}/github-webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "issues",
          "X-GitHub-Delivery": "delivery-uuid-1",
        },
      },
      (res) => {
        assert.equal(res.statusCode, 202);
        resolve();
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });

  assert.ok(receivedIssue);
  assert.equal(receivedIssue.issue.number, 8);
  assert.equal(receivedIssue.issue.title, "prueba de contexto");

  // Enviar misma entrega (deduplicación por delivery ID)
  await new Promise<void>((resolve, reject) => {
    const data = JSON.stringify(samplePayload);
    const req = http.request(
      `http://127.0.0.1:${port}/github-webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "issues",
          "X-GitHub-Delivery": "delivery-uuid-1", // Mismo delivery ID
        },
      },
      (res) => {
        let respBody = "";
        res.on("data", (chunk) => { respBody += chunk; });
        res.on("end", () => {
          assert.equal(res.statusCode, 200);
          assert.ok(respBody.includes("ignored_duplicate"));
          resolve();
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });

  await receiver.stop();
  assert.equal(receiver.isRunning(), false);
});

test("dc-scan-guard: bloquea herramientas edit/write sobre archivos reservados por conflict guard", () => {
  dcConflictGuard.clear();
  dcConflictGuard.reserveFiles(["src/core/secret.ts"], "issue-8", "Issue #8");

  // Edición de un archivo no reservado -> permitido
  const unreserved = handleToolCall({
    toolName: "edit",
    input: { path: "src/ui/dc-window.ts" },
  });
  assert.equal(unreserved, undefined);

  // 1. Relativo + edit -> BLOQUEADO
  const blockedRelEdit = handleToolCall({
    toolName: "edit",
    input: { path: "src/core/secret.ts" },
  });
  assert.ok(blockedRelEdit);
  assert.equal(blockedRelEdit?.block, true);
  assert.ok(blockedRelEdit?.reason.includes("dc-conflict-guard"));
  assert.ok(blockedRelEdit?.reason.includes("Issue #8"));

  // 2. Relativo + write -> BLOQUEADO
  const blockedRelWrite = handleToolCall({
    toolName: "write",
    input: { path: "src/core/secret.ts" },
  });
  assert.ok(blockedRelWrite);
  assert.equal(blockedRelWrite?.block, true);
  assert.ok(blockedRelWrite?.reason.includes("dc-conflict-guard"));

  // 3. Absoluto + edit -> BLOQUEADO
  const absolutePath = path.resolve(process.cwd(), "src/core/secret.ts");
  const blockedAbsEdit = handleToolCall({
    toolName: "edit",
    input: { path: absolutePath },
  });
  assert.ok(blockedAbsEdit);
  assert.equal(blockedAbsEdit?.block, true);
  assert.ok(blockedAbsEdit?.reason.includes("dc-conflict-guard"));

  // 4. Absoluto + write -> BLOQUEADO
  const blockedAbsWrite = handleToolCall({
    toolName: "write",
    input: { path: absolutePath },
  });
  assert.ok(blockedAbsWrite);
  assert.equal(blockedAbsWrite?.block, true);
  assert.ok(blockedAbsWrite?.reason.includes("dc-conflict-guard"));

  dcConflictGuard.clear();
});

